// Meeting detection: notices when a call app starts using the microphone and decides when
// to offer "Take notes?" and, for recordings started that way, "Call ended? Stop".
// Pure logic; electron/micwatch.js feeds it what the OS reports.

// Known meeting apps. Mac entries match a bundle ID prefix (helper processes such as
// "com.google.Chrome.helper" share their app's prefix); Windows entries match the exe
// file name or the packaged app's family name.
export const MEETING_APPS = [
  { name: 'Teams', mac: ['com.microsoft.teams2', 'com.microsoft.teams'], win: ['ms-teams', 'teams.exe', 'msteams_'] },
  { name: 'Zoom', mac: ['us.zoom.'], win: ['zoom.exe', 'cpthost.exe'] },
  { name: 'Webex', mac: ['com.cisco.webexmeetingsapp', 'com.webex.', 'com.cisco.webex'], win: ['webex.exe', 'ciscowebexstart.exe', 'atmgr.exe'] },
  { name: 'Slack', mac: ['com.tinyspeck.slackmacgap'], win: ['slack.exe'] },
  { name: 'Google Meet', browser: true, mac: ['com.google.chrome', 'com.microsoft.edgemac', 'com.apple.safari', 'com.apple.webkit', 'org.mozilla.firefox', 'company.thebrowser.browser', 'com.brave.browser'], win: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'arc.exe'] },
  { name: 'FaceTime', mac: ['com.apple.facetime', 'com.apple.avconferenced'], win: [] },
  { name: 'Discord', mac: ['com.hnc.discord'], win: ['discord.exe'] },
  { name: 'GoTo', mac: ['com.logmein.goto', 'com.logmein.gotomeeting'], win: ['goto.exe', 'g2mcomm.exe'] },
  { name: 'RingCentral', mac: ['com.ringcentral.'], win: ['ringcentral.exe'] },
];

const OWN = ['com.cgtechnologies.trailmix', 'com.github.electron', 'trailmix.exe', 'electron.exe'];

// One reported app → { key, label, known } (key is stable across reports for that app).
export function classify(app, platform) {
  const id = (platform === 'darwin' ? app.bundleId : app.exe || app.id || '').toLowerCase();
  if (!id || OWN.some((o) => id.startsWith(o))) return null;
  for (const m of MEETING_APPS) {
    const list = platform === 'darwin' ? m.mac : m.win;
    const hit = list.find((p) => id.startsWith(p) || id === p);
    if (hit) return { key: m.name, label: m.browser ? `${browserName(id)} (a web meeting)` : m.name, known: true, browser: !!m.browser };
  }
  return { key: id, label: app.name || prettyExe(id), known: false };
}

function browserName(id) {
  if (id.includes('edge')) return 'Edge';
  if (id.includes('safari') || id.includes('webkit')) return 'Safari';
  if (id.includes('firefox')) return 'Firefox';
  if (id.includes('brave')) return 'Brave';
  if (id.includes('thebrowser') || id.includes('arc')) return 'Arc';
  return 'Chrome';
}

const prettyExe = (id) => id.replace(/\.exe$/, '').replace(/^.*[\\/]/, '');

// Windows keeps, per app, when it last started and stopped using the microphone
// (HKCU\...\CapabilityAccessManager\ConsentStore\microphone). Stop == 0 means "in use now".
// Parses `reg query <that key> /s` output.
export function parseWindowsConsentStore(text) {
  const apps = [];
  let current = null;
  const flush = () => {
    // `session` is when it started using the mic: a new value means a new call, even if
    // Windows never recorded the end of the last one (a crash or sleep leaves Stop at 0).
    if (current && current.start > 0n && current.stop === 0n) apps.push({ exe: current.id, name: prettyExe(current.id), session: current.start.toString() });
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^HKEY_/i.test(line)) {
      flush();
      const m = line.match(/\\microphone\\(?:NonPackaged\\)?([^\\]+)$/i);
      if (m && m[1].toLowerCase() !== 'nonpackaged') {
        // NonPackaged keys are the exe path with \ replaced by #.
        const seg = m[1];
        const id = seg.includes('#') ? seg.split('#').pop() : seg;
        current = { id: id.toLowerCase(), start: 0n, stop: -1n };
      }
      continue;
    }
    const v = line.match(/^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-f]+)/i);
    if (v && current) current[v[1] === 'LastUsedTimeStart' ? 'start' : 'stop'] = BigInt(v[2]);
  }
  flush();
  return apps;
}

/**
 * Feed it snapshots (`update(apps, now)`); it calls back:
 *   onPrompt({ key, label })     a meeting app has held the mic for `settleMs` → offer notes
 *   onEnded({ key, label })      the app a detection-started recording came from let go
 * Options: { platform, anyApp, settleMs, graceMs, endMs, isRecording() }
 * Call update() regularly (not only when the app list changes): the timers only advance
 * when it runs.
 */
export class MeetingDetector {
  constructor({ platform, anyApp = false, settleMs = 2500, graceMs = 3000, endMs = 8000, isRecording = () => false, onPrompt = () => {}, onEnded = () => {} }) {
    Object.assign(this, { platform, anyApp, settleMs, graceMs, endMs, isRecording, onPrompt, onEnded });
    this.seen = new Map(); // key -> { label, since, prompted, goneAt }
    this.following = null; // { key, label, goneSince } for a recording we started from a prompt
  }

  update(rawApps, now = Date.now()) {
    const present = new Map();
    for (const a of rawApps) {
      const c = classify(a, this.platform);
      if (!c || !(c.known || this.anyApp)) continue;
      const prev = present.get(c.key);
      present.set(c.key, { ...c, session: a.session || prev?.session || null });
    }
    // Apps that let go of the mic are forgotten, so the next call prompts again. Brief
    // drops (browsers open and close the mic during a call) don't count.
    for (const [key, s] of [...this.seen]) {
      if (present.has(key)) continue;
      s.goneAt ??= now;
      if (now - s.goneAt > this.graceMs) this.seen.delete(key);
    }
    for (const [key, c] of present) {
      let s = this.seen.get(key);
      // The OS says this is a new mic session for the app: treat it as a new call.
      if (s && c.session && s.session && c.session !== s.session) s = null;
      if (!s) s = { label: c.label, since: now, prompted: false };
      if (c.session) s.session = c.session;
      s.goneAt = null;
      this.seen.set(key, s);
      if (!s.prompted && now - s.since >= this.settleMs) {
        s.prompted = true; // once per call, whatever the answer
        if (!this.isRecording()) this.onPrompt({ key, label: c.label });
      }
    }
    if (this.following) {
      if (present.has(this.following.key)) this.following.goneSince = null;
      else if (!this.following.goneSince) this.following.goneSince = now;
      else if (now - this.following.goneSince >= this.endMs) {
        const f = this.following;
        this.following = null;
        if (this.isRecording()) this.onEnded({ key: f.key, label: f.label });
      }
    }
  }

  // The user accepted a prompt: watch for that app letting go of the mic.
  follow(key, label) {
    this.following = { key, label, goneSince: null };
  }

  stopFollowing() {
    this.following = null;
  }
}
