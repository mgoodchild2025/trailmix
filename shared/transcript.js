// Transcript helpers shared by the main process (prompts) and the renderer (display).
//
// A segment is { id, channel, speaker, text, start, end }.
//   channel 0 = the note-taker's microphone ("Me")
//   channel 1 = system audio, i.e. everyone else on the call ("Them")

export const ME = 0;
export const THEM = 1;

const words = (s) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);

function similarity(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  // Overlap coefficient: an echoed fragment is usually a subset of the original.
  return shared / Math.min(A.size, B.size);
}

// Without headphones the mic hears the speakers, so "Them" audio shows up again on
// the "Me" channel. Flag mic segments that overlap a system-audio segment in time
// and mostly repeat its words.
export function markEchoes(segments, threshold = 0.6) {
  const them = segments.filter((s) => s.channel === THEM);
  return segments.map((s) => {
    if (s.channel !== ME) return s;
    const echo = them.some(
      (t) =>
        t.start < s.end + 1.5 &&
        s.start < t.end + 1.5 &&
        words(s.text).length >= 2 &&
        similarity(s.text, t.text) >= threshold,
    );
    return echo ? { ...s, echo: true } : s;
  });
}

export function speakerLabel(seg, myName = 'Me') {
  if (seg.channel === ME) return myName || 'Me';
  return seg.speaker != null ? `Speaker ${seg.speaker + 1}` : 'Them';
}

export function formatTime(sec = 0) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// Merge consecutive segments from the same speaker into display/prompt turns.
export function toTurns(segments, myName) {
  const turns = [];
  const sorted = markEchoes([...segments].sort((a, b) => a.start - b.start)).filter(
    (s) => !s.echo && s.text.trim(),
  );
  for (const s of sorted) {
    const who = speakerLabel(s, myName);
    const last = turns[turns.length - 1];
    if (last && last.who === who && s.start - last.end < 20) {
      last.text += ' ' + s.text.trim();
      last.end = s.end;
    } else {
      turns.push({ who, channel: s.channel, text: s.text.trim(), start: s.start, end: s.end });
    }
  }
  return turns;
}

export function transcriptToText(segments, myName) {
  return toTurns(segments, myName)
    .map((t) => `[${formatTime(t.start)}] ${t.who}: ${t.text}`)
    .join('\n');
}

export function durationOf(segments) {
  return segments.reduce((max, s) => Math.max(max, s.end || 0), 0);
}
