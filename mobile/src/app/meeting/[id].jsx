import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BUILT_IN_TEMPLATES } from '../../../../shared/templates.js';
import { toTurns, formatTime, durationOf } from '../../../../shared/transcript.js';
import { getMeeting, patchMeeting, removeMeeting, subscribeMeetings } from '../../lib/store.js';
import { meetingChanged, meetingDeleted } from '../../lib/sync.js';
import { getSession } from '../../lib/session.js';
import { enhance, ask } from '../../lib/ai.js';
import { useRecording } from '../../lib/recording.jsx';
import { useTheme, type } from '../../lib/theme.js';
import { PressableScale, Symbol } from '../../components/ui.jsx';
import { BottomBar, HeaderIcons, useMenu } from '../../components/AndroidBars.jsx';
import { RecorderPanel } from '../../components/Recorder.jsx';
import { NotesMarkdown } from '../../components/Notes.jsx';

const TABS = [
  ['notes', 'Notes'],
  ['enhanced', 'AI Notes'],
  ['transcript', 'Transcript'],
  ['ask', 'Ask'],
];
const plain = (md) => (md || '').replace(/<\/?mark>/g, '');

export default function MeetingScreen() {
  const { id } = useLocalSearchParams();
  const [menuSheet, openMenu] = useMenu(); // Android "More" menu
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const recording = useRecording();
  const { rec } = recording;
  const isLive = rec.meetingId === id && rec.status !== 'idle';
  const busyElsewhere = rec.status !== 'idle' && !isLive;

  const [m, setM] = useState(() => getMeeting(id));
  const [tab, setTab] = useState(() => (getMeeting(id)?.enhanced ? 'enhanced' : 'notes'));
  const [streaming, setStreaming] = useState(null);
  const pending = useRef({});
  const timer = useRef(null);
  const abort = useRef(null);

  // Changes from sync or the recorder; fields being typed are kept.
  useEffect(
    () =>
      subscribeMeetings((ids) => {
        if (!ids.includes(id)) return;
        const fresh = getMeeting(id);
        if (!fresh) return router.back();
        setM((cur) => {
          const next = { ...fresh };
          for (const k of Object.keys(pending.current)) next[k] = cur[k];
          return next;
        });
      }),
    [id],
  );

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = {};
    if (Object.keys(p).length) {
      patchMeeting(id, p);
      meetingChanged(id, { recording: isLive });
    }
  }, [id, isLive]);
  useEffect(() => flush, [flush]);

  const edit = (fields) => {
    setM((cur) => ({ ...cur, ...fields }));
    Object.assign(pending.current, fields);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  const runEnhance = useCallback(
    async (templateId) => {
      flush();
      setTab('enhanced');
      setStreaming('');
      abort.current = new AbortController();
      try {
        await enhance(id, templateId, { onDelta: (d) => setStreaming((x) => (x ?? '') + d), signal: abort.current.signal });
        setM(getMeeting(id));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        if (!err.cancelled) Alert.alert("Couldn't write the notes", err.message);
      } finally {
        setStreaming(null);
      }
    },
    [id, flush],
  );

  const stopAndEnhance = async () => {
    await recording.stop();
    const fresh = getMeeting(id);
    if (fresh && (fresh.transcript.length || fresh.notes.trim())) runEnhance(fresh.templateId || 'general');
  };

  const startRec = async () => {
    try {
      await recording.start(id);
      setTab('notes');
    } catch (err) {
      Alert.alert("Couldn't start recording", err.message);
    }
  };

  const share = () => {
    flush();
    const body = plain(getMeeting(id).enhanced || getMeeting(id).notes).trim();
    if (!body) return Alert.alert('Nothing to share yet', 'Add notes or write AI notes first.');
    Share.share({ title: m.title || 'Meeting notes', message: body });
  };

  const del = () =>
    Alert.alert(`Delete "${m.title || 'Untitled meeting'}"?`, 'It will be removed from this phone and your other devices.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (isLive) await recording.stop();
          removeMeeting(id);
          meetingDeleted(id);
          router.back();
        },
      },
    ]);

  if (!m) return null;
  const duration = durationOf(m.transcript);
  const canEnhance = streaming == null && !isLive && (m.transcript.length > 0 || m.notes.trim().length > 0);
  const currentTpl = m.templateId || 'general';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: '' }} />
      {Platform.OS === 'android' ? (
        <>
          <Stack.Screen
            options={{
              headerRight: () => (
                <HeaderIcons
                  items={[
                    { icon: 'square.and.arrow.up', label: 'Share notes', onPress: share },
                    {
                      icon: 'ellipsis',
                      label: 'More',
                      onPress: () =>
                        openMenu({
                          items: [
                            { heading: true, label: 'Write AI notes with' },
                            ...BUILT_IN_TEMPLATES.map((tpl) => ({
                              label: tpl.name,
                              subtitle: tpl.description,
                              icon: 'sparkles',
                              checked: tpl.id === currentTpl,
                              disabled: !canEnhance,
                              onPress: () => runEnhance(tpl.id),
                            })),
                            { heading: true, label: 'Meeting' },
                            { label: 'Copy notes', icon: 'doc.on.doc', disabled: !(m.enhanced || m.notes), onPress: () => Clipboard.setStringAsync(plain(m.enhanced || m.notes)) },
                            { label: 'Delete meeting', icon: 'trash', destructive: true, onPress: del },
                          ],
                        }),
                    },
                  ]}
                />
              ),
            }}
          />
          {menuSheet}
        </>
      ) : null}
      {Platform.OS === 'ios' ? (
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.arrow.up" onPress={share} accessibilityLabel="Share notes" />
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.Menu title="Write AI notes with" icon="sparkles" disabled={!canEnhance}>
            {BUILT_IN_TEMPLATES.map((tpl) => (
              <Stack.Toolbar.MenuAction key={tpl.id} subtitle={tpl.description} isOn={tpl.id === currentTpl} onPress={() => runEnhance(tpl.id)}>{tpl.name}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="doc.on.doc" disabled={!(m.enhanced || m.notes)} onPress={() => Clipboard.setStringAsync(plain(m.enhanced || m.notes))}>Copy notes</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={del}>Delete meeting</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      ) : null}

      {Platform.OS === 'ios' && !isLive && tab !== 'ask' ? (
        <Stack.Toolbar>
          {streaming != null ? (
            <Stack.Toolbar.Button icon="stop.circle" onPress={() => abort.current?.abort()} accessibilityLabel="Stop writing notes" />
          ) : (
            <Stack.Toolbar.Button icon="sparkles" disabled={!canEnhance} onPress={() => runEnhance(currentTpl)} accessibilityLabel={m.enhanced ? 'Rewrite AI notes' : 'Write AI notes'} />
          )}
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button variant="prominent" tintColor={t.red} disabled={busyElsewhere || streaming != null} onPress={startRec} accessibilityLabel={m.transcript.length ? 'Continue recording' : 'Record'}>
            {busyElsewhere ? 'Recording elsewhere' : m.transcript.length ? 'Continue recording' : 'Record'}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: isLive ? 240 : 120 + insets.bottom }}
        style={{ flex: 1 }}
      >
        <View style={s.head}>
          <TextInput
            value={m.title}
            onChangeText={(title) => edit({ title })}
            placeholder="Untitled meeting"
            placeholderTextColor={t.label3}
            style={[type.title1, { color: t.label, padding: 0 }]}
            multiline
            blurOnSubmit
            returnKeyType="done"
            accessibilityLabel="Meeting title"
          />
          <Text style={[type.subhead, { color: t.label2, marginTop: 4 }]}>
            {new Date(m.createdAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            {duration > 0 ? ` · ${formatTime(duration)}` : ''}
          </Text>
          <SegmentedControl
            style={s.segmented}
            values={TABS.map(([, l]) => l)}
            selectedIndex={TABS.findIndex(([k]) => k === tab)}
            onChange={(e) => {
              Haptics.selectionAsync();
              setTab(TABS[e.nativeEvent.selectedSegmentIndex][0]);
            }}
          />
        </View>

        {tab === 'notes' && (
          <TextInput
            multiline
            scrollEnabled={false}
            value={m.notes}
            onChangeText={(notes) => edit({ notes })}
            placeholder={isLive ? 'Jot down what matters. A few words is enough.' : 'Rough notes. Record the meeting and Trailmix fills in the rest.'}
            placeholderTextColor={t.label3}
            textAlignVertical="top"
            style={[type.body, s.notes, { color: t.label }]}
            accessibilityLabel="Your notes"
          />
        )}
        {tab === 'enhanced' && <AiNotes m={m} streaming={streaming} canEnhance={canEnhance} onEnhance={() => runEnhance(currentTpl)} />}
        {tab === 'transcript' && <Transcript m={m} live={isLive} interim={isLive ? recording.interim : ''} />}
        {tab === 'ask' && <AskThread m={m} />}
      </ScrollView>

      {tab === 'ask' && !isLive ? <AskBar id={id} m={m} onSave={(chat) => edit({ chat })} bottomInset={insets.bottom} /> : null}
      {isLive ? (
        <Animated.View entering={FadeIn.duration(200)} style={s.recorderWrap}>
          <RecorderPanel onStop={stopAndEnhance} bottomInset={insets.bottom} />
        </Animated.View>
      ) : null}
      {Platform.OS === 'android' && !isLive && tab !== 'ask' ? (
        <BottomBar
          actions={[
            streaming != null
              ? { icon: 'stop.circle', label: 'Stop writing notes', onPress: () => abort.current?.abort() }
              : { icon: 'sparkles', label: m.enhanced ? 'Rewrite AI notes' : 'Write AI notes', onPress: () => runEnhance(currentTpl), disabled: !canEnhance },
          ]}
          primary={{
            title: busyElsewhere ? 'Recording elsewhere' : m.transcript.length ? 'Continue recording' : 'Record',
            icon: 'record.circle',
            disabled: busyElsewhere || streaming != null,
            onPress: startRec,
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function AiNotes({ m, streaming, canEnhance, onEnhance }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  if (streaming === '' || (streaming == null && !m.enhanced)) {
    return (
      <View style={s.placeholder}>
        <Animated.View style={streaming === '' && !reduced ? s.pulse : null}>
          <Symbol name="sparkles" size={34} color={streaming === '' ? t.red : t.label3} />
        </Animated.View>
        <Text style={[type.headline, { color: t.label, marginTop: 12 }]}>{streaming === '' ? 'Writing your notes…' : 'No AI notes yet'}</Text>
        <Text style={[type.subhead, { color: t.label2, textAlign: 'center', marginTop: 4 }]}>
          {streaming === '' ? 'Reading your notes and the transcript.' : 'Record or jot some notes, then tap sparkles. Your own points stay highlighted.'}
        </Text>
        {streaming == null && canEnhance ? (
          <PressableScale onPress={onEnhance} style={[s.inlineBtn, { backgroundColor: t.fill }]} accessibilityLabel="Write AI notes">
            <Symbol name="sparkles" size={16} color={t.red} />
            <Text style={[type.headline, { color: t.red }]}>Write AI notes</Text>
          </PressableScale>
        ) : null}
      </View>
    );
  }
  return (
    <View style={s.pad}>
      <NotesMarkdown text={streaming ?? m.enhanced} hideTitle />
      {streaming == null ? <Text style={[type.footnote, { color: t.label3, marginTop: 18 }]}>Bold points are from your own notes; the rest was added from the transcript.</Text> : null}
    </View>
  );
}

const SPEAKER_COLORS = ['#E93E3F', '#066AB5', '#1f8a4c', '#b86e00', '#7a4fd0', '#0f8a8a'];

function Transcript({ m, live, interim }) {
  const t = useTheme();
  const name = getSession().info?.staff?.name?.split(' ')[0];
  const turns = toTurns(m.transcript, name);
  if (!turns.length && !interim) {
    return (
      <View style={s.placeholder}>
        <Symbol name="text.quote" size={34} color={t.label3} />
        <Text style={[type.headline, { color: t.label, marginTop: 12 }]}>{live ? 'Listening…' : 'No transcript'}</Text>
        <Text style={[type.subhead, { color: t.label2, textAlign: 'center', marginTop: 4 }]}>{live ? 'What people say appears here as they say it.' : 'Record this meeting to get a transcript.'}</Text>
      </View>
    );
  }
  return (
    <View style={s.pad}>
      {turns.map((turn, i) => {
        const n = Number((turn.who.match(/\d+/) || [0])[0]);
        return (
          <View key={i} style={{ marginBottom: 16 }}>
            <Text style={[type.footnote, { color: SPEAKER_COLORS[(n - 1 + SPEAKER_COLORS.length) % SPEAKER_COLORS.length], fontWeight: '600' }]}>
              {turn.who}
              <Text style={{ color: t.label3, fontWeight: '400' }}>  {formatTime(turn.start)}</Text>
            </Text>
            <Text style={[type.body, { color: t.label, marginTop: 2 }]}>{turn.text}</Text>
          </View>
        );
      })}
      {interim ? <Text style={[type.body, { color: t.label3, fontStyle: 'italic' }]}>{interim}</Text> : null}
    </View>
  );
}

function AskThread({ m }) {
  const t = useTheme();
  const messages = m.chat || [];
  if (!messages.length) {
    return (
      <View style={s.placeholder}>
        <Symbol name="bubble.left.and.text.bubble.right" size={34} color={t.label3} />
        <Text style={[type.headline, { color: t.label, marginTop: 12 }]}>Ask about this meeting</Text>
        <Text style={[type.subhead, { color: t.label2, textAlign: 'center', marginTop: 4 }]}>Draft a follow-up email, list action items, or check what was agreed.</Text>
      </View>
    );
  }
  return (
    <View style={s.pad}>
      {messages.map((msg, i) =>
        msg.role === 'user' ? (
          <View key={i} style={[s.bubble, { backgroundColor: t.red }]}>
            <Text style={[type.body, { color: '#fff' }]}>{msg.content}</Text>
          </View>
        ) : (
          <View key={i} style={{ marginBottom: 18 }}>
            <NotesMarkdown text={msg.content} />
          </View>
        ),
      )}
    </View>
  );
}

function AskBar({ id, m, onSave, bottomInset }) {
  const t = useTheme();
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState(null);
  const messages = m.chat || [];
  const send = async (q) => {
    q = q.trim();
    if (!q || answer != null) return;
    const next = [...messages, { role: 'user', content: q }];
    onSave(next);
    setInput('');
    setAnswer('');
    try {
      const text = await ask(id, next, { onDelta: (d) => setAnswer((a) => (a ?? '') + d) });
      onSave([...next, { role: 'assistant', content: text }]);
    } catch (err) {
      onSave(messages);
      setInput(q);
      Alert.alert("Couldn't answer", err.message);
    } finally {
      setAnswer(null);
    }
  };
  const suggestions = ['Draft a follow-up email', 'What are the action items?', 'Write a ticket note'];
  return (
    <View style={[s.askBar, { borderTopColor: t.separator, backgroundColor: t.bg, paddingBottom: Math.max(bottomInset, 10) }]}>
      {answer != null ? (
        <Text numberOfLines={3} style={[type.subhead, { color: t.label2, paddingHorizontal: 4, paddingBottom: 8 }]}>
          {answer || 'Thinking…'}
        </Text>
      ) : !messages.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
          {suggestions.map((q) => (
            <PressableScale key={q} onPress={() => send(q)} style={[s.chip, { backgroundColor: t.fill }]}>
              <Text style={[type.subhead, { color: t.label }]}>{q}</Text>
            </PressableScale>
          ))}
        </ScrollView>
      ) : null}
      <View style={[s.askField, { backgroundColor: t.fill }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
          placeholder="Ask about this meeting"
          placeholderTextColor={t.label3}
          style={[type.body, { color: t.label, flex: 1, paddingVertical: 8 }]}
        />
        <PressableScale onPress={() => send(input)} disabled={!input.trim() || answer != null} accessibilityLabel="Send">
          <Symbol name="arrow.up.circle.fill" size={30} color={t.red} />
        </PressableScale>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  segmented: { marginTop: 18, height: 32 },
  notes: { paddingHorizontal: 20, paddingTop: 14, minHeight: 320 },
  pad: { paddingHorizontal: 20, paddingTop: 18 },
  placeholder: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 64 },
  pulse: { animationName: { '0%': { opacity: 1 }, '50%': { opacity: 0.35 }, '100%': { opacity: 1 } }, animationDuration: '1.6s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 44, borderRadius: 22, marginTop: 20 },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginBottom: 14, borderCurve: 'continuous' },
  askBar: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  askField: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingLeft: 14, paddingRight: 6, minHeight: 44 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  recorderWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
