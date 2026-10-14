import { app, BrowserWindow, ipcMain, session, desktopCapturer, systemPreferences, safeStorage, dialog, clipboard, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Store } from './store.js';
import { TranscriptionSession } from './deepgram.js';
import { streamClaude } from './llm.js';
import { ENHANCE_SYSTEM, enhanceUserMessage, CHAT_SYSTEM, meetingContext, libraryContext } from './prompts.js';
import { findTemplate } from '../shared/templates.js';
import { setupUpdater } from './updater.js';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const here = import.meta.dirname;
const isMac = process.platform === 'darwin';

let win;
let store;
let live = null; // { meetingId, session }
let updater;
const aborts = new Map(); // requestId -> AbortController

// Lets tests or IT point the app at a different data folder.
if (process.env.TRAILMIX_DATA_DIR) app.setPath('userData', process.env.TRAILMIX_DATA_DIR);

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: 'Trailmix',
    backgroundColor: '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(here, '..', 'dist', 'index.html'));

  // Links in notes open in the user's browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });

  if (process.env.TRAILMIX_LOG_CONSOLE) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  }
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------- system audio ----------
// getDisplayMedia() in the renderer lands here. Granting `audio: 'loopback'` gives us the
// computer's output audio (the other meeting participants). On macOS 14.2+ Electron uses
// Apple's Core Audio tap; on Windows it's WASAPI loopback. The video track is discarded.
function setupDisplayMedia() {
  // Chromium needs a video source alongside the loopback audio. Using our own window
  // (request.frame) avoids listing screens, which on macOS requires the Screen
  // Recording permission and fails with "Failed to get sources" without it.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame) return callback({ video: request.frame, audio: 'loopback' });
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      callback(sources.length ? { video: sources[0], audio: 'loopback' } : {});
    } catch (err) {
      console.error('display media request failed', err);
      callback({});
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });
}

