import { app, BrowserWindow, ipcMain, session, desktopCapturer, systemPreferences, safeStorage, dialog, clipboard, shell, Menu, Notification } from 'electron';
import { marked } from 'marked';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Store } from './store.js';
import { TranscriptionSession } from './deepgram.js';
import { streamClaude } from './llm.js';
import { ENHANCE_SYSTEM, enhanceUserMessage, CHAT_SYSTEM, meetingContext, libraryContext } from '../shared/prompts.js';
import { findTemplate } from '../shared/templates.js';
import { setupUpdater } from './updater.js';
import { setupSync } from './sync.js';
import { MeetingDetector } from './meeting-detect.js';
import { watchMicrophone } from './micwatch.js';
import { Overlay } from './overlay.js';
import { createTray, isActive } from './tray.js';
import { CoreClient, CORE_URLS, PROTOCOL, connectUrl, parseConnectLink, pair } from '../shared/core.js';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const here = import.meta.dirname;
const isMac = process.platform === 'darwin';

let win;
let store;
let live = null; // { meetingId, session }
let updater;
let sync;
let tray = null;
let overlay = null;
let rec = { state: 'idle' }; // recording state reported by the window: { state, meetingId, title, accumMs, resumedAt }
let prompt = null; // overlay prompt from meeting detection: { mode: 'prompt' | 'ended', key, label }
let promptTimer = null;
let quitting = false; // set once the app is really quitting (closing the window only hides it)
let quitConfirmed = false;
const aborts = new Map(); // requestId -> AbortController

// Lets tests or IT point the app at a different data folder.
if (process.env.TRAILMIX_DATA_DIR) app.setPath('userData', process.env.TRAILMIX_DATA_DIR);

