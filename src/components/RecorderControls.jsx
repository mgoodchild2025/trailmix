import Icon from './Icon.jsx';
import { fmtClock } from '../lib/util.js';

function Meter({ label, value }) {
  // RMS → rough perceptual 0..1
  const v = Math.min(1, Math.sqrt(value || 0) * 2.2);
  return (
    <span className="meter" title={label}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ transform: `scaleX(${v})` }} />
      </span>
    </span>
  );
}

export default function RecorderControls({ isThis, rec, levels, elapsed, onStart, onStop, onPause, onResume }) {
  if (!isThis || rec.state === 'idle') {
    const busy = rec.state !== 'idle';
    return (
      <button className="btn record" onClick={onStart} disabled={busy} title={busy ? 'Another meeting is recording' : ''}>
        <span className="rec-dot static" /> {busy ? 'Recording elsewhere' : 'Start recording'}
      </button>
    );
  }
  if (rec.state === 'starting' || rec.state === 'stopping') {
    return <span className="rec-status muted">{rec.state === 'starting' ? 'Starting…' : 'Finishing transcript…'}</span>;
  }
  const paused = rec.state === 'paused';
  return (
    <div className={`recorder ${paused ? 'paused' : ''}`}>
      <span className={`rec-dot ${paused ? 'static' : ''}`} />
      <span className="rec-time">{fmtClock(elapsed)}</span>
      {rec.conn === 'reconnecting' && <span className="chip warn tiny">Reconnecting…</span>}
      <Meter label="You" value={paused ? 0 : levels.mic} />
      <Meter label="Them" value={paused ? 0 : levels.sys} />
      {paused ? (
        <button className="icon-btn" onClick={onResume} title="Resume">
          <Icon name="play" />
        </button>
      ) : (
        <button className="icon-btn" onClick={onPause} title="Pause">
          <Icon name="pause" />
        </button>
      )}
      <button className="btn stop" onClick={onStop}>
        <Icon name="stop" size={14} /> Stop
      </button>
    </div>
  );
}
