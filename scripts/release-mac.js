// Builds, signs and notarises the Mac app, then adds it to the draft GitHub Release that
// the Windows CI job creates for this version. Waiting for that draft (instead of letting
// electron-builder create one) avoids ending up with two drafts for the same tag.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tag = `v${version}`;
const repo = 'mgoodchild2025/trailmix';
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', ...opts });

console.log(`Building Trailmix ${version} for macOS…`);
sh('npx vite build', { stdio: 'inherit' });
sh('npx electron-builder --mac --universal --publish never', {
  stdio: 'inherit',
  env: { ...process.env, APPLE_KEYCHAIN_PROFILE: 'trailmix-notary' },
});

// electron-builder notarises the app but not the disk image; do that too, so a .dmg
// downloaded from GitHub opens without a Gatekeeper warning. Stapling changes the file,
// so refresh its checksum in latest-mac.yml.
const dmg = `release/Trailmix-${version}-universal.dmg`;
console.log('\nNotarising the disk image…');
sh(`xcrun notarytool submit "${dmg}" --keychain-profile trailmix-notary --wait`, { stdio: 'inherit' });
sh(`xcrun stapler staple "${dmg}"`, { stdio: 'inherit' });
{
  const { createHash } = await import('node:crypto');
  const buf = fs.readFileSync(dmg);
  const sha = createHash('sha512').update(buf).digest('base64');
  const yml = fs.readFileSync('release/latest-mac.yml', 'utf8');
  const entry = new RegExp(`(- url: Trailmix-${version.replace(/\./g, '\\.')}-universal\\.dmg\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`);
  if (!entry.test(yml)) throw new Error('Could not find the .dmg entry in latest-mac.yml');
  fs.writeFileSync('release/latest-mac.yml', yml.replace(entry, (_m, a, b) => `${a}${sha}${b}${buf.length}`));
}

const files = [
  'latest-mac.yml',
  `Trailmix-${version}-universal-mac.zip`,
  `Trailmix-${version}-universal-mac.zip.blockmap`,
  `Trailmix-${version}-universal.dmg`,
  `Trailmix-${version}-universal.dmg.blockmap`,
].map((f) => `release/${f}`);
for (const f of files) if (!fs.existsSync(f)) throw new Error(`Missing build output: ${f}`);

console.log(`\nWaiting for the Windows build to create draft ${tag} (push the tag first)…`);
let release;
for (let i = 0; i < 60 && !release; i++) {
  const all = JSON.parse(sh(`gh api repos/${repo}/releases`));
  release = all.find((r) => r.tag_name === tag && r.assets.some((a) => a.name === 'latest.yml'));
  if (!release) await new Promise((r) => setTimeout(r, 30_000));
}
if (!release) throw new Error(`No draft ${tag} with Windows files after 30 minutes. Check GitHub Actions.`);

for (const f of files) {
  const name = f.split('/').pop();
  const existing = release.assets.find((a) => a.name === name);
  if (existing) sh(`gh api --method DELETE repos/${repo}/releases/assets/${existing.id}`);
  sh(
    `gh api --method POST -H "Content-Type: application/octet-stream" "https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}" --input "${f}" --silent`,
  );
  console.log(`  uploaded ${name}`);
}
// macOS registers every built copy as a trailmix:// handler and may then open links in
// one of these build folders instead of /Applications. Unregister them.
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
for (const dir of fs.readdirSync('release').filter((d) => d.startsWith('mac'))) {
  try {
    sh(`"${lsregister}" -u "release/${dir}/Trailmix.app"`);
  } catch {}
}

console.log(`\nDone. Publish with: npm run release:publish`);
