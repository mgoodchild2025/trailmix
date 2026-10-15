// iOS system colours (they follow light/dark, Increase Contrast and the user's tint
// settings automatically); close equivalents on Android. CG red is the accent.
import { Platform, PlatformColor, useColorScheme } from 'react-native';

const RED = '#E93E3F';

const ios = {
  bg: PlatformColor('systemBackground'),
  grouped: PlatformColor('systemGroupedBackground'),
  cell: PlatformColor('secondarySystemGroupedBackground'),
  label: PlatformColor('label'),
  label2: PlatformColor('secondaryLabel'),
  label3: PlatformColor('tertiaryLabel'),
  separator: PlatformColor('separator'),
  fill: PlatformColor('tertiarySystemFill'),
  fill2: PlatformColor('secondarySystemFill'),
  green: PlatformColor('systemGreen'),
  orange: PlatformColor('systemOrange'),
  blue: PlatformColor('link'),
  red: RED,
  onRed: '#ffffff',
};

const androidLight = { bg: '#ffffff', grouped: '#f2f2f7', cell: '#ffffff', label: '#1c1c1e', label2: '#6b6b70', label3: '#a1a1a6', separator: '#d8d8dc', fill: '#ececf0', fill2: '#e3e3e8', green: '#1f8a4c', orange: '#b86e00', blue: '#066AB5', red: RED, onRed: '#ffffff' };
const androidDark = { bg: '#000000', grouped: '#000000', cell: '#1c1c1e', label: '#f2f2f7', label2: '#a1a1a6', label3: '#6b6b70', separator: '#38383a', fill: '#2c2c2e', fill2: '#3a3a3c', green: '#4cc27f', orange: '#e0a040', blue: '#4ea3e6', red: '#ff5a5b', onRed: '#ffffff' };

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  if (Platform.OS === 'ios') return ios;
  return dark ? androidDark : androidLight;
}

// Type ramp after iOS text styles (size / line height / weight / tracking).
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.4 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.36 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: 0.38 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.43 },
  body: { fontSize: 17, lineHeight: 24, letterSpacing: -0.43 },
  callout: { fontSize: 16, lineHeight: 21, letterSpacing: -0.31 },
  subhead: { fontSize: 15, lineHeight: 20, letterSpacing: -0.23 },
  footnote: { fontSize: 13, lineHeight: 18, letterSpacing: -0.08 },
  caption: { fontSize: 12, lineHeight: 16 },
};
