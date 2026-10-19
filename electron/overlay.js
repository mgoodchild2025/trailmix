// A small always-on-top window for the meeting prompt ("Teams call started — Start
// recording") and the recording indicator (timer, pause, stop). It never takes focus, so
// it can't pull you out of the call app, and it's hidden from screen sharing.
import { BrowserWindow, screen } from 'electron';

const SIZES = {
  prompt: { width: 400, height: 76 },
  ended: { width: 400, height: 76 },
  recording: { width: 214, height: 44 },
};
const MARGIN = 14;

export class Overlay {
  constructor({ preload, load, isMac }) {
    Object.assign(this, { preload, load, isMac });
    this.win = null;
    this.view = null; // what the overlay page shows: { mode, ... } or null when hidden
    this.pillPos = null; // where the user dragged the recording indicator to
  }

  get webContents() {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      ...SIZES.prompt,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      acceptFirstMouse: true, // a click on a button works without activating the window first
      hasShadow: true,
      ...(this.isMac ? { type: 'panel' } : {}),
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, this.isMac ? 'floating' : 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Keeps the indicator out of screen shares and recordings of the screen.
    win.setContentProtection(true);
    win.on('moved', () => {
      if (this.view?.mode === 'recording') this.pillPos = win.getPosition();
    });
    this.load(win, 'overlay');
    this.win = win;
    return win;
  }

  // view: { mode: 'prompt' | 'ended' | 'recording', ... } or null to hide.
  set(view) {
    const prevMode = this.view?.mode;
    this.view = view;
    if (!view) {
      if (this.win && !this.win.isDestroyed()) this.win.hide();
      return;
    }
    const win = this.ensure();
    this.webContents?.send('overlay:state', view);
    if (view.mode !== prevMode || !win.isVisible()) this.place(win, view.mode);
    if (!win.isVisible()) win.showInactive();
  }

  place(win, mode) {
    const size = SIZES[mode];
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    let [x, y] = [area.x + area.width - size.width - MARGIN, area.y + MARGIN];
    if (mode === 'recording' && this.pillPos) {
      // Keep it where the user put it, as long as that's still on a screen.
      const d = screen.getDisplayNearestPoint({ x: this.pillPos[0], y: this.pillPos[1] }).workArea;
      x = Math.min(Math.max(this.pillPos[0], d.x), d.x + d.width - size.width);
      y = Math.min(Math.max(this.pillPos[1], d.y), d.y + d.height - size.height);
    }
    win.setBounds({ x: Math.round(x), y: Math.round(y), ...size });
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
