// "File to client": puts a meeting's notes (and, if asked, its transcript) on a client's,
// prospect's or lead's timeline in CG Core. Filing again updates that same entry.
import { useEffect, useState } from 'react';
import { api } from '../lib/bridge.js';
import { errMsg } from '../lib/util.js';
import Icon from './Icon.jsx';
import ClientSearch from './ClientSearch.jsx';

export default function FileDialog({ meeting, initialTarget = null, onClose, toast, onOpenHistory }) {
  const filed = meeting.filed;
  const [target, setTarget] = useState(initialTarget || (filed ? { type: filed.type, id: filed.id, name: filed.name } : null));
  const [contacts, setContacts] = useState(null);
  const [contactId, setContactId] = useState('');
  const [includeTranscript, setIncludeTranscript] = useState(!!filed?.includeTranscript);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // A client or prospect can have the contact the meeting was with; a lead can't.
  useEffect(() => {
    setContacts(null);
    setContactId('');
    if (target?.type !== 'company') return;
    let alive = true;
    api.filing
      .contacts(target.id)
      .then((c) => alive && setContacts(c))
      .catch(() => alive && setContacts([]));
    return () => {
      alive = false;
    };
  }, [target?.type, target?.id]);

  const file = async () => {
    setBusy(true);
    try {
      const r = await api.filing.file({ meetingId: meeting.id, target: { type: target.type, id: target.id }, contactId: contactId || null, includeTranscript });
      toast(r.updated ? `Updated in ${r.name}'s timeline.` : `Filed to ${r.name}'s timeline.`, 'ok');
      onClose(r);
    } catch (e) {
      toast(errMsg(e));
      setBusy(false);
    }
  };

  const unfile = async () => {
    if (!window.confirm(`Remove this meeting from ${filed.name}'s timeline in CG Core?`)) return;
    setBusy(true);
    try {
      await api.filing.unfile(meeting.id);
      toast(`Removed from ${filed.name}'s timeline.`, 'ok');
      onClose(null);
    } catch (e) {
      toast(errMsg(e));
      setBusy(false);
    }
  };

  const sameTarget = filed && target && filed.type === target.type && filed.id === target.id;

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="file-title">
        <header className="modal-head">
          <h2 id="file-title">{filed ? 'Filed in CG Core' : 'File to a client'}</h2>
          <button className="icon-btn" onClick={() => onClose()} aria-label="Close" disabled={busy}>
            <Icon name="close" />
          </button>
        </header>

        {filed && (
          <p className="muted small">
            On <b>{filed.name}</b>&apos;s timeline.{' '}
            <button className="link small" onClick={() => api.filing.open(filed.url)}>
              Open in CG Core
            </button>
            {onOpenHistory && (
              <>
                {' · '}
                <button className="link small" onClick={() => (onClose(), onOpenHistory({ type: filed.type, id: filed.id, name: filed.name }))}>
                  Client history
                </button>
              </>
            )}
          </p>
        )}

        {target ? (
          <div className="file-target">
            <div>
              <b>{target.name}</b>
              {target.detail && <span className="muted small"> · {target.detail}</span>}
            </div>
            <button className="link small" onClick={() => setTarget(null)} disabled={busy}>
              Change
            </button>
          </div>
        ) : (
          <ClientSearch onPick={setTarget} toast={toast} />
        )}

        {target?.type === 'company' && contacts?.length > 0 && (
          <label className="field">
            <span>Who it was with (optional)</span>
            <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={busy}>
              <option value="">Nobody in particular</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.title ? ` · ${c.title}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={includeTranscript} onChange={(e) => setIncludeTranscript(e.target.checked)} disabled={busy} />
          Include the transcript
        </label>
        <p className="muted small">
          The {meeting.enhanced ? 'AI notes' : 'notes'} go on the timeline{includeTranscript ? ', followed by the full transcript' : ''}. Colleagues with access to sales activity in CG Core can see it.
        </p>

        <footer className="modal-foot">
          {filed && (
            <button className="btn ghost danger" onClick={unfile} disabled={busy}>
              <Icon name="trash" /> Remove from timeline
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => onClose()} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={file} disabled={!target || busy}>
            {busy ? <span className="spinner small on-red" aria-hidden="true" /> : <Icon name="folder" />} {filed ? (sameTarget ? 'Update' : 'Move here') : 'File'}
          </button>
        </footer>
      </div>
    </div>
  );
}
