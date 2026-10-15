#!/usr/bin/env node
// Small App Store Connect API helper for Trailmix's TestFlight builds.
//
// Auth: an App Store Connect API key (App Manager). The private key stays in
// ~/.private_keys/AuthKey_<KEY_ID>.p8 (mode 600); this script only uses it to sign a
// 20-minute token and never prints it. Key ID and Issuer ID are identifiers, not secrets.
//
//   node scripts/asc.mjs status                  app, recent builds, groups, review info
//   node scripts/asc.mjs wait <build>            wait until a build has finished processing
//   node scripts/asc.mjs whats-new <build> <text>
//   node scripts/asc.mjs ensure-group <name>     create the external group if missing
//   node scripts/asc.mjs add <build> <group>     add a build to a group
//   node scripts/asc.mjs review-info             set beta description / review notes (see below)
//   node scripts/asc.mjs submit <build>          submit a build for Beta App Review
//   node scripts/asc.mjs reviews                 review state and groups of recent builds
//   node scripts/asc.mjs public-link <group> on|off
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEY_ID = process.env.ASC_KEY_ID || 'R4RRZDN7S8';
const ISSUER = process.env.ASC_ISSUER_ID || '332f6085-9569-4d59-92f0-09e19da628cd';
const KEY_PATH = process.env.ASC_KEY_PATH || path.join(os.homedir(), '.private_keys', `AuthKey_${KEY_ID}.p8`);
const BUNDLE_ID = 'com.cgtechnologies.trailmix.mobile';
const API = 'https://api.appstoreconnect.apple.com';

const b64url = (b) => Buffer.from(b).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: fs.readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}

async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.errors?.map((x) => `${x.title}: ${x.detail}`).join('; ') || res.statusText;
    throw new Error(`${method} ${p} -> ${res.status} ${e}`);
  }
  return json;
}

