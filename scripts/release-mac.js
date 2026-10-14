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
console.log(`\nDone. Publish with: npm run release:publish`);
