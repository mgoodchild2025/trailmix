// Filing a meeting to a client's, prospect's or lead's timeline in CG Core: guessing
// which client a meeting was with from its title. Shared by the desktop and mobile apps.
//
// CG Core's search (GET /api/trailmix/v1/clients?q=) needs every typed word in the
// name, so the app asks once per likely word of the title, then keeps the result whose
// whole name appears in the title ("Northfield Dental - Q3 review" -> Northfield Dental).

// Words that are in many titles but never a client's name.
const STOP = new Set(
  'meeting call review quarterly weekly monthly sync catch up catchup check checkin intro introduction discovery demo kickoff kick off onboarding qbr service support follow followup with and the for from about our your notes stand standup team internal update planning q1 q2 q3 q4 1:1 one'.split(' '),
);

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/<\/?mark>/g, '')
    .split(/[^\p{L}\p{N}&']+/u)
    .filter(Boolean);

/** The searches worth sending for a title: its distinctive words, longest first, at most 4. */
export function suggestQueries(title) {
  const seen = new Set();
  return words(title)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !seen.has(w) && seen.add(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
}

// A company's name without what's in brackets (its nickname) or legal endings.
const coreName = (name) =>
  words(String(name).replace(/\(.*?\)/g, ' ')).filter((w) => !['inc', 'ltd', 'llc', 'corp', 'corporation', 'limited', 'co', 'the'].includes(w));

/**
 * The search result the title most clearly names, or null when none is clear: every
 * word of its name must be in the title, and the longest such name wins (so
 * "Northfield Dental Leeds" beats "Northfield Dental" for a title naming both).
 * A nickname in brackets also counts when it's written in the title.
 */
export function pickSuggestion(title, results) {
  const t = new Set(words(title));
  let best = null;
  let bestLen = 0;
  for (const r of results || []) {
    const name = coreName(r.name);
    const nick = (/\(([^)]+)\)/.exec(r.name)?.[1] || '').toLowerCase().split(/,\s*/).filter(Boolean);
    const byName = name.length > 0 && name.every((w) => t.has(w));
    const byNick = nick.some((n) => words(n).length && words(n).every((w) => t.has(w)));
    if (!byName && !byNick) continue;
    const len = byName ? name.join(' ').length : 1;
    if (len > bestLen) {
      best = r;
      bestLen = len;
    }
  }
  return best;
}

/** What a meeting keeps about where it was filed (synced to the person's other devices). */
export function filedRecord(res, includeTranscript) {
  return {
    type: res.target.type,
    id: res.target.id,
    name: res.target.name,
    activityId: res.activityId,
    url: res.url,
    at: Date.parse(res.filedAt) || Date.now(),
    includeTranscript: !!includeTranscript,
  };
}
