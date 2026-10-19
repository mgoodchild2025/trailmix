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
  assert.deepEqual(events, []);
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
