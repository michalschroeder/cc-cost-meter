#!/usr/bin/env node
'use strict';
// Trim an analyze.js DETAIL payload to what the grading subagents need. The full
// payload carries every billed call (hundreds of KB — the chart needs it, a grader
// does not). This keeps every precomputed rollup, the turn list with short prompts,
// and the top consumers, so a strong-model grader reads ~10–20k tokens, not ~120k.
//
//   node scripts/grader-view.js < detail.json > grader.json
const CAP = 300;   // chars kept of each prompt / consumer target
const TOP = 15;    // consumer rows kept

const cap = (s) => String(s == null ? '' : s).slice(0, CAP);

function graderView(d) {
  const turns = (d.turns || []).map((t) => ({
    turnIndex: t.turnIndex, kind: t.kind, skill: t.skill || null, steps: t.steps, cost: t.cost,
    peakContext: t.peakContext, avgContext: t.avgContext, tools: t.tools, prompt: cap(t.prompt),
  }));
  const s = d.summary || {};
  const summary = { ...s };
  if (s.contextConsumers) {
    summary.contextConsumers = { ...s.contextConsumers,
      top: (s.contextConsumers.top || []).slice(0, TOP).map((c) => ({ ...c, target: cap(c.target) })) };
  }
  const { calls, ...rest } = d; // eslint-disable-line no-unused-vars
  return { ...rest, summary, turns };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (s += c));
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', reject);
  });
}

if (require.main === module) {
  readStdin().then((raw) => {
    process.stdout.write(JSON.stringify(graderView(JSON.parse(raw)), null, 2) + '\n');
  }).catch((e) => { process.stderr.write(`grader-view.js: ${e.message}\n`); process.exit(1); });
}

module.exports = { graderView };
