// Sandboxed preload: exposes a narrow, typed-by-convention API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

function on(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('trailmix', {
  platform: process.platform,
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  meetings: {
    list: invoke('meetings:list'),
    search: invoke('meetings:search'),
    get: invoke('meetings:get'),
    create: invoke('meetings:create'),
    patch: invoke('meetings:patch'),
    remove: invoke('meetings:delete'),
    menu: invoke('meetings:menu'),
    onChanged: (cb) => on('meetings:changed', cb),
  },
  onToast: (cb) => on('app:toast', cb),
  detect: {
    onStart: (cb) => on('detect:start', cb),
    onStop: (cb) => on('detect:stop', cb),
  },
  system: {
    permissions: invoke('system:permissions'),
    askMic: invoke('system:askMic'),
    openPrivacy: invoke('system:openPrivacy'),
    openDataFolder: invoke('system:openDataFolder'),
  },
  transcribe: {
    start: invoke('transcribe:start'),
    stop: invoke('transcribe:stop'),
    sendAudio: (buf) => ipcRenderer.send('transcribe:audio', buf),
    onEvent: (cb) => on('transcribe:event', cb),
  },
  ai: {
    enhance: invoke('ai:enhance'),
    chat: invoke('ai:chat'),
    cancel: invoke('ai:cancel'),
    onDelta: (cb) => on('ai:delta', cb),
  },
  core: {
    urls: invoke('core:urls'),
    connect: invoke('core:connect'),
    pairCode: invoke('core:pairCode'),
    cancel: invoke('core:cancel'),
    refresh: invoke('core:refresh'),
    signout: invoke('core:signout'),
    onStatus: (cb) => on('core:status', cb),
  },
  sync: {
    status: invoke('sync:status'),
    now: invoke('sync:now'),
    onStatus: (cb) => on('sync:status', cb),
  },
  updates: {
    status: invoke('update:status'),
    check: invoke('update:check'),
    install: invoke('update:install'),
    onStatus: (cb) => on('update:status', cb),
  },
  exporter: { copy: invoke('export:copy'), saveMarkdown: invoke('export:saveMarkdown') },
});
