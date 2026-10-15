import { app, BrowserWindow, ipcMain, session, desktopCapturer, systemPreferences, safeStorage, dialog, clipboard, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Store } from './store.js';
import { TranscriptionSession } from './deepgram.js';
import { streamClaude } from './llm.js';
import { ENHANCE_SYSTEM, enhanceUserMessage, CHAT_SYSTEM, meetingContext, libraryContext } from './prompts.js';
import { findTemplate } from '../shared/templates.js';
import { setupUpdater } from './updater.js';
import { CoreClient, CORE_URLS, PROTOCOL, connectUrl, parseConnectLink, pair } from './core.js';

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

// ---------- trailmix:// links (CG Core sign-in) ----------
// Only the installed app registers the scheme, so a dev copy never hijacks it; in dev,
// use "paste the code" in Settings instead.
let pendingLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)) || null;
if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
// One running copy owns trailmix:// links. Dev builds skip this so they can run beside
// the installed app.
if (app.isPackaged && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleLink(link);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('open-url', (e, link) => {
  e.preventDefault();
  if (store) handleLink(link);
  else pendingLink = link;
});

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

// ---------- CG Core ----------
let pairing = null; // { state, url, timer }

function coreClient() {
  const { coreToken } = store.secrets();
  if (!coreToken) return null;
  return new CoreClient({ baseUrl: store.settings().coreUrl, token: coreToken });
}

function deviceName() {
  try {
    if (isMac) return execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim();
  } catch {}
  return os.hostname().replace(/\.local$/, '');
}

function coreStatus(extra = {}) {
  send('core:status', { ...store.settings().core, pairing: !!pairing, ...extra });
}

async function refreshCore() {
  const core = coreClient();
  if (!core) return;
  try {
    store.setCore({ info: await core.me() });
    coreStatus();
  } catch (err) {
    if (err.unauthorized) signOutLocal(err.message);
    // Offline: keep the cached info and try again later.
  }
}

function signOutLocal(message) {
  store.setCore({ token: '', info: null });
  coreStatus(message ? { error: message } : {});
}

async function completePairing(code, state) {
  if (!pairing || state !== pairing.state) {
    coreStatus({ error: 'That sign-in link is out of date. Start the sign-in again from Settings.' });
    return;
  }
  const { url } = pairing;
  clearTimeout(pairing.timer);
  pairing = null;
  try {
    const res = await pair(url, { code, state, deviceName: deviceName(), platform: process.platform, appVersion: app.getVersion() });
    store.setCore({ token: res.token, url, info: { staff: res.staff, device: res.device } });
    await refreshCore();
    coreStatus({ justConnected: true });
  } catch (err) {
    coreStatus({ error: err.message });
  }
  if (win) win.focus();
}

function handleLink(link) {
  const parsed = parseConnectLink(link);
  if (parsed) completePairing(parsed.code, parsed.state);
}

// Claude through CG Core when signed in, otherwise with the user's own key.
async function aiStream({ purpose, system, messages, effort, maxTokens, signal, onDelta }) {
  const s = store.settings();
  const core = coreClient();
  if (core && !s.ownKeys.anthropic) {
    const cfg = s.core.config || {};
    const model = cfg.claudeModels?.includes(s.claudeModel) ? s.claudeModel : cfg.defaultClaudeModel;
    try {
      return await core.streamClaude({ purpose, model, system, messages, effort, maxTokens, onDelta, signal });
    } catch (err) {
      if (err.unauthorized) signOutLocal(err.message);
      throw err;
    }
  }
  return streamClaude({ apiKey: store.secrets().anthropicKey, model: s.claudeModel, system, messages, effort, maxTokens, onDelta, signal });
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
    const s = store.settings();
    const core = coreClient();
    if (!deepgramKey && !core) throw new Error('Sign in with CG Core (or add a Deepgram key) in Settings to start transcribing.');
    const meeting = store.get(meetingId);
    const offsetSec = meeting.transcript.reduce((m, seg) => Math.max(m, seg.end || 0), 0);
    const viaCore = core && !deepgramKey;
    const org = viaCore ? s.core.config || {} : {};
    const keyterms = [...new Set([...(org.keyterms || []), ...(s.keyterms || '').split(/[,\n]/).map((k) => k.trim())].filter(Boolean))];
    const session = new TranscriptionSession({
      // Through CG Core, each (re)connect gets a fresh short-lived Deepgram token.
      authorize: viaCore
        ? async () => {
            try {
              return `Bearer ${(await core.deepgramToken()).accessToken}`;
            } catch (err) {
              if (err.unauthorized) signOutLocal(err.message);
              throw err;
            }
          }
        : async () => `Token ${deepgramKey}`,
      model: org.deepgramModel || s.deepgramModel,
      language: org.language || s.language,
      keyterms: keyterms.slice(0, 50),
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
    const meeting = store.get(meetingId);
    const template = findTemplate(templateId || meeting.templateId || s.defaultTemplateId, s.customTemplates);
    const ctrl = new AbortController();
    aborts.set(requestId, ctrl);
    try {
      const { text } = await aiStream({
        purpose: 'enhance',
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
    const context = meetingId
      ? meetingContext(store.get(meetingId), s.myName)
      : libraryContext(store.all(), s.myName);
    const ctrl = new AbortController();
    aborts.set(requestId, ctrl);
    try {
      const { text } = await aiStream({
        purpose: 'chat',
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

  // ----- CG Core -----
  handle('core:urls', () => CORE_URLS);
  handle('core:connect', async ({ url } = {}) => {
    const base = url || store.settings().coreUrl;
    if (!Object.values(CORE_URLS).includes(base)) throw new Error('Unknown CG Core address.');
    clearTimeout(pairing?.timer);
    const state = crypto.randomBytes(16).toString('hex');
    pairing = { state, url: base, timer: setTimeout(() => ((pairing = null), coreStatus()), 10 * 60 * 1000) };
    await shell.openExternal(connectUrl(base, { state, device: deviceName(), platform: process.platform }));
    coreStatus();
    return true;
  });
  // Fallback when the browser can't open trailmix:// links (e.g. dev builds).
  handle('core:pairCode', async (code) => {
    if (!pairing) throw new Error('Start the sign-in first.');
    await completePairing(code, pairing.state);
  });
  handle('core:cancel', () => {
    clearTimeout(pairing?.timer);
    pairing = null;
    coreStatus();
  });
  handle('core:refresh', () => refreshCore());
  handle('core:signout', async () => {
    const core = coreClient();
    if (live) await stopLive();
    await core?.signout().catch(() => {});
    signOutLocal();
  });

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
  refreshCore();
  setInterval(refreshCore, 30 * 60 * 1000);
  if (pendingLink) win.webContents.once('did-finish-load', () => handleLink(pendingLink));
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('before-quit', () => store?.flushAll());
app.on('window-all-closed', async () => {
  await stopLive();
  store?.flushAll();
  if (!isMac) app.quit();
});
