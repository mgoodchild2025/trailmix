// File to a client: puts the meeting's notes (and, if asked, its transcript) on a client's,
// prospect's or lead's timeline in CG Core. Filing again updates the same entry.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getMeeting } from '../../lib/store.js';
import { companyContacts, fileMeeting, searchClients, unfileMeeting } from '../../lib/filing.js';
import { useTheme, type } from '../../lib/theme.js';
import { Button, SectionHeader, Symbol } from '../../components/ui.jsx';

export default function FileScreen() {
  const { id, suggest } = useLocalSearchParams();
  const t = useTheme();
  const m = getMeeting(id);
  const filed = m?.filed;
  const initial = suggest ? JSON.parse(suggest) : filed ? { type: filed.type, id: filed.id, name: filed.name } : null;
  const [target, setTarget] = useState(initial);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [contactId, setContactId] = useState(null);
  const [transcript, setTranscript] = useState(!!filed?.includeTranscript);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return setResults(null);
    let alive = true;
    const timer = setTimeout(() => {
      searchClients(query.trim())
        .then((r) => alive && setResults(r))
        .catch((e) => alive && (setResults([]), Alert.alert("Couldn't search CG Core", e.message)));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    setContacts(null);
    setContactId(null);
    if (target?.type !== 'company') return;
    let alive = true;
    companyContacts(target.id)
      .then((c) => alive && setContacts(c))
      .catch(() => alive && setContacts([]));
    return () => {
      alive = false;
    };
  }, [target?.type, target?.id]);

  if (!m) return null;
  const same = filed && target && filed.type === target.type && filed.id === target.id;

  const file = async () => {
    setBusy(true);
    try {
      const r = await fileMeeting(id, { target: { type: target.type, id: target.id }, contactId, includeTranscript: transcript });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      setTimeout(() => Alert.alert(r.updated ? 'Updated in CG Core' : 'Filed in CG Core', `On ${r.name}'s timeline.`), 300);
    } catch (e) {
      setBusy(false);
      Alert.alert("Couldn't file the meeting", e.message);
    }
  };

  const unfile = () =>
    Alert.alert(`Remove from ${filed.name}'s timeline?`, 'The meeting stays in Trailmix.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await unfileMeeting(id);
            router.back();
          } catch (e) {
            setBusy(false);
            Alert.alert("Couldn't remove it", e.message);
          }
        },
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: t.grouped }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: filed ? 'Filed in CG Core' : 'File to a client' }} />

      {filed ? (
        <Text style={[type.footnote, s.note, { color: t.label2 }]}>
          On {filed.name}&apos;s timeline.{' '}
          <Text style={{ color: t.red }} onPress={() => Linking.openURL(filed.url)}>
            Open in CG Core
          </Text>
          {'  ·  '}
          <Text style={{ color: t.red }} onPress={() => router.push(`/client/${filed.type}/${filed.id}`)}>
            Client history
          </Text>
        </Text>
      ) : null}

      <SectionHeader>Client, prospect or lead</SectionHeader>
      {target ? (
        <View style={[s.card, s.row, { backgroundColor: t.cell }]}>
          <View style={{ flex: 1 }}>
            <Text style={[type.headline, { color: t.label }]}>{target.name}</Text>
            {target.detail ? <Text style={[type.footnote, { color: t.label2 }]}>{target.detail}</Text> : null}
          </View>
          <Pressable onPress={() => setTarget(null)} hitSlop={10} disabled={busy} accessibilityRole="button">
            <Text style={[type.body, { color: t.red }]}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[s.card, { backgroundColor: t.cell }]}>
          <View style={[s.searchRow, { borderBottomColor: t.separator }]}>
            <Symbol name="magnifyingglass" size={16} color={t.label3} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name"
              placeholderTextColor={t.label3}
              style={[type.body, { color: t.label, flex: 1, paddingVertical: 10 }]}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search clients, prospects and leads"
            />
          </View>
          {results === null ? (
            <Text style={[type.footnote, s.pad, { color: t.label2 }]}>Type at least two letters of the name.</Text>
          ) : results.length === 0 ? (
            <Text style={[type.footnote, s.pad, { color: t.label2 }]}>No clients, prospects or leads match.</Text>
          ) : (
            results.map((r, i) => (
              <Pressable key={`${r.type}:${r.id}`} onPress={() => setTarget(r)} style={({ pressed }) => [s.result, i && { borderTopColor: t.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.fill }]} accessibilityRole="button">
                <Text style={[type.body, { color: t.label, flex: 1 }]} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[type.footnote, { color: t.label2 }]}>{r.detail}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      {target?.type === 'company' && contacts?.length ? (
        <>
          <SectionHeader>Who it was with (optional)</SectionHeader>
          <View style={[s.card, { backgroundColor: t.cell }]}>
            {[{ id: null, name: 'Nobody in particular' }, ...contacts].map((c, i) => (
              <Pressable key={c.id ?? 'none'} onPress={() => setContactId(c.id)} style={({ pressed }) => [s.result, i && { borderTopColor: t.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.fill }]} accessibilityRole="radio" accessibilityState={{ checked: contactId === c.id }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: t.label }]}>{c.name}</Text>
                  {c.title ? <Text style={[type.footnote, { color: t.label2 }]}>{c.title}</Text> : null}
                </View>
                {contactId === c.id ? <Symbol name="checkmark" size={17} color={t.red} weight="semibold" /> : null}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <View style={[s.card, s.row, { backgroundColor: t.cell, marginTop: 22 }]}>
        <Text style={[type.body, { color: t.label, flex: 1 }]}>Include the transcript</Text>
        <Switch value={transcript} onValueChange={setTranscript} disabled={busy} trackColor={{ true: t.red }} />
      </View>
      <Text style={[type.footnote, s.note, { color: t.label2 }]}>
        The {m.enhanced ? 'AI notes' : 'notes'} go on the timeline{transcript ? ', followed by the full transcript' : ''}. Colleagues with access to sales activity in CG Core can see it.
      </Text>

      <View style={s.actions}>
        {busy ? <ActivityIndicator color={t.red} /> : <Button title={filed ? (same ? 'Update in CG Core' : 'Move here') : 'File'} icon="folder" kind="primary" onPress={file} disabled={!target} />}
        {filed && !busy ? <Button title="Remove from timeline" onPress={unfile} /> : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 },
  pad: { padding: 16 },
  note: { paddingHorizontal: 16, paddingTop: 8 },
  actions: { gap: 10, marginTop: 24 },
});
