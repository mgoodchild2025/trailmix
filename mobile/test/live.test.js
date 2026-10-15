import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, pcmLevel } from '../src/lib/live.js';

test('base64 PCM decodes to the same bytes as Node', () => {
  const bytes = new Uint8Array(3199).map((_, i) => (i * 37) % 256);
  const b64 = Buffer.from(bytes).toString('base64');
  assert.deepEqual(base64ToBytes(b64), bytes);
});

test('level of silence is 0 and of full scale is about 1', () => {
  assert.equal(pcmLevel(new Uint8Array(320)), 0);
  const loud = new Uint8Array(320);
  for (let i = 0; i < 320; i += 2) [loud[i], loud[i + 1]] = [0xff, 0x7f];
  assert.ok(pcmLevel(loud) > 0.99);
});
