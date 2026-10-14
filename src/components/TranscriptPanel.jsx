import { useEffect, useMemo, useRef } from 'react';
import { toTurns, formatTime, ME } from '../../shared/transcript.js';
import Icon from './Icon.jsx';

export default function TranscriptPanel({ segments, interim, myName, live, onClose }) {
  const turns = useMemo(() => toTurns(segments, myName), [segments, myName]);
  const ref = useRef(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns, interim]);

  return (
    <section className="transcript">
      <header className="panel-head">
        <span>Transcript</span>
        <button className="icon-btn" onClick={onClose} title="Hide transcript">
          <Icon name="close" />
        </button>
      </header>
      <div
        className="transcript-body"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {turns.length === 0 && !interim?.[0] && !interim?.[1] && (
          <p className="muted small">{live ? 'Listening… speech will appear here.' : 'No transcript for this meeting.'}</p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`turn ${t.channel === ME ? 'me' : 'them'}`}>
            <div className="turn-head">
              <span className="who">{t.who}</span>
              <span className="time">{formatTime(t.start)}</span>
            </div>
            <p>{t.text}</p>
          </div>
        ))}
        {live &&
          [0, 1].map((ch) =>
            interim?.[ch] ? (
              <div key={ch} className={`turn interim ${ch === ME ? 'me' : 'them'}`}>
                <p>{interim[ch]}</p>
              </div>
            ) : null,
          )}
      </div>
    </section>
  );
}
