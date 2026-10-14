import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isDemo } from './lib/bridge.js';
import { Recorder, DemoRecorder } from './audio/recorder.js';
import { errMsg } from './lib/util.js';
import Sidebar from './components/Sidebar.jsx';
import MeetingView from './components/MeetingView.jsx';
import Settings from './components/Settings.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import Icon from './components/Icon.jsx';

const IDLE = { meetingId: null, state: 'idle' };

export default function App() {
  const [settings, setSettings] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState('home');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [autoEnhance, setAutoEnhance] = useState(null);

  const toast = useCallback((text, kind = 'error') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 2500);
  }, []);

  const refreshList = useCallback(() => api.meetings.list().then(setMeetings), []);

  useEffect(() => {
    api.settings.get().then(setSettings);
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    const t = setTimeout(() => api.meetings.search(query).then(setMatches), 150);
    return () => clearTimeout(t);
  }, [query, meetings]);

  const rec = useRecording({ toast, settings, onFinished: (id) => settings?.autoEnhance && setAutoEnhance(id), refreshList });

  const select = (id) => {
    setSelectedId(id);
    setView('meeting');
  };

  const newMeeting = async ({ record = false } = {}) => {
    const m = await api.meetings.create({});
    await refreshList();
    select(m.id);
    if (record) rec.start(m.id);
  };

  if (!settings) return <div className="app loading" />;

  const setupNeeded = !settings.hasDeepgramKey || !settings.hasAnthropicKey;

  return (
    <div className={`app platform-${api.platform}`}>
      <Sidebar
        meetings={meetings}
        selectedId={selectedId}
        view={view}
        query={query}
        onQuery={setQuery}
        matches={matches}
        onSelect={select}
        onNew={() => newMeeting()}
        onAsk={() => setView('ask')}
        onSettings={() => setView('settings')}
        rec={rec.state}
      />

      {view === 'meeting' && selectedId ? (
        <MeetingView
          key={selectedId}
          id={selectedId}
          settings={settings}
          rec={rec.state}
          levels={rec.levels}
          elapsed={rec.elapsed}
          interim={rec.interim}
          recorder={rec}
          autoEnhance={autoEnhance}
          clearAutoEnhance={() => setAutoEnhance(null)}
          refreshList={refreshList}
          toast={toast}
          onDeleted={() => {
            setSelectedId(null);
            setView('home');
            refreshList();
          }}
          openSettings={() => setView('settings')}
        />
      ) : view === 'settings' ? (
        <Settings settings={settings} onChange={setSettings} toast={toast} />
      ) : view === 'ask' ? (
        <main className="main ask">
          <header className="page-head drag">
            <h1>Ask across meetings</h1>
            <p className="muted small">Claude reads your enhanced notes (or transcripts) from every meeting on this computer.</p>
          </header>
          <ChatPanel full meetingId={null} toast={toast} disabled={!settings.hasAnthropicKey && 'Add your Anthropic API key in Settings first.'} />
        </main>
      ) : (
        <Home setupNeeded={setupNeeded} settings={settings} onNew={newMeeting} onSettings={() => setView('settings')} />
      )}

      {rec.state.state !== 'idle' && (view !== 'meeting' || selectedId !== rec.state.meetingId) && (
        <button className="floating-rec" onClick={() => select(rec.state.meetingId)}>
          <span className="rec-dot" /> Recording — back to meeting
        </button>
      )}

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' ? <Icon name="warn" /> : <Icon name="check" />} {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Home({ setupNeeded, settings, onNew, onSettings }) {
  return (
    <main className="main home">
      <div className="drag home-drag" />
      <div className="home-inner">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>Notes that write themselves.</h1>
        <p className="muted">
          Start recording when your call begins and jot down anything that matters. Trailmix listens to both sides of the conversation — Teams, Zoom, Meet or a phone on
          speaker — with no bot joining. When you stop, Claude turns your notes and the transcript into clean, shareable notes.
        </p>
        <div className="row gap-s center">
          <button className="btn record big" onClick={() => onNew({ record: true })} disabled={!settings.hasDeepgramKey}>
            <span className="rec-dot static" /> Start a meeting now
          </button>
          <button className="btn big" onClick={() => onNew()}>
            <Icon name="plus" /> Blank note
          </button>
        </div>
        {setupNeeded && (
          <div className="setup card">
            <h2>Finish setting up</h2>
            <ul>
              <li className={settings.hasDeepgramKey ? 'done' : ''}>
                <Icon name={settings.hasDeepgramKey ? 'check' : 'warn'} /> Deepgram key for live transcription
              </li>
              <li className={settings.hasAnthropicKey ? 'done' : ''}>
                <Icon name={settings.hasAnthropicKey ? 'check' : 'warn'} /> Anthropic key for AI notes
              </li>
            </ul>
            <button className="btn primary" onClick={onSettings}>
              Open settings
            </button>
          </div>
        )}
        <p className="muted small tip">Tip: wear headphones for the cleanest transcript. Without them, Trailmix filters out echo of other speakers picked up by your mic.</p>
      </div>
    </main>
  );
}

