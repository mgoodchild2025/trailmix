// The real API comes from the Electron preload. When the UI is opened in a plain
// browser (`npm run web`) we fall back to an in-memory demo so the interface can be
// previewed and designed without Electron, API keys or a microphone.
import { BUILT_IN_TEMPLATES } from '../../shared/templates.js';

export const api = window.trailmix || createDemoBridge();
export const isDemo = !window.trailmix;

// `npm run web` with #overlay=prompt|ended|recording previews the floating window.
function demoOverlay() {
  const mode = new URLSearchParams(location.hash.slice(1)).get('overlay') || 'prompt';
  return { mode, label: 'Teams', rec: { state: 'live', title: 'Northfield Dental — quarterly review', accumMs: 754000, resumedAt: Date.now() } };
}

function createDemoBridge() {
  const listeners = { transcribe: new Set(), ai: new Set() };
  const emit = (set, p) => set.forEach((cb) => cb(p));
  const now = Date.now();
  let settings = {
    myName: 'Matt',
    claudeModel: 'claude-opus-5-5',
    deepgramModel: 'nova-3',
    language: 'en',
    keyterms: 'CG Technologies',
    defaultTemplateId: 'general',
    autoEnhance: true,
    detectMeetings: true,
    detectAnyApp: false,
    customTemplates: [],
    hasDeepgramKey: true,
    hasAnthropicKey: true,
    encryptionAvailable: true,
    ownKeys: { deepgram: false, anthropic: false },
    core: {
      connected: true,
      url: 'https://core.cgtechnologies.com',
      staff: { name: 'Matt Goodchild', email: 'matt@example.com' },
      device: { name: "Matt's MacBook Air" },
      features: { claude: true, deepgram: true, sync: true },
      config: { claudeModels: ['claude-opus-5-5', 'claude-sonnet-5-5'], defaultClaudeModel: 'claude-opus-5-5' },
    },
  };
  const coreListeners = new Set();
  const changeListeners = new Set();
  const seg = (channel, speaker, start, text) => ({ id: `${start}`, channel, speaker, start, end: start + 6, text });
  const meetings = new Map(
    [
      {
        id: 'demo-1',
        title: 'Northfield Dental — quarterly review',
        createdAt: now - 3 * 3600e3,
        updatedAt: now,
        templateId: 'client-review',
        notes: 'backups failing leeds\nwants teams phones quote\nrenewal march - price sensitive\nMFA rollout for reception?',
        transcript: [
          seg(1, 0, 4, 'Thanks for making time. The main thing on our side is the backups at the Leeds practice.'),
          seg(0, null, 12, 'Yes, we saw that. The NAS job has been failing since the third of October.'),
          seg(1, 1, 22, 'We would also like a quote for moving the phones over to Teams.'),
          seg(0, null, 31, "I'll get that over to you by Friday, along with the renewal options for March."),
        ],
        enhanced: `# Northfield Dental — Q3 service review

## Context
- Quarterly review with Northfield's practice manager and finance lead.

## Service issues raised
- <mark>Backups failing at Leeds</mark> — NAS backup job failing since **3 Oct**; suspected cause is the new firewall rule.

## Projects & recommendations
- <mark>Wants a Teams Phone quote</mark> to replace the current hosted PBX at both sites.
- <mark>MFA rollout for reception</mark> — shared reception logins are the blocker; propose named accounts.

## Commercial
- <mark>Renewal in March, price sensitive</mark> — asked for options at current and reduced scope.

## Agreed next steps
- [ ] Matt — fix Leeds backup job and confirm a successful restore test
- [ ] Matt — send Teams Phone quote and renewal options (Fri)`,
        chat: [],
      },
      {
        id: 'demo-2',
        title: 'Weekly service desk stand-up',
        createdAt: now - 26 * 3600e3,
        updatedAt: now,
        templateId: 'team',
        notes: 'ticket backlog 42\npatching window moved',
        transcript: [],
        enhanced: '',
        chat: [],
      },
    ].map((m) => [m.id, m]),
  );
  const summary = (m) => ({
    id: m.id, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt,
    hasEnhanced: !!m.enhanced, segments: m.transcript.length,
    preview: (m.enhanced || m.notes).replace(/<\/?mark>|[#*\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140),
  });
  const streamText = async (requestId, text) => {
    for (let i = 0; i < text.length; i += 12) {
      emit(listeners.ai, { requestId, text: text.slice(i, i + 12) });
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  let fake;

  return {
    platform: 'demo',
    settings: {
      get: async () => settings,
      set: async (p) => {
        settings = { ...settings, ...p };
        if ('deepgramKey' in p) settings.hasDeepgramKey = !!p.deepgramKey;
        if ('anthropicKey' in p) settings.hasAnthropicKey = !!p.anthropicKey;
        return settings;
      },
    },
    meetings: {
      list: async () => [...meetings.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt),
      search: async (q) =>
        q.trim() ? [...meetings.values()].filter((m) => JSON.stringify(m).toLowerCase().includes(q.toLowerCase())).map((m) => m.id) : null,
      get: async (id) => structuredClone(meetings.get(id)),
      create: async (f = {}) => {
        const m = { id: `demo-${Date.now()}`, title: '', createdAt: Date.now(), updatedAt: Date.now(), notes: '', transcript: [], enhanced: '', templateId: settings.defaultTemplateId, chat: [], ...f };
        meetings.set(m.id, m);
        return structuredClone(m);
      },
      patch: async (id, f) => Object.assign(meetings.get(id), f, { updatedAt: Date.now() }) && true,
      remove: async (id) => {
        meetings.delete(id);
        changeListeners.forEach((cb) => cb({ deleted: id }));
        return true;
      },
      // No native menus in a browser: offer delete only.
      menu: async ({ id }) => {
        const m = meetings.get(id);
        if (window.confirm(`Delete "${m.title || 'Untitled meeting'}"? (The desktop app shows a Share and Delete menu here.)`)) {
          meetings.delete(id);
          changeListeners.forEach((cb) => cb({ deleted: id }));
        }
      },
      onChanged: (cb) => (changeListeners.add(cb), () => changeListeners.delete(cb)),
    },
    onToast: () => () => {},
    commands: { on: () => () => {} },
    rec: { report: () => {} },
    window: { setCompact: async (on) => on, pin: async (on) => on },
    notesReady: () => {},
    overlay: { get: async () => demoOverlay(), onState: () => () => {}, act: () => {} },
    system: {
      permissions: async () => ({ platform: 'demo', mic: 'granted', screen: 'granted' }),
      askMic: async () => true,
      openPrivacy: async () => {},
      openDataFolder: async () => {},
    },
    transcribe: {
      start: async ({ meetingId }) => {
        const lines = [
          [1, 0, 'Morning all, shall we start with the ticket queue?'],
          [0, null, 'Sure. We are at forty two open, down from fifty last week.'],
          [1, 1, 'The patching window has moved to Thursday night.'],
        ];
        let i = 0;
        let t = meetings.get(meetingId).transcript.at(-1)?.end || 0;
        fake = setInterval(() => {
          const [channel, speaker, text] = lines[i++ % lines.length];
          emit(listeners.transcribe, { type: 'interim', meetingId, channel, text: text.slice(0, 20) + '…' });
          setTimeout(() => {
            const s = seg(channel, speaker, t, text);
            s.id = `${Date.now()}`;
            t += 6;
            meetings.get(meetingId).transcript.push(s);
            emit(listeners.transcribe, { type: 'final', meetingId, segment: s });
          }, 700);
        }, 2500);
        setTimeout(() => emit(listeners.transcribe, { type: 'status', meetingId, state: 'open' }), 300);
        return true;
      },
      stop: async () => clearInterval(fake),
      sendAudio: () => {},
      onEvent: (cb) => (listeners.transcribe.add(cb), () => listeners.transcribe.delete(cb)),
    },
    ai: {
      enhance: async ({ requestId, meetingId, templateId }) => {
        const m = meetings.get(meetingId);
        const tpl = BUILT_IN_TEMPLATES.find((t) => t.id === templateId) || BUILT_IN_TEMPLATES[0];
        const text = `# ${m.title || 'Service desk stand-up'}\n\n${tpl.sections
          .split('\n')
          .filter((l) => l.startsWith('## '))
          .slice(0, 3)
          .map((h) => `${h}\n- <mark>${m.notes.split('\n')[0] || 'Key point'}</mark> — detail pulled from the transcript.\n- A second point Claude found in the conversation.`)
          .join('\n\n')}\n\n## Action items\n- [ ] Matt — follow up on the above`;
        await streamText(requestId, text);
        const fields = { enhanced: text, templateId: tpl.id };
        if (!m.title) fields.title = text.match(/^# (.+)$/m)[1];
        Object.assign(m, fields);
        return fields;
      },
      chat: async ({ requestId }) => {
        const text = 'This is the demo preview, so answers are canned. In the desktop app Claude answers from the meeting notes and transcript, citing times like [00:12].';
        await streamText(requestId, text);
        return { text };
      },
      cancel: async () => {},
      onDelta: (cb) => (listeners.ai.add(cb), () => listeners.ai.delete(cb)),
    },
    core: {
      urls: async () => ({ production: 'https://core.cgtechnologies.com', staging: 'https://core-staging.cgtechnologies.com' }),
      connect: async () => {
        setTimeout(() => {
          settings = { ...settings, core: { ...settings.core, connected: true }, hasDeepgramKey: true, hasAnthropicKey: true };
          coreListeners.forEach((cb) => cb({ ...settings.core, justConnected: true }));
        }, 1500);
        coreListeners.forEach((cb) => cb({ ...settings.core, pairing: true }));
        return true;
      },
      pairCode: async () => {},
      cancel: async () => coreListeners.forEach((cb) => cb({ ...settings.core, pairing: false })),
      refresh: async () => {},
      signout: async () => {
        settings = { ...settings, core: { connected: false, url: settings.core.url }, hasDeepgramKey: false, hasAnthropicKey: false };
        coreListeners.forEach((cb) => cb(settings.core));
      },
      onStatus: (cb) => (coreListeners.add(cb), () => coreListeners.delete(cb)),
    },
    sync: {
      status: async () => ({ enabled: true, lastSyncAt: Date.now() - 120000, pending: 0 }),
      now: async () => {},
      onStatus: () => () => {},
    },
    updates: {
      status: async () => ({ state: 'dev', version: '0.1.0' }),
      check: async () => {},
      install: async () => false,
      onStatus: () => () => {},
    },
    exporter: {
      copy: async ({ text, html }) => {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
        ]);
        return true;
      },
      saveMarkdown: async ({ title, markdown }) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
        a.download = `${title || 'Meeting notes'}.md`;
        a.click();
        return true;
      },
    },
  };
}
