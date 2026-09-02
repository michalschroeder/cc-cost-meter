'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ANALYZE = path.join(__dirname, '..', 'analyze.js');
const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function mkProfile() {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-smoke-'));
  tmpDirs.push(cfg);
  return cfg;
}

function writeTranscript(cfg, id, entries, when) {
  const proj = path.join(cfg, 'projects', '-test-proj');
  fs.mkdirSync(proj, { recursive: true });
  const file = path.join(proj, `${id}.jsonl`);
  fs.writeFileSync(file, entries.map((o) => JSON.stringify(o)).join('\n') + '\n');
  if (when != null) { const d = new Date(when * 1000); fs.utimesSync(file, d, d); }
}

function runJson(args, cfg) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg,
      XDG_STATE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'csl-st-')),
      STATUSLINE_PRICING_NO_FETCH: '1',
      STATUSLINE_MONTHLY_BUDGET: '0' };
    tmpDirs.push(env.XDG_STATE_HOME);
    const proc = spawn(process.execPath, [ANALYZE, ...args], { env });
    let out = '', err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
}

// Proven fixture shape from parity test — timestamp required for cost > 0.
const fixture = () => [
  { type: 'user', message: { role: 'user', content: 'do the thing' }, uuid: 'u1' },
  { type: 'assistant', timestamp: '2024-06-01T10:00:00Z',
    message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
      content: [{ type: 'text', text: 'done' }] }, uuid: 'a1' },
];

// Build one billed assistant step. `content` blocks default to a single text block.
function step(id, ts, usage, content, model) {
  return { type: 'assistant', timestamp: ts, uuid: 'a-' + id,
    message: { id, role: 'assistant', model: model || 'claude-sonnet-4-6', usage,
      content: content || [{ type: 'text', text: 'ok' }] } };
}
const user = (text, uuid) => ({ type: 'user', message: { role: 'user', content: text }, uuid });
const toolResult = (toolUseId, text, uuid) => ({ type: 'user', uuid,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text }] } });
const usage = (cacheRead, output, extra) => ({ input_tokens: 0, output_tokens: output,
  cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, ...(extra || {}) });

test('smoke: list payload has the documented top-level keys', async () => {
  const cfg = mkProfile();
  writeTranscript(cfg, 'smoke001', fixture(), 1717200000);
  const out = await runJson(['list'], cfg);
  assert.ok(Array.isArray(out.sessions));
  assert.deepStrictEqual(Object.keys(out.periods).sort(), ['month', 'today', 'week']);
  assert.ok('monthlyBudget' in out);
  assert.strictEqual(out.sessions[0].session, 'smoke001');
});

test('smoke: detail payload exposes the precomputed summary rollups', async () => {
  const cfg = mkProfile();
  writeTranscript(cfg, 'smoke002', fixture(), 1717200000);
  const out = await runJson(['smoke002'], cfg);
  assert.strictEqual(out.session, 'smoke002');
  assert.ok(out.totalCost > 0);
  for (const k of ['contextGrowth', 'byTurnKind', 'toolTally', 'highContextCost', 'contextResets', 'cacheRebuilds', 'contextConsumers', 'assistantOutput', 'bySkill']) {
    assert.ok(k in out.summary, `summary.${k} present`);
  }
  assert.ok('count' in out.summary.cacheRebuilds && 'extraCost' in out.summary.cacheRebuilds);
});

