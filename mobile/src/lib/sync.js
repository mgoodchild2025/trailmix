// Phone side of meeting sync (shared/sync.js does the work).
import { AppState } from 'react-native';
import { SyncEngine } from '../../../shared/sync.js';
import { coreClient, getSession, subscribeSession } from './session.js';
import { getMeeting, replaceMeeting, removeMeeting, syncStateStorage, notifyMeetingsChanged, listMeetings } from './store.js';

const client = () => {
  const c = coreClient();
  if (!c) throw new Error('Not signed in to CG Core');
  return c;
};

const engine = new SyncEngine({
  api: {
    list: (cursor, limit) => client().listMeetings(cursor, limit),
    put: (id, v, doc) => client().putMeeting(id, v, doc),
    del: (id, v) => client().deleteMeeting(id, v),
  },
  storage: {
    loadState: () => syncStateStorage.load(),
    saveState: (s) => syncStateStorage.save(s),
    get: (id) => {
      const m = getMeeting(id);
      return m ? JSON.parse(JSON.stringify(m)) : null;
    },
    put: (doc) => replaceMeeting(doc),
    remove: (id) => removeMeeting(id),
  },
  onChange: (ids) => notifyMeetingsChanged(ids),
});

let timer = null;
let statusListeners = new Set();
let status = { syncing: false, lastSyncAt: null, error: null };
const setStatus = (p) => {
  status = { ...status, ...p };
  statusListeners.forEach((cb) => cb(status));
};
export const subscribeSync = (cb) => (statusListeners.add(cb), cb(status), () => statusListeners.delete(cb));

const enabled = () => {
  const s = getSession();
  return !!s.token && s.info?.features?.sync === true;
};

export async function syncNow() {
  clearTimeout(timer);
  timer = null;
  if (!enabled()) return;
  const st = engine.state();
  if (!st.cursor && !st.lastSyncAt && !syncStateStorage.load()?.seeded) {
    for (const m of listMeetings()) engine.markDirty(m.id);
    syncStateStorage.save({ ...engine.state(), seeded: true });
  }
  setStatus({ syncing: true });
  try {
    await engine.sync();
    setStatus({ syncing: false, lastSyncAt: Date.now(), error: null });
  } catch (err) {
    setStatus({ syncing: false, error: err.message });
  }
}

export function meetingChanged(id, { recording = false } = {}) {
  engine.markDirty(id);
  if (enabled() && !timer) timer = setTimeout(syncNow, recording ? 30000 : 3000);
}

export function meetingDeleted(id) {
  engine.markDeleted(id);
  if (enabled()) setTimeout(syncNow, 1000);
}

export function startSync() {
  syncNow();
  const iv = setInterval(syncNow, 2 * 60 * 1000);
  const sub = AppState.addEventListener('change', (s) => s === 'active' && syncNow());
  const off = subscribeSession(() => syncNow());
  return () => {
    clearInterval(iv);
    sub.remove();
    off();
  };
}
