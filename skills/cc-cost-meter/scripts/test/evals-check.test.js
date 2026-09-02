'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { checkRun, summarize } = require(path.join(__dirname, '..', '..', 'evals', 'check.js'));

const fixture = { summary: { avoidable: { band: 2 } } };
const good = { rating: 2, headline: 'h', cards: [
  { verdict: 'bad', title: 'Compact after turn 9', what: 'w', why: 'y', how: 'type /compact after turn 9' },
  { verdict: 'good', title: 'Delegated', what: 'w', why: 'y', how: 'keep it' },
  { verdict: 'warn', title: 'Batch', what: 'ran tools one at a time', why: 'y', how: 'run reads at once' },
] };

test('check: every assertion type passes on a conforming run', () => {
  const r = checkRun(good, fixture, [
    { type: 'rating_in', min: 1, max: 2 },
    { type: 'rating_near_band', tolerance: 1 },
    { type: 'card_mentions', pattern: 'after turn \\d+', flags: 'i' },
    { type: 'no_card_mentions', pattern: 'auto-?compact', flags: 'i' },
    { type: 'no_jargon', words: ['cache_read'] },
    { type: 'cards_between', min: 3, max: 6 },
    { type: 'has_good_card' },
  ]);
  assert.strictEqual(r.length, 7);
  assert.ok(r.every((x) => x.passed), JSON.stringify(r.filter((x) => !x.passed)));
  assert.ok(r.every((x) => typeof x.text === 'string' && typeof x.evidence === 'string'));
});

test('check: failures carry evidence', () => {
  const bad = { rating: 4, cards: [{ verdict: 'warn', title: 't', what: 'the cache_read line dominated', why: '', how: '' }] };
  const r = checkRun(bad, fixture, [
    { type: 'rating_near_band', tolerance: 1 },
    { type: 'no_jargon', words: ['cache_read'] },
    { type: 'has_good_card' },
    { type: 'cards_between', min: 3, max: 6 },
  ]);
  assert.deepStrictEqual(r.map((x) => x.passed), [false, false, false, false]);
  assert.match(r[0].evidence, /rating 4 vs band 2/);
  assert.match(r[1].evidence, /cache_read/);
});

test('summarize: pass rate and rating spread per case', () => {
  const s = summarize([
    { name: 'a', run: 'run-1', rating: 2, results: [{ passed: true }, { passed: true }] },
    { name: 'a', run: 'run-2', rating: 4, results: [{ passed: true }, { passed: false }] },
  ]);
  assert.strictEqual(s.cases[0].name, 'a');
  assert.strictEqual(s.cases[0].runs, 2);
  assert.strictEqual(s.cases[0].passRate, 0.75);
  assert.deepStrictEqual(s.cases[0].ratings, [2, 4]);
  assert.strictEqual(s.cases[0].spread, 2);
});
