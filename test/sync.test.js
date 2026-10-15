import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, mergeMeetings, touch } from '../shared/sync.js';

// In-memory CG Core following docs/cg-core-api.md section 5.
function fakeCore({ pageSize } = {}) {
  const rows = new Map(); // id -> { version, seq, deleted, doc }
  let seq = 0;
  const err = (status, body) => Object.assign(new Error(`HTTP ${status}`), { status, body });
  const current = (id) => {
    const r = rows.get(id);
    return r && { id, version: r.version, deleted: r.deleted, doc: r.deleted ? null : structuredClone(r.doc) };
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

function device(api) {
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
  const engine = new SyncEngine({ api, storage, onChange: (ids) => changes.push(...ids) });
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
