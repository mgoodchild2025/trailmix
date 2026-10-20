// Watches which apps are using the microphone and feeds MeetingDetector.
//   macOS: the bundled trailmix-micwatch helper (Core Audio), one JSON line per change.
//   Windows: polls the microphone consent store Windows keeps for its "mic in use" icon.
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { parseWindowsConsentStore } from './meeting-detect.js';

const WIN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

export function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'trailmix-micwatch')
    : path.join(import.meta.dirname, '..', 'build', 'bin', 'trailmix-micwatch');
}

export function watchMicrophone(onApps, log = () => {}) {
  if (process.platform === 'darwin') return watchMac(onApps, log);
  if (process.platform === 'win32') return watchWindows(onApps, log);
  return () => {};
}

function watchMac(onApps, log) {
  let child = null;
  let stopped = false;
  let restarts = 0;
  const start = () => {
    const bin = helperPath();
    if (!fs.existsSync(bin)) return log(`meeting detection: helper missing at ${bin} (run scripts/build-micwatch.sh)`);
    child = spawn(bin, [], { stdio: ['ignore', 'pipe', 'ignore'] });
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
    child.on('exit', () => {
      child = null;
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

function watchWindows(onApps, log) {
  let stopped = false;
  let timer = null;
  const poll = () => {
    execFile('reg', ['query', WIN_KEY, '/s'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (stopped) return;
      if (err) log(`meeting detection: reg query failed (${err.message})`);
      else onApps(parseWindowsConsentStore(stdout));
      timer = setTimeout(poll, 1500);
    });
  };
  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
