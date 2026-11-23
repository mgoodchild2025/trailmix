// Client history: a client's, prospect's or lead's meetings, calls and site visits from
// CG Core, everyone's that you may see (filed from Trailmix or logged in Core), with
// "Ask about this client" across them.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/bridge.js';
import { renderMarkdown } from '../lib/markdown.js';
import { errMsg } from '../lib/util.js';
import Icon from './Icon.jsx';
import ClientSearch from './ClientSearch.jsx';
import ChatPanel from './ChatPanel.jsx';

const KIND = { meeting: 'Meeting', call: 'Call', site_visit: 'Site visit' };
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function ClientHistory({ target, onPick, settings, toast, localByActivity = {}, onOpenMeeting }) {
  const [data, setData] = useState(null); // { target, entries, nextBefore }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({}); // id -> full entry (or true while loading)
  const [asking, setAsking] = useState(false);

  const load = useCallback(
    async (before = null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.history.get({ type: target.type, id: target.id, before });
        setData((d) => (before && d ? { ...page, entries: [...d.entries, ...page.entries] } : page));
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [target?.type, target?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    setData(null);
    setOpen({});
    setAsking(false);
    if (target) load();
  }, [target?.type, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (e) => {
    if (open[e.id]) return setOpen(({ [e.id]: _, ...rest }) => rest);
    if (!e.truncated) return setOpen((o) => ({ ...o, [e.id]: e }));
    setOpen((o) => ({ ...o, [e.id]: true }));
    try {
      const full = await api.history.entry({ type: target.type, id: target.id, activityId: e.id });
      setOpen((o) => ({ ...o, [e.id]: full }));
    } catch (err) {
      toast(errMsg(err));
      setOpen(({ [e.id]: _, ...rest }) => rest);
    }
  };

  if (!target) {
    return (
      <main className="main client-history">
        <header className="page-head drag">
          <h1>Client history</h1>
          <p className="muted small">Meetings, calls and visits with a client, prospect or lead, from CG Core: everyone&apos;s you can see, not just yours.</p>
        </header>
        <div className="history-pick">
          <ClientSearch onPick={onPick} toast={toast} />
        </div>
      </main>
    );
  }

  const t = data?.target || target;
  return (
    <main className="main client-history">
      <header className="page-head drag history-head">
        <div>
          <h1>{t.name}</h1>
          <p className="muted small">
            {t.detail && <>{t.detail} · </>}
            {t.url && (
              <button className="link small no-drag" onClick={() => api.filing.open(t.url)}>
                Open in CG Core
              </button>
            )}
            {' · '}
            <button className="link small no-drag" onClick={() => onPick(null)}>
              Another client
            </button>
          </p>
        </div>
        <button className={`btn no-drag ${asking ? 'accent' : ''}`} onClick={() => setAsking((v) => !v)} disabled={!data?.entries.length}>
          <Icon name="sparkle" /> Ask about {t.name.split(' (')[0]}
        </button>
      </header>

      <div className="history-body">
        <div className="history-list">
          {error && (
            <div className="banner warn">
              <Icon name="warn" /> {error}{' '}
              <button className="link small" onClick={() => load()}>
                Try again
              </button>
            </div>
          )}
          {!data && loading && <p className="muted pad">Loading…</p>}
          {data && data.entries.length === 0 && <p className="muted pad">No meetings, calls or visits on record yet.</p>}
          {data?.entries.map((e) => {
            const full = open[e.id];
            const localId = localByActivity[e.id];
            return (
              <article key={e.id} className={`history-entry ${full ? 'open' : ''}`}>
                <button className="history-entry-head" onClick={() => toggle(e)} aria-expanded={!!full}>
                  <div>
                    <b>{e.subject}</b>
                    <div className="muted small">
                      {when(e.occurredAt)} · {KIND[e.type] || 'Meeting'}
                      {e.by && <> · {e.mine ? 'You' : e.by}</>}
                      {e.contact && <> · with {e.contact}</>}
                      {e.fromTrailmix && <span className="chip tiny">Trailmix</span>}
                    </div>
                  </div>
                  <Icon name={full ? 'close' : 'plus'} size={14} />
                </button>
                {full === true && <p className="muted small pad">Loading…</p>}
                {full && full !== true && (
                  <div className="history-notes">
                    {full.notes ? <article className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(full.notes) }} /> : <p className="muted small">No notes.</p>}
                    {localId && (
                      <button className="link small" onClick={() => onOpenMeeting(localId)}>
                        Open this meeting in Trailmix
                      </button>
                    )}
                  </div>
                )}
                {!full && e.notes && <p className="history-preview muted small">{e.notes.replace(/[#*>`_]|<\/?mark>/g, '').replace(/\s+/g, ' ').slice(0, 220)}</p>}
              </article>
            );
          })}
          {data?.nextBefore && (
            <button className="btn block" onClick={() => load(data.nextBefore)} disabled={loading}>
              {loading ? 'Loading…' : 'Older entries'}
            </button>
          )}
        </div>
        {asking && (
          <div className="history-ask">
            <ChatPanel
              client={t}
              toast={toast}
              onClose={() => setAsking(false)}
              disabled={!settings.hasAnthropicKey && 'Sign in to CG Core (or add your Anthropic key) to ask questions.'}
            />
          </div>
        )}
      </div>
    </main>
  );
}
