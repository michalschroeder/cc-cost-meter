#!/usr/bin/env node
'use strict';
// Sync the bundled price snapshot (data/model_prices.json) with upstream LiteLLM.
// Run by .github/workflows/sync-prices.yml daily; also usable by hand:
//   node scripts/sync-prices.js            # fetch upstream, rewrite snapshot if drifted
//   node scripts/sync-prices.js --from f   # use a local LiteLLM-shaped JSON instead
// Prints one line per change (the PR body). Writes nothing when in sync.
// This is the ONLY place that touches the network; the analyzer stays offline
// (lib/pricing.js reads the bundled snapshot and never fetches).
//
// Policy — the snapshot stays a curated list of current Claude models:
//   • rates of every existing key mirror upstream (5 base rates incl. the 1h
//     cache-write tier, plus the 4 `*_above_200k_tokens` rates, added/removed
//     as upstream has them)
//   • a key upstream no longer carries is left untouched
//   • a NEW generation — bare `claude-<tier>-<n>[-<m>]`, newer than the newest
//     snapshot key of its tier — is added; older gens / dated aliases are not
const fs = require('fs');
const path = require('path');
const https = require('https');

const SNAPSHOT = path.join(__dirname, '..', 'data', 'model_prices.json');
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const BASE = ['input_cost_per_token', 'output_cost_per_token',
  'cache_creation_input_token_cost', 'cache_read_input_token_cost',
  'cache_creation_input_token_cost_above_1hr'];
const ABOVE = ['input_cost_per_token', 'output_cost_per_token',
  'cache_creation_input_token_cost', 'cache_read_input_token_cost'].map((k) => `${k}_above_200k_tokens`);
const KEY_RE = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?$/; // 1-2 digit parts: a -YYYYMMDD suffix is a dated alias, not a version

const num = (v) => typeof v === 'number' && isFinite(v) && v >= 0;
const parseKey = (k) => { const m = KEY_RE.exec(k); return m && { tier: m[1], ver: [+m[2], +(m[3] || 0)] }; };
const newer = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);

// Rebuild one entry from upstream; returns {entry, changes[]}.
function syncEntry(key, ours, up) {
  const entry = {};
  const changes = [];
  const set = (k, v, from) => {
    if (from !== v) changes.push(`${key}: ${k} ${from === undefined ? 'added' : v === undefined ? 'removed' : `${from} → ${v}`}`);
    if (v !== undefined) entry[k] = v;
  };
  for (const k of BASE) set(k, num(up[k]) ? up[k] : ours[k], ours[k]);
  for (const k of ABOVE) set(k, num(up[k]) ? up[k] : undefined, ours[k]);
  return { entry, changes };
}

// Pure: {next, changes[]} for a snapshot object and a LiteLLM-shaped upstream.
function syncSnapshot(snapshot, upstream) {
  const lookup = (k) => upstream[k] || upstream[`anthropic/${k}`];
  const changes = [];
  const keys = Object.keys(snapshot);
  const next = {};
  for (const key of keys) {
    const up = lookup(key);
    if (!up) { next[key] = snapshot[key]; continue; }
    const r = syncEntry(key, snapshot[key], up);
    next[key] = r.entry;
    changes.push(...r.changes);
  }
  // New generations: newer than the newest snapshot key of the same tier.
  const newest = {};
  for (const key of keys) {
    const p = parseKey(key);
    if (p && (!newest[p.tier] || newer(p.ver, newest[p.tier].ver))) newest[p.tier] = { key, ...p };
  }
  const added = [];
  for (const [key, up] of Object.entries(upstream)) {
    const p = parseKey(key);
    if (!p || key in next || !newest[p.tier] || !newer(p.ver, newest[p.tier].ver)) continue;
    if (!num(up.input_cost_per_token) || !num(up.output_cost_per_token)) continue;
    added.push({ key, tier: p.tier, entry: syncEntry(key, {}, up).entry });
    changes.push(`${key}: added (new ${p.tier} generation)`);
  }
  // Place each new key before the first existing key of its tier (newest first, as the file reads).
  const ordered = {};
  for (const key of keys) {
    const tier = (parseKey(key) || {}).tier;
    const first = keys.find((k) => (parseKey(k) || {}).tier === tier);
    if (key === first) for (const a of added) if (a.tier === tier) ordered[a.key] = a.entry;
    ordered[key] = next[key];
  }
  return { next: ordered, changes };
}

// Node's number formatting is what wrote the snapshot in the first place, so a
// no-change sync is a byte-identical file.
const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'cc-cost-meter sync-prices' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main(argv) {
  const i = argv.indexOf('--from');
  const upstream = i !== -1 ? JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')) : await fetchJson(LITELLM_URL);
  const before = fs.readFileSync(SNAPSHOT, 'utf8');
  const { next, changes } = syncSnapshot(JSON.parse(before), upstream);
  const after = serialize(next);
  if (after === before) { console.error('snapshot in sync'); return; }
  fs.writeFileSync(SNAPSHOT, after);
  console.log(changes.map((c) => `- ${c}`).join('\n'));
}

module.exports = { syncSnapshot, serialize, syncEntry };
if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
