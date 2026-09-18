'use strict';
// Unit tests for the price-snapshot sync policy (scripts/sync-prices.js).
// Pure: syncSnapshot never touches the network or disk.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { syncSnapshot, serialize } = require('../sync-prices.js');

const SNAPSHOT = path.join(__dirname, '..', '..', 'data', 'model_prices.json');
const rates = (over) => Object.assign({
  input_cost_per_token: 0.000005,
  output_cost_per_token: 0.000025,
  cache_creation_input_token_cost: 0.00000625,
  cache_read_input_token_cost: 5e-7,
  cache_creation_input_token_cost_above_1hr: 0.00001,
}, over);

test('rate drift is pulled from upstream and reported', () => {
  const snap = { 'claude-opus-5': rates() };
  const up = { 'claude-opus-5': rates({ cache_read_input_token_cost: 2.5e-7 }) };
  const { next, changes } = syncSnapshot(snap, up);
  assert.equal(next['claude-opus-5'].cache_read_input_token_cost, 2.5e-7);
  assert.equal(changes.length, 1);
  assert.match(changes[0], /^claude-opus-5: cache_read_input_token_cost /);
});

test('upstream is also matched under an anthropic/ prefix', () => {
  const snap = { 'claude-sonnet-5': rates() };
  const up = { 'anthropic/claude-sonnet-5': rates({ output_cost_per_token: 0.00003 }) };
  assert.equal(syncSnapshot(snap, up).next['claude-sonnet-5'].output_cost_per_token, 0.00003);
});

test('above-200k rates are added and removed with upstream', () => {
  const snap = { 'claude-sonnet-5': rates({ input_cost_per_token_above_200k_tokens: 0.000006 }) };
  const up = { 'claude-sonnet-5': rates({ output_cost_per_token_above_200k_tokens: 0.0000225 }) };
  const { next, changes } = syncSnapshot(snap, up);
  assert.equal(next['claude-sonnet-5'].input_cost_per_token_above_200k_tokens, undefined);
  assert.equal(next['claude-sonnet-5'].output_cost_per_token_above_200k_tokens, 0.0000225);
  assert.equal(changes.filter((c) => /removed$/.test(c)).length, 1);
  assert.equal(changes.filter((c) => /added$/.test(c)).length, 1);
});

test('a newer generation of a known tier is added, older gens and aliases are not', () => {
  const snap = { 'claude-opus-5': rates(), 'claude-opus-4-1': rates() };
  const up = {
    'claude-opus-5': rates(),
    'claude-opus-4-1': rates(),
    'claude-opus-5-1': rates(),            // newer → added
    'claude-opus-4-5': rates(),            // older gen → skipped
    'claude-opus-5-1-20260901': rates(),   // dated alias → skipped
    'claude-nova-9': rates(),              // unknown tier → skipped
    'openrouter/anthropic/claude-opus-5-1': rates(), // re-hoster → skipped
  };
  const { next, changes } = syncSnapshot(snap, up);
  assert.deepEqual(Object.keys(next), ['claude-opus-5-1', 'claude-opus-5', 'claude-opus-4-1']);
  assert.equal(changes.length, 1);
  assert.match(changes[0], /^claude-opus-5-1: added \(new opus generation\)$/);
});

test('a key upstream no longer carries is left untouched', () => {
  const snap = { 'claude-gone-1': rates({ input_cost_per_token: 0.42 }) };
  const { next, changes } = syncSnapshot(snap, {});
  assert.equal(next['claude-gone-1'].input_cost_per_token, 0.42);
  assert.equal(changes.length, 0);
});

test('malformed upstream rates are ignored, ours kept', () => {
  const snap = { 'claude-opus-5': rates() };
  const up = { 'claude-opus-5': rates({ input_cost_per_token: 'free', output_cost_per_token: -1 }) };
  const { next, changes } = syncSnapshot(snap, up);
  assert.equal(next['claude-opus-5'].input_cost_per_token, 0.000005);
  assert.equal(next['claude-opus-5'].output_cost_per_token, 0.000025);
  assert.equal(changes.length, 0);
});

test('a no-change sync round-trips the bundled snapshot byte for byte', () => {
  const before = fs.readFileSync(SNAPSHOT, 'utf8');
  const { next, changes } = syncSnapshot(JSON.parse(before), {});
  assert.equal(changes.length, 0);
  assert.equal(serialize(next), before);
});