// ---------- IPC ----------
function registerIpc() {
  const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));

  handle('settings:get', () => store.settings());
  handle('settings:set', (patch) => store.saveSettings(patch));

  handle('meetings:list', () => store.list());
  handle('meetings:search', (q) => store.search(q));
  handle('meetings:get', (id) => store.get(id));
  handle('meetings:create', (fields) => {
    const s = store.settings();
    return store.create({ templateId: s.defaultTemplateId, ...fields });
  });
  handle('meetings:patch', (id, fields) => {
    store.patch(id, fields);
    return true;
  });
  handle('meetings:delete', async (id) => {
    if (live?.meetingId === id) await stopLive();
    store.remove(id);
    return true;
  });

  handle('system:permissions', async () => {
    if (!isMac) return { mic: 'granted', screen: 'granted', platform: process.platform };
    return {
      platform: process.platform,
      mic: systemPreferences.getMediaAccessStatus('microphone'),
      screen: systemPreferences.getMediaAccessStatus('screen'),
    };
  });
  handle('system:askMic', async () => (isMac ? systemPreferences.askForMediaAccess('microphone') : true));
  handle('system:openPrivacy', (pane) => {
    if (!isMac) return shell.openExternal('ms-settings:privacy-microphone');
    const anchor = pane === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Microphone';
    return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
  });
  handle('system:openDataFolder', () => shell.openPath(app.getPath('userData')));

  // ----- transcription -----
  handle('transcribe:start', async ({ meetingId, sampleRate }) => {
    if (live) await stopLive();
    const { deepgramKey } = store.secrets();
    if (!deepgramKey) throw new Error('Add your Deepgram API key in Settings to start transcribing.');
    const s = store.settings();
    const meeting = store.get(meetingId);
    const offsetSec = meeting.transcript.reduce((m, seg) => Math.max(m, seg.end || 0), 0);
    const session = new TranscriptionSession({
      apiKey: deepgramKey,
      model: s.deepgramModel,
      language: s.language,
      keyterms: (s.keyterms || '').split(/[,\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 50),
      sampleRate,
      offsetSec,
    });
    let n = 0;
    session.on('transcript', (t) => {
      if (t.isFinal && t.text.trim()) {
        const seg = { id: `${Date.now().toString(36)}-${n++}`, channel: t.channel, speaker: t.speaker, text: t.text.trim(), start: t.start, end: t.end };
        store.appendSegment(meetingId, seg);
        send('transcribe:event', { type: 'final', meetingId, segment: seg });
      } else if (!t.isFinal) {
        send('transcribe:event', { type: 'interim', meetingId, channel: t.channel, text: t.text });
      }
    });
    session.on('status', (st) => send('transcribe:event', { type: 'status', meetingId, ...st }));
    session.on('error', (err) => send('transcribe:event', { type: 'error', meetingId, message: err.message }));
    session.start();
    live = { meetingId, session };
    return true;
  });

  ipcMain.on('transcribe:audio', (_e, buf) => live?.session.sendAudio(Buffer.from(buf)));
  handle('transcribe:stop', () => stopLive());

  // ----- AI -----
  handle('ai:enhance', async ({ requestId, meetingId, templateId }) => {
    const s = store.settings();
    const { anthropicKey } = store.secrets();
    const meeting = store.get(meetingId);
    const template = findTemplate(templateId || meeting.templateId || s.defaultTemplateId, s.customTemplates);
    const ctrl = new AbortController();
    aborts.set(requestId, ctrl);
    try {
      const { text } = await streamClaude({
        apiKey: anthropicKey,
        model: s.claudeModel,
        system: ENHANCE_SYSTEM,
        messages: [{ role: 'user', content: enhanceUserMessage(meeting, template, s.myName) }],
        effort: 'medium',
        signal: ctrl.signal,
        onDelta: (d) => send('ai:delta', { requestId, text: d }),
      });
      const fields = { enhanced: text.trim(), templateId: template.id };
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      if (title && !meeting.title.trim()) fields.title = title;
      store.patch(meetingId, fields);
      return fields;
    } finally {
      aborts.delete(requestId);
    }
  });

  handle('ai:chat', async ({ requestId, meetingId, messages }) => {
    const s = store.settings();
    const { anthropicKey } = store.secrets();
    const context = meetingId
      ? meetingContext(store.get(meetingId), s.myName)
      : libraryContext(store.all(), s.myName);
    const ctrl = new AbortController();
    aborts.set(requestId, ctrl);
    try {
      const { text } = await streamClaude({
        apiKey: anthropicKey,
        model: s.claudeModel,
        // Meeting material is a stable prefix, so cache it across follow-up questions.
        system: [
          { type: 'text', text: CHAT_SYSTEM },
          { type: 'text', text: context || '(No meetings yet.)', cache_control: { type: 'ephemeral' } },
        ],
        messages,
        effort: 'low',
        maxTokens: 16000,
        signal: ctrl.signal,
        onDelta: (d) => send('ai:delta', { requestId, text: d }),
      });
      return { text };
    } finally {
      aborts.delete(requestId);
    }
  });

  handle('ai:cancel', (requestId) => aborts.get(requestId)?.abort());

  // ----- updates -----
  handle('update:status', () => updater.status());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());

  // ----- export -----
  handle('export:copy', ({ text, html }) => {
    clipboard.write({ text, html });
    return true;
  });
  handle('export:saveMarkdown', async ({ title, markdown }) => {
    const safe = (title || 'Meeting notes').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `${safe}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, markdown);
    return true;
  });
}

async function stopLive() {
  if (!live) return;
  const { session, meetingId } = live;
  live = null;
  await session.stop();
  store.flush(meetingId);
  send('transcribe:event', { type: 'status', meetingId, state: 'stopped' });
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), safeStorage);
  setupDisplayMedia();
  updater = setupUpdater({ send, isRecording: () => !!live });
  registerIpc();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('before-quit', () => store?.flushAll());
app.on('window-all-closed', async () => {
  await stopLive();
  store?.flushAll();
  if (!isMac) app.quit();
});
