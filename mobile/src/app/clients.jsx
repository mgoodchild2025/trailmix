// Client history, step 1: pick a client, prospect or lead from CG Core.
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { listMeetings } from '../lib/store.js';
import { searchClients } from '../lib/filing.js';
import { useTheme, type } from '../lib/theme.js';
import { SectionHeader, Symbol } from '../components/ui.jsx';

export default function ClientsScreen() {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);

  // Clients you've filed meetings to, for one tap.
  const recent = [];
  const seen = new Set();
  for (const m of listMeetings()) {
    if (!m.filed || seen.has(`${m.filed.type}:${m.filed.id}`)) continue;
    seen.add(`${m.filed.type}:${m.filed.id}`);
    recent.push({ type: m.filed.type, id: m.filed.id, name: m.filed.name });
  }

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

  const open = (r) => router.push(`/client/${r.type}/${r.id}`);
  const list = results ?? (query.trim().length < 2 ? recent : []);

  return (
    <ScrollView style={{ backgroundColor: t.grouped }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: 'Client history' }} />
      <Text style={[type.footnote, s.note, { color: t.label2 }]}>Meetings, calls and visits with a client, prospect or lead, from CG Core: everyone&apos;s you can see, not just yours.</Text>
      <View style={[s.card, { backgroundColor: t.cell, marginTop: 12 }]}>
        <View style={s.searchRow}>
          <Symbol name="magnifyingglass" size={16} color={t.label3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search clients, prospects and leads"
            placeholderTextColor={t.label3}
            style={[type.body, { color: t.label, flex: 1, paddingVertical: 10 }]}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search clients, prospects and leads"
          />
        </View>
      </View>
      {list.length ? (
        <>
          <SectionHeader>{results ? 'Results' : 'Clients you’ve filed to'}</SectionHeader>
          <View style={[s.card, { backgroundColor: t.cell }]}>
            {list.map((r, i) => (
              <Pressable key={`${r.type}:${r.id}`} onPress={() => open(r)} style={({ pressed }) => [s.row, i && { borderTopColor: t.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.fill }]} accessibilityRole="button">
                <Text style={[type.body, { color: t.label, flex: 1 }]} numberOfLines={1}>
                  {r.name}
                </Text>
                {r.detail ? <Text style={[type.footnote, { color: t.label2 }]}>{r.detail}</Text> : null}
                <Symbol name="chevron.right" size={13} color={t.label3} weight="semibold" />
              </Pressable>
            ))}
          </View>
        </>
      ) : results ? (
        <Text style={[type.footnote, s.note, { color: t.label2, marginTop: 16 }]}>No clients, prospects or leads match.</Text>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  card: { borderRadius: 12, overflow: 'hidden' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 },
  note: { paddingHorizontal: 4 },
});
