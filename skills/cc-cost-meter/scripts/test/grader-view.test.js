'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { graderView } = require('../grader-view');

const detail = {
  session: 's', title: 't', totalCost: 1, steps: 2, legend: 'L', components: { input: 0 },
  byModel: [], byAgent: [], subagents: { total: 0, count: 0 },
  turns: [{ turnIndex: 1, kind: 'user', skill: null, steps: 2, cost: 1, peakContext: 5, avgContext: 4,
    tools: [['Bash', 2]], prompt: 'x'.repeat(1000), tokens: { input: 0 } }],
  calls: [{ seq: 1 }],
  summary: { mainSteps: 2, contextConsumers: { note: 'n', totalEstTokens: 1,
    top: Array.from({ length: 30 }, (_, i) => ({ tool: 'Read', target: 'y'.repeat(1000) + i, estTokens: 30 - i })) } },
};

test('grader-view: drops calls, caps prompts/targets, keeps summary', () => {
  const g = graderView(detail);
  assert.ok(!('calls' in g));
  assert.strictEqual(g.turns[0].prompt.length, 300);
  assert.ok(!('tokens' in g.turns[0]));
  assert.deepStrictEqual(g.turns[0].tools, [['Bash', 2]]);
  assert.strictEqual(g.summary.contextConsumers.top.length, 15);
  assert.strictEqual(g.summary.contextConsumers.top[0].target.length, 300);
  assert.strictEqual(g.summary.mainSteps, 2);
  assert.strictEqual(g.legend, 'L');
  assert.strictEqual(detail.summary.contextConsumers.top.length, 30, 'input not mutated');
});

test('grader-view: tolerates a payload without turns/consumers', () => {
  const g = graderView({ session: 's', summary: {} });
  assert.deepStrictEqual(g.turns, []);
  assert.deepStrictEqual(g.summary, {});
});
