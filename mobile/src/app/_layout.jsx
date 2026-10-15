import { useEffect, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSession, subscribeSession } from '../lib/session.js';
import { setDemoStore } from '../lib/store.js';
import { startSync } from '../lib/sync.js';
import { RecordingProvider } from '../lib/recording.jsx';
import { useTheme } from '../lib/theme.js';

export default function RootLayout() {
  const t = useTheme();
  // Native header titles don't follow dynamic system colours; give them concrete ones.
  const titleColor = useColorScheme() === 'dark' ? '#ffffff' : '#000000';
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let demo = false;
    const off = subscribeSession((s) => {
      if (s.demo !== demo) setDemoStore((demo = s.demo));
    });
    loadSession().then(() => setReady(true));
    const stopSync = startSync();
    return () => {
      off();
      stopSync();
    };
  }, []);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RecordingProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerTintColor: t.red,
              headerTitleStyle: { color: titleColor },
              headerLargeTitleStyle: { color: titleColor },
              headerShadowVisible: false,
              headerBackButtonDisplayMode: 'minimal',
              headerTransparent: Platform.OS === 'ios',
              contentStyle: { backgroundColor: t.grouped },
            }}
          >
            <Stack.Screen name="index" options={{ title: 'Meetings', headerLargeTitleEnabled: true }} />
            <Stack.Screen name="meeting/[id]" options={{ title: '', contentStyle: { backgroundColor: t.bg } }} />
            <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true }} />
          </Stack>
        </RecordingProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
