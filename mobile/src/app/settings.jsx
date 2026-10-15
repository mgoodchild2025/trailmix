import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { getSession, refreshSession, signOut, subscribeSession } from '../lib/session.js';
import { subscribeSync, syncNow } from '../lib/sync.js';
import { useTheme } from '../lib/theme.js';
import { Button, Chip } from '../components/ui.jsx';

export default function Settings() {
  const t = useTheme();
  const [session, setSession] = useState(getSession());
  const [sync, setSync] = useState(null);
  useEffect(() => subscribeSession(setSession), []);
  useEffect(() => subscribeSync(setSync), []);
  const info = session.info || {};
  const f = info.features || {};
  const staging = session.url?.includes('staging');
  const card = [s.card, { borderColor: t.line }];
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View style={card}>
        <Text style={[s.h2, { color: t.ink }]}>CG Core</Text>
        <Text style={{ color: t.ink }}>
          Signed in as <Text style={{ fontWeight: '700' }}>{info.staff?.name || '…'}</Text>
          {staging ? ' (staging)' : ''}
        </Text>
        <View style={s.chips}>
          <Chip label={f.deepgram === false ? 'Transcription not set up' : 'Transcription'} tone={f.deepgram === false ? 'warn' : 'ok'} />
          <Chip label={f.claude === false ? 'AI not set up' : 'AI notes'} tone={f.claude === false ? 'warn' : 'ok'} />
          <Chip label={f.sync ? 'Sync' : 'Sync not available yet'} tone={f.sync ? 'ok' : 'warn'} />
        </View>
        <Text style={{ color: t.ink3, fontSize: 13, lineHeight: 19 }}>
          {sync?.syncing ? 'Syncing…' : sync?.error ? `Sync problem: ${sync.error}` : sync?.lastSyncAt ? `Last synced ${new Date(sync.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet'}
        </Text>
        <View style={s.chips}>
          <Button small title="Sync now" onPress={() => syncNow()} />
          <Button small title="Refresh" onPress={() => refreshSession()} />
          <Button
            small
            title="Sign out"
            onPress={() =>
              Alert.alert('Sign out of CG Core?', 'Meetings already on this phone stay here.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
              ])
            }
          />
        </View>
      </View>
      <View style={card}>
        <Text style={[s.h2, { color: t.ink }]}>About</Text>
        <Text style={{ color: t.ink3, lineHeight: 20 }}>
          Trailmix {Constants.expoConfig?.version}. Audio is streamed for transcription and never saved. Meetings sync privately with your own devices through CG Core.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  h2: { fontSize: 16, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
