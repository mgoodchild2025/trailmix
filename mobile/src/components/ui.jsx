import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme.js';

export function Button({ title, onPress, kind = 'default', disabled, style, small }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.red : kind === 'dark' ? t.ink : 'transparent';
  const fg = kind === 'primary' ? t.onRed : kind === 'dark' ? t.bg : t.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        small && s.small,
        { backgroundColor: bg, borderColor: kind === 'default' ? t.line2 : bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      <Text style={[s.btnText, small && s.smallText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, tone }) {
  const t = useTheme();
  const c = tone === 'ok' ? t.ok : tone === 'warn' ? t.warn : t.ink3;
  return (
    <View style={[s.chip, { borderColor: t.line }]}>
      <Text style={[s.chipText, { color: c }]}>{label}</Text>
    </View>
  );
}

export function Segmented({ options, value, onChange }) {
  const t = useTheme();
  return (
    <View style={[s.seg, { backgroundColor: t.sunk }]}>
      {options.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={[s.segItem, value === v && { backgroundColor: t.bg }]} accessibilityRole="tab" accessibilityState={{ selected: value === v }}>
          <Text style={[s.segText, { color: value === v ? t.ink : t.ink3 }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  small: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { fontSize: 16, fontWeight: '600' },
  smallText: { fontSize: 14 },
  chip: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 1 },
  chipText: { fontSize: 11, fontWeight: '600' },
  seg: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segText: { fontSize: 14, fontWeight: '600' },
});
