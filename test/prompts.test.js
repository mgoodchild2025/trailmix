import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceUserMessage, libraryContext } from '../shared/prompts.js';
import { findTemplate } from '../shared/templates.js';

const meeting = (over = {}) => ({
  id: 'a', title: '', createdAt: Date.UTC(2026, 9, 13, 9), notes: 'backups failing', enhanced: '', chat: [],
  transcript: [{ id: '1', channel: 1, speaker: 0, start: 3, end: 6, text: 'The Leeds backups keep failing.' }],
  ...over,
});

test('enhance message includes notes, transcript and template sections', () => {
  const msg = enhanceUserMessage(meeting(), findTemplate('client-review'), 'Matt');
  assert.match(msg, /<rough_notes>\nbackups failing\n<\/rough_notes>/);
  assert.match(msg, /\[00:03\] Speaker 1: The Leeds backups keep failing\./);
  assert.match(msg, /## Service issues raised/);
  assert.match(msg, /Note-taker: Matt/);
});

test('unknown template falls back to general', () => {
  assert.equal(findTemplate('nope').id, 'general');
});

test('library context prefers enhanced notes and respects the budget', () => {
  const ms = [
    meeting({ id: 'old', createdAt: 1, title: 'Old', enhanced: 'x'.repeat(500) }),
    meeting({ id: 'new', createdAt: 2, title: 'New', enhanced: '# New notes' }),
  ];
  const ctx = libraryContext(ms, 'Matt', 300);
  assert.match(ctx, /title="New"/);
  assert.doesNotMatch(ctx, /title="Old"/);
  assert.match(ctx, /1 older meeting\(s\) omitted/);
  assert.doesNotMatch(ctx, /<transcript>/);
});

test('client context lists everyone\'s entries with who, when and with whom, newest kept first when long', async () => {
  const { clientContext } = await import('../shared/prompts.js');
  const target = { name: 'Northfield Dental', detail: 'Client' };
  const entries = [
    { type: 'meeting', subject: 'Q3 "review"', notes: 'Backups fixed', truncated: false, occurredAt: '2026-11-20T15:00:00Z', by: 'Matt', contact: 'Jo Smith' },
    { type: 'call', subject: 'Follow-up', notes: 'x'.repeat(500), truncated: true, occurredAt: '2026-10-01T15:00:00Z', by: 'Alex', contact: null },
  ];
  const all = clientContext(target, entries);
  assert.match(all, /<client name="Northfield Dental" kind="Client">/);
  assert.match(all, /title="Q3 'review'"/);
  assert.match(all, /by="Matt" with="Jo Smith">\nBackups fixed/);
  assert.match(all, /\(cut for length\)/);
  const short = clientContext(target, entries, 300);
  assert.match(short, /Backups fixed/);
  assert.match(short, /1 older entry omitted for length/);
  assert.match(clientContext(target, []), /No meetings, calls or visits on record yet/);
});
