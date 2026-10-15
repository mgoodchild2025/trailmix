// "Try the demo": sample meetings and simulated recording and AI, all in memory. For
// people without a CG Technologies account (including Apple's TestFlight reviewers).
const now = Date.now();
const seg = (speaker, start, text, i) => ({ id: `d${start}-${i}`, channel: 0, mono: true, speaker, start, end: start + 6, text });

export const DEMO_MEETINGS = [
  {
    id: 'demo-qbr',
    title: 'Northfield Dental — Q3 service review',
    createdAt: now - 2 * 3600e3,
    updatedAt: now - 2 * 3600e3,
    source: 'mobile',
    templateId: 'client-review',
    notes: 'backups failing leeds\nteams phones quote\nrenewal march, price sensitive',
    transcript: [
      seg(0, 3, 'Thanks for coming in. The main thing for us is the backups at the Leeds practice.', 0),
      seg(1, 11, 'Understood. The NAS job has been failing since the third of October.', 1),
      seg(0, 22, 'We would also like a quote for moving the phones over to Teams.', 2),
      seg(1, 31, "I'll send that by Friday, along with renewal options for March.", 3),
    ],
    enhanced: `# Northfield Dental — Q3 service review

## Service issues raised
- <mark>Backups failing at Leeds</mark> — the NAS backup job has failed since 3 Oct; likely the new firewall rule.

## Projects & recommendations
- <mark>Teams Phone quote</mark> to replace the hosted PBX at both sites.

## Commercial
- <mark>Renewal in March, price sensitive</mark> — options at current and reduced scope.

## Agreed next steps
- [ ] Fix the Leeds backup job and run a restore test
- [ ] Send the Teams Phone quote and renewal options (Fri)`,
    chat: [],
  },
  {
    id: 'demo-standup',
    title: 'Service desk stand-up',
    createdAt: now - 26 * 3600e3,
    updatedAt: now - 26 * 3600e3,
    source: 'desktop',
    templateId: 'team',
    notes: 'backlog 42\npatching moved to thursday',
    transcript: [],
    enhanced: '',
    chat: [],
  },
];

export const DEMO_LINES = [
  [0, 'Morning. Shall we start with the ticket queue?'],
  [1, "We're at forty two open, down from fifty last week."],
  [0, 'Good. The patching window has moved to Thursday night.'],
  [1, "I'll let the Leeds practice know it affects their server."],
];

export const demoEnhanced = (m) => `# ${m.title || 'Service desk stand-up'}

## Updates
- <mark>Backlog at 42</mark> open tickets, down from 50 last week.
- <mark>Patching moved to Thursday</mark> night.

## Action items
- [ ] Tell the Leeds practice the patching affects their server`;

export const demoAnswer = 'This is the demo, so answers are examples. Signed in with CG Core, Trailmix answers from the meeting notes and transcript, citing times like [00:12].';

export async function streamText(text, onDelta, signal) {
  for (let i = 0; i < text.length; i += 10) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    onDelta?.(text.slice(i, i + 10));
    await new Promise((r) => setTimeout(r, 18));
  }
  return text;
}
