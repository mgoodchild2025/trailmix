// The small always-on-top window: "Meeting detected — Start recording", "Call ended —
// Stop", and the recording indicator shown while you're in another app.
import { useEffect, useState } from 'react';
import { api } from './lib/bridge.js';
import Icon from './components/Icon.jsx';

const elapsedMs = (rec) => (rec?.state === 'live' ? rec.accumMs + (Date.now() - rec.resumedAt) : rec?.accumMs || 0);

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function Overlay() {
  const [view, setView] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add('overlay-page');
    api.overlay.get().then((v) => v && setView(v));
    return api.overlay.onState(setView);
  }, []);

  const live = view?.rec?.state === 'live';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live]);

  if (!view) return null;
  const act = (type) => () => api.overlay.act({ type });
  const time = fmt(elapsedMs(view.rec));

  if (view.mode === 'recording') {
    const paused = view.rec.state === 'paused';
    return (
      <div key="recording" className="ov ov-pill drag">
        <button className="ov-time no-drag" onClick={act('open')} title={`Show ${view.rec.title || 'meeting'}`}>
          <span className={`rec-dot${paused ? ' static paused' : ''}`} />
          <span className="ov-clock">{paused ? 'Paused' : time}</span>
        </button>
        <button className="icon-btn no-drag" onClick={act(paused ? 'resume' : 'pause')} aria-label={paused ? 'Resume recording' : 'Pause recording'} title={paused ? 'Resume' : 'Pause'}>
          <Icon name={paused ? 'play' : 'pause'} />
        </button>
        <button className="ov-stop no-drag" onClick={act('stop')} aria-label="Stop recording" title="Stop and write notes">
          <Icon name="stop" /> Stop
        </button>
      </div>
    );
  }

  const ended = view.mode === 'ended';
  return (
    <div key={view.mode} className="ov ov-card drag">
      <span className="brand-mark ov-mark" aria-hidden="true" />
      <div className="ov-text">
        <b>{ended ? `${view.label} call ended` : 'Meeting detected'}</b>
        <span title={view.label}>{ended ? `Recording · ${time}` : `${view.label} is using your mic`}</span>
      </div>
      {ended ? (
        <button className="btn primary small no-drag" onClick={act('stop')}>
          Stop &amp; write notes
        </button>
      ) : (
        <button className="btn primary small no-drag" onClick={act('start')}>
          <span className="rec-dot static on-red" /> Start recording
        </button>
      )}
      <button className="icon-btn ov-close no-drag" onClick={act('dismiss')} aria-label={ended ? 'Keep recording' : 'Not now'} title={ended ? 'Keep recording' : 'Not now'}>
        <Icon name="close" />
      </button>
    </div>
  );
}
