// Meetings on the phone: one JSON file each under the app's documents folder, mirrored
// in memory. Same document shape as the desktop app so sync can merge them.
import { File, Directory, Paths } from 'expo-file-system';
import { touch } from '../../../shared/sync.js';

const dir = new Directory(Paths.document, 'meetings');
const stateFile = new File(Paths.document, 'sync-state.json');
import { DEMO_MEETINGS } from './demo.js';

const cache = new Map();
const listeners = new Set();
let loaded = false;
let demo = false;

// In demo mode the store holds sample meetings in memory and never touches disk.
export function setDemoStore(on) {
  demo = on;
  cache.clear();
  loaded = false;
  if (on) {
    for (const m of DEMO_MEETINGS) cache.set(m.id, JSON.parse(JSON.stringify(m)));
    loaded = true;
  }
  emit([]);
}

const emit = (ids) => listeners.forEach((cb) => cb(ids));
export const subscribeMeetings = (cb) => (listeners.add(cb), () => listeners.delete(cb));

function load() {
  if (loaded) return;
  dir.create({ intermediates: true, idempotent: true });
  for (const f of dir.list()) {
    if (!(f instanceof File) || !f.name.endsWith('.json')) continue;
    try {
      const m = JSON.parse(f.textSync());
      cache.set(m.id, m);
    } catch {}
  }
  loaded = true;
}

const fileFor = (id) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Bad meeting id');
  return new File(dir, `${id}.json`);
};

function write(m) {
  if (demo) return;
  const f = fileFor(m.id);
  f.create({ overwrite: true });
  f.write(JSON.stringify(m));
}

export const isDemoStore = () => demo;

export function listMeetings() {
  load();
  return [...cache.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getMeeting(id) {
  load();
  return cache.get(id) || null;
}

export function createMeeting(fields = {}) {
  load();
  const now = Date.now();
  const id = `${now.toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const m = { id, title: '', createdAt: now, updatedAt: now, notes: '', transcript: [], enhanced: '', templateId: null, chat: [], source: 'mobile', ...fields };
  touch(m, ['title', 'notes', 'enhanced', 'templateId', 'chat'], now);
  cache.set(id, m);
  write(m);
  emit([id]);
  return m;
}

export function patchMeeting(id, fields) {
  const m = getMeeting(id);
  if (!m) return null;
  const allowed = ['title', 'notes', 'enhanced', 'templateId', 'chat'];
  const changed = allowed.filter((k) => k in fields);
  for (const k of changed) m[k] = fields[k];
  touch(m, changed);
  write(m);
  emit([id]);
  return m;
}

export function appendSegment(id, seg) {
  const m = getMeeting(id);
  if (!m) return;
  m.transcript.push(seg);
  m.updatedAt = Date.now();
  write(m);
  emit([id]);
}

export function replaceMeeting(doc) {
  load();
  cache.set(doc.id, doc);
  write(doc);
}

export function removeMeeting(id) {
  load();
  cache.delete(id);
  if (!demo) {
    const f = fileFor(id);
    if (f.exists) f.delete();
  }
  emit([id]);
}

export const syncStateStorage = {
  load() {
    try {
      return stateFile.exists ? JSON.parse(stateFile.textSync()) : null;
    } catch {
      return null;
    }
  },
  save(s) {
    stateFile.create({ overwrite: true });
    stateFile.write(JSON.stringify(s));
  },
};

export { emit as notifyMeetingsChanged };
