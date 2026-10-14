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

export const fmtDate = (ts) =>
  new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};
