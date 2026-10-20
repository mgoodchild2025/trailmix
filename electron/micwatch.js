// Watches which apps are using the microphone and feeds MeetingDetector.
//   macOS: the bundled trailmix-micwatch helper (Core Audio), one JSON line per change.
//   Windows: the bundled trailmix-micwatch.exe helper (active capture sessions on every
//   microphone, via the Windows audio system), plus the microphone consent store Windows
//   keeps for its "mic in use" icon as a backup. Either one seeing an app is enough.
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { parseWindowsConsentStore } from './meeting-detect.js';

const WIN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

export function helperPath() {
  const name = process.platform === 'win32' ? 'trailmix-micwatch.exe' : 'trailmix-micwatch';
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(import.meta.dirname, '..', 'build', 'bin', name);
}

export function watchMicrophone(onApps, log = () => {}) {
  if (process.platform === 'darwin') return watchMac(onApps, log);
  if (process.platform === 'win32') return watchWindows(onApps, log);
  return () => {};
}

// Runs the bundled helper and restarts it if it dies; each JSON line it prints is a
// snapshot of the apps using a mic.
function watchHelper(args, onApps, log) {
  let child = null;
  let stopped = false;
  let restarts = 0;
  const start = () => {
    const bin = helperPath();
    if (!fs.existsSync(bin)) return log(`meeting detection: helper missing at ${bin}`);
    child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    child.on('error', (err) => log(`meeting detection: helper failed to start (${err.message})`));
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        try {
          const snap = JSON.parse(line);
          restarts = 0;
          onApps(snap.apps || []);
        } catch {}
      }
    });
    child.on('exit', (code) => {
      child = null;
      if (!stopped) log(`meeting detection: helper exited (${code})`);
      if (stopped || restarts++ > 5) return;
      setTimeout(start, 2000 * restarts);
    });
  };
  start();
  return () => {
    stopped = true;
    child?.kill();
  };
}

function watchMac(onApps, log) {
  return watchHelper([], onApps, log);
}

function watchWindows(onApps, log) {
  let fromHelper = [];
  let fromConsent = [];
  let regFailed = false;
  const emit = () => {
    const seen = new Map();
    for (const a of [...fromHelper, ...fromConsent]) seen.set(a.exe, { ...seen.get(a.exe), ...a });
    onApps([...seen.values()]);
  };
  const stopHelper = watchHelper(['--parent', String(process.pid)], (apps) => {
    fromHelper = apps;
    emit();
  }, log);

  let stopped = false;
  let timer = null;
  const poll = () => {
    execFile('reg', ['query', WIN_KEY, '/s'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (stopped) return;
      if (err) {
        // The key only exists once some app has used the mic; say so once, not every poll.
        if (!regFailed) log(`meeting detection: consent store unreadable (${String(err.message).split('\n')[0]})`);
        regFailed = true;
        fromConsent = [];
      } else {
        regFailed = false;
        fromConsent = parseWindowsConsentStore(stdout);
        emit();
      }
      timer = setTimeout(poll, 1500);
    });
  };
  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopHelper();
  };
}
