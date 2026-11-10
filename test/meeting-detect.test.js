import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, parseWindowsConsentStore, MeetingDetector } from '../electron/meeting-detect.js';

test('recognises meeting apps on macOS, including browser helper processes', () => {
  assert.equal(classify({ bundleId: 'com.microsoft.teams2' }, 'darwin').label, 'Teams');
  assert.equal(classify({ bundleId: 'us.zoom.xos' }, 'darwin').label, 'Zoom');
  assert.equal(classify({ bundleId: 'com.google.Chrome.helper' }, 'darwin').label, 'Chrome (a web meeting)');
  assert.equal(classify({ bundleId: 'com.microsoft.edgemac.helper' }, 'darwin').label, 'Edge (a web meeting)');
  assert.equal(classify({ bundleId: 'com.example.dictation', name: 'Dictator' }, 'darwin').known, false);
});

test('never prompts about Trailmix itself', () => {
  assert.equal(classify({ bundleId: 'com.cgtechnologies.trailmix.helper.Renderer' }, 'darwin'), null);
  assert.equal(classify({ bundleId: 'com.github.Electron.helper' }, 'darwin'), null);
  assert.equal(classify({ exe: 'trailmix.exe' }, 'win32'), null);
});

test('parses the Windows microphone consent store', () => {
  const text = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone',
    '    Value    REG_SZ    Allow',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe',
    '    LastUsedTimeStart    REG_QWORD    0x1db1f2c3a4b5c6d',
    '    LastUsedTimeStop    REG_QWORD    0x0',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#matt#AppData#Roaming#Zoom#bin#Zoom.exe',
    '    LastUsedTimeStart    REG_QWORD    0x1db1f2c3a4b5c6d',
    '    LastUsedTimeStop    REG_QWORD    0x0',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe',
    '    LastUsedTimeStart    REG_QWORD    0x1db1f2c3a4b5c6d',
    '    LastUsedTimeStop    REG_QWORD    0x1db1f2c3a4b9999',
  ].join('\r\n');
  const apps = parseWindowsConsentStore(text);
  assert.deepEqual(apps.map((a) => a.exe), ['msteams_8wekyb3d8bbwe', 'zoom.exe']);
  assert.equal(classify(apps[0], 'win32').label, 'Teams');
  assert.equal(classify(apps[1], 'win32').label, 'Zoom');
});

function run(opts = {}) {
  const events = [];
  let recording = false;
  const d = new MeetingDetector({
    platform: 'darwin',
    isRecording: () => recording,
    onPrompt: (e) => events.push(['prompt', e.label]),
    onEnded: (e) => events.push(['ended', e.label]),
    ...opts,
  });
  return { d, events, setRecording: (v) => (recording = v) };
}
const zoom = [{ bundleId: 'us.zoom.xos', pid: 1 }];

test('asks once a meeting app has held the mic for a couple of seconds, and only once per call', () => {
  const { d, events } = run();
  d.update(zoom, 0);
  d.update(zoom, 2000);
  assert.deepEqual(events, []); // a blip isn't a call
  d.update(zoom, 2500);
  d.update(zoom, 60000);
  assert.deepEqual(events, [['prompt', 'Zoom']]);
  d.update([], 61000); // call over
  d.update([], 65000);
  d.update(zoom, 120000);
  d.update(zoom, 126000); // next call asks again
  assert.deepEqual(events, [['prompt', 'Zoom'], ['prompt', 'Zoom']]);
});

test('stays quiet while Trailmix is already recording, and for unknown apps by default', () => {
  const { d, events, setRecording } = run();
  setRecording(true);
  d.update(zoom, 0);
  d.update(zoom, 6000);
  d.update([{ bundleId: 'com.example.voicememo' }], 7000);
  d.update([{ bundleId: 'com.example.voicememo' }], 20000);
  // No prompts (Zoom leaving mid-recording is a separate "call ended?" offer).
  assert.deepEqual(events.filter((e) => e[0] === 'prompt'), []);
  const any = run({ anyApp: true });
  any.d.update([{ bundleId: 'com.example.voicememo', name: 'Voice thing' }], 0);
  any.d.update([{ bundleId: 'com.example.voicememo', name: 'Voice thing' }], 6000);
  assert.deepEqual(any.events, [['prompt', 'Voice thing']]);
});

test('offers to stop when the followed call app lets go of the mic for a while', () => {
  const { d, events, setRecording } = run();
  d.update(zoom, 0);
  d.update(zoom, 5000);
  d.follow('Zoom', 'Zoom');
  setRecording(true);
  d.update([], 10000); // mute/unmute or a brief drop: wait
  d.update(zoom, 12000);
  d.update([], 20000);
  d.update([], 27000);
  assert.deepEqual(events, [['prompt', 'Zoom']]);
  d.update([], 28000);
  assert.deepEqual(events, [['prompt', 'Zoom'], ['ended', 'Zoom']]);
});

