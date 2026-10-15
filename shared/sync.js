// Meeting sync through CG Core (docs/cg-core-api.md section 5), shared by the desktop
// and mobile apps. Each app supplies an API client and a storage adapter; this file
// decides what to push, what to pull and how to merge two copies of a meeting.
//
// Merging: each editable field carries its own edit time (doc.fieldTimes[field]), so an
// edit to the notes on the phone and to the title on the laptop both survive. The
// transcript is merged by segment id, since two devices never record the same segment.

export const SYNCED_FIELDS = ['title', 'notes', 'enhanced', 'templateId', 'chat', 'share'];

// Fields that stay on the device and never go to Core.
const LOCAL_ONLY = ['_sync'];

export function touch(doc, fields, now = Date.now()) {
  doc.fieldTimes = { ...(doc.fieldTimes || {}) };
  for (const f of fields) doc.fieldTimes[f] = now;
  doc.updatedAt = now;
  return doc;
}

function fieldTime(doc, f) {
  return doc?.fieldTimes?.[f] ?? doc?.updatedAt ?? 0;
}

export function mergeMeetings(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = { ...a, fieldTimes: { ...(a.fieldTimes || {}) } };
  for (const f of SYNCED_FIELDS) {
    if (fieldTime(b, f) > fieldTime(a, f)) {
      out[f] = b[f];
      out.fieldTimes[f] = fieldTime(b, f);
    }
  }
  const seen = new Map();
  for (const seg of [...(a.transcript || []), ...(b.transcript || [])]) if (!seen.has(seg.id)) seen.set(seg.id, seg);
  out.transcript = [...seen.values()].sort((x, y) => x.start - y.start);
  out.createdAt = Math.min(a.createdAt ?? Infinity, b.createdAt ?? Infinity);
  out.updatedAt = Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0);
  out.source = a.source || b.source;
  return out;
}

// Key order doesn't matter (Postgres jsonb sorts keys); values and array order do.
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonical(v[k]);
    return out;
  }
  return v;
}

// Meetings saved before sync existed have no fieldTimes, and older ones may lack chat or
// transcript; a merge fills those in. Treat missing and empty as the same so a merged
// copy that only gained empty defaults doesn't look like a real change.
function normalised(doc) {
  const d = { ...forUpload(doc) };
  if (!d.fieldTimes || !Object.keys(d.fieldTimes).length) delete d.fieldTimes;
  for (const k of ['transcript', 'chat']) if (!d[k] || !d[k].length) delete d[k];
  return canonical(d);
}

export function sameDoc(a, b) {
  return JSON.stringify(normalised(a)) === JSON.stringify(normalised(b));
}

export function forUpload(doc) {
  const copy = { ...doc };
  for (const k of LOCAL_ONLY) delete copy[k];
  return copy;
}

/**
 * api:     { list(cursor, limit), put(id, ifVersion, doc), del(id, ifVersion) }
 *          errors carry .status (409 conflicts carry .body.current)
 * storage: {
 *   loadState() / saveState(state)    // { cursor, items: { [id]: { version, dirty, pendingDelete } } }
 *   get(id) -> doc | null             // the local copy
 *   put(doc)                          // save a merged or pulled copy
 *   remove(id)                        // remove locally (deleted elsewhere)
 * }
 */
export class SyncEngine {
  // `account` identifies where and as whom we sync (CG Core address + staff id). Sync state
  // belongs to one account: after signing in elsewhere, the old cursor and versions mean
  // nothing, so the device starts fresh there.
  constructor({ api, storage, account = () => null, onChange = () => {}, log = () => {} }) {
    Object.assign(this, { api, storage, account, onChange, log });
    this.running = null;
    this.again = false;
  }

  state() {
    const s = this.storage.loadState() || {};
    const account = this.account();
    if (account && s.account && s.account !== account) {
      // Signed in somewhere else: forget the other account's cursor and versions.
      return { cursor: null, items: {}, lastSyncAt: null, lastError: null, account, fresh: true };
    }
    return { cursor: s.cursor ?? null, items: s.items || {}, lastSyncAt: s.lastSyncAt ?? null, lastError: s.lastError ?? null, account: account ?? s.account ?? null };
  }

