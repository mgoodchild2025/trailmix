import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSession, signIn, subscribeSession } from '../lib/session.js';
import { createMeeting, listMeetings, subscribeMeetings } from '../lib/store.js';
import { meetingChanged, subscribeSync } from '../lib/sync.js';
import { useRecording } from '../lib/recording.jsx';
import { useTheme } from '../lib/theme.js';
import { Button, Chip } from '../components/ui.jsx';

function useSession() {
  const [s, set] = useState(getSession());
  useEffect(() => subscribeSession(set), []);
  return s;
}

export default function Home() {
  const session = useSession();
  return session.token ? <MeetingList /> : <SignIn />;
}

function SignIn() {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const go = async (server) => {
    setBusy(true);
    try {
      await signIn(server);
    } catch (err) {
      Alert.alert("Couldn't sign in", err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[s.signin, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title: '' }} />
      <View style={[s.mark, { backgroundColor: t.red }]}>
        <View style={s.dot} />
      </View>
      <Text style={[s.h1, { color: t.ink }]}>Trailmix</Text>
      <Text style={[s.lead, { color: t.ink3 }]}>Record a meeting, jot a few notes, and get clean notes back. They sync with Trailmix on your computer.</Text>
      <Button title={busy ? 'Opening CG Core…' : 'Sign in with CG Core'} kind="primary" onPress={() => go('production')} disabled={busy} style={s.wide} />
      <Text style={[s.small, { color: t.ink3 }]}>Uses your CG Technologies Microsoft 365 account.</Text>
      <Pressable onPress={() => go('staging')} disabled={busy} hitSlop={12}>
        <Text style={[s.small, { color: t.blue, marginTop: 24 }]}>Use staging</Text>
      </Pressable>
    </View>
  );
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return d.toLocaleDateString('en-GB', { month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function MeetingList() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { rec, start } = useRecording();
  const [meetings, setMeetings] = useState(listMeetings());
  const [sync, setSync] = useState(null);
  useEffect(() => subscribeMeetings(() => setMeetings(listMeetings())), []);
  useEffect(() => subscribeSync(setSync), []);

  const rows = useMemo(() => {
    const out = [];
    let last = null;
    for (const m of meetings) {
      const g = dayLabel(m.createdAt);
      if (g !== last) out.push({ header: g, key: `h-${g}` });
      last = g;
      out.push({ m, key: m.id });
    }
    return out;
  }, [meetings]);

  const newMeeting = async (record) => {
    const m = createMeeting();
    meetingChanged(m.id);
    router.push(`/meeting/${m.id}`);
    if (record) {
      try {
        await start(m.id);
      } catch (err) {
        Alert.alert("Couldn't start recording", err.message);
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen
        options={{
          title: 'Meetings',
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={12} accessibilityLabel="Settings">
              <Text style={{ color: t.red, fontSize: 16, fontWeight: '600' }}>Settings</Text>
            </Pressable>
          ),
        }}
      />
      {sync?.error ? <Text style={[s.syncErr, { color: t.warn }]}>Sync problem: {sync.error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        ListEmptyComponent={<Text style={[s.empty, { color: t.ink3 }]}>No meetings yet. Tap Start recording when your meeting begins.</Text>}
        renderItem={({ item }) =>
          item.header ? (
            <Text style={[s.group, { color: t.ink3 }]}>{item.header.toUpperCase()}</Text>
          ) : (
            <Pressable onPress={() => router.push(`/meeting/${item.m.id}`)} style={({ pressed }) => [s.row, { borderColor: t.line, backgroundColor: pressed ? t.sunk : t.bg }]}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[s.title, { color: t.ink }]}>
                  {rec.meetingId === item.m.id && rec.status !== 'idle' ? '● ' : ''}
                  {item.m.title || 'Untitled meeting'}
                </Text>
                <View style={s.meta}>
                  <Text style={{ color: t.ink3, fontSize: 13 }}>{new Date(item.m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</Text>
                  {item.m.enhanced ? <Chip label="Enhanced" /> : null}
                  {item.m.source === 'desktop' ? <Chip label="From computer" /> : null}
                </View>
              </View>
            </Pressable>
          )
        }
      />
      <View style={[s.bottom, { paddingBottom: 12 + insets.bottom, backgroundColor: t.bg, borderColor: t.line }]}>
        {rec.status !== 'idle' ? (
          <Button title="● Recording: back to meeting" kind="dark" onPress={() => router.push(`/meeting/${rec.meetingId}`)} style={{ flex: 1 }} />
        ) : (
          <>
            <Button title="Blank note" onPress={() => newMeeting(false)} style={{ flex: 1 }} />
            <Button title="● Start recording" kind="primary" onPress={() => newMeeting(true)} style={{ flex: 2 }} />
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  signin: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  mark: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  h1: { fontSize: 30, fontWeight: '800' },
  lead: { fontSize: 16, textAlign: 'center', lineHeight: 23, marginBottom: 12 },
  wide: { alignSelf: 'stretch' },
  small: { fontSize: 13, textAlign: 'center' },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  row: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  empty: { textAlign: 'center', padding: 40, fontSize: 15, lineHeight: 22 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  syncErr: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13 },
});
