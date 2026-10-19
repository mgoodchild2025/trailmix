// Background auto-update from GitHub Releases (configured under "publish" in package.json).
// Downloads silently, then tells the UI an update is ready. It installs when the user
// clicks "Restart to update" or the next time the app quits.
import { app } from 'electron';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export function setupUpdater({ send, isRecording, beforeInstall = () => {} }) {
  let status = { state: app.isPackaged ? 'idle' : 'dev', version: app.getVersion() };
  const set = (patch) => {
    status = { ...status, ...patch };
    send('update:status', status);
  };

  const check = () => {
    if (!app.isPackaged) return set({ state: 'dev' });
    autoUpdater.checkForUpdates().catch((err) => set({ state: 'error', message: shortError(err) }));
  };

  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => set({ state: 'current', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) => set({ state: 'downloading', next: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', next: info.version }));
    autoUpdater.on('error', (err) => set({ state: 'error', message: shortError(err) }));

    setTimeout(check, 10_000);
    setInterval(check, CHECK_EVERY_MS);
  }

  return {
    status: () => status,
    check,
    install: () => {
      if (status.state !== 'ready') return false;
      if (isRecording()) throw new Error('Stop recording before restarting to update.');
      // Closing the window normally just hides it; let the updater's quit through.
      beforeInstall();
      setImmediate(() => autoUpdater.quitAndInstall());
      return true;
    },
  };
}

// electron-updater errors can include full HTTP headers; keep the UI message short.
function shortError(err) {
  const msg = String(err?.message || err);
  if (/\b404\b/.test(msg)) return 'no published release found';
  if (/No published versions/i.test(msg)) return 'no published release found';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(msg)) return 'offline or GitHub unreachable';
  return msg.split('\n')[0].slice(0, 120);
}