// ---------- error log ----------
// Main-process problems go to <userData>/logs/main.log (Settings → Open data folder), so a
// failure on a staff PC can be diagnosed. Nothing from meetings is written here.
const startupErrors = [];
function logLine(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'main.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${line}\n`);
  } catch {}
}
const errText = (err) => (err?.stack || String(err)).split('\n').slice(0, 6).join('\n');
process.on('uncaughtException', (err) => logLine(`uncaught: ${errText(err)}`));
process.on('unhandledRejection', (err) => logLine(`unhandled rejection: ${errText(err)}`));
// Runs one startup step; a failure is logged and the rest of startup carries on.
function step(name, fn) {
  try {
    return fn();
  } catch (err) {
    startupErrors.push(`${name}: ${err?.message || err}`);
    logLine(`startup step "${name}" failed: ${errText(err)}`);
  }
}

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
  // Opening Trailmix again (Start menu, Dock, Finder) while it's in the tray shows it.
  if (store) showWindow();
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
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Recording runs in this window, so it must keep full speed while hidden in the tray.
      backgroundThrottling: false,
    },
  });

  loadPage(win);
  // Opened at login: start in the tray, ready for the next meeting.
  win.once('ready-to-show', () => !startHidden && win.show());
  win.webContents.once('did-finish-load', () => {
    windowReady = true;
    for (const c of queuedCommands.splice(0)) send('app:command', c);
  });

  // Closing the window keeps Trailmix running in the menu bar / tray (and keeps any
  // recording going); Quit is in the tray menu, the app menu and Cmd+Q.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    trayHint();
  });
  for (const ev of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore']) win.on(ev, refreshOverlay);

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

function loadPage(w, hash) {
  if (DEV_URL) w.loadURL(hash ? `${DEV_URL}#${hash}` : DEV_URL);
  else w.loadFile(path.join(here, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
}

// Commands for the main window (start/stop recording, open a meeting…). Queued if the
// window is still loading, e.g. right after launch at login.
let windowReady = false;
const queuedCommands = [];
function command(c) {
  if (windowReady) send('app:command', c);
  else queuedCommands.push(c);
}

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
    sync?.now();
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

  const withApp = (s) => ({ ...s, canOpenAtLogin: canOpenAtLogin() });
  handle('settings:get', () => withApp(store.settings()));
  handle('settings:set', (patch) => {
    const out = store.saveSettings(patch);
    if ('detectMeetings' in patch || 'detectAnyApp' in patch) setupMeetingDetection();
    if ('openAtLogin' in patch) applyLoginItem();
    if ('showRecordingIndicator' in patch) refreshOverlay();
    return withApp(out);
  });

  // ----- recording state, tray and overlay -----
  ipcMain.on('rec:state', (e, next) => {
    if (e.sender !== win?.webContents) return;
    rec = next || { state: 'idle' };
    tray?.setRecording(rec);
    refreshOverlay();
  });
  ipcMain.handle('overlay:get', () => overlay?.view || null);
  ipcMain.on('overlay:act', (e, action) => {
    if (e.sender !== overlay?.webContents) return;
    overlayAction(action);
  });

  handle('meetings:list', () => store.list());
  handle('meetings:search', (q) => store.search(q));
  handle('meetings:get', (id) => store.get(id));
  handle('meetings:create', (fields) => {
    const s = store.settings();
    const m = store.create({ templateId: s.defaultTemplateId, ...fields });
    sync.changed(m.id);
    return m;
  });
  handle('meetings:patch', (id, fields) => {
    store.patch(id, fields);
    sync.changed(id);
    return true;
  });
  handle('meetings:delete', async (id) => {
    if (live?.meetingId === id) await stopLive();
    store.remove(id);
    sync.deleted(id);
    send('meetings:changed', { deleted: id });
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
      source: viaCore ? 'core' : 'own',
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
        sync.changed(meetingId);
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
      sync.changed(meetingId);
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

  // ----- sync -----
  handle('sync:status', () => sync.status());
  handle('sync:now', () => sync.now());

  // ----- updates -----
  handle('update:status', () => updater.status());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());

  // ----- export -----
  handle('export:copy', ({ text, html }) => {
    clipboard.write({ text, html });
    return true;
  });
  handle('export:saveMarkdown', ({ title, markdown }) => saveMarkdown(title, markdown));

  // Right-click (or "…") on a meeting in the sidebar.
  handle('meetings:menu', ({ id, x, y }) => {
    const m = store.get(id);
    const title = m.title?.trim() || 'Untitled meeting';
    const md = shareableNotes(m);
    const has = !!md.trim();
    const share = [
      { label: 'Copy notes', enabled: has, click: () => copyNotes(md) },
      { label: 'Email notes…', enabled: has, click: () => emailNotes(title, md) },
      { label: 'Save as Markdown…', enabled: has, click: () => saveMarkdown(title, md) },
    ];
    // macOS share sheet: Mail, Messages, AirDrop, Notes…
    if (isMac && has) share.push({ type: 'separator' }, { label: 'More', role: 'shareMenu', sharingItem: { texts: [`${title}\n\n${md}`] } });
    Menu.buildFromTemplate([
      { label: 'Share', submenu: share },
      { type: 'separator' },
      { label: 'Delete…', click: () => confirmDelete(id, title) },
    ]).popup({ window: win, x: Math.round(x), y: Math.round(y) });
  });
}

// The notes people share: the enhanced notes if there are any, else the rough notes,
// without the <mark> tags that show which lines came from the note-taker.
function shareableNotes(m) {
  return (m.enhanced || m.notes || '').replace(/<\/?mark>/g, '').trim();
}

function copyNotes(md) {
  clipboard.write({ text: md, html: marked.parse(md) });
  send('app:toast', { text: 'Copied. Paste into email, Teams or a ticket.', kind: 'ok' });
}

// mailto: links are length-limited (Outlook on Windows truncates around 2,000
// characters), so long notes go on the clipboard and the email asks for a paste.
function emailNotes(title, md) {
  clipboard.write({ text: md, html: marked.parse(md) });
  const fits = md.length <= 1800;
  const body = fits ? md : 'The notes are on your clipboard: paste them here (Cmd+V or Ctrl+V).';
  shell.openExternal(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
  if (!fits) send('app:toast', { text: 'Notes copied. Paste them into the new email.', kind: 'ok' });
}

async function saveMarkdown(title, markdown) {
  const safe = (title || 'Meeting notes').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `${safe}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, markdown);
  return true;
}

async function confirmDelete(id, title) {
  const recording = live?.meetingId === id;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete "${title}"?`,
    detail: `${recording ? 'This meeting is recording; deleting it stops the recording. ' : ''}It will be moved to Trailmix's trash folder.`,
  });
  if (response !== 0) return;
  if (recording) await stopLive();
  store.remove(id);
  sync.deleted(id);
  send('meetings:changed', { deleted: id });
}

// ---------- meeting detection ----------
// When a call app starts using the microphone, offer to take notes; if the recording was
// started that way, offer to stop when the call app lets go. Never records on its own.
let detector = null;
let stopWatching = null;
const shownNotes = new Set(); // keep references so notifications aren't garbage-collected

function notify({ title, body, action, onAccept = () => showWindow() }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: !action, actions: isMac && action ? [{ type: 'button', text: action }] : [], closeButtonText: 'Not now' });
  const accept = () => {
    shownNotes.delete(n);
    onAccept();
  };
  n.on('action', accept);
  n.on('click', accept);
  n.on('close', () => shownNotes.delete(n));
  shownNotes.add(n);
  n.show();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (isMac) app.focus({ steal: true });
}

