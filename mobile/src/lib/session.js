// CG Core sign-in on the phone. The device token lives in the iOS Keychain / Android
// Keystore (expo-secure-store); nothing else secret is kept on the phone.
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { CoreClient, CORE_URLS, connectUrl, parseConnectLink, pair } from '../../../shared/core.js';

const TOKEN = 'trailmix.coreToken';
const INFO = 'trailmix.coreInfo';
const URL_KEY = 'trailmix.coreUrl';

let state = { loaded: false, url: CORE_URLS.production, token: null, info: null };
const listeners = new Set();
const emit = () => listeners.forEach((cb) => cb(state));

export const subscribeSession = (cb) => (listeners.add(cb), () => listeners.delete(cb));
export const getSession = () => state;

export async function loadSession() {
  const [token, info, url] = await Promise.all([SecureStore.getItemAsync(TOKEN), SecureStore.getItemAsync(INFO), SecureStore.getItemAsync(URL_KEY)]);
  state = { loaded: true, token, info: info ? JSON.parse(info) : null, url: url || CORE_URLS.production };
  emit();
  if (token) refreshSession();
  return state;
}

export function coreClient() {
  return state.token ? new CoreClient({ baseUrl: state.url, token: state.token }) : null;
}

const deviceName = () => Constants.deviceName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');

// Opens CG Core in a browser sheet; CG Core sends back trailmix://connect?code=&state=.
export async function signIn(server = 'production') {
  const base = CORE_URLS[server];
  const st = Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  const result = await WebBrowser.openAuthSessionAsync(connectUrl(base, { state: st, device: deviceName(), platform: Platform.OS }), 'trailmix://connect');
  if (result.type !== 'success') return { cancelled: true };
  const link = parseConnectLink(result.url);
  if (!link || link.state !== st) throw new Error('That sign-in link is out of date. Try again.');
  const res = await pair(base, { code: link.code, state: st, deviceName: deviceName(), platform: Platform.OS, appVersion: Constants.expoConfig?.version || '0' });
  await SecureStore.setItemAsync(TOKEN, res.token);
  await SecureStore.setItemAsync(URL_KEY, base);
  state = { ...state, token: res.token, url: base, info: { staff: res.staff, device: res.device } };
  emit();
  await refreshSession();
  return { ok: true };
}

export async function refreshSession() {
  const core = coreClient();
  if (!core) return;
  try {
    const info = await core.me();
    state = { ...state, info };
    await SecureStore.setItemAsync(INFO, JSON.stringify(info));
    emit();
  } catch (err) {
    if (err.unauthorized) await signOutLocal();
  }
}

export async function signOut() {
  await coreClient()?.signout().catch(() => {});
  await signOutLocal();
}

async function signOutLocal() {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN), SecureStore.deleteItemAsync(INFO)]);
  state = { ...state, token: null, info: null };
  emit();
}
