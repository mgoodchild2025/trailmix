import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceUserMessage, libraryContext } from '../electron/prompts.js';
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
