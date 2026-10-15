import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { BUILT_IN_TEMPLATES, findTemplate } from '../../../../shared/templates.js';
import { toTurns, formatTime, durationOf } from '../../../../shared/transcript.js';
import { getMeeting, patchMeeting, removeMeeting, subscribeMeetings } from '../../lib/store.js';
import { meetingChanged, meetingDeleted } from '../../lib/sync.js';
import { getSession } from '../../lib/session.js';
import { enhance, ask } from '../../lib/ai.js';
import { useRecording } from '../../lib/recording.jsx';
import { useTheme } from '../../lib/theme.js';
import { Button, Segmented } from '../../components/ui.jsx';
import { NotesMarkdown } from '../../components/Notes.jsx';

const clock = (ms) => {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
const plain = (md) => (md || '').replace(/<\/?mark>/g, '');

export default function MeetingScreen() {
  const { id } = useLocalSearchParams();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const recording = useRecording();
  const { rec } = recording;
  const isLive = rec.meetingId === id && rec.status !== 'idle';

  const [m, setM] = useState(() => getMeeting(id));
  const [tab, setTab] = useState(() => (getMeeting(id)?.enhanced ? 'enhanced' : 'notes'));
  const [streaming, setStreaming] = useState(null);
  const [picker, setPicker] = useState(false);
  const pending = useRef({});
  const timer = useRef(null);
  const abort = useRef(null);

  // Changes from sync or the recorder; keep fields being typed.
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
        await enhance(id, templateId, { onDelta: (d) => setStreaming((s) => (s ?? '') + d), signal: abort.current.signal });
        setM(getMeeting(id));
      } catch (err) {
        if (!err.cancelled) Alert.alert("Couldn't enhance notes", err.message);
      } finally {
        setStreaming(null);
      }
    },
    [id, flush],
  );

  // Stopping the recording enhances automatically, like the desktop app.
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

  const share = async () => {
    flush();
    const cur = getMeeting(id);
    const body = plain(cur.enhanced || cur.notes).trim();
    if (!body) return Alert.alert('Nothing to share yet', 'Add notes or enhance the meeting first.');
    await Share.share({ title: cur.title || 'Meeting notes', message: body });
  };

  const del = () =>
    Alert.alert(`Delete "${m.title || 'Untitled meeting'}"?`, 'It is removed from this phone and your other devices.', [
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable onPress={share} hitSlop={10} accessibilityLabel="Share">
                <Text style={{ color: t.red, fontSize: 16, fontWeight: '600' }}>Share</Text>
              </Pressable>
              <Pressable onPress={del} hitSlop={10} accessibilityLabel="Delete meeting">
                <Text style={{ color: t.ink3, fontSize: 16 }}>Delete</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <View style={s.head}>
        <TextInput value={m.title} onChangeText={(title) => edit({ title })} placeholder="Untitled meeting" placeholderTextColor={t.ink3} style={[s.title, { color: t.ink }]} />
        <Text style={{ color: t.ink3, fontSize: 13 }}>
          {new Date(m.createdAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {duration > 0 ? ` · ${formatTime(duration)}` : ''}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              ['notes', 'Notes'],
              ['enhanced', 'AI notes'],
              ['transcript', 'Transcript'],
              ['ask', 'Ask'],
            ]}
          />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'notes' && (
          <TextInput
            multiline
            value={m.notes}
            onChangeText={(notes) => edit({ notes })}
            placeholder={isLive ? 'Jot down anything important. Short phrases are fine.' : 'Rough notes. Record the meeting, then enhance to get clean notes.'}
            placeholderTextColor={t.ink3}
            textAlignVertical="top"
            style={[s.notes, { color: t.ink }]}
          />
        )}
        {tab === 'enhanced' && (
          <ScrollView contentContainerStyle={s.pad}>
            {streaming === '' ? <Text style={{ color: t.ink3 }}>Reading your notes and the transcript…</Text> : null}
            {streaming || m.enhanced ? (
              <NotesMarkdown text={streaming ?? m.enhanced} />
            ) : (
              <Text style={{ color: t.ink3, lineHeight: 22 }}>No AI notes yet. Record or write some notes, then tap Enhance.</Text>
            )}
            {m.enhanced && streaming == null ? (
              <Button small title="Copy notes" onPress={() => Clipboard.setStringAsync(plain(m.enhanced))} style={{ marginTop: 20, alignSelf: 'flex-start' }} />
            ) : null}
          </ScrollView>
        )}
        {tab === 'transcript' && <Transcript m={m} live={isLive} interim={isLive ? recording.interim : ''} />}
        {tab === 'ask' && <Ask id={id} m={m} onSave={(chat) => edit({ chat })} />}
      </View>

      <View style={[s.bar, { borderColor: t.line, paddingBottom: 10 + insets.bottom }]}>
        {isLive ? (
          <>
            <View style={s.live}>
              <Text style={{ color: rec.status === 'paused' ? t.ink3 : t.red, fontWeight: '700' }}>{rec.status === 'paused' ? 'Paused' : '● Live'}</Text>
              <Text style={{ color: t.ink, fontVariant: ['tabular-nums'], fontWeight: '600' }}>{clock(recording.elapsed)}</Text>
              <View style={[s.meter, { backgroundColor: t.sunk }]}>
                <View style={[s.meterFill, { backgroundColor: t.ok, width: `${Math.min(100, Math.sqrt(recording.level) * 220)}%` }]} />
              </View>
              {rec.conn === 'reconnecting' ? <Text style={{ color: t.warn, fontSize: 12 }}>Reconnecting…</Text> : null}
            </View>
            {rec.status === 'paused' ? <Button small title="Resume" onPress={recording.resume} /> : <Button small title="Pause" onPress={recording.pause} />}
            <Button small title="Stop" kind="primary" onPress={stopAndEnhance} />
          </>
        ) : (
          <>
            <Button small title={streaming != null ? 'Stop' : m.enhanced ? 'Re-enhance' : 'Enhance'} kind="dark" onPress={() => (streaming != null ? abort.current?.abort() : setPicker(true))} disabled={streaming == null && !m.transcript.length && !m.notes.trim()} style={{ flex: 1 }} />
            <Button small title={rec.status !== 'idle' ? 'Recording elsewhere' : '● Record'} kind="primary" onPress={startRec} disabled={rec.status !== 'idle'} style={{ flex: 1 }} />
          </>
        )}
      </View>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <Pressable style={s.scrim} onPress={() => setPicker(false)} />
        <View style={[s.sheet, { backgroundColor: t.bg, paddingBottom: 20 + insets.bottom }]}>
          <Text style={[s.sheetTitle, { color: t.ink }]}>Enhance with template</Text>
          {BUILT_IN_TEMPLATES.map((tpl) => (
            <Pressable
              key={tpl.id}
              onPress={() => {
                setPicker(false);
                runEnhance(tpl.id);
              }}
              style={({ pressed }) => [s.sheetRow, { borderColor: t.line, backgroundColor: pressed ? t.sunk : 'transparent' }]}
            >
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: tpl.id === (m.templateId || 'general') ? '700' : '500' }}>{tpl.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 13 }}>{tpl.description}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Transcript({ m, live, interim }) {
  const t = useTheme();
  const name = getSession().info?.staff?.name?.split(' ')[0];
  const turns = toTurns(m.transcript, name);
  const ref = useRef(null);
  return (
    <FlatList
      ref={ref}
      data={turns}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={s.pad}
      onContentSizeChange={() => live && ref.current?.scrollToEnd({ animated: true })}
      ListEmptyComponent={<Text style={{ color: t.ink3 }}>{live ? 'Listening… speech appears here.' : 'No transcript for this meeting.'}</Text>}
      ListFooterComponent={interim ? <Text style={{ color: t.ink3, fontStyle: 'italic', marginTop: 8 }}>{interim}</Text> : null}
      renderItem={({ item }) => (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: t.ink3, fontSize: 12 }}>
            <Text style={{ fontWeight: '700', color: t.ink2 }}>{item.who}</Text> {formatTime(item.start)}
          </Text>
          <Text style={{ color: t.ink, fontSize: 15, lineHeight: 22, marginTop: 2 }}>{item.text}</Text>
        </View>
      )}
    />
  );
}

