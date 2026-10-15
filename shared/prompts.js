import { transcriptToText, formatTime, durationOf, isMono } from './transcript.js';

const ORG = 'CG Technologies, an IT managed service provider';

export const ENHANCE_SYSTEM = `You write meeting notes for staff at ${ORG}.

You receive the note-taker's own rough notes, an automatic transcript and a template. Turn them into clean, scannable notes the note-taker would be happy to send to a colleague.

How to treat the inputs:
- The note-taker's rough notes show what they thought mattered. Every point in them must appear in the output, and they set the emphasis. Use the transcript to fill in detail, context, names, numbers and anything important they missed.
- The transcript is machine-generated. It can mishear words, especially names, product names and acronyms. "Me" (or the note-taker's name) is the person taking notes; "Speaker N" labels are other participants and may not be consistent. Prefer the note-taker's spelling of names and terms over the transcript's.
- Never invent facts, owners or dates. If something is ambiguous, say so briefly rather than guessing.

Output format:
- Markdown only. The first line is "# " followed by a short, specific meeting title (for example "Acme Dental — Q3 service review", not "Meeting notes").
- Use the template's sections as "## " headings, in order. Drop a section if nothing in the meeting fits it; do not write "None" or "N/A".
- Bullets are short and concrete. Nest sub-bullets for supporting detail. Bold only the few things a skimmer must not miss.
- Action items are task-list bullets: "- [ ] Owner — task (due date)". Leave the owner or date out if it was not stated.
- Wrap text that comes directly from the note-taker's rough notes in <mark>…</mark>, keeping their wording (you may fix obvious typos). Text you add from the transcript stays unwrapped. For example: "- <mark>Backup failures at Leeds site</mark> — NAS job has failed since 3 Oct; Dave suspects the new firewall rule."
- No preamble or closing remarks; output only the notes.`;

export function enhanceUserMessage(meeting, template, myName) {
  const date = new Date(meeting.createdAt);
  const transcript = transcriptToText(meeting.transcript || [], myName);
  return `<meeting>
Title so far: ${meeting.title || '(untitled)'}
Date: ${date.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}
Length: ${formatTime(durationOf(meeting.transcript || []))}
Note-taker: ${myName || 'Me'}${
    isMono(meeting.transcript)
      ? '\nRecorded on one phone microphone: speakers are numbered by the transcription and one of them is the note-taker. Use names from the notes or the conversation where it is clear who is speaking.'
      : ''
  }
</meeting>

<template name="${template.name}">
${template.sections}
</template>

<rough_notes>
${(meeting.notes || '').trim() || '(The note-taker did not write any notes. Base the notes on the transcript.)'}
</rough_notes>

<transcript>
${transcript || '(No transcript was captured.)'}
</transcript>

Write the enhanced notes.`;
}

export const CHAT_SYSTEM = `You are Trailmix, the meeting-notes assistant used by staff at ${ORG}. Answer questions using the meeting material provided below.

- Base answers on the material. If it doesn't cover something, say so plainly; do not fill gaps from general knowledge unless the user asks you to.
- When you rely on the transcript, cite the time like [12:04] so the user can check it. For questions spanning several meetings, name the meeting and date.
- The transcript is machine-generated and may mishear names and terms.
- Be concise. Use Markdown lists when they help. When asked to draft something (follow-up email, ticket note, summary for a manager), write it ready to paste.`;

export function meetingContext(meeting, myName, { includeTranscript = true } = {}) {
  const date = new Date(meeting.createdAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const parts = [`<meeting title="${(meeting.title || 'Untitled').replace(/"/g, "'")}" date="${date}">`];
  if (meeting.enhanced) parts.push(`<enhanced_notes>\n${meeting.enhanced}\n</enhanced_notes>`);
  if (meeting.notes?.trim()) parts.push(`<rough_notes>\n${meeting.notes.trim()}\n</rough_notes>`);
  if (includeTranscript && meeting.transcript?.length)
    parts.push(`<transcript>\n${transcriptToText(meeting.transcript, myName)}\n</transcript>`);
  parts.push('</meeting>');
  return parts.join('\n');
}

// For questions across meetings: newest first, enhanced notes in preference to
// transcripts, stopping at a character budget so the request fits comfortably.
export function libraryContext(meetings, myName, budgetChars = 600_000) {
  const sorted = [...meetings].sort((a, b) => b.createdAt - a.createdAt);
  const out = [];
  let used = 0;
  let omitted = 0;
  for (const m of sorted) {
    const full = meetingContext(m, myName, { includeTranscript: !m.enhanced });
    if (used + full.length > budgetChars) {
      omitted++;
      continue;
    }
    out.push(full);
    used += full.length;
  }
  if (omitted) out.push(`(${omitted} older meeting(s) omitted for length.)`);
  return out.join('\n\n');
}
