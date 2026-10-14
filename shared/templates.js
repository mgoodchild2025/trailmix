// Built-in note templates. Each template's `sections` text is given to Claude as the
// structure for the enhanced notes. Staff can add their own in Settings → Templates.

export const BUILT_IN_TEMPLATES = [
  {
    id: 'general',
    name: 'General meeting',
    description: 'A good default for most meetings.',
    sections: `## Summary
Two or three sentences on what the meeting was about and where it landed.

## Key points
The substance of the discussion, grouped by topic.

## Decisions
Anything that was agreed or decided.

## Action items
Who is doing what, and by when if mentioned.`,
  },
  {
    id: 'client-review',
    name: 'Client meeting / QBR',
    description: 'Account reviews and client check-ins.',
    sections: `## Context
Who attended from the client side and the purpose of the meeting.

## Client priorities & concerns
What the client cares about right now, in their words where possible.

## Service issues raised
Problems, outages, tickets or frustrations mentioned, including systems and users affected.

## Projects & recommendations
Work in flight, proposed projects, and recommendations we made.

## Commercial
Renewals, budget, pricing, new opportunities or upsell signals.

## Risks
Anything that threatens the relationship, security posture or delivery.

## Agreed next steps
Owner — task — due date.`,
  },
  {
    id: 'discovery',
    name: 'Sales discovery',
    description: 'First calls with prospects.',
    sections: `## Company & stakeholders
Who they are, size, industry, and who is involved in the decision.

## Current environment
Existing IT setup: provider, devices, Microsoft 365/Google, line-of-business apps, backups, security tooling, networks, sites.

## Pain points
What is not working today and why they are talking to us.

## Requirements
What a good outcome looks like for them.

## Budget, timeline & decision process
Anything said about money, timing, contracts ending, or how they will decide.

## Objections & concerns

## Next steps`,
  },
  {
    id: 'technical',
    name: 'Technical / support call',
    description: 'Troubleshooting calls; produces ticket-ready notes.',
    sections: `## Problem
What the user reported, in plain terms, plus when it started.

## Environment
Affected users, devices, systems, versions, sites.

## Troubleshooting performed
Steps taken in order and what each showed.

## Root cause
Confirmed or suspected. Say clearly if unconfirmed.

## Resolution / workaround

## Follow-up
Outstanding actions and owners.

## Ticket note
A short, client-facing paragraph suitable for pasting into the ticket.`,
  },
  {
    id: 'one-on-one',
    name: '1:1',
    description: 'Manager and team-member check-ins.',
    sections: `## Check-in
How they are doing.

## Wins

## Challenges & blockers

## Feedback
Given in either direction.

## Growth & goals

## Action items`,
  },
  {
    id: 'team',
    name: 'Team meeting / stand-up',
    description: 'Internal team syncs.',
    sections: `## Updates
Grouped by person where the transcript makes it clear who is speaking.

## Blockers

## Decisions

## Action items`,
  },
  {
    id: 'interview',
    name: 'Interview',
    description: 'Hiring interviews.',
    sections: `## Candidate background

## Technical ability
Evidence from their answers.

## Communication & fit

## Strengths

## Concerns

## Questions they asked

## Recommendation
Only if the interviewer stated one in their notes or on the call; otherwise leave for the interviewer.`,
  },
];

export function allTemplates(custom = []) {
  return [...BUILT_IN_TEMPLATES, ...custom];
}

export function findTemplate(id, custom = []) {
  return allTemplates(custom).find((t) => t.id === id) || BUILT_IN_TEMPLATES[0];
}
