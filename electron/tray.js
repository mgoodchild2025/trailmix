// Menu bar (macOS) / notification area (Windows) icon. Shows whether Trailmix is recording
// and gives one-click start, pause and stop without opening the window.
import { Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const elapsedMs = (rec) => (rec.state === 'live' ? rec.accumMs + (Date.now() - rec.resumedAt) : rec.accumMs || 0);
export const isActive = (rec) => ['starting', 'live', 'paused', 'stopping'].includes(rec?.state);

export function createTray({ isMac, assetsDir, onCommand, onOpen }) {
  const img = (name) => {
    const i = nativeImage.createFromPath(path.join(assetsDir, `${name}.png`));
    if (isMac && name.endsWith('Template')) i.setTemplateImage(true);
    return i;
  };
  const icons = isMac
    ? { idle: img('trayTemplate'), rec: img('trayRecording') }
    : { idle: img('trayWin'), rec: img('trayWinRecording') };

  const tray = new Tray(icons.idle);
  let rec = { state: 'idle' };
  let update = null;
  let ticker = null;

  // Windows: left click opens the window, right click shows the menu. macOS: any click
  // shows the menu, as menu bar icons do. The menu is built when it opens so the timer
  // in it is current.
  const popUp = () => tray.popUpContextMenu(menu());
  tray.on('click', () => (isMac ? popUp() : onOpen()));
  tray.on('right-click', popUp);

  const menu = () => {
    const recording = isActive(rec);
    const cmd = (c) => () => onCommand(c);
    const items = recording
      ? [
          { label: rec.state === 'paused' ? `Paused · ${fmt(elapsedMs(rec))}` : `Recording · ${fmt(elapsedMs(rec))}`, enabled: false },
          { label: rec.title || 'Untitled meeting', enabled: false },
          { type: 'separator' },
          rec.state === 'paused' ? { label: 'Resume', click: cmd('resume') } : { label: 'Pause', click: cmd('pause'), enabled: rec.state === 'live' },
          { label: 'Stop recording', click: cmd('stop') },
          { label: 'Show meeting', click: cmd('open') },
        ]
      : [
          { label: 'Start recording', click: cmd('start') },
          { label: 'New note', click: cmd('new') },
        ];
    return Menu.buildFromTemplate([
      ...items,
      { type: 'separator' },
      { label: 'Open Trailmix', click: () => onOpen() },
      { label: 'Settings…', click: cmd('settings') },
      ...(update?.state === 'ready' && !recording ? [{ type: 'separator' }, { label: `Restart to update to ${update.next}`, click: cmd('install-update') }] : []),
      { type: 'separator' },
      { label: 'Quit Trailmix', role: 'quit' },
    ]);
  };

  const render = () => {
    const recording = isActive(rec);
    const time = recording ? fmt(elapsedMs(rec)) : '';
    tray.setToolTip(recording ? `Trailmix — ${rec.state === 'paused' ? 'paused' : 'recording'} ${time}` : 'Trailmix');
    // macOS shows the timer next to the icon.
    if (isMac) tray.setTitle(recording ? ` ${time}` : '', { fontType: 'monospacedDigit' });
  };

  const tick = () => {
    clearInterval(ticker);
    ticker = rec.state === 'live' ? setInterval(render, 1000) : null;
  };

  render();
  return {
    setRecording(next) {
      rec = next || { state: 'idle' };
      tray.setImage(isActive(rec) ? icons.rec : icons.idle);
      render();
      tick();
    },
    setUpdate(next) {
      update = next;
    },
    destroy() {
      clearInterval(ticker);
      tray.destroy();
    },
  };
}
