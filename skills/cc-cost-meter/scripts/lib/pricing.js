'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUNDLED = path.join(__dirname, '..', '..', 'data', 'model_prices.json');

// Valid per-token rate: finite, non-negative; clamp >1 down to 1. Else null.
function sanitizeRate(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return null;
  return v > 1 ? 1 : v;
}

// Build a {modelKey: costs} map from a LiteLLM-shaped object. Requires valid
// input+output rates; applies fallbacks; indexes provider-stripped aliases
// (first write wins, so direct-provider entries beat re-hosters).
function buildMap(rawObj) {
  const map = {};
  const put = (k, v) => { if (k && !(k in map)) map[k] = v; };
  for (const [name, e] of Object.entries(rawObj || {})) {
    if (!e || typeof e !== 'object') continue;
    const input = sanitizeRate(e.input_cost_per_token);
    const output = sanitizeRate(e.output_cost_per_token);
    if (input == null || output == null) continue;
    const cacheWrite = sanitizeRate(e.cache_creation_input_token_cost);
    const cacheRead = sanitizeRate(e.cache_read_input_token_cost);
    // 1-hour-TTL cache-write rate: LiteLLM's field when present, else calculateCost
    // falls back to cacheWrite × 1.6 (Anthropic's 2×/1.25× ratio).
    const cacheWrite1h = sanitizeRate(e.cache_creation_input_token_cost_above_1hr);
    const val = {
      input, output,
      cacheWrite: cacheWrite == null ? input * 1.25 : cacheWrite,
      cacheRead: cacheRead == null ? input * 0.1 : cacheRead,
      // No pricing source publishes a fast-mode rate, so this stays 1 and
      // `usage.speed === 'fast'` calls are priced at normal rates — a known
      // undercount if fast mode carries a premium.
      fastMultiplier: 1,
      webSearch: 0.01,
    };
    if (cacheWrite1h != null) val.cacheWrite1h = cacheWrite1h;
    // Long-context (>200K input) premium tier. Anthropic charges higher rates when
    // a request's input exceeds 200K tokens (the 1M-context tier). Captured only
    // when present; each field falls back to its base rate. calculateCost selects
    // this tier per-call by prompt size.
    const bigIn = sanitizeRate(e.input_cost_per_token_above_200k_tokens);
    const bigOut = sanitizeRate(e.output_cost_per_token_above_200k_tokens);
    const bigCW = sanitizeRate(e.cache_creation_input_token_cost_above_200k_tokens);
    const bigCR = sanitizeRate(e.cache_read_input_token_cost_above_200k_tokens);
    if (bigIn != null || bigOut != null || bigCW != null || bigCR != null) {
      val.above200k = {
        input: bigIn == null ? val.input : bigIn,
        output: bigOut == null ? val.output : bigOut,
        cacheWrite: bigCW == null ? val.cacheWrite : bigCW,
        cacheRead: bigCR == null ? val.cacheRead : bigCR,
      };
    }
    put(name, val);
    const slash = name.indexOf('/');
    if (slash !== -1) put(name.slice(slash + 1), val);
  }
  return map;
}

// A payload is usable only if it prices at least one Claude model — the real
// invariant this tool depends on. Rejects CDN/error bodies, schema renames, and
// tables whose Claude entries all have malformed rates (dropped by buildMap). A
// model-count threshold can't work: the curated bundled snapshot has ~5 keys
// while the live LiteLLM table has hundreds, so no single count is safe.
function isUsablePriceTable(raw) {
  const map = buildMap(raw);
  return Object.keys(map).some((k) => k.startsWith('claude-'));
}

// Resolve message.model → costs object, or null (unknown/local → $0).
function getModelCosts(map, model) {
  if (!model) return null;
  if (model.includes(':') || /-(q4|bf16|fp16|gguf|f16|f32)$/.test(model)) return null;
  // Strip a context-tier suffix ("claude-opus-5[1m]") — no pricing source keys
  // the 1M variant separately; the >200K premium is applied per-call via above200k.
  const name = model.replace(/\[[^\]]*\]$/, '').replace(/@.*$/, '').replace(/-\d{8}$/, '');
  if (map[name]) return map[name];
  if (map[model]) return map[model];
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) { if (name === k || name.startsWith(k + '-')) return map[k]; }
  return null;
}

// Short deterministic hash of the rate map — cache invalidation key.
function hashMap(map) {
  const h = crypto.createHash('sha1');
  for (const k of Object.keys(map).sort()) {
    const v = map[k];
    const b = v.above200k;
    const big = b ? `|${b.input},${b.output},${b.cacheWrite},${b.cacheRead}` : '';
    const cw1h = v.cacheWrite1h != null ? `|1h:${v.cacheWrite1h}` : '';
    h.update(`${k}:${v.input},${v.output},${v.cacheWrite},${v.cacheRead}${big}${cw1h}`);
  }
  return h.digest('hex').slice(0, 12);
}

// Load the bundled LiteLLM price snapshot. Offline by design: the analyzer never
// fetches, so a price refresh means updating data/model_prices.json in the skill.
function loadPricing() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(BUNDLED, 'utf8')); } catch { raw = {}; }
  if (!isUsablePriceTable(raw)) raw = {};
  const map = buildMap(raw);
  return { map, pricingHash: hashMap(map) };
}

module.exports = { sanitizeRate, buildMap, isUsablePriceTable, getModelCosts, hashMap, loadPricing };
