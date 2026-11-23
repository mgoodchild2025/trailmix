// Client history: everyone's meetings, calls and site visits with a client, prospect or
// lead that you may see in CG Core, newest first, and Ask about them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMeetings } from '../../../lib/store.js';
import { askClient, clientHistory, historyEntry } from '../../../lib/filing.js';
import { useTheme, type } from '../../../lib/theme.js';
import { PressableScale, Symbol } from '../../../components/ui.jsx';
import { NotesMarkdown } from '../../../components/Notes.jsx';

const KIND = { meeting: 'Meeting', call: 'Call', site_visit: 'Site visit' };
const when = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function ClientHistoryScreen() {
  const { type: kind, id } = useLocalSearchParams();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({}); // id -> full entry (true while loading)
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null); // { q, text, done }
  const abort = useRef(null);

  const load = useCallback(
    async (before = null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await clientHistory(kind, id, before);
        setData((d) => (before && d ? { ...page, entries: [...d.entries, ...page.entries] } : page));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [kind, id],
  );
  useEffect(() => {
    load();
    return () => abort.current?.abort();
  }, [load]);

  // Your own filed meetings open in Trailmix.
  const localByActivity = Object.fromEntries(listMeetings().filter((m) => m.filed?.activityId).map((m) => [m.filed.activityId, m.id]));

  const toggle = async (e) => {
    if (open[e.id]) return setOpen(({ [e.id]: _, ...rest }) => rest);
    if (!e.truncated) return setOpen((o) => ({ ...o, [e.id]: e }));
    setOpen((o) => ({ ...o, [e.id]: true }));
    try {
      const full = await historyEntry(kind, id, e.id);
      setOpen((o) => ({ ...o, [e.id]: full }));
    } catch (err) {
      setOpen(({ [e.id]: _, ...rest }) => rest);
      Alert.alert("Couldn't open it", err.message);
    }
  };

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text || (answer && !answer.done)) return;
    setQuestion('');
    setAnswer({ q: text, text: '', done: false });
    abort.current = new AbortController();
    try {
      const out = await askClient(data?.target || { type: kind, id, name: 'this client' }, [{ role: 'user', content: text }], {
        onDelta: (d) => setAnswer((a) => a && { ...a, text: a.text + d }),
        signal: abort.current.signal,
      });
      setAnswer({ q: text, text: out, done: true });
    } catch (err) {
      setAnswer(null);
      if (!err.cancelled) Alert.alert("Couldn't answer", err.message);
    }
  };

  const target = data?.target;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.grouped }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: target?.name || 'Client history' }} />
      <ScrollView contentContainerStyle={s.page} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        {target ? (
          <Text style={[type.footnote, s.note, { color: t.label2 }]}>
            {target.detail}
            {target.url ? (
              <>
                {'  ·  '}
                <Text style={{ color: t.red }} onPress={() => Linking.openURL(target.url)}>
                  Open in CG Core
                </Text>
              </>
            ) : null}
          </Text>
        ) : null}

        {answer ? (
          <View style={[s.card, s.answer, { backgroundColor: t.cell }]}>
            <Text style={[type.subhead, { color: t.label2, fontWeight: '600' }]}>{answer.q}</Text>
            {answer.text ? <NotesMarkdown text={answer.text} /> : <ActivityIndicator color={t.red} style={{ alignSelf: 'flex-start', marginTop: 8 }} />}
          </View>
        ) : data?.entries.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {['Summarise our history with them', 'What have they asked us for?', 'Anything we promised and haven’t done?'].map((p) => (
              <Pressable key={p} onPress={() => ask(p)} style={({ pressed }) => [s.chip, { backgroundColor: t.fill }, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Symbol name="sparkles" size={13} color={t.red} />
                <Text style={[type.footnote, { color: t.label }]}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {error ? (
          <Pressable onPress={() => load()} style={[s.card, s.row, { backgroundColor: t.cell }]} accessibilityRole="button">
            <Symbol name="exclamationmark.circle.fill" size={18} color={t.orange} />
            <Text style={[type.footnote, { color: t.label2, flex: 1 }]}>{error} Tap to try again.</Text>
          </Pressable>
        ) : null}
        {!data && loading ? <ActivityIndicator color={t.red} style={{ marginTop: 32 }} /> : null}
        {data && !data.entries.length ? <Text style={[type.body, s.note, { color: t.label2, marginTop: 24 }]}>No meetings, calls or visits on record yet.</Text> : null}

        {data?.entries.map((e) => {
          const full = open[e.id];
          const localId = localByActivity[e.id];
          return (
            <View key={e.id} style={[s.card, s.entry, { backgroundColor: t.cell }]}>
              <Pressable onPress={() => toggle(e)} style={s.entryHead} accessibilityRole="button" accessibilityState={{ expanded: !!full }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.headline, { color: t.label }]}>{e.subject}</Text>
                  <Text style={[type.footnote, { color: t.label2 }]}>
                    {when(e.occurredAt)} · {KIND[e.type] || 'Meeting'}
                    {e.by ? ` · ${e.mine ? 'You' : e.by}` : ''}
                    {e.contact ? ` · with ${e.contact}` : ''}
                    {e.fromTrailmix ? ' · Trailmix' : ''}
                  </Text>
                </View>
                <Symbol name="chevron.right" size={13} color={t.label3} weight="semibold" style={full ? { transform: [{ rotate: '90deg' }] } : null} />
              </Pressable>
              {full === true ? <ActivityIndicator color={t.red} style={{ margin: 12 }} /> : null}
              {full && full !== true ? (
                <View style={[s.notes, { borderTopColor: t.separator }]}>
                  {full.notes ? <NotesMarkdown text={full.notes} /> : <Text style={[type.footnote, { color: t.label2 }]}>No notes.</Text>}
                  {localId ? (
                    <Text style={[type.subhead, { color: t.red, marginTop: 10 }]} onPress={() => router.push(`/meeting/${localId}`)}>
                      Open this meeting in Trailmix
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {!full && e.notes ? (
                <Text style={[type.footnote, s.preview, { color: t.label2 }]} numberOfLines={2}>
                  {e.notes.replace(/[#*>`_]|<\/?mark>/g, '').replace(/\s+/g, ' ')}
                </Text>
              ) : null}
            </View>
          );
        })}
        {data?.nextBefore ? (
          <PressableScale onPress={() => load(data.nextBefore)} disabled={loading} style={[s.more, { backgroundColor: t.fill }]} accessibilityLabel="Older entries">
            <Text style={[type.headline, { color: t.label }]}>{loading ? 'Loading…' : 'Older entries'}</Text>
          </PressableScale>
        ) : null}
      </ScrollView>

      {data?.entries.length ? (
        <View style={[s.askBar, { backgroundColor: t.cell, borderTopColor: t.separator, paddingBottom: 10 + insets.bottom }]}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder={`Ask about ${target?.name?.split(' (')[0] || 'this client'}…`}
            placeholderTextColor={t.label3}
            style={[type.body, s.askInput, { color: t.label, backgroundColor: t.fill }]}
            returnKeyType="send"
            onSubmitEditing={() => ask()}
            accessibilityLabel="Ask about this client"
          />
          <PressableScale onPress={() => ask()} disabled={!question.trim() || (answer && !answer.done)} accessibilityLabel="Ask">
            <Symbol name="arrow.up.circle.fill" size={32} color={t.red} />
          </PressableScale>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 120, gap: 10 },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  note: { paddingHorizontal: 4 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 34, borderRadius: 17 },
  answer: { padding: 14, gap: 6 },
  entry: {},
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  preview: { paddingHorizontal: 14, paddingBottom: 12, marginTop: -6 },
  notes: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  more: { minHeight: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  askBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth },
  askInput: { flex: 1, minHeight: 40, borderRadius: 20, paddingHorizontal: 14 },
});
