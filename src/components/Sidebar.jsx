import { useMemo } from 'react';
import Icon from './Icon.jsx';
import { dayGroup } from '../lib/util.js';
import { api } from '../lib/bridge.js';

export default function Sidebar({ meetings, selectedId, view, query, onQuery, matches, onSelect, onNew, onAsk, onSettings, rec, enhancingId }) {
  const groups = useMemo(() => {
    const list = matches ? meetings.filter((m) => matches.includes(m.id)) : meetings;
    const out = [];
    for (const m of list) {
      const g = dayGroup(m.createdAt);
      if (out.at(-1)?.label !== g) out.push({ label: g, items: [] });
      out.at(-1).items.push(m);
    }
    return out;
  }, [meetings, matches]);

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Trailmix
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="btn primary block" onClick={onNew}>
          <Icon name="plus" /> New meeting
        </button>
        <button className={`nav-item ${view === 'ask' ? 'active' : ''}`} onClick={onAsk}>
          <Icon name="sparkle" /> Ask across meetings
        </button>
        <label className="search">
          <Icon name="search" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search notes and transcripts" />
        </label>
      </div>

      <nav className="meeting-list">
        {groups.length === 0 && <p className="muted small pad">{query ? 'No matches.' : 'No meetings yet.'}</p>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="group-label">{g.label}</div>
            {g.items.map((m) => (
              <div
                key={m.id}
                className={`meeting-row ${view === 'meeting' && m.id === selectedId ? 'active' : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  api.meetings.menu({ id: m.id, x: e.clientX, y: e.clientY });
                }}
              >
                <button className="meeting-item" onClick={() => onSelect(m.id)}>
                  <span className="meeting-title">
                    {rec.meetingId === m.id && rec.state !== 'idle' && <span className="rec-dot" />}
                    {enhancingId === m.id && <span className="spinner small" title="Writing notes…" />}
                    {m.title || 'Untitled meeting'}
                  </span>
                  <span className="meeting-meta">
                    {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    {m.hasEnhanced && <span className="chip tiny">Enhanced</span>}
                  </span>
                </button>
                <button
                  className="icon-btn row-menu"
                  title="Share or delete"
                  aria-label={`Share or delete ${m.title || 'Untitled meeting'}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    api.meetings.menu({ id: m.id, x: r.left, y: r.bottom + 2 });
                  }}
                >
                  <Icon name="more" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={onSettings}>
          <Icon name="gear" /> Settings
        </button>
      </div>
    </aside>
  );
}
