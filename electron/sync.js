// Desktop side of meeting sync: connects shared/sync.js to the local Store and CG Core.
import fs from 'node:fs';
import path from 'node:path';
import { SyncEngine } from '../shared/sync.js';

const QUIET_MS = 3000; // after an edit
const RECORDING_MS = 30000; // while a transcript is growing
const PERIODIC_MS = 2 * 60 * 1000;

export function setupSync({ store, coreClient, isRecording, onMeetingsChanged, onStatus, onUnauthorized }) {
  const statePath = path.join(store.root, 'sync-state.json');
  const storage = {
    loadState() {
      try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
      } catch {
        return null;
      }
    },
    saveState(s) {
      const tmp = `${statePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(s));
      fs.renameSync(tmp, statePath);
    },
    get(id) {
      try {
        return structuredClone(store.get(id));
      } catch {
        return null;
      }
    },
    put: (doc) => store.replace(doc),
    remove: (id) => store.remove(id),
  };

  // The engine needs a client per call: the sign-in can change while the app runs.
  const api = {
    list: (cursor, limit) => client().listMeetings(cursor, limit),
    put: (id, v, doc) => client().putMeeting(id, v, doc),
    del: (id, v) => client().deleteMeeting(id, v),
  };
  const client = () => {
    const c = coreClient();
    if (!c) throw new Error('Not signed in to CG Core');
    return c;
  };

  const engine = new SyncEngine({ api, storage, onChange: (ids) => onMeetingsChanged(ids) });
  let timer = null;

  const enabled = () => {
    const core = store.settings().core;
    return core.connected && core.features?.sync === true;
  };

  function status(extra = {}) {
    const s = engine.state();
    const pending = Object.values(s.items).filter((i) => i.dirty).length;
    const st = { enabled: enabled(), lastSyncAt: s.lastSyncAt, error: s.lastError, pending, ...extra };
    onStatus(st);
    return st;
  }

  async function run() {
    clearTimeout(timer);
    timer = null;
    if (!enabled()) return status();
    // First sync on this computer: upload every meeting already here.
    const s = engine.state();
    if (!s.cursor && !s.lastSyncAt && !s.seeded) {
      for (const m of store.list()) engine.markDirty(m.id);
      storage.saveState({ ...engine.state(), seeded: true });
    }
    status({ syncing: true });
    try {
      await engine.sync();
    } catch (err) {
      if (err.status === 401) onUnauthorized(err.message);
    }
    status();
  }

  function soon(ms = isRecording() ? RECORDING_MS : QUIET_MS) {
    if (timer) return;
    timer = setTimeout(run, ms);
  }

  setInterval(() => enabled() && run(), PERIODIC_MS);

  return {
    changed(id) {
      engine.markDirty(id);
      if (enabled()) soon();
    },
    deleted(id) {
      engine.markDeleted(id);
      if (enabled()) soon(QUIET_MS);
    },
    now: run,
    status,
  };
}
