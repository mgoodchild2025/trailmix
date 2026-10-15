import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, mergeMeetings, touch } from '../shared/sync.js';

// In-memory CG Core following docs/cg-core-api.md section 5.
// Postgres jsonb returns objects with keys sorted (and recursively), like this.
const jsonb = (v) => (Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, jsonb(v[k])])) : v);

function fakeCore({ pageSize, reorderKeys = true } = {}) {
  const rows = new Map(); // id -> { version, seq, deleted, doc }
  let seq = 0;
  const err = (status, body) => Object.assign(new Error(`HTTP ${status}`), { status, body });
  const current = (id) => {
    const r = rows.get(id);
    return r && { id, version: r.version, deleted: r.deleted, doc: r.deleted ? null : reorderKeys ? jsonb(r.doc) : structuredClone(r.doc) };
  };
  return {
    rows,
    async list(cursor, limit) {
      const after = Number(cursor || 0);
      const n = pageSize || limit;
      const changed = [...rows.entries()].filter(([, r]) => r.seq > after).sort((a, b) => a[1].seq - b[1].seq);
      const page = changed.slice(0, n);
      return {
        meetings: page.map(([id]) => current(id)),
        cursor: String(page.length ? page.at(-1)[1].seq : after),
        more: changed.length > n,
      };
    },
    async put(id, ifVersion, doc) {
      const r = rows.get(id);
      if ((r?.version ?? null) !== (ifVersion ?? null)) throw err(409, { code: 'conflict', current: current(id) });
      const version = (r?.version || 0) + 1;
      rows.set(id, { version, seq: ++seq, deleted: false, doc: structuredClone(doc) });
      return { id, version };
    },
    async del(id, ifVersion) {
      const r = rows.get(id);
      if (!r) throw err(404, {});
      if (r.version !== ifVersion) throw err(409, { code: 'conflict', current: current(id) });
      rows.set(id, { version: r.version + 1, seq: ++seq, deleted: true, doc: null });
      return { id, version: r.version + 1 };
    },
  };
}

function device(api, account = () => 'core-a|staff-1') {
  const docs = new Map();
  let state = null;
  const storage = {
    loadState: () => (state ? structuredClone(state) : null),
    saveState: (s) => (state = structuredClone(s)),
    get: (id) => (docs.has(id) ? structuredClone(docs.get(id)) : null),
    put: (doc) => docs.set(doc.id, structuredClone(doc)),
    remove: (id) => docs.delete(id),
  };
  const changes = [];
  const engine = new SyncEngine({ api, storage, account: () => account(), onChange: (ids) => changes.push(...ids) });
  return {
    docs,
    engine,
    changes,
    edit(id, fields, at) {
      const doc = docs.get(id) || { id, title: '', notes: '', enhanced: '', transcript: [], chat: [], createdAt: at, updatedAt: at };
      Object.assign(doc, fields);
      touch(doc, Object.keys(fields).filter((k) => k !== 'transcript'), at);
      docs.set(id, doc);
      engine.markDirty(id);
    },
    delete(id) {
      docs.delete(id);
      engine.markDeleted(id);
    },
  };
}

test('a meeting made on the phone appears on the laptop', async () => {
  const core = fakeCore();
  const phone = device(core);
  const laptop = device(core);
  phone.edit('m1', { title: 'Site visit', notes: 'rack needs UPS', source: 'mobile' }, 1000);
  await phone.engine.sync();
  await laptop.engine.sync();
  assert.equal(laptop.docs.get('m1').title, 'Site visit');
  assert.deepEqual(laptop.changes, ['m1']);
});

test('different fields edited on two devices both survive a conflict', async () => {
  const core = fakeCore();
  const phone = device(core);
  const laptop = device(core);
  phone.edit('m1', { title: 'Draft', notes: 'a' }, 1000);
  await phone.engine.sync();
  await laptop.engine.sync();
  phone.edit('m1', { notes: 'a, plus phone notes' }, 2000);
  laptop.edit('m1', { title: 'Acme QBR' }, 2100);
  await phone.engine.sync();
  await laptop.engine.sync(); // gets a 409, merges, retries
  await phone.engine.sync();
  for (const d of [phone, laptop]) {
    assert.equal(d.docs.get('m1').title, 'Acme QBR');
    assert.equal(d.docs.get('m1').notes, 'a, plus phone notes');
  }
  assert.equal(core.rows.get('m1').version, 3);
});

test('the same field edited twice: the later edit wins', async () => {
  const core = fakeCore();
  const a = device(core);
  const b = device(core);
  a.edit('m1', { notes: 'v1' }, 1000);
  await a.engine.sync();
  await b.engine.sync();
  a.edit('m1', { notes: 'from a (later)' }, 3000);
  b.edit('m1', { notes: 'from b (earlier)' }, 2000);
  await b.engine.sync();
  await a.engine.sync();
  await b.engine.sync();
  assert.equal(a.docs.get('m1').notes, 'from a (later)');
  assert.equal(b.docs.get('m1').notes, 'from a (later)');
});

