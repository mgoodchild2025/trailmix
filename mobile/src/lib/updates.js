// Android copies are installed from a download, not a store, so they check GitHub for a
// newer build themselves. Android releases are tagged android-v<version> on the
// Trailmix repo and carry the signed .apk.
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const RELEASES = 'https://api.github.com/repos/mgoodchild2025/trailmix/releases?per_page=30';

const parts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// { version, url } when a newer Android build is published, else null.
export async function checkForAndroidUpdate() {
  if (Platform.OS !== 'android') return null;
  try {
    const res = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const rel = (await res.json()).find((r) => !r.draft && r.tag_name?.startsWith('android-v'));
    const apk = rel?.assets?.find((a) => a.name.endsWith('.apk'));
    const version = rel?.tag_name.slice('android-v'.length);
    return apk && isNewer(version, Constants.expoConfig?.version) ? { version, url: apk.browser_download_url } : null;
  } catch {
    return null; // offline: try again next launch
  }
}