function Ask({ id, m, onSave }) {
  const t = useTheme();
  const [input, setInput] = useState('');
  const [pendingText, setPending] = useState(null);
  const messages = m.chat || [];
  const send = async (q) => {
    q = q.trim();
    if (!q || pendingText != null) return;
    const next = [...messages, { role: 'user', content: q }];
    onSave(next);
    setInput('');
    setPending('');
    try {
      const answer = await ask(id, next, { onDelta: (d) => setPending((p) => (p ?? '') + d) });
      onSave([...next, { role: 'assistant', content: answer }]);
    } catch (err) {
      onSave(messages);
      setInput(q);
      Alert.alert("Couldn't answer", err.message);
    } finally {
      setPending(null);
    }
  };
  const suggestions = ['Draft a follow-up email', 'What are my action items?', 'Write a ticket note'];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={s.pad}>
        {!messages.length && pendingText == null ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.ink3 }}>Ask anything about this meeting.</Text>
            {suggestions.map((q) => (
              <Button key={q} small title={q} onPress={() => send(q)} style={{ alignSelf: 'flex-start' }} />
            ))}
          </View>
        ) : null}
        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <Text key={i} style={[s.userMsg, { backgroundColor: t.sunk, color: t.ink }]}>
              {msg.content}
            </Text>
          ) : (
            <View key={i} style={{ marginBottom: 14 }}>
              <NotesMarkdown text={msg.content} />
            </View>
          ),
        )}
        {pendingText != null ? pendingText ? <NotesMarkdown text={pendingText} /> : <Text style={{ color: t.ink3 }}>Thinking…</Text> : null}
      </ScrollView>
      <View style={[s.askRow, { borderColor: t.line }]}>
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => send(input)} returnKeyType="send" placeholder="Ask about this meeting…" placeholderTextColor={t.ink3} style={[s.askInput, { color: t.ink, borderColor: t.line2 }]} />
        <Button small title="Send" kind="primary" onPress={() => send(input)} disabled={!input.trim() || pendingText != null} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', paddingVertical: 4 },
  notes: { flex: 1, fontSize: 17, lineHeight: 26, paddingHorizontal: 20, paddingTop: 8 },
  pad: { padding: 20, paddingBottom: 40 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  live: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  meter: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', maxWidth: 80 },
  meterFill: { height: '100%' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 20, paddingBottom: 8 },
  sheetRow: { paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  userMsg: { alignSelf: 'flex-end', padding: 10, borderRadius: 12, marginBottom: 12, overflow: 'hidden', maxWidth: '85%' },
  askRow: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  askInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, fontSize: 16 },
});