test('transcripts from two devices are combined by segment', async () => {
  const merged = mergeMeetings(
    { id: 'm', transcript: [{ id: 's1', start: 0, text: 'one' }, { id: 's3', start: 9, text: 'three' }] },
    { id: 'm', transcript: [{ id: 's2', start: 4, text: 'two' }, { id: 's1', start: 0, text: 'one' }] },
  );
  assert.deepEqual(merged.transcript.map((s) => s.id), ['s1', 's2', 's3']);
});

test('deleting on one device removes it everywhere and erases it in Core', async () => {
  const core = fakeCore();
  const phone = device(core);
  const laptop = device(core);
  phone.edit('m1', { title: 'x' }, 1000);
  await phone.engine.sync();
  await laptop.engine.sync();
  laptop.delete('m1');
  await laptop.engine.sync();
  await phone.engine.sync();
  assert.equal(phone.docs.has('m1'), false);
  assert.equal(core.rows.get('m1').deleted, true);
  assert.equal(core.rows.get('m1').doc, null);
});

test('a meeting deleted before it ever synced never reaches Core', async () => {
  const core = fakeCore();
  const d = device(core);
  d.edit('m1', { title: 'oops' }, 1000);
  d.delete('m1');
  await d.engine.sync();
  assert.equal(core.rows.size, 0);
});

test('pulls page through "more" without missing changes', async () => {
  const core = fakeCore({ pageSize: 2 });
  const a = device(core);
  for (let i = 0; i < 5; i++) a.edit(`m${i}`, { title: `M${i}` }, 1000 + i);
  await a.engine.sync();
  const b = device(core);
  await b.engine.sync();
  assert.equal(b.docs.size, 5);
});

test('local-only sync bookkeeping is never uploaded', async () => {
  const core = fakeCore();
  const d = device(core);
  d.edit('m1', { title: 't', _sync: { secret: 1 } }, 1000);
  await d.engine.sync();
  assert.equal('_sync' in core.rows.get('m1').doc, false);
});

test('devices settle: nothing is re-uploaded after a sync with no changes', async () => {
  const core = fakeCore();
  const phone = device(core);
  const laptop = device(core);
  phone.edit('m1', { title: 'Site visit', notes: 'rack', source: 'mobile' }, 1000);
  laptop.edit('m2', { title: 'QBR', notes: 'renewal', source: 'desktop' }, 1100);
  for (let i = 0; i < 4; i++) {
    await phone.engine.sync();
    await laptop.engine.sync();
  }
  const versions = () => [...core.rows.values()].map((r) => r.version);
  const before = versions();
  for (let i = 0; i < 3; i++) {
    await phone.engine.sync();
    await laptop.engine.sync();
  }
  assert.deepEqual(versions(), before, 'versions kept rising: devices are ping-ponging uploads');
  assert.deepEqual(before, [1, 1]);
  for (const d of [phone, laptop]) {
    const st = d.engine.state();
    assert.equal(Object.values(st.items).some((i) => i.dirty), false);
  }
});

test('signing in to a different CG Core starts sync fresh there', async () => {
  const staging = fakeCore();
  const production = fakeCore();
  let where = 'staging';
  const api = new Proxy({}, { get: (_t, k) => (where === 'staging' ? staging : production)[k] });
  const d = device(api, () => `${where}|staff-1`);
  d.edit('m1', { title: 'Made on staging', notes: 'n' }, 1000);
  for (let i = 0; i < 3; i++) d.edit('m1', { notes: `v${i}` }, 2000 + i), await d.engine.sync();
  assert.equal(staging.rows.get('m1').version, 3);
  // Now signed in to production: the staging cursor and version 3 mean nothing there.
  where = 'production';
  d.engine.markDirty('m1'); // what the apps do on their first sync after a fresh start
  await d.engine.sync();
  assert.equal(production.rows.get('m1').version, 1);
  assert.equal(production.rows.get('m1').doc.notes, 'v2');
  assert.equal(d.engine.state().account, 'production|staff-1');
});

test('a version the server never issued is uploaded as new', async () => {
  const core = fakeCore();
  const err = (status, body) => Object.assign(new Error('x'), { status, body });
  const api = { ...core, put: async (id, v, doc) => (v != null && !core.rows.has(id) ? Promise.reject(err(409, { code: 'conflict', current: null })) : core.put(id, v, doc)) };
  const d = device(api);
  d.edit('m1', { title: 't' }, 1000);
  const st = d.engine.state();
  st.items.m1 = { version: 7, dirty: true };
  d.engine.storage.saveState(st);
  await d.engine.sync();
  assert.equal(core.rows.get('m1').version, 1);
});

test('meetings saved before sync existed settle after one upload', async () => {
  const core = fakeCore();
  const d = device(core);
  // An old meeting file: no fieldTimes at all.
  d.docs.set('old', { id: 'old', title: 'From 0.3', notes: 'n', enhanced: '', transcript: [], chat: [], createdAt: 1, updatedAt: 1 });
  d.engine.markDirty('old');
  await d.engine.sync();
  await d.engine.sync();
  await d.engine.sync();
  assert.equal(core.rows.get('old').version, 1);
  assert.equal(d.engine.state().items.old.dirty, false);
});
