// CG Technologies colours, light and dark.
import { useColorScheme } from 'react-native';

const light = { bg: '#ffffff', side: '#f7f7f9', sunk: '#f2f3f6', ink: '#333333', ink2: '#5b5f66', ink3: '#8a8f98', line: '#ebecf0', line2: '#dcdee4', red: '#E93E3F', redInk: '#c62f30', blue: '#066AB5', ok: '#1f8a4c', warn: '#b86e00', mark: '#fde8e8', onRed: '#ffffff' };
const dark = { bg: '#18191c', side: '#121315', sunk: '#202226', ink: '#e8e9ec', ink2: '#b4b8c0', ink3: '#868b94', line: '#2b2e34', line2: '#3a3e46', red: '#E93E3F', redInk: '#ff6b6c', blue: '#4ea3e6', ok: '#4cc27f', warn: '#e0a040', mark: 'rgba(233,62,63,0.2)', onRed: '#ffffff' };

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}