// ---------- tray, overlay, login item ----------
const PROMPT_MS = 60_000; // an unanswered prompt goes away after a minute

function showPrompt(p) {
  logLine(`[detect] ${p.mode}: ${p.label}`);
  clearTimeout(promptTimer);
  prompt = p;
  promptTimer = setTimeout(() => {
    prompt = null;
    refreshOverlay();
  }, PROMPT_MS);
  refreshOverlay();
}

function clearPrompt() {
  clearTimeout(promptTimer);
  prompt = null;
}

// What the floating window shows: a pending prompt first; otherwise, while recording,
// the indicator, but only when the Trailmix window isn't the one in front.
function refreshOverlay() {
  if (!overlay) return;
  if (prompt) return overlay.set({ ...prompt, rec });
  const front = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
  const want = isActive(rec) && rec.state !== 'stopping' && store.settings().showRecordingIndicator !== false && !front;
  overlay.set(want ? { mode: 'recording', rec } : null);
}

function overlayAction({ type }) {
  switch (type) {
    case 'start': // from the prompt
      if (prompt?.key) detector?.follow(prompt.key, prompt.label);
      clearPrompt();
      showWindow();
      command({ cmd: 'start' });
      break;
    case 'stop': // from the "call ended" prompt or the indicator
      clearPrompt();
      command({ cmd: 'stop' });
      break;
    case 'dismiss':
      clearPrompt();
      break;
    case 'pause':
    case 'resume':
      command({ cmd: type });
      break;
    case 'open':
      showWindow();
      command({ cmd: 'open', meetingId: rec.meetingId });
      break;
  }
  refreshOverlay();
}

function trayCommand(cmd) {
  if (cmd === 'install-update') return updater.install();
  if (cmd === 'test-prompt') return showPrompt({ mode: 'prompt', key: 'Teams', label: 'Teams' });
  if (['start', 'new', 'open', 'settings'].includes(cmd)) showWindow();
  command({ cmd, meetingId: rec.meetingId });
}

// The dev copy is Electron.app; registering it as a login item would open bare Electron.
const canOpenAtLogin = () => app.isPackaged && (isMac || process.platform === 'win32');

function applyLoginItem() {
  if (!canOpenAtLogin()) return;
  const openAtLogin = store.settings().openAtLogin !== false;
  app.setLoginItemSettings(isMac ? { openAtLogin } : { openAtLogin, args: ['--hidden'] });
}

let startHidden = false; // opened at login: stay in the tray (worked out once the app is ready)

// Windows users may not expect the close button to leave the app running: say so, once.
function trayHint() {
  if (isMac || store.settings().trayHintShown) return;
  store.saveSettings({ trayHintShown: true });
  notify({ title: 'Trailmix is still running', body: "It's in the system tray, ready for your next meeting. Quit from the tray icon." });
}

async function confirmQuitWhileRecording() {
  const { response } = await dialog.showMessageBox(win && !win.isDestroyed() && win.isVisible() ? win : undefined, {
    type: 'warning',
    buttons: ['Stop and quit', 'Keep recording'],
    defaultId: 1,
    cancelId: 1,
    message: 'Trailmix is recording',
    detail: 'Quitting stops the recording. The transcript so far is saved; you can write the notes from it later.',
  });
  if (response !== 0) return;
  quitConfirmed = true;
  await stopLive();
  app.quit();
}

function setupMeetingDetection() {
  stopWatching?.();
  stopWatching = null;
  const s = store.settings();
  if (!s.detectMeetings || !['darwin', 'win32'].includes(process.platform)) return;
  detector = new MeetingDetector({
    platform: process.platform,
    anyApp: !!s.detectAnyApp,
    isRecording: () => !!live,
    onPrompt: ({ key, label }) => showPrompt({ mode: 'prompt', key, label }),
    onEnded: ({ key, label }) => showPrompt({ mode: 'ended', key, label }),
  });
  let last = '';
  let current = [];
  const stopMic = watchMicrophone(
    (apps) => {
      // Log what the OS reports (app names only), to make detection easy to check.
      const seen = apps.map((a) => a.bundleId || a.exe).join(', ');
      if (seen !== last) logLine(`[detect] using the mic: ${seen || 'nothing'}`);
      last = seen;
      current = apps;
      smokeMicReports++;
      detector?.update(apps);
    },
    (msg) => logLine(msg),
  );
  // The macOS watcher only reports changes, so re-check every second for the timers.
  const ticker = setInterval(() => detector?.update(current), 1000);
  stopWatching = () => {
    clearInterval(ticker);
    stopMic();
  };
}