  // Called by the app whenever a meeting changes locally.
  markDirty(id) {
    const s = this.state();
    s.items[id] = { ...(s.items[id] || {}), dirty: true, pendingDelete: false };
    this.storage.saveState(s);
  }

  markDeleted(id) {
    const s = this.state();
    const it = s.items[id];
    if (!it?.version) delete s.items[id]; // never reached Core: nothing to delete there
    else s.items[id] = { ...it, dirty: true, pendingDelete: true };
    this.storage.saveState(s);
  }

  // Runs one sync; overlapping calls are coalesced into one more pass.
  async sync() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  async pass() {
    const s = this.state();
    const changed = new Set();
    try {
      await this.push(s, changed);
      await this.pull(s, changed);
      s.lastSyncAt = Date.now();
      s.lastError = null;
    } catch (err) {
      s.lastError = err.message;
      throw err;
    } finally {
      this.storage.saveState(s);
      if (changed.size) this.onChange([...changed]);
    }
  }

  async push(s, changed) {
    for (const [id, it] of Object.entries(s.items)) {
      if (!it.dirty) continue;
      if (it.pendingDelete) {
        await this.pushDelete(s, id, it);
        continue;
      }
      const doc = this.storage.get(id);
      if (!doc) {
        delete s.items[id];
        continue;
      }
      await this.pushDoc(s, id, it, doc, changed);
    }
  }

  async pushDoc(s, id, it, doc, changed, attempt = 0) {
    try {
      const res = await this.api.put(id, it.version ?? null, forUpload(doc));
      s.items[id] = { version: res.version, dirty: false };
    } catch (err) {
      const current = err.status === 409 ? err.body?.current : null;
      // A version this server never issued (e.g. left over from another account): create it.
      if (err.status === 409 && !current && it.version != null && attempt <= 2) {
        return this.pushDoc(s, id, { version: null }, doc, changed, attempt + 1);
      }
      if (!current || attempt > 2) throw err;
      // Someone else wrote first: merge, keep the merge locally, and try again on top.
      const merged = current.deleted ? doc : mergeMeetings(doc, current.doc);
      this.storage.put(merged);
      changed.add(id);
      await this.pushDoc(s, id, { version: current.version }, merged, changed, attempt + 1);
    }
  }

  async pushDelete(s, id, it, attempt = 0) {
    try {
      await this.api.del(id, it.version ?? null);
      delete s.items[id];
    } catch (err) {
      if (err.status === 404) return void delete s.items[id];
      const current = err.status === 409 ? err.body?.current : null;
      if (!current || attempt > 2) throw err;
      if (current.deleted) return void delete s.items[id];
      // Edited elsewhere since: the delete still wins, as the user asked for it.
      await this.pushDelete(s, id, { version: current.version }, attempt + 1);
    }
  }

  async pull(s, changed) {
    for (let page = 0; page < 1000; page++) {
      const res = await this.api.list(s.cursor, 100);
      for (const m of res.meetings) {
        const it = s.items[m.id];
        // A local edit that hasn't been pushed yet: leave it; the next push merges.
        if (it?.dirty) {
          s.items[m.id] = { ...it };
          continue;
        }
        if (m.deleted) {
          if (this.storage.get(m.id)) {
            this.storage.remove(m.id);
            changed.add(m.id);
          }
          delete s.items[m.id];
          continue;
        }
        const local = this.storage.get(m.id);
        const merged = mergeMeetings(local, m.doc);
        this.storage.put(merged);
        s.items[m.id] = { version: m.version, dirty: false };
        // Local had something Core didn't: push the merge back. Compare content, not JSON
        // text: Core stores jsonb, which reorders keys.
        if (local && !sameDoc(merged, m.doc)) s.items[m.id].dirty = true;
        changed.add(m.id);
      }
      s.cursor = res.cursor ?? s.cursor;
      if (!res.more) break;
    }
  }
}