// A subagent's byAgent label prefers its meta.json `description` (the Task tool's
// short summary) over the long, boilerplate-heavy first prompt.
test('smoke: subagent label comes from meta.json description', async () => {
  const cfg = mkProfile();
  const id = 'smoke003';
  writeTranscript(cfg, id, fixture(), 1717200000);
  const subDir = path.join(cfg, 'projects', '-test-proj', id, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const sub = [
    { type: 'user', message: { role: 'user', content: 'You have access to the Datadog MCP tools. The account is already authenticated. Validate ...' }, uuid: 's-u1' },
    { type: 'assistant', timestamp: '2024-06-01T10:05:00Z',
      message: { id: 'sm1', role: 'assistant', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
        content: [{ type: 'text', text: 'ok' }] }, uuid: 's-a1' },
  ];
  fs.writeFileSync(path.join(subDir, 'agent-abc123.jsonl'), sub.map((o) => JSON.stringify(o)).join('\n') + '\n');
  fs.writeFileSync(path.join(subDir, 'agent-abc123.meta.json'),
    JSON.stringify({ agentType: 'general-purpose', description: 'Validate DD error tracking' }));
  const out = await runJson([id], cfg);
  const agent = out.byAgent.find((a) => a.name === 'agent-abc123');
  assert.ok(agent, 'subagent present in byAgent');
  assert.strictEqual(agent.label, 'Validate DD error tracking');
});

// With no meta.json, the label falls back to the first prompt — but a skill-dispatch
// preamble ("Base directory for this skill: …/skills/<name> …") is long boilerplate
// identical across sibling subagents, so it collapses to `skill: <name>`. Also asserts
// byAgent carries a `steps` (billed-call) count.
test('smoke: subagent skill-dispatch label collapses to the skill name + carries steps', async () => {
  const cfg = mkProfile();
  const id = 'smoke00b';
  writeTranscript(cfg, id, fixture(), 1717200000);
  const subDir = path.join(cfg, 'projects', '-test-proj', id, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const step = (uid) => ({ type: 'assistant', timestamp: '2024-06-01T10:05:00Z',
    message: { id: 'sm' + uid, role: 'assistant', model: 'claude-sonnet-4-6',
      usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
      content: [{ type: 'text', text: 'ok' }] }, uuid: 's-a' + uid });
  const sub = [
    { type: 'user', message: { role: 'user', content: 'Base directory for this skill: /home/u/.claude/skills/deep-research\n\n<long preamble>' }, uuid: 's-u1' },
    step(1), step(2),
  ];
  fs.writeFileSync(path.join(subDir, 'agent-def456.jsonl'), sub.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const out = await runJson([id], cfg);
  const agent = out.byAgent.find((a) => a.name === 'agent-def456');
  assert.ok(agent, 'subagent present in byAgent');
  assert.strictEqual(agent.label, 'skill: deep-research');
  assert.strictEqual(agent.steps, 2, 'steps counts billed subagent calls');
});

test('smoke: empty store still emits valid list JSON', async () => {
  const cfg = mkProfile();
  const out = await runJson(['list'], cfg);
  assert.deepStrictEqual(out.sessions, []);
});

// A step's contextSources name the largest things that landed in context right
// before it (top 3, ranked by size) — what got newly written into that step.
test('smoke: main calls expose contextSources for what landed before them', async () => {
  const cfg = mkProfile();
  const entries = [
    { type: 'user', message: { role: 'user', content: 'read the files' }, uuid: 'u1' },
    { type: 'assistant', timestamp: '2024-06-01T10:00:00Z',
      message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/foo.js' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'git log --stat' } },
        ] }, uuid: 'a1' },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'X'.repeat(16000) }, // ~4k tok — bigger
      { type: 'tool_result', tool_use_id: 't2', content: 'Y'.repeat(6000) },  // ~1.5k tok
    ] }, uuid: 'u2' },
    { type: 'assistant', timestamp: '2024-06-01T10:01:00Z',
      message: { id: 'm2', role: 'assistant', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 0, output_tokens: 30, cache_read_input_tokens: 5000, cache_creation_input_tokens: 18000 },
        content: [{ type: 'text', text: 'done' }] }, uuid: 'a2' },
  ];
  writeTranscript(cfg, 'smoke004', entries, 1717200000);
  const out = await runJson(['smoke004'], cfg);
  const mains = out.calls.filter((c) => c.isMain);
  // m1's request was driven by the user prompt that preceded it.
  assert.deepStrictEqual(mains[0].contextSources, [{ tool: 'user-prompt', target: 'read the files' }]);
  // m2's written context = the two tool results that came back, biggest first.
  assert.deepStrictEqual(mains[1].contextSources, [
    { tool: 'Read', target: '/repo/src/foo.js' },
    { tool: 'Bash', target: 'git log --stat' },
  ]);
});

// An AskUserQuestion result is attributed to the question it asked, so the tooltip
// can say which one — toolTarget pulls the first question's text.
test('smoke: AskUserQuestion context source carries the question asked', async () => {
  const cfg = mkProfile();
  const entries = [
    { type: 'user', message: { role: 'user', content: 'ask me something' }, uuid: 'u1' },
    { type: 'assistant', timestamp: '2024-06-01T10:00:00Z',
      message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
        content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion',
          input: { questions: [{ question: 'Pick format A or B?', header: 'Format' }] } }] }, uuid: 'a1' },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'q1', content: 'A'.repeat(800) },
    ] }, uuid: 'u2' },
    { type: 'assistant', timestamp: '2024-06-01T10:01:00Z',
      message: { id: 'm2', role: 'assistant', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 0, output_tokens: 30, cache_read_input_tokens: 5000, cache_creation_input_tokens: 18000 },
        content: [{ type: 'text', text: 'done' }] }, uuid: 'a2' },
  ];
  writeTranscript(cfg, 'smoke005', entries, 1717200000);
  const out = await runJson(['smoke005'], cfg);
  const mains = out.calls.filter((c) => c.isMain);
  assert.deepStrictEqual(mains[1].contextSources, [{ tool: 'AskUserQuestion', target: 'Pick format A or B?' }]);
});

