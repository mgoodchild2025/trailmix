// One recording at a time, owned at the app root so it keeps going while you move
// between screens, and (with background audio) while the phone is locked.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { AudioStudioModule, useAudioRecorder } from '@siteed/audio-studio';
import { LiveTranscriber, base64ToBytes, pcmLevel } from './live.js';
import { coreClient, getSession } from './session.js';
import { appendSegment, getMeeting } from './store.js';
import { meetingChanged, syncNow } from './sync.js';

const Ctx = createContext(null);
export const useRecording = () => useContext(Ctx);

const IDLE = { meetingId: null, status: 'idle', accumMs: 0, resumedAt: 0, conn: null };

export function RecordingProvider({ children }) {
  const audio = useAudioRecorder();
  const [rec, setRec] = useState(IDLE);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const live = useRef(null);
  const recRef = useRef(rec);
  recRef.current = rec;

  const stop = useCallback(async () => {
    const cur = recRef.current;
    if (cur.status === 'idle' || cur.status === 'stopping') return;
    setRec((r) => ({ ...r, status: 'stopping' }));
    try {
      await audio.stopRecording();
    } catch {}
    await live.current?.stop();
    live.current = null;
    setRec(IDLE);
    setInterim('');
    setLevel(0);
    if (cur.meetingId) {
      meetingChanged(cur.meetingId);
      syncNow();
    }
    return cur.meetingId;
  }, [audio]);

  const start = useCallback(
    async (meetingId) => {
      if (recRef.current.status !== 'idle') await stop();
      const core = coreClient();
      if (!core) throw new Error('Sign in to CG Core first.');
      const info = getSession().info || {};
      if (info.features?.deepgram === false) throw new Error('Transcription is not set up in CG Core yet. Ask a CG Core admin.');
      const perm = await AudioStudioModule.requestPermissionsAsync();
      if (!perm.granted) throw new Error('Trailmix needs microphone access. Turn it on in Settings, Trailmix.');

      setRec({ ...IDLE, meetingId, status: 'starting' });
      const m = getMeeting(meetingId);
      const cfg = info.config || {};
      const t = new LiveTranscriber({
        authorize: async () => `Bearer ${(await core.deepgramToken()).accessToken}`,
        model: cfg.deepgramModel || 'nova-3',
        language: cfg.language || 'en',
        keyterms: (cfg.keyterms || []).slice(0, 50),
        offsetSec: (m?.transcript || []).reduce((x, s) => Math.max(x, s.end || 0), 0),
        onFinal: (seg) => {
          appendSegment(meetingId, seg);
          meetingChanged(meetingId, { recording: true });
          setInterim('');
        },
        onInterim: setInterim,
        onStatus: (conn) => setRec((r) => (r.status === 'idle' ? r : { ...r, conn })),
        onError: (err) => {
          Alert.alert('Transcription stopped', err.message);
          stop();
        },
      });
      live.current = t;
      t.start();
      try {
        await audio.startRecording({
          sampleRate: 16000,
          channels: 1,
          encoding: 'pcm_16bit',
          interval: 100,
          keepAwake: true,
          showNotification: true,
          notification: { title: 'Trailmix is recording', text: m?.title || 'Meeting in progress' },
          autoResumeAfterInterruption: true,
          output: { primary: { enabled: false } }, // stream only: audio is never saved
          ios: { audioSession: { category: 'PlayAndRecord', mode: 'Default', categoryOptions: ['MixWithOthers', 'DefaultToSpeaker', 'AllowBluetooth'] } },
          onAudioStream: async (e) => {
            if (typeof e.data !== 'string') return;
            const bytes = base64ToBytes(e.data);
            live.current?.send(bytes.buffer);
            setLevel(pcmLevel(bytes));
          },
        });
      } catch (err) {
        await t.stop();
        live.current = null;
        setRec(IDLE);
        throw err;
      }
      setRec((r) => ({ ...r, status: 'live', resumedAt: Date.now() }));
    },
    [audio, stop],
  );

  const pause = useCallback(async () => {
    await audio.pauseRecording();
    setRec((r) => ({ ...r, status: 'paused', accumMs: r.accumMs + (Date.now() - r.resumedAt) }));
    setLevel(0);
  }, [audio]);

  const resume = useCallback(async () => {
    await audio.resumeRecording();
    setRec((r) => ({ ...r, status: 'live', resumedAt: Date.now() }));
  }, [audio]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (rec.status !== 'live') return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [rec.status]);
  const elapsed = rec.status === 'live' ? rec.accumMs + (Date.now() - rec.resumedAt) : rec.accumMs;

  return <Ctx.Provider value={{ rec, level, interim, elapsed, start, stop, pause, resume }}>{children}</Ctx.Provider>;
}
