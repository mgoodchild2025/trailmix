import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/bridge.js';
import { renderMarkdown, stripMarks } from '../lib/markdown.js';
import { errMsg, fmtDate, uid } from '../lib/util.js';
import { allTemplates } from '../../shared/templates.js';
import { formatTime, durationOf } from '../../shared/transcript.js';
import Icon from './Icon.jsx';
import RecorderControls from './RecorderControls.jsx';
import TranscriptPanel from './TranscriptPanel.jsx';
import ChatPanel from './ChatPanel.jsx';

export default function MeetingView({ id, settings, rec, levels, elapsed, interim, recorder, autoEnhance, clearAutoEnhance, refreshList, toast, onDeleted, openSettings, compact = false, onCompact = () => {}, onEnhancing = () => {} }) {
  const [meeting, setMeeting] = useState(null);
  const [tab, setTab] = useState('notes');
  const [showTranscript, setShowTranscript] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [streaming, setStreaming] = useState(null); // { requestId, text }
  const [editing, setEditing] = useState(false);
  const [templateId, setTemplateId] = useState(settings.defaultTemplateId);
  const [pinned, setPinned] = useState(false);
  const saveTimer = useRef(null);
  const pendingPatch = useRef({});

  const isLive = rec.meetingId === id && rec.state !== 'idle';
  const templates = allTemplates(settings.customTemplates);

  // ---- load ----
  useEffect(() => {
    let alive = true;
    setMeeting(null);
    setStreaming(null);
    setEditing(false);
    api.meetings.get(id).then((m) => {
      if (!alive) return;
      setMeeting(m);
      setTab(m.enhanced ? 'enhanced' : 'notes');
      setTemplateId(m.templateId || settings.defaultTemplateId);
      setShowTranscript(rec.meetingId === id && rec.state !== 'idle');
    });
    return () => {
      alive = false;
      flush();
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLive) setShowTranscript(true);
  }, [isLive]);

  // ---- live transcript ----
  useEffect(
    () =>
      api.transcribe.onEvent((ev) => {
        if (ev.type === 'final' && ev.meetingId === id)
          setMeeting((m) => m && { ...m, transcript: [...m.transcript, ev.segment] });
      }),
    [id],
  );

  // Changes synced from another device. Fields with an unsaved local edit are kept.
  useEffect(
    () =>
      api.meetings.onChanged(({ updated }) => {
        if (updated !== id) return;
        api.meetings.get(id).then((fresh) =>
          setMeeting((cur) => {
            if (!cur) return cur;
            const next = { ...cur };
            for (const k of ['title', 'notes', 'enhanced', 'templateId', 'chat', 'transcript', 'share']) {
              if (!(k in pendingPatch.current)) next[k] = fresh[k];
            }
            return next;
          }),
        );
      }),
    [id],
  );

  // ---- saving ----
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    const p = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(p).length) {
      return api.meetings.patch(id, p).then(() => 'title' in p && refreshList());
    }
    return Promise.resolve();
  }, [id, refreshList]);

  const update = (fields) => {
    setMeeting((m) => ({ ...m, ...fields }));
    Object.assign(pendingPatch.current, fields);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 500);
  };

  // ---- enhance ----
  const enhance = useCallback(
    async (tplId = templateId) => {
      if (!settings.hasAnthropicKey) {
        toast('Add your Anthropic API key in Settings to enhance notes.');
        return openSettings();
      }
      await flush();
      const requestId = uid();
      setEditing(false);
      setTab('enhanced');
      setStreaming({ requestId, text: '' });
      onEnhancing(id);
      const off = api.ai.onDelta((d) => d.requestId === requestId && setStreaming((s) => s && { ...s, text: s.text + d.text }));
      try {
        const fields = await api.ai.enhance({ requestId, meetingId: id, templateId: tplId });
        setMeeting((m) => ({ ...m, ...fields }));
        refreshList();
        api.notesReady({ title: fields.title || meeting?.title });
      } catch (e) {
        if (!/Cancelled/.test(errMsg(e))) toast(errMsg(e));
        setTab((t) => (meeting?.enhanced ? t : 'notes'));
      } finally {
        off();
        setStreaming(null);
        onEnhancing(null);
      }
    },
    [id, templateId, settings.hasAnthropicKey, flush, refreshList, toast, openSettings, meeting?.enhanced, meeting?.title, onEnhancing],
  );

  useEffect(() => {
    if (autoEnhance === id && meeting) {
      clearAutoEnhance();
      if (meeting.transcript.length || meeting.notes.trim()) enhance();
    }
  }, [autoEnhance, id, meeting, clearAutoEnhance, enhance]);

  if (!meeting) return <main className="main loading" />;

  const enhancedMd = streaming ? streaming.text : meeting.enhanced;
  const canEnhance = !streaming && !isLive && (meeting.transcript.length > 0 || meeting.notes.trim());
  const duration = durationOf(meeting.transcript);

  const recorderControls = (
    <RecorderControls
      isThis={rec.meetingId === id}
      rec={rec}
      levels={levels}
      elapsed={elapsed}
      onStart={() => recorder.start(id)}
      onStop={recorder.stop}
      onPause={recorder.pause}
      onResume={recorder.resume}
      compact={compact}
    />
  );

  // Side panel while recording: the title, the recorder and room for notes.
  if (compact) {
    const lastLine = (rec.meetingId === id && (interim?.[1] || interim?.[0])) || meeting.transcript.at(-1)?.text || '';
    return (
      <main className="main meeting panel">
        <header className="panel-head drag">
          <div className="panel-bar">
            <span className="panel-brand muted small">Trailmix</span>
            <button
              className={`icon-btn no-drag ${pinned ? 'on' : ''}`}
              onClick={() => api.window.pin(!pinned).then(setPinned)}
              title={pinned ? 'Stop keeping on top' : 'Keep on top of other windows'}
              aria-pressed={pinned}
            >
              <Icon name="pin" />
            </button>
            <button className="icon-btn no-drag" onClick={() => onCompact(false)} title="Open full view">
              <Icon name="expand" />
            </button>
          </div>
          <input className="title-input no-drag" value={meeting.title} placeholder="Untitled meeting" onChange={(e) => update({ title: e.target.value })} />
          <div className="panel-rec no-drag">{recorderControls}</div>
        </header>
        {isLive && rec.warnings?.map((w) => (
          <div key={w} className="banner warn">
            <Icon name="warn" /> {w}
          </div>
        ))}
        <textarea
          className="notes-editor panel-notes"
          value={meeting.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Jot down anything important — short phrases are fine. Trailmix fills in the rest from the transcript."
          autoFocus
        />
        {isLive && (
          <div className="panel-caption muted small" title="Latest from the transcript">
            <Icon name="transcript" size={12} /> <span>{lastLine || 'Listening…'}</span>
          </div>
        )}
      </main>
    );
  }

  async function copyNotes() {
    const md = stripMarks(meeting.enhanced || meeting.notes);
    await api.exporter.copy({ text: md, html: renderMarkdown(md) });
    toast('Copied — paste into email, Teams or a ticket.', 'ok');
  }

  async function del() {
    if (!window.confirm(`Delete "${meeting.title || 'Untitled meeting'}"? It will be moved to Trailmix's trash folder.`)) return;
    await api.meetings.remove(id);
    onDeleted();
  }

  return (
    <main className="main meeting">
      <header className="meeting-head drag">
        <div className="meeting-head-left">
          <input
            className="title-input no-drag"
            value={meeting.title}
            placeholder="Untitled meeting"
            onChange={(e) => update({ title: e.target.value })}
          />
          <div className="meta muted small">
            {fmtDate(meeting.createdAt)}
            {duration > 0 && <> · {formatTime(duration)}</>}
          </div>
        </div>
        <div className="meeting-head-right no-drag">
          {recorderControls}
          {isLive && (
            <button className="icon-btn" onClick={() => onCompact(true)} title="Switch to side panel">
              <Icon name="panel" />
            </button>
          )}
        </div>
      </header>

      {isLive && rec.warnings?.map((w) => (
        <div key={w} className="banner warn">
          <Icon name="warn" /> {w}
        </div>
      ))}

      <div className="toolbar">
        <div className="segmented">
          <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
            My notes
          </button>
          <button className={tab === 'enhanced' ? 'on' : ''} onClick={() => setTab('enhanced')} disabled={!meeting.enhanced && !streaming}>
            {streaming && <span className="spinner small" aria-hidden="true" />} Enhanced
          </button>
        </div>
        <div className="row gap-s">
          <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)} title="Template">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {streaming ? (
            <button className="btn" onClick={() => api.ai.cancel(streaming.requestId)}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : (
            <button className="btn accent" onClick={() => enhance()} disabled={!canEnhance} title={isLive ? 'Stop recording first' : ''}>
              <Icon name="sparkle" /> {meeting.enhanced ? 'Re-enhance' : 'Enhance notes'}
            </button>
          )}
          <span className="divider" />
          <button className={`icon-btn ${showTranscript ? 'on' : ''}`} onClick={() => setShowTranscript((v) => !v)} title="Transcript">
            <Icon name="transcript" />
          </button>
          <button className="icon-btn" onClick={copyNotes} title="Copy notes">
            <Icon name="copy" />
          </button>
          <button
            className="icon-btn"
            onClick={() => api.exporter.saveMarkdown({ title: meeting.title, markdown: stripMarks(meeting.enhanced || meeting.notes) })}
            title="Save as Markdown"
          >
            <Icon name="download" />
          </button>
          <button className="icon-btn danger" onClick={del} title="Delete meeting">
            <Icon name="trash" />
          </button>
        </div>
      </div>

      <div className="meeting-body">
        <div className="doc-col">
        <div className="doc-scroll">
          <div className="doc">
            {tab === 'notes' ? (
              <textarea
                className="notes-editor"
                value={meeting.notes}
                onChange={(e) => update({ notes: e.target.value })}
                placeholder={
                  isLive
                    ? 'Jot down anything important — short phrases are fine. Trailmix fills in the rest from the transcript.'
                    : 'Write rough notes here. Start recording to capture the conversation, then Enhance to turn it all into clean notes.'
                }
                autoFocus={!meeting.notes}
              />
            ) : editing ? (
              <>
                <textarea className="notes-editor mono" value={meeting.enhanced} onChange={(e) => update({ enhanced: e.target.value })} />
                <button className="btn small" onClick={() => setEditing(false)}>
                  <Icon name="check" /> Done editing
                </button>
              </>
            ) : (
              <>
                {streaming && (
                  <div className="enhance-status" role="status">
                    <span className="spinner" aria-hidden="true" />
                    <div>
                      <b>{streaming.text ? 'Writing your notes…' : 'Reading your notes and the transcript…'}</b>
                      <span className="muted small">This usually takes under a minute. You can keep working.</span>
                    </div>
                  </div>
                )}
                <article className={`prose enhanced ${streaming ? 'streaming' : ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(enhancedMd) }} />
                {!streaming && meeting.enhanced && (
                  <div className="doc-foot muted small">
                    <span className="legend">
                      <mark>Highlighted</mark> text is from your notes; the rest was added from the transcript.
                    </span>
                    <button className="link small" onClick={() => setEditing(true)}>
                      <Icon name="edit" size={12} /> Edit
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {showChat ? (
          <ChatPanel
            meetingId={id}
            initial={meeting.chat || []}
            onSave={(chat) => {
              setMeeting((m) => ({ ...m, chat }));
              api.meetings.patch(id, { chat });
            }}
            onClose={() => setShowChat(false)}
            toast={toast}
            disabled={!settings.hasAnthropicKey && 'Add your Anthropic API key in Settings to ask questions.'}
          />
        ) : (
          <button className="ask-bar" onClick={() => setShowChat(true)}>
            <Icon name="sparkle" /> Ask about this meeting…
            {meeting.chat?.length > 0 && <span className="chip tiny">{Math.ceil(meeting.chat.length / 2)}</span>}
          </button>
        )}
        </div>

        {showTranscript && (
          <TranscriptPanel
            segments={meeting.transcript}
            interim={rec.meetingId === id ? interim : null}
            myName={settings.myName}
            live={isLive}
            onClose={() => setShowTranscript(false)}
          />
        )}
      </div>

    </main>
  );
}