// Owns the audio pipeline and the live transcription session. Lives at the app level so
// recording continues while the user browses other meetings.
function useRecording({ toast, settings, onFinished, refreshList }) {
  const [state, setState] = useState(IDLE);
  const [levels, setLevels] = useState({ mic: 0, sys: 0 });
  const [interim, setInterim] = useState({ 0: '', 1: '' });
  const [, tick] = useState(0);
  const recorder = useRef(null);
  const ready = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sysHeard = useRef(false);

  useEffect(() => {
    if (state.state !== 'live') return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [state.state]);

  const stop = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.state === 'idle' || cur.state === 'stopping') return;
    setState((s) => ({ ...s, state: 'stopping' }));
    ready.current = false;
    await recorder.current?.stop().catch(() => {});
    recorder.current = null;
    await api.transcribe.stop().catch(() => {});
    setState(IDLE);
    setInterim({ 0: '', 1: '' });
    setLevels({ mic: 0, sys: 0 });
    refreshList();
    if (cur.meetingId) onFinished(cur.meetingId);
  }, [onFinished, refreshList]);

  useEffect(
    () =>
      api.transcribe.onEvent((ev) => {
        if (ev.meetingId !== stateRef.current.meetingId) return;
        if (ev.type === 'interim') setInterim((i) => ({ ...i, [ev.channel]: ev.text }));
        else if (ev.type === 'final') setInterim((i) => ({ ...i, [ev.segment.channel]: '' }));
        else if (ev.type === 'status') setState((s) => (s.state === 'idle' ? s : { ...s, conn: ev.state }));
        else if (ev.type === 'error') {
          toast(ev.message);
          stop();
        }
      }),
    [toast, stop],
  );

  // A dead system-audio stream (usually a missing macOS permission) produces exact
  // silence. Warn if nothing at all has come through after a while.
  useEffect(() => {
    if (state.state !== 'live' || !state.systemAudio) return;
    const t = setTimeout(() => {
      if (!sysHeard.current && stateRef.current.state === 'live')
        setState((s) => ({
          ...s,
          warnings: [...(s.warnings || []), 'No sound has come through from other apps yet. If people are talking, check Screen & System Audio Recording permission in Settings.'],
        }));
    }, 45000);
    return () => clearTimeout(t);
  }, [state.state, state.systemAudio]);

  const start = useCallback(
    async (meetingId) => {
      if (stateRef.current.state !== 'idle') await stop();
      if (!settings?.hasDeepgramKey) return toast('Add your Deepgram API key in Settings to start recording.');
      setState({ meetingId, state: 'starting' });
      sysHeard.current = false;
      const r = new (isDemo ? DemoRecorder : Recorder)({
        onAudio: (buf) => ready.current && api.transcribe.sendAudio(buf),
        onLevel: (l) => {
          if (l.sysPeak > 0) sysHeard.current = true;
          setLevels({ mic: l.mic, sys: l.sys });
        },
      });
      try {
        const perms = await api.system.permissions();
        if (perms.mic !== 'granted') await api.system.askMic();
        const info = await r.start();
        recorder.current = r;
        await api.transcribe.start({ meetingId, sampleRate: info.sampleRate });
        ready.current = true;
        setState({ meetingId, state: 'live', systemAudio: info.systemAudio, warnings: info.warnings, accumMs: 0, resumedAt: Date.now() });
      } catch (e) {
        await r.stop().catch(() => {});
        recorder.current = null;
        setState(IDLE);
        toast(errMsg(e));
      }
    },
    [settings?.hasDeepgramKey, stop, toast],
  );

  const pause = useCallback(() => {
    recorder.current?.setPaused(true);
    setState((s) => ({ ...s, state: 'paused', accumMs: s.accumMs + (Date.now() - s.resumedAt) }));
  }, []);
  const resume = useCallback(() => {
    recorder.current?.setPaused(false);
    setState((s) => ({ ...s, state: 'live', resumedAt: Date.now() }));
  }, []);

  const elapsed = state.state === 'live' ? state.accumMs + (Date.now() - state.resumedAt) : state.accumMs || 0;

  return { state, levels, interim, elapsed, start, stop, pause, resume };
}