// Thinking is attributed only to steps that carry a thinking block. m1 has one
// (empty text — Claude Code stores the block, not the text); m2 has none, so its
// output beyond chars/4 is tool-call payload, not reasoning.
test('smoke: thinking steps counted from thinking blocks, residual only on those steps', async () => {
  const cfg = mkProfile();
  const entries = [
    user('go', 'u1'),
    step('m1', '2024-06-01T10:00:00Z', usage(1000, 600),
      [{ type: 'thinking', thinking: '', signature: 'sig' },
       { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    toolResult('t1', 'a b c', 'u2'),
    step('m2', '2024-06-01T10:00:05Z', usage(1200, 600),
      [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'pwd' } }]),
    toolResult('t2', '/x', 'u3'),
  ];
  writeTranscript(cfg, 'think001', entries, 1717200000);
  const out = await runJson(['think001'], cfg);
  const th = out.summary.assistantOutput.thinking;
  assert.strictEqual(th.stepSource, 'thinking-blocks');
  assert.strictEqual(th.stepsWithThinking, 1);
  assert.strictEqual(th.mainSteps, 2);
  // m1 visible = {"command":"ls"} = 16 chars = 4 tok → 596 unstored thinking
  assert.strictEqual(th.unstoredTokens, 596);
  // m2: all 600 output tokens are tool-call payload (scaled up, not thinking)
  const kinds = out.summary.assistantOutput.byKind;
  assert.strictEqual(kinds.thinking.tokens, 596);
  assert.strictEqual(kinds.toolCalls.tokens, 604);
  // synthetic assistant-thinking consumer row counts 1 thinking step
  const row = out.summary.contextConsumers.top.find((c) => c.tool === 'assistant-thinking');
  assert.strictEqual(row.count, 1);
});

test('smoke: no thinking blocks anywhere → legacy residual heuristic, flagged', async () => {
  const cfg = mkProfile();
  const entries = [
    user('go', 'u1'),
    step('m1', '2024-06-01T10:00:00Z', usage(1000, 600),
      [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    toolResult('t1', 'a', 'u2'),
  ];
  writeTranscript(cfg, 'think002', entries, 1717200000);
  const out = await runJson(['think002'], cfg);
  const th = out.summary.assistantOutput.thinking;
  assert.strictEqual(th.stepSource, 'residual-heuristic');
  assert.strictEqual(th.stepsWithThinking, 1);
  assert.strictEqual(th.unstoredTokens, 596);
});

// Thinking from turn 1 is not re-read in turn 2 (prior-turn thinking blocks are
// stripped from context), so its carried cost counts only the remaining steps of
// its own turn: m1's thinking is carried by m2 only, not by m3/m4.
test('smoke: assistant-thinking carry is bounded to the turn', async () => {
  const cfg = mkProfile();
  const entries = [
    user('first', 'u1'),
    step('m1', '2024-06-01T10:00:00Z', usage(1000, 600),
      [{ type: 'thinking', thinking: '', signature: 's' },
       { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    toolResult('t1', 'a', 'u2'),
    step('m2', '2024-06-01T10:00:05Z', usage(1100, 4)),
    user('second', 'u3'),
    step('m3', '2024-06-01T10:01:00Z', usage(1200, 4)),
    step('m4', '2024-06-01T10:01:05Z', usage(1300, 4)),
  ];
  writeTranscript(cfg, 'carry001', entries, 1717200000);
  const out = await runJson(['carry001'], cfg);
  const main = out.calls.filter((c) => c.isMain);
  const rate = main.reduce((a, c) => a + c.cacheReadCost, 0) / main.reduce((a, c) => a + c.tokens.cacheRead, 0);
  const row = out.summary.contextConsumers.top.find((c) => c.tool === 'assistant-thinking');
  assert.strictEqual(row.estTokens, 596);
  assert.ok(Math.abs(row.carriedCost - 596 * 1 * rate) < 1e-9, `carried ${row.carriedCost} vs ${596 * rate}`);
});

test('smoke: stepShape, modelSwitches, idleGaps are computed', async () => {
  const cfg = mkProfile();
  const entries = [
    user('go', 'u1'),
    step('m1', '2024-06-01T10:00:00Z', usage(1000, 50),
      [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } },
       { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b' } }]),
    toolResult('t1', 'A', 'u2'), toolResult('t2', 'B', 'u3'),
    step('m2', '2024-06-01T10:20:00Z', usage(1100, 50),
      [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } }], 'claude-opus-4-6'),
    toolResult('t3', 'x', 'u4'),
    step('m3', '2024-06-01T10:20:10Z', usage(1200, 50), null, 'claude-opus-4-6'),
  ];
  writeTranscript(cfg, 'shape001', entries, 1717200000);
  const out = await runJson(['shape001'], cfg);
  const s = out.summary;
  assert.deepStrictEqual(s.stepShape, { toolCalls: 3, stepsWithTools: 2, parallelSteps: 1, toolsPerStep: 1.5 });
  assert.deepStrictEqual(s.modelSwitches, { count: 1, models: ['claude-sonnet-4-6', 'claude-opus-4-6'] });
  assert.strictEqual(s.idleGaps.count, 1);
  assert.strictEqual(s.idleGaps.longestMs, 20 * 60 * 1000);
  assert.strictEqual(s.idleGaps.totalMs, 20 * 60 * 1000);
  assert.strictEqual(s.idleGaps.thresholdMs, 5 * 60 * 1000);
});
