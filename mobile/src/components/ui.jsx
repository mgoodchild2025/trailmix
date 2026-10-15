import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme, type } from '../lib/theme.js';

// SF Symbol on iOS; nothing (or a fallback) where symbols don't exist.
export function Symbol({ name, size = 20, color, weight = 'regular', fallback = null, style }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} fallback={fallback} style={[{ width: size, height: size }, style]} />;
}

// Feedback on touch-down: 3% scale in 120ms (it's touched often, so it stays subtle).
export function PressableScale({ onPress, onLongPress, disabled, style, children, hitSlop = 8, accessibilityLabel, accessibilityRole = 'button' }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={hitSlop}
      pressRetentionOffset={16}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View style={[s.press, pressed && s.pressed, disabled && { opacity: 0.4 }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

// Primary / secondary capsule buttons.
export function Button({ title, icon, onPress, kind = 'secondary', disabled, style }) {
  const t = useTheme();
  const primary = kind === 'primary';
  const fg = primary ? t.onRed : t.label;
  return (
    <PressableScale onPress={onPress} disabled={disabled} style={[s.btn, { backgroundColor: primary ? t.red : t.fill }, style]} accessibilityLabel={title}>
      <View style={s.btnInner}>
        {icon ? <Symbol name={icon} size={17} color={fg} weight="semibold" /> : null}
        <Text style={[type.headline, { color: fg }]}>{title}</Text>
      </View>
    </PressableScale>
  );
}

// Liquid Glass where the OS has it (iOS 26+), a blur material otherwise.
export function Glass({ style, children, tint }) {
  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <GlassView style={style} glassEffectStyle="regular" tintColor={tint}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={60} tint="systemChromeMaterial" style={[style, { overflow: 'hidden' }]}>
      {children}
    </BlurView>
  );
}

export function SectionHeader({ children }) {
  const t = useTheme();
  return <Text style={[type.footnote, s.sectionHeader, { color: t.label2 }]}>{children}</Text>;
}

const s = StyleSheet.create({
  press: { transform: [{ scale: 1 }], transitionProperty: 'transform', transitionDuration: '120ms', transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1) },
  pressed: { transform: [{ scale: 0.97 }] },
  btn: { minHeight: 50, borderRadius: 25, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeader: { textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 22, paddingBottom: 7 },
});
