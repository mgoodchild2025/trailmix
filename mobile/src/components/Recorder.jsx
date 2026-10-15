// The live recording panel, after Voice Memos: a waveform of recent input, a big timer,
// and round pause/stop controls on a glass surface.
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useRecording } from '../lib/recording.jsx';
import { useTheme, type } from '../lib/theme.js';
import { Glass, PressableScale, Symbol } from './ui.jsx';

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function Waveform({ levels, color, paused, height = 36 }) {
  const reduced = useReducedMotion();
  return (
    <View style={[s.wave, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((v, i) => {
        // sqrt for perceived loudness; a floor so silence still shows a resting line.
        const k = paused ? 0.08 : Math.max(0.08, Math.min(1, Math.sqrt(v) * 2.6));
        return (
          <Animated.View
            key={i}
            style={[
              s.bar,
              { backgroundColor: color, height, opacity: 0.35 + 0.65 * ((i + 1) / levels.length), transform: [{ scaleY: k }] },
              !reduced && s.barAnim,
            ]}
          />
        );
      })}
    </View>
  );
}

export function RecorderPanel({ onStop, bottomInset }) {
  const t = useTheme();
  const { rec, levels, elapsed, pause, resume } = useRecording();
  const paused = rec.status === 'paused';
  return (
    <Glass style={[s.panel, { marginBottom: Math.max(bottomInset, 12) }]}>
      <View style={s.panelTop}>
        <View style={[s.dot, { backgroundColor: paused ? t.label3 : t.red }]} />
        <Text style={[type.footnote, { color: t.label2, fontWeight: '600' }]}>
          {rec.status === 'starting' ? 'Starting…' : paused ? 'Paused' : rec.conn === 'reconnecting' ? 'Reconnecting…' : 'Recording'}
        </Text>
      </View>
      <Waveform levels={levels} color={paused ? t.label3 : t.red} paused={paused} />
      <View style={s.controls}>
        <PressableScale onPress={paused ? resume : pause} style={[s.round, { backgroundColor: t.fill }]} accessibilityLabel={paused ? 'Resume recording' : 'Pause recording'}>
          <Symbol name={paused ? 'play.fill' : 'pause.fill'} size={22} color={t.label} />
        </PressableScale>
        <Text style={[s.time, { color: t.label }]} accessibilityLabel={`Recorded ${clock(elapsed)}`}>
          {clock(elapsed)}
        </Text>
        <PressableScale onPress={onStop} style={[s.stopRing, { borderColor: t.fill2 }]} accessibilityLabel="Stop recording">
          <View style={[s.stopSquare, { backgroundColor: t.red }]} />
        </PressableScale>
      </View>
    </Glass>
  );
}

const s = StyleSheet.create({
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'stretch', justifyContent: 'center' },
  bar: { width: 4, borderRadius: 2 },
  barAnim: { transitionProperty: 'transform', transitionDuration: '100ms', transitionTimingFunction: 'linear' },
  panel: { marginHorizontal: 12, borderRadius: 28, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16, gap: 12 },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 34, fontWeight: '300', fontVariant: ['tabular-nums'], letterSpacing: 0.4 },
  stopRing: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 24, height: 24, borderRadius: 6 },
});
