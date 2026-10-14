import test from 'node:test';
import assert from 'node:assert/strict';
import { markEchoes, toTurns, transcriptToText, formatTime } from '../shared/transcript.js';

const seg = (channel, start, text, speaker = null) => ({ id: `${channel}-${start}`, channel, speaker, start, end: start + 4, text });

test('mic echo of system audio is flagged', () => {
  const out = markEchoes([
    seg(1, 10, 'We need the backup report by Friday please', 0),
    seg(0, 10.4, 'need the backup report by Friday'),
    seg(0, 30, 'Sure, I can send that over'),
  ]);
  assert.equal(out[1].echo, true);
  assert.equal(out[2].echo, undefined);
});

test('genuine replies overlapping in time are kept', () => {
  const out = markEchoes([seg(1, 10, 'Can you send the quote today?', 0), seg(0, 12, 'Yes I will email it this afternoon')]);
  assert.equal(out[1].echo, undefined);
});

test('turns merge consecutive segments from one speaker and drop echoes', () => {
  const turns = toTurns(
    [seg(0, 0, 'Hello'), seg(0, 4, 'everyone.'), seg(1, 9, 'Hi Matt, thanks for joining', 1), seg(0, 9.2, 'thanks for joining')],
    'Matt',
  );
  assert.deepEqual(turns.map((t) => [t.who, t.text]), [
    ['Matt', 'Hello everyone.'],
    ['Speaker 2', 'Hi Matt, thanks for joining'],
  ]);
});

test('transcript text has timestamps and labels', () => {
  assert.equal(transcriptToText([seg(1, 65, 'Morning')]), '[01:05] Speaker: Morning'.replace('Speaker:', 'Them:'));
  assert.equal(formatTime(3725), '1:02:05');
});
