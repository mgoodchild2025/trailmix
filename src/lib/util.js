import { clockTime, hour12ForLocale, timeOptions } from '../../shared/clock.js';

// Electron prefixes errors thrown in ipcMain.handle; show users just the message.
export const errMsg = (e) =>
  String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function dayGroup(ts) {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today - new Date(d).setHours(0, 0, 0, 0)) / 864e5;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  if (d.getFullYear() === today.getFullYear()) return d.toLocaleString('en-GB', { month: 'long' });
  return String(d.getFullYear());
}

// The system's clock (12- or 24-hour), asked once and again when the window comes back
// (the setting may have changed meanwhile). Outside Electron: the browser's default.
let hour12 = null;
export function systemHour12() {
  if (hour12 === null) {
    try {
      hour12 = window.trailmix?.system?.hour12?.();
    } catch {
      hour12 = null;
    }
    if (typeof hour12 !== 'boolean') hour12 = hour12ForLocale();
  }
  return hour12;
}
if (typeof window !== 'undefined') window.addEventListener('focus', () => { hour12 = null; });

/** A time of day in the system's format: "15:05" or "3:05 pm". */
export const fmtTime = (ts) => clockTime(ts, systemHour12());

export const fmtDate = (ts) =>
  new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...timeOptions(systemHour12()) });

export const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};
