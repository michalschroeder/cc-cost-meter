#!/usr/bin/env node
'use strict';
// Grade eval runs against evals.json assertions. Pure functions + a small CLI.
//   node evals/check.js evals/runs/iteration-1
const fs = require('fs');
const path = require('path');

const cardText = (c) => ['title', 'what', 'why', 'how'].map((k) => String(c[k] || '')).join(' ');
const allCardText = (a) => (Array.isArray(a.cards) ? a.cards : []).map(cardText).join('\n');

// One assertion → { text, passed, evidence }.
function checkOne(a, fixture, as) {
  const rating = Number(a.rating);
  const cards = Array.isArray(a.cards) ? a.cards : [];
  switch (as.type) {
    case 'rating_in':
      return { text: `rating in ${as.min}–${as.max}`, passed: rating >= as.min && rating <= as.max, evidence: `rating ${rating}` };
    case 'rating_near_band': {
      const band = Number(fixture && fixture.summary && fixture.summary.avoidable && fixture.summary.avoidable.band);
      const ok = Number.isFinite(band) && Math.abs(rating - band) <= (as.tolerance == null ? 1 : as.tolerance);
      return { text: `rating within ±${as.tolerance == null ? 1 : as.tolerance} of computed band`, passed: ok, evidence: `rating ${rating} vs band ${band}` };
    }
    case 'card_mentions': {
      const re = new RegExp(as.pattern, as.flags || '');
      const hit = cards.find((c) => re.test(cardText(c)));
      return { text: `some card matches /${as.pattern}/`, passed: !!hit, evidence: hit ? `card "${hit.title}"` : 'no card matched' };
    }
    case 'no_card_mentions': {
      const re = new RegExp(as.pattern, as.flags || '');
      const hit = cards.find((c) => re.test(cardText(c)));
      return { text: `no card matches /${as.pattern}/`, passed: !hit, evidence: hit ? `card "${hit.title}" matched` : 'none matched' };
    }
    case 'no_jargon': {
      const text = allCardText(a).toLowerCase();
      const found = (as.words || []).filter((w) => text.includes(String(w).toLowerCase()));
      return { text: `no jargon (${(as.words || []).join(', ')})`, passed: found.length === 0, evidence: found.length ? `found: ${found.join(', ')}` : 'clean' };
    }
    case 'cards_between':
      return { text: `${as.min}–${as.max} cards`, passed: cards.length >= as.min && cards.length <= as.max, evidence: `${cards.length} cards` };
    case 'has_good_card': {
      const ok = cards.some((c) => c.verdict === 'good');
      return { text: 'at least one good card', passed: ok, evidence: ok ? 'present' : 'no good card' };
    }
    default:
      return { text: `unknown assertion ${as.type}`, passed: false, evidence: 'unsupported type' };
  }
}

function checkRun(assessment, fixture, assertions) {
  return (assertions || []).map((as) => checkOne(assessment || {}, fixture, as));
}

// rows: [{ name, run, rating, results:[{passed}] }] → per-case pass rate + rating spread.
function summarize(rows) {
  const byName = new Map();
  for (const r of rows) {
    const c = byName.get(r.name) || { name: r.name, runs: 0, passed: 0, total: 0, ratings: [] };
    c.runs += 1; c.ratings.push(r.rating);
    for (const x of r.results) { c.total += 1; if (x.passed) c.passed += 1; }
    byName.set(r.name, c);
  }
  const cases = [...byName.values()].map((c) => {
    const nums = c.ratings.filter(Number.isFinite);
    return { name: c.name, runs: c.runs, passRate: c.total ? c.passed / c.total : 0, ratings: c.ratings,
      spread: nums.length ? Math.max(...nums) - Math.min(...nums) : 0 };
  });
  return { cases, total: cases.length ? cases.reduce((a, c) => a + c.passRate, 0) / cases.length : 0 };
}

function main(runsDir) {
  const here = __dirname;
  const evals = JSON.parse(fs.readFileSync(path.join(here, 'evals.json'), 'utf8')).evals;
  const rows = [];
  for (const e of evals) {
    const dir = path.join(runsDir, e.name);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort(); } catch { /* no runs */ }
    const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', `${e.name}.grader.json`), 'utf8'));
    for (const f of files) {
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const results = checkRun(a, fixture, e.assertions);
      rows.push({ name: e.name, run: f, rating: Number(a.rating), results });
      fs.writeFileSync(path.join(dir, f.replace(/\.json$/, '.grading.json')), JSON.stringify({ expectations: results }, null, 2) + '\n');
    }
  }
  const s = summarize(rows);
  let bad = false;
  for (const c of s.cases) {
    const flag = c.passRate < 1 || c.spread > 1;
    if (flag) bad = true;
    console.log(`${flag ? 'FAIL' : 'ok  '} ${c.name}: runs=${c.runs} pass=${Math.round(c.passRate * 100)}% ratings=[${c.ratings.join(',')}] spread=${c.spread}`);
  }
  for (const r of rows) for (const x of r.results) if (!x.passed) console.log(`  - ${r.name}/${r.run}: ${x.text} — ${x.evidence}`);
  console.log(`overall pass ${Math.round(s.total * 100)}%`);
  process.exit(bad ? 1 : 0);
}

if (require.main === module) {
  if (!process.argv[2]) { console.error('usage: check.js <runsDir>'); process.exit(2); }
  main(path.resolve(process.argv[2]));
}

module.exports = { checkRun, summarize };
