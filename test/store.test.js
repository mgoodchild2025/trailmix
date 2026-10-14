import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.js';

const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
};

test('meetings persist, patch, search and move to trash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailmix-'));
  const s = new Store(dir, fakeSafe);
  const m = s.create({ title: 'Acme' });
  s.patch(m.id, { notes: 'firewall renewal', transcript: 'ignored' });
  s.appendSegment(m.id, { id: '1', channel: 0, start: 0, end: 1, text: 'hello there' });
  s.flushAll();

  const fresh = new Store(dir, fakeSafe);
  const back = fresh.get(m.id);
  assert.equal(back.notes, 'firewall renewal');
  assert.equal(back.transcript.length, 1);
  assert.deepEqual(fresh.search('FIREWALL'), [m.id]);
  assert.deepEqual(fresh.search('hello'), [m.id]);
  assert.equal(fresh.list()[0].title, 'Acme');

  fresh.remove(m.id);
  assert.equal(fresh.list().length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'trash', `${m.id}.json`)));
  assert.throws(() => fresh.get('../settings'), /Bad meeting id/);
});

test('API keys are encrypted at rest and never exposed in public settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailmix-'));
  const s = new Store(dir, fakeSafe);
  const pub = s.saveSettings({ anthropicKey: ' sk-test ', myName: 'Matt', hasAnthropicKey: false });
  assert.equal(pub.hasAnthropicKey, true);
  assert.equal(pub.anthropicKey, undefined);
  assert.equal(pub.myName, 'Matt');
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.doesNotMatch(raw, /"sk-test"/);
  assert.equal(s.secrets().anthropicKey, 'sk-test');
  s.saveSettings({ anthropicKey: '' });
  assert.equal(s.settings().hasAnthropicKey, !!process.env.ANTHROPIC_API_KEY);
});
