// Publishes the draft release for the current version once both platforms are attached.
// Staff apps only see published releases, so nothing reaches them until this runs.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tag = `v${version}`;
const assets = JSON.parse(execSync(`gh release view ${tag} --json assets`, { encoding: 'utf8' })).assets.map((a) => a.name);
const need = { 'latest-mac.yml': 'Mac (run npm run release:mac)', 'latest.yml': 'Windows (wait for the GitHub Actions build)' };
const missing = Object.entries(need).filter(([f]) => !assets.includes(f));
if (missing.length) {
  console.error(`Release ${tag} is missing:\n${missing.map(([f, why]) => `  - ${f}: ${why}`).join('\n')}`);
  process.exit(1);
}
execSync(`gh release edit ${tag} --draft=false --latest`, { stdio: 'inherit' });
console.log(`Published ${tag}. Staff apps will pick it up within 4 hours, or at next launch.`);
