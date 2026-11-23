// Filing a meeting to a client's, prospect's or lead's timeline in CG Core, and reading a
// client's history back (everyone's meetings, calls and visits you may see). Same CG Core
// endpoints and rules as the desktop app; demo mode answers from sample data.
import { CHAT_SYSTEM, clientContext } from '../../../shared/prompts.js';
import { filedRecord, pickSuggestion, suggestQueries } from '../../../shared/filing.js';
import { coreClient, getSession } from './session.js';
import { getMeeting, patchMeeting } from './store.js';
import { meetingChanged, syncNow } from './sync.js';
import { streamText } from './demo.js';

const demo = () => getSession().demo;
const features = () => getSession().info?.features || {};

/** Can this person file meetings (Log activities in CG Core)? */
export const canFile = () => demo() || !!features().file;
/** Can this person read client history (a sales permission or Log activities)? */
export const canReadHistory = () => demo() || !!(features().history || features().file);

function core() {
  const c = coreClient();
  if (!c) throw new Error('Sign in to CG Core first.');
  return c;
}

// ---------- demo data ----------
const DEMO_TARGETS = [
  { type: 'company', id: 'c-northfield', name: 'Northfield Dental', detail: 'Client' },
  { type: 'company', id: 'c-acme', name: 'Acme Accounting (AA)', detail: 'Prospect' },
  { type: 'lead', id: 'l-river', name: 'Riverside Physio', detail: 'Lead · Sam Patel' },
];
const DAY = 864e5;
const demoHistory = () => [
  { id: 'h1', type: 'meeting', subject: 'Northfield Dental — Q3 service review', notes: '## Summary\n- **Backups at Leeds** fixed after the firewall change\n- Teams Phone quote sent; decision in January\n\n## Actions\n- [ ] Tom to send the iPad serial numbers', truncated: false, occurredAt: new Date(Date.now() - 3 * DAY).toISOString(), by: 'Alex Morgan', contact: 'Dr Priya Shah', fromTrailmix: true, mine: true },
  { id: 'h2', type: 'site_visit', subject: 'Leeds practice: firewall and NAS', notes: 'Replaced the firewall rule blocking the NAS; ran a manual backup.', truncated: false, occurredAt: new Date(Date.now() - 26 * DAY).toISOString(), by: 'Sam Lee', contact: null, fromTrailmix: false, mine: false },
  { id: 'h3', type: 'call', subject: 'Backup failure follow-up', notes: 'Called Tom: NAS job failing since 3 Oct. Booked a site visit.', truncated: false, occurredAt: new Date(Date.now() - 30 * DAY).toISOString(), by: 'Jordan Ellis', contact: 'Tom Reed', fromTrailmix: false, mine: false },
];

// ---------- search and contacts ----------
export async function searchClients(q) {
  if (demo()) return DEMO_TARGETS.filter((t) => q.toLowerCase().split(/\s+/).every((w) => t.name.toLowerCase().includes(w)));
  return (await core().searchClients(q)).results;
}

export async function companyContacts(companyId) {
  if (demo()) return companyId === 'c-northfield' ? [{ id: 'p1', name: 'Dr Priya Shah', title: 'Practice owner' }, { id: 'p2', name: 'Tom Reed', title: 'Practice manager' }] : [];
  return (await core().companyContacts(companyId)).contacts;
}

/** The client a meeting's title names, or null. */
export async function suggestTarget(meetingId) {
  const m = getMeeting(meetingId);
  if (!m || m.filed || !canFile()) return null;
  const found = [];
  for (const q of suggestQueries(m.title)) found.push(...(await searchClients(q).catch(() => [])));
  return pickSuggestion(m.title, found);
}

// ---------- filing ----------
/** Files the meeting (CG Core builds the entry from its synced copy, so sync first). */
export async function fileMeeting(meetingId, { target, contactId = null, includeTranscript = false }) {
  let res;
  if (demo()) {
    const t = DEMO_TARGETS.find((x) => x.id === target.id) || target;
    res = { activityId: 'demo', target: { type: t.type, id: t.id, name: t.name }, url: 'https://core.cgtechnologies.com/', filedAt: new Date().toISOString(), updated: !!getMeeting(meetingId)?.filed };
  } else {
    meetingChanged(meetingId);
    await syncNow();
    try {
      res = await core().fileMeeting(meetingId, { target, contactId, includeTranscript });
    } catch (err) {
      if (err.status !== 404 || !/synced/i.test(err.message)) throw err;
      await syncNow();
      res = await core().fileMeeting(meetingId, { target, contactId, includeTranscript });
    }
  }
  const filed = filedRecord(res, includeTranscript);
  patchMeeting(meetingId, { filed });
  meetingChanged(meetingId);
  return { ...filed, updated: !!res.updated };
}

export async function unfileMeeting(meetingId) {
  if (!demo()) await core().unfileMeeting(meetingId);
  patchMeeting(meetingId, { filed: null });
  meetingChanged(meetingId);
}

// ---------- client history ----------
export async function clientHistory(type, id, before = null) {
  if (demo()) {
    const t = DEMO_TARGETS.find((x) => x.id === id) || { type, id, name: 'Client', detail: 'Client' };
    return { target: { ...t, url: 'https://core.cgtechnologies.com/' }, entries: demoHistory(), nextBefore: null };
  }
  return core().clientHistory(type, id, before);
}

export async function historyEntry(type, id, activityId) {
  if (demo()) return demoHistory().find((e) => e.id === activityId);
  return (await core().clientHistoryEntry(type, id, activityId)).entry;
}

/** Answers a question from the client's history (up to 200 entries). */
export async function askClient(target, messages, { onDelta, signal } = {}) {
  if (demo()) return streamText(`This is the demo, so answers are examples. Signed in, Trailmix answers from every meeting, call and visit with ${target.name} on record.`, onDelta, signal);
  const c = core();
  let page = await c.clientHistory(target.type, target.id);
  const entries = [...page.entries];
  while (page.nextBefore && entries.length < 200) {
    page = await c.clientHistory(target.type, target.id, page.nextBefore);
    entries.push(...page.entries);
  }
  const info = getSession().info || {};
  const { text } = await c.streamClaude({
    purpose: 'chat',
    model: info.config?.defaultClaudeModel,
    system: [
      { type: 'text', text: CHAT_SYSTEM },
      { type: 'text', text: clientContext(page.target || target, entries), cache_control: { type: 'ephemeral' } },
    ],
    messages,
    effort: 'low',
    maxTokens: 16000,
    onDelta,
    signal,
  });
  return text;
}
