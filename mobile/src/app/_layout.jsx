import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSession, subscribeSession } from '../lib/session.js';
import { startSync } from '../lib/sync.js';
import { RecordingProvider } from '../lib/recording.jsx';
import { useTheme } from '../lib/theme.js';

export default function RootLayout() {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadSession().then(() => setReady(true));
    const stopSync = startSync();
    const off = subscribeSession(() => {});
    return () => {
      stopSync();
      off();
    };
  }, []);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <RecordingProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.bg },
            headerTintColor: t.red,
            headerTitleStyle: { color: t.ink, fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Trailmix' }} />
          <Stack.Screen name="meeting/[id]" options={{ title: '' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
        </Stack>
      </RecordingProvider>
    </SafeAreaProvider>
  );
}