async function stopLive() {
  if (!live) return;
  const { session, meetingId } = live;
  live = null;
  await session.stop();
  store.flush(meetingId);
  send('transcribe:event', { type: 'status', meetingId, state: 'stopped' });
}

// CI smoke test: start the packaged app, report what came up, quit.
function smokeReport() {
  setTimeout(() => {
    const login = canOpenAtLogin() ? app.getLoginItemSettings(isMac ? {} : { args: ['--hidden'] }) : null;
    const report = {
      version: app.getVersion(),
      tray: !!tray,
      overlay: !!overlay,
      detection: !!stopWatching,
      micReports: smokeMicReports,
      openAtLogin: login ? { openAtLogin: login.openAtLogin, executableWillLaunchAtLogin: login.executableWillLaunchAtLogin, launchItems: login.launchItems } : 'not packaged',
      errors: startupErrors,
    };
    fs.writeFileSync(process.env.TRAILMIX_SMOKE_OUT, JSON.stringify(report, null, 2));
    quitting = true;
    app.exit(0);
  }, 8000);
}
let smokeMicReports = 0;

// Windows shows this ID's app name and icon on notifications; it must match the
// installer's appId (package.json build.appId).
if (process.platform === 'win32') app.setAppUserModelId('com.cgtechnologies.trailmix');

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), safeStorage);
  setupDisplayMedia();
  updater = setupUpdater({
    send: (ch, st) => {
      send(ch, st);
      tray?.setUpdate(st);
    },
    isRecording: () => !!live,
    beforeInstall: () => (quitting = true),
  });
  sync = setupSync({
    store,
    coreClient,
    isRecording: () => !!live,
    onStatus: (st) => send('sync:status', st),
    onUnauthorized: (msg) => signOutLocal(msg),
    // Changes pulled from other devices: refresh what's on screen.
    onMeetingsChanged: (ids) => {
      for (const id of ids) {
        let exists = true;
        try {
          store.get(id);
        } catch {
          exists = false;
        }
        send('meetings:changed', exists ? { updated: id } : { deleted: id });
      }
    },
  });
  registerIpc();
  logLine(`Trailmix ${app.getVersion()} starting on ${process.platform} ${os.release()}${process.argv.includes('--hidden') ? ' (at login)' : ''}`);
  step('start hidden check', () => {
    startHidden = process.argv.includes('--hidden') || (isMac && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin);
  });
  step('open at login', applyLoginItem);
  createWindow();
  step('overlay', () => {
    overlay = new Overlay({ preload: path.join(here, 'preload.cjs'), load: loadPage, isMac });
  });
  step('tray', () => {
    tray = createTray({
      isMac,
      assetsDir: path.join(here, 'assets', 'tray'),
      onCommand: trayCommand,
      onOpen: showWindow,
      dev: !app.isPackaged,
    });
    tray.setUpdate(updater.status());
  });
  refreshCore();
  setInterval(refreshCore, 30 * 60 * 1000);
  step('meeting detection', setupMeetingDetection);
  if (process.env.TRAILMIX_SMOKE_OUT) smokeReport();
  if (pendingLink) win.webContents.once('did-finish-load', () => handleLink(pendingLink));
  // Dock icon clicked (macOS): bring the window back. (Not for the activation that comes
  // with launching, or a login-item start would open the window anyway.)
  const launchedAt = Date.now();
  app.on('activate', () => {
    if (startHidden && Date.now() - launchedAt < 3000) return;
    showWindow();
  });
});

app.on('before-quit', (e) => {
  if (live && !quitConfirmed) {
    e.preventDefault();
    confirmQuitWhileRecording();
    return;
  }
  quitting = true;
  stopWatching?.();
  store?.flushAll();
});
app.on('will-quit', () => {
  tray?.destroy();
  overlay?.destroy();
});
// Only reached while quitting (closing the window hides it).
app.on('window-all-closed', async () => {
  await stopLive();
  store?.flushAll();
  if (!isMac) app.quit();
});
