import { useMemo, useState } from 'react';
import Icon from './Icon.jsx';
import { dayGroup, fmtTime } from '../lib/util.js';
import { api } from '../lib/bridge.js';

export default function Sidebar({ meetings, selectedId, view, query, onQuery, matches, onSelect, onNew, onAsk, onSettings, rec, enhancingId, canHistory, onHistory }) {
  // Clients, prospects and leads this person has filed meetings to, for the filter.
  const [client, setClient] = useState('');
  const clients = useMemo(() => {
    const byKey = new Map();
    for (const m of meetings) {
      if (!m.filed) continue;
      const key = `${m.filed.type}:${m.filed.id}`;
      byKey.set(key, { name: m.filed.name, target: { type: m.filed.type, id: m.filed.id, name: m.filed.name }, count: (byKey.get(key)?.count || 0) + 1 });
    }
    return [...byKey].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  }, [meetings]);
  const clientOn = client && clients.some((c) => c.key === client) ? client : '';

  const groups = useMemo(() => {
    let list = matches ? meetings.filter((m) => matches.includes(m.id)) : meetings;
    if (clientOn) list = list.filter((m) => m.filed && `${m.filed.type}:${m.filed.id}` === clientOn);
    const out = [];
    for (const m of list) {
      const g = dayGroup(m.createdAt);
      if (out.at(-1)?.label !== g) out.push({ label: g, items: [] });
      out.at(-1).items.push(m);
    }
    return out;
  }, [meetings, matches, clientOn]);

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
        {canHistory && (
          <button className={`nav-item ${view === 'client' ? 'active' : ''}`} onClick={() => onHistory(clientOn ? clients.find((c) => c.key === clientOn)?.target ?? null : null)}>
            <Icon name="folder" /> Client history
          </button>
        )}
        <label className="search">
          <Icon name="search" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search notes and transcripts" />
        </label>
        {clients.length > 0 && (
          <select className="select client-filter" value={clientOn} onChange={(e) => setClient(e.target.value)} aria-label="Show meetings filed to a client">
            <option value="">All meetings</option>
            {clients.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        )}
      </div>

      <nav className="meeting-list">
        {groups.length === 0 && <p className="muted small pad">{query || clientOn ? 'No matches.' : 'No meetings yet.'}</p>}
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
                    {fmtTime(m.createdAt)}
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