async function app() {
  const r = await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}&fields[apps]=name,bundleId`);
  if (!r.data.length) throw new Error(`No App Store Connect app with bundle ID ${BUNDLE_ID}`);
  return r.data[0];
}

async function build(appId, number) {
  const r = await api('GET', `/v1/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(number)}&fields[builds]=version,processingState,expired,uploadedDate,usesNonExemptEncryption&limit=1`);
  if (!r.data.length) throw new Error(`Build ${number} not found (it may still be uploading)`);
  return r.data[0];
}

async function groups(appId) {
  return (await api('GET', `/v1/apps/${appId}/betaGroups?fields[betaGroups]=name,isInternalGroup,publicLinkEnabled,publicLink&limit=50`)).data;
}

async function group(appId, name) {
  const g = (await groups(appId)).find((x) => x.attributes.name === name);
  if (!g) throw new Error(`No tester group named "${name}"`);
  return g;
}

const [cmd, ...args] = process.argv.slice(2);
const a = await app();

switch (cmd) {
  case 'status': {
    console.log(`App: ${a.attributes.name} (${a.attributes.bundleId}) id ${a.id}`);
    const b = await api('GET', `/v1/builds?filter[app]=${a.id}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,expired,uploadedDate`);
    for (const x of b.data) console.log(`  build ${x.attributes.version}: ${x.attributes.processingState}${x.attributes.expired ? ' (expired)' : ''}, uploaded ${x.attributes.uploadedDate}`);
    for (const g of await groups(a.id)) console.log(`  group "${g.attributes.name}" ${g.attributes.isInternalGroup ? 'internal' : 'external'}${g.attributes.publicLinkEnabled ? ` public link ${g.attributes.publicLink}` : ''}`);
    const loc = await api('GET', `/v1/apps/${a.id}/betaAppLocalizations`);
    console.log(`  beta description: ${loc.data.map((l) => `${l.attributes.locale}: ${l.attributes.description ? 'set' : 'missing'}, feedback email ${l.attributes.feedbackEmail ? 'set' : 'missing'}`).join(' | ') || 'none'}`);
    const rd = await api('GET', `/v1/apps/${a.id}/betaAppReviewDetail`);
    const r = rd.data.attributes;
    console.log(`  review contact: name ${r.contactFirstName ? 'set' : 'missing'}, email ${r.contactEmail ? 'set' : 'missing'}, phone ${r.contactPhone ? 'set' : 'missing'}; notes ${r.notes ? 'set' : 'missing'}; demo account required: ${r.demoAccountRequired}`);
    break;
  }
  case 'wait': {
    for (let i = 0; i < 90; i++) {
      const b = await build(a.id, args[0]).catch(() => null);
      const st = b?.attributes.processingState || 'NOT_FOUND';
      if (st === 'VALID') {
        console.log(`build ${args[0]} is processed`);
        process.exit(0);
      }
      if (st === 'FAILED' || st === 'INVALID') throw new Error(`build ${args[0]} processing ${st}`);
      if (i % 4 === 0) console.log(`build ${args[0]}: ${st}…`);
      await new Promise((r) => setTimeout(r, 20000));
    }
    throw new Error('Timed out waiting for processing');
  }
  case 'whats-new': {
    const b = await build(a.id, args[0]);
    const text = args.slice(1).join(' ');
    const locs = (await api('GET', `/v1/builds/${b.id}/betaBuildLocalizations`)).data;
    const en = locs.find((l) => l.attributes.locale.startsWith('en'));
    if (en) await api('PATCH', `/v1/betaBuildLocalizations/${en.id}`, { data: { type: 'betaBuildLocalizations', id: en.id, attributes: { whatsNew: text } } });
    else await api('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-GB', whatsNew: text }, relationships: { build: { data: { type: 'builds', id: b.id } } } } });
    console.log(`What to Test set for build ${args[0]}`);
    break;
  }
  case 'ensure-group': {
    const name = args.join(' ');
    const g = (await groups(a.id)).find((x) => x.attributes.name === name);
    if (g) console.log(`group "${name}" exists (${g.attributes.isInternalGroup ? 'internal' : 'external'})`);
    else {
      await api('POST', '/v1/betaGroups', { data: { type: 'betaGroups', attributes: { name, publicLinkEnabled: false }, relationships: { app: { data: { type: 'apps', id: a.id } } } } });
      console.log(`created external group "${name}"`);
    }
    break;
  }
  case 'add': {
    const b = await build(a.id, args[0]);
    const g = await group(a.id, args.slice(1).join(' '));
    await api('POST', `/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: 'builds', id: b.id }] });
    console.log(`added build ${args[0]} to "${g.attributes.name}"`);
    break;
  }
  case 'review-info': {
    // Reads the text to send from scripts/testflight-review.json (no personal data in code).
    const info = JSON.parse(fs.readFileSync(new URL('./testflight-review.json', import.meta.url), 'utf8'));
    // Only fields present in the file are sent; anything already set in App Store Connect
    // and not in the file is left as it is.
    const attrs = {};
    if (info.description) attrs.description = info.description;
    if (info.feedbackEmail) attrs.feedbackEmail = info.feedbackEmail;
    if (Object.keys(attrs).length) {
      const locs = (await api('GET', `/v1/apps/${a.id}/betaAppLocalizations`)).data;
      const en = locs.find((l) => l.attributes.locale.startsWith('en'));
      if (en) await api('PATCH', `/v1/betaAppLocalizations/${en.id}`, { data: { type: 'betaAppLocalizations', id: en.id, attributes: attrs } });
      else await api('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale: 'en-GB', ...attrs }, relationships: { app: { data: { type: 'apps', id: a.id } } } } });
    }
    const rd = await api('GET', `/v1/apps/${a.id}/betaAppReviewDetail`);
    const review = {};
    if (info.reviewNotes) review.notes = info.reviewNotes;
    if (info.demoAccountRequired !== undefined) review.demoAccountRequired = info.demoAccountRequired;
    for (const k of ['contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone']) if (info[k]) review[k] = info[k];
    await api('PATCH', `/v1/betaAppReviewDetails/${rd.data.id}`, { data: { type: 'betaAppReviewDetails', id: rd.data.id, attributes: review } });
    console.log(`saved: ${[...Object.keys(attrs), ...Object.keys(review)].join(', ')}`);
    break;
  }
  case 'submit': {
    const b = await build(a.id, args[0]);
    await api('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: b.id } } } } });
    console.log(`build ${args[0]} submitted for Beta App Review`);
    break;
  }
  case 'expire': {
    // Removes a build from TestFlight (and from beta review). Can't be undone for that build.
    const b = await build(a.id, args[0]);
    await api('PATCH', `/v1/builds/${b.id}`, { data: { type: 'builds', id: b.id, attributes: { expired: true } } });
    console.log(`build ${args[0]} expired`);
    break;
  }
  case 'reviews': {
    // Beta App Review state of recent builds (and which group each build is in).
    const b = await api('GET', `/v1/builds?filter[app]=${a.id}&sort=-uploadedDate&limit=10&fields[builds]=version`);
    for (const x of b.data) {
      const r = await api('GET', `/v1/builds/${x.id}/betaAppReviewSubmission`).catch(() => null);
      // Apple doesn't list a build's groups from the build side; ask each group instead.
      const g = { data: [] };
      for (const grp of await groups(a.id)) {
        const inG = await api('GET', `/v1/betaGroups/${grp.id}/builds?fields[builds]=version&limit=50`).catch(() => ({ data: [] }));
        if (inG.data.some((y) => y.id === x.id)) g.data.push(grp);
      }
      const state = r?.data?.attributes?.betaReviewState || 'not submitted';
      console.log(`  build ${x.attributes.version}: ${state}${r?.data?.attributes?.submittedDate ? ` (submitted ${r.data.attributes.submittedDate})` : ''}; groups: ${g.data.map((y) => y.attributes.name).join(', ') || 'none'}`);
    }
    break;
  }
  case 'public-link': {
    const g = await group(a.id, args.slice(0, -1).join(' '));
    const on = args.at(-1) === 'on';
    const r = await api('PATCH', `/v1/betaGroups/${g.id}`, { data: { type: 'betaGroups', id: g.id, attributes: { publicLinkEnabled: on, publicLinkLimitEnabled: false } } });
    console.log(on ? `public link: ${r.data.attributes.publicLink}` : 'public link off');
    break;
  }
  default:
    console.log('commands: status | reviews | expire <build> | wait <build> | whats-new <build> <text> | ensure-group <name> | add <build> <group> | review-info | submit <build> | public-link <group> on|off');
}