test('a call app that briefly drops the mic still gets asked', () => {
  const chrome = [{ bundleId: 'com.google.Chrome.helper', pid: 2 }];
  const { d, events } = run();
  d.update(chrome, 0);
  d.update([], 1000); // browsers reopen the mic during a call
  d.update(chrome, 2000);
  d.update(chrome, 2500);
  assert.deepEqual(events, [['prompt', 'Chrome (a web meeting)']]);
});

test('a long gap starts the count again', () => {
  const { d, events } = run();
  d.update(zoom, 0);
  d.update([], 1000);
  d.update([], 5000); // gone for longer than the grace period
  d.update(zoom, 6000);
  d.update(zoom, 8000);
  assert.deepEqual(events, []);
  d.update(zoom, 8500);
  assert.deepEqual(events, [['prompt', 'Zoom']]);
});

test('a new mic session from the same app is a new call, even without a gap', () => {
  const { d, events } = run({ platform: 'win32' });
  const teams = (session) => [{ exe: 'ms-teams.exe', session }];
  d.update(teams('100'), 0);
  d.update(teams('100'), 3000);
  assert.deepEqual(events, [['prompt', 'Teams']]);
  // Windows never recorded the end of that call; the next one has a new start time.
  d.update(teams('100'), 600000);
  d.update(teams('200'), 900000);
  d.update(teams('200'), 903000);
  assert.deepEqual(events, [['prompt', 'Teams'], ['prompt', 'Teams']]);
});

test('the consent store parser reports when each app started using the mic', () => {
  const out = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe',
    '    LastUsedTimeStart    REG_QWORD    0x1dc4f00aa000000',
    '    LastUsedTimeStop    REG_QWORD    0x0',
  ].join('\r\n');
  const apps = parseWindowsConsentStore(out);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].session, BigInt('0x1dc4f00aa000000').toString());
});

test("Siri and dictation are never a call, even with 'any app' on", () => {
  const { d, events } = run({ anyApp: true });
  const siri = [{ bundleId: 'com.apple.CoreSpeech', pid: 9 }];
  d.update(siri, 0);
  d.update(siri, 5000);
  assert.deepEqual(events, []);
});

test('a manual recording still offers to stop when the call app leaves', () => {
  const { d, events, setRecording } = run();
  setRecording(true); // pressed Record without a prompt
  d.update(zoom, 0);
  d.update(zoom, 4000);
  d.update([], 5000);
  d.update([], 13000);
  assert.deepEqual(events, [['ended', 'Zoom']]);
});

test('the call ends when the meeting app leaves, not when another app does', () => {
  const teams = { bundleId: 'com.microsoft.teams2.modulehost', pid: 3 };
  const other = { bundleId: 'com.example.recorder', name: 'Recorder', pid: 4 };
  const { d, events, setRecording } = run({ anyApp: true });
  d.update([other], 0);
  d.update([other], 3000); // prompt for the other app, which the user accepts
  d.follow('com.example.recorder', 'Recorder');
  setRecording(true);
  d.update([other, teams], 3500); // Teams joins the call
  d.update([other], 10000); // Teams hangs up; the other app keeps the mic
  d.update([other], 19000);
  assert.deepEqual(events, [['prompt', 'Recorder']]);
  d.update([], 20000);
  d.update([], 28000);
  assert.deepEqual(events, [['prompt', 'Recorder'], ['ended', 'Recorder']]);
});

test('the stop offer comes once per call, and again if a new call starts', () => {
  const { d, events, setRecording } = run();
  setRecording(true);
  d.update(zoom, 0);
  d.update([], 1000);
  d.update([], 9000);
  d.update([], 20000);
  assert.deepEqual(events, [['ended', 'Zoom']]);
  d.update(zoom, 30000);
  d.update([], 31000);
  d.update([], 39000);
  assert.equal(events.filter((e) => e[0] === 'ended').length, 2);
});

test('a call that comes back after the end offer is reported, so a countdown can be cancelled', () => {
  const events = [];
  const d = new MeetingDetector({
    platform: 'darwin',
    isRecording: () => true,
    onEnded: (e) => events.push(['ended', e.label]),
    onResumed: (e) => events.push(['resumed', e.label]),
  });
  d.update(zoom, 0);
  d.update([], 1000);
  d.update([], 9000);
  d.update(zoom, 12000); // reconnected
  assert.deepEqual(events, [['ended', 'Zoom'], ['resumed', 'Zoom']]);
});
