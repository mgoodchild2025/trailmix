import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { getSession, refreshSession, signOut, subscribeSession } from '../lib/session.js';
import { subscribeSync, syncNow } from '../lib/sync.js';
import { useTheme, type } from '../lib/theme.js';
import { SectionHeader, Symbol } from '../components/ui.jsx';

function Row({ icon, iconColor, title, detail, onPress, destructive, last, right }) {
  const t = useTheme();
  const body = (
    <View style={[s.row, { backgroundColor: t.cell }]}>
      {icon ? <Symbol name={icon} size={20} color={iconColor || t.label2} /> : null}
      <Text style={[type.body, { color: destructive ? t.red : onPress ? t.red : t.label, flex: 1 }]}>{title}</Text>
      {detail ? <Text style={[type.body, { color: t.label2 }]}>{detail}</Text> : null}
      {right}
    </View>
  );
  return (
    <View>
      {onPress ? (
        <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }} accessibilityRole="button">
          {body}
        </Pressable>
      ) : (
        body
      )}
      {!last ? <View style={[s.sep, { backgroundColor: t.separator }]} /> : null}
    </View>
  );
}

export default function Settings() {
  const t = useTheme();
  const [session, setSession] = useState(getSession());
  const [sync, setSync] = useState(null);
  useEffect(() => subscribeSession(setSession), []);
  useEffect(() => subscribeSync(setSync), []);
  const info = session.info || {};
  const f = info.features || {};
  const name = info.staff?.name || 'Signed in';
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const staging = !session.demo && session.url?.includes('staging');
  const ok = (on) => <Symbol name={on ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'} size={20} color={on ? t.green : t.orange} />;
  const syncDetail = session.demo ? 'Off in demo' : !f.sync ? 'Not available yet' : sync?.syncing ? 'Syncing…' : sync?.error ? 'Problem' : sync?.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Waiting';

  return (
    <ScrollView style={{ backgroundColor: t.grouped }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} contentInsetAdjustmentBehavior="automatic">
      <View style={[s.group, { marginTop: 12 }]}>
        <View style={[s.account, { backgroundColor: t.cell }]}>
          <View style={[s.avatar, { backgroundColor: t.red }]}>
            <Text style={[type.title3, { color: '#fff' }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.headline, { color: t.label }]}>{name}</Text>
            <Text style={[type.subhead, { color: t.label2 }]}>
              {session.demo ? 'Demo, nothing is saved' : staging ? 'CG Core staging' : info.staff?.email || 'CG Core'}
            </Text>
          </View>
        </View>
      </View>

      <SectionHeader>CG Core services</SectionHeader>
      <View style={s.group}>
        <Row icon="waveform" title="Transcription" right={ok(f.deepgram !== false)} />
        <Row icon="sparkles" title="AI notes" right={ok(f.claude !== false)} />
        <Row icon="arrow.triangle.2.circlepath" title="Sync" detail={syncDetail} last />
      </View>
      {sync?.error && !session.demo ? <Text style={[type.footnote, s.footer, { color: t.orange }]}>{sync.error}</Text> : null}

      <View style={[s.group, { marginTop: 28 }]}>
        {!session.demo && f.sync ? <Row title="Sync now" onPress={() => syncNow()} /> : null}
        {!session.demo ? <Row title="Refresh from CG Core" onPress={() => refreshSession()} /> : null}
        <Row
          title={session.demo ? 'Exit demo' : 'Sign out'}
          destructive
          last
          onPress={() =>
            session.demo
              ? signOut()
              : Alert.alert('Sign out of CG Core?', 'Meetings already on this phone stay here.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
                ])
          }
        />
      </View>

      <Text style={[type.footnote, s.footer, { color: t.label2 }]}>
        Trailmix {Constants.expoConfig?.version} for CG Technologies. Audio is streamed for transcription and never saved. Your meetings sync privately between your own devices through CG Core.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  group: { borderRadius: 12, overflow: 'hidden', borderCurve: 'continuous' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 10, lineHeight: 18 },
});
