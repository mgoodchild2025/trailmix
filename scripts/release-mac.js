// Builds, signs and notarises the Mac app, then uploads it to the draft GitHub Release
// for the current version (creating the draft if CI hasn't yet). Uses your gh login.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
console.log(`Building Trailmix ${version} for macOS and uploading to draft release v${version}…`);
execSync('npx vite build', { stdio: 'inherit' });
execSync('npx electron-builder --mac --universal --publish always', {
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: token, APPLE_KEYCHAIN_PROFILE: 'trailmix-notary' },
});
console.log(`\nDone. When the Windows build has also uploaded, run: npm run release:publish`);
