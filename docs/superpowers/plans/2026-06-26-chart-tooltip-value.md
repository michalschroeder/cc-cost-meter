# Chart Tooltip Value (did + ate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the context-chart tooltip's repeated, truncated `serving: <prompt>` line with two value lines — what the step *ran* (its tools) and what *ate* its newly-written context (top-3 sources).

**Architecture:** The data layer (`session-detail.js`) attaches a new `contextSources` array to each main call, reusing the proven `afterStep`→call mapping. The renderer (`render-report.js`) emits `data-tools`/`data-source` on each chart bar plus an updated native `<title>`; the client tooltip script in `report-template.html` renders the two new lines. The mock payload is extended so `--mock` demonstrates it.

**Tech Stack:** Node stdlib only (no deps, no build). Tests via `node --test`.

## Global Constraints

- Pure Node stdlib — no new dependencies, no build step.
- Costs/tokens are never re-aggregated from `calls[]`; this feature only reads existing per-call fields and the existing `consumerEvents`.
- All user-derived strings (tool targets, prompts) are HTML-escaped with the existing `esc()` before reaching HTML.
- Spec: `docs/superpowers/specs/2026-06-26-chart-tooltip-value-design.md`. Design decisions locked: Q1 = no per-source token numbers; Q2 = list top 3.

---

### Task 1: Data layer — `contextSources` per main call

**Files:**
- Modify: `skills/cc-cost-meter/scripts/lib/session-detail.js` (in `buildDetail`, just after the `triggerByIdx` block — around lines 342–347)
- Test: `skills/cc-cost-meter/scripts/test/smoke.test.js` (new test, end-to-end via `analyze.js`)

**Interfaces:**
- Consumes: existing `consumerEvents` (`{ tool, target, estTokens, afterStep }`), `mainIdx` (parse-order index per kept main call), `mainCalls` (= `perCall.filter(isMain)`, same order as `mainIdx`).
- Produces: each emitted `calls[]` entry that is a main call and had preceding context events gains `contextSources: Array<{ tool: string, target: string }>` — top-3 by `estTokens` desc. Main calls with no preceding events and all subagent calls have **no** `contextSources` key.

- [ ] **Step 1: Write the failing test**

Add to `skills/cc-cost-meter/scripts/test/smoke.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/cc-cost-meter/scripts/test/smoke.test.js`
Expected: FAIL — the new test errors (`mains[0].contextSources` is `undefined`, deepStrictEqual mismatch). The other smoke tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `skills/cc-cost-meter/scripts/lib/session-detail.js`, find this existing block:

```js
  const triggerByIdx = new Map();
  for (const e of consumerEvents) {
    const cur = triggerByIdx.get(e.afterStep);
    if (!cur || e.estTokens > cur.estTokens) triggerByIdx.set(e.afterStep, e);
  }
  summary.assistantOutput = buildAssistantOutput(mainCalls, mainIdx, triggerByIdx);
```

Insert immediately **after** that `summary.assistantOutput = ...` line:

```js
  // Top-3 things that landed in context right before each main call — what got
  // newly written into that step — attached per call for the chart tooltip. Same
  // afterStep→call mapping triggerByIdx/mainIdx already use; estTokens only ranks
  // here and is intentionally not serialized (the tooltip shows names, no numbers).
  const sourcesByIdx = new Map();
  for (const e of consumerEvents) {
    const arr = sourcesByIdx.get(e.afterStep) || [];
    arr.push(e); sourcesByIdx.set(e.afterStep, arr);
  }
  mainCalls.forEach((c, j) => {
    const evs = sourcesByIdx.get(mainIdx[j]);
    if (evs && evs.length) {
      c.contextSources = evs.slice().sort((a, b) => b.estTokens - a.estTokens)
        .slice(0, 3).map((e) => ({ tool: e.tool, target: e.target }));
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/cc-cost-meter/scripts/test/smoke.test.js`
Expected: PASS (all smoke tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add skills/cc-cost-meter/scripts/lib/session-detail.js skills/cc-cost-meter/scripts/test/smoke.test.js
git commit -m "feat(detail): attach contextSources (top-3 pre-step sources) per main call"
```

---

### Task 2: Tooltip rendering — data attributes, native title, client lines

**Files:**
- Modify: `skills/cc-cost-meter/scripts/render-report.js` (helpers near `ctxOf` ~line 228; data block + native `<title>` inside `contextTimeline` ~lines 333–342)
- Modify: `skills/cc-cost-meter/assets/report-template.html` (chart branch of the tooltip `html()` function, ~lines 614–617)
- Test: `skills/cc-cost-meter/scripts/test/render-report.test.js` (new test)

**Interfaces:**
- Consumes: `c.tools` (existing `string[]`), `c.contextSources` (from Task 1).
- Produces: each chart base bar carries `data-tools` / `data-source` (omitted when empty); native `<title>` appends `— ran <tally>; written ← <sources>`; the client `.tip` card renders `ran:` and `+Yk written ←` lines. No `data-prompt`, no `serving:` line remain.

- [ ] **Step 1: Write the failing test**

Add to `skills/cc-cost-meter/scripts/test/render-report.test.js`:

```js
test('render: chart tooltip shows tools ran and context sources, not the prompt', () => {
  const ts = (m) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
  const payload = {
    ...detail,
    calls: [
      { seq: 1, agent: 'main', isMain: true, cost: 0.13, prompt: 'p', turnIndex: 1, ts: ts(0),
        tokens: { input: 0, cacheRead: 50000, cacheWrite: 6000, output: 100 },
        tools: ['Read', 'Read', 'Bash'],
        contextSources: [{ tool: 'Read', target: '/repo/src/foo.js' }, { tool: 'Bash', target: 'git log --stat' }] },
      { seq: 2, agent: 'main', isMain: true, cost: 0.10, prompt: 'p2', turnIndex: 2, ts: ts(2),
        tokens: { input: 0, cacheRead: 40000, cacheWrite: 0, output: 100 } },
    ],
  };
  const html = render(payload, TEMPLATE);
  // SVG data attributes drive the styled tooltip: tally + basename'd sources.
  assert.match(html, /data-tools="Read ×2 · Bash"/);
  assert.match(html, /data-source="Read foo.js · Bash git log --stat"/);
  // Only the first bar has tools; the second (no tools/sources) omits the attrs.
  assert.strictEqual((html.match(/data-tools=/g) || []).length, 1);
  assert.strictEqual((html.match(/data-source=/g) || []).length, 1);
  // Native <title> fallback gained the did/ate suffix.
  assert.match(html, /— ran Read ×2 · Bash; written ← Read foo.js · Bash git log --stat/);
  // The old prompt-echo is gone from both the SVG and the client script.
  assert.ok(!html.includes('data-prompt='), 'data-prompt removed from bars');
  assert.ok(!/serving: '/.test(html), 'serving line removed from client tooltip script');
  // The client tooltip script now emits the "ran:" line.
  assert.match(html, /ran: ' \+ esc\(d\.tools\)/);
});

test('render: chart tooltip escapes hostile context-source targets', () => {
  const payload = {
    ...detail,
    calls: [
      { seq: 1, agent: 'main', isMain: true, cost: 0.1, prompt: 'p', turnIndex: 1,
        tokens: { input: 0, cacheRead: 50000, cacheWrite: 6000, output: 100 },
        tools: ['Read'],
        contextSources: [{ tool: 'Read', target: '/repo/<x> & "y".js' }] },
    ],
  };
  const html = render(payload, TEMPLATE);
  assert.match(html, /data-source="Read &lt;x&gt; &amp; &quot;y&quot;\.js"/);
  assert.ok(!html.includes('<x>'), 'raw target leaked into svg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/cc-cost-meter/scripts/test/render-report.test.js`
Expected: FAIL — no `data-tools`/`data-source` emitted; `serving: '` still present in template; `data-prompt=` still present.

- [ ] **Step 3a: Add the helpers in `render-report.js`**

Find this existing block (just after `totalCtxOf`):

```js
const totalCtxOf = (c) => ctxOf(c) + writtenOf(c);
```

Insert immediately after it:

```js
// Tool tally for a step: "Read ×2 · Bash · Edit" in first-seen order, ×N only when >1.
const toolTally = (tools) => {
  if (!tools || !tools.length) return '';
  const n = new Map();
  for (const t of tools) n.set(t, (n.get(t) || 0) + 1);
  return [...n].map(([t, c]) => (c > 1 ? `${t} ×${c}` : t)).join(' · ');
};
// One context source as "Read foo.js": tool + basename(target) (file paths → last
// segment; other targets truncated). user-prompt → "your message".
const sourceLabel = (s) => {
  if (!s) return '';
  if (s.tool === 'user-prompt') return 'your message';
  const base = String(s.target || '').split(/[\\/]/).pop() || '';
  return `${s.tool} ${truncate(base, 24)}`.trim();
};
```

- [ ] **Step 3b: Emit the data attributes (`render-report.js`, in `contextTimeline`)**

Replace this existing block:

```js
    const data = ` data-step="${esc(step)}" data-cached="${esc(compactTokens(cached))}" data-written="${esc(compactTokens(written))}"` +
      ` data-total="${esc(compactTokens(total))}" data-cost="${esc(money(c.cost))}" data-mins="${esc(fmtMins(mins))}"` +
      ` data-prompt="${esc(truncate(c.prompt || '', 110))}"`;
```

with:

```js
    const toolsStr = toolTally(c.tools);
    const sourcesStr = (c.contextSources || []).map(sourceLabel).filter(Boolean).join(' · ');
    const data = ` data-step="${esc(step)}" data-cached="${esc(compactTokens(cached))}" data-written="${esc(compactTokens(written))}"` +
      ` data-total="${esc(compactTokens(total))}" data-cost="${esc(money(c.cost))}" data-mins="${esc(fmtMins(mins))}"` +
      (toolsStr ? ` data-tools="${esc(toolsStr)}"` : '') +
      (sourcesStr ? ` data-source="${esc(sourcesStr)}"` : '');
```

- [ ] **Step 3c: Update the native `<title>` (`render-report.js`, same loop)**

Replace this existing line:

```js
    parts.push(`<rect class="ctx-bar ${tierClass(cached, highCtx, resetDrop)}" x="${xv}" y="${yCached.toFixed(1)}" width="${barW.toFixed(2)}" height="${hCached.toFixed(1)}"${data}>` +
      `<title>step ${esc(step)} · ${esc(compactTokens(total))} context (${esc(compactTokens(cached))} re-read + ${esc(compactTokens(written))} written) · ${esc(money(c.cost))} · +${esc(fmtMins(mins))}</title></rect>`);
```

with:

```js
    parts.push(`<rect class="ctx-bar ${tierClass(cached, highCtx, resetDrop)}" x="${xv}" y="${yCached.toFixed(1)}" width="${barW.toFixed(2)}" height="${hCached.toFixed(1)}"${data}>` +
      `<title>step ${esc(step)} · ${esc(compactTokens(total))} context (${esc(compactTokens(cached))} re-read + ${esc(compactTokens(written))} written) · ${esc(money(c.cost))} · +${esc(fmtMins(mins))}` +
      `${toolsStr ? ` — ran ${esc(toolsStr)}` : ''}${sourcesStr ? `; written ← ${esc(sourcesStr)}` : ''}</title></rect>`);
```

- [ ] **Step 3d: Update the client tooltip script (`assets/report-template.html`)**

Replace this existing block (chart branch of `html()`):

```js
      return '<div class="tip-h">Step ' + esc(d.step) + ' · ' + esc(d.total) + ' context</div>' +
        '<div class="tip-cost">' + esc(d.cost) + '</div>' +
        '<div class="tip-b">' + esc(d.cached) + ' re-read + ' + esc(d.written) + ' written · +' + esc(d.mins) + ' from start</div>' +
        (d.prompt ? '<div class="tip-b">serving: ' + esc(d.prompt) + '</div>' : '');
```

with:

```js
      return '<div class="tip-h">Step ' + esc(d.step) + ' · ' + esc(d.total) + ' context</div>' +
        '<div class="tip-cost">' + esc(d.cost) + '</div>' +
        '<div class="tip-b">' + esc(d.cached) + ' re-read + ' + esc(d.written) + ' written · +' + esc(d.mins) + ' from start</div>' +
        (d.tools ? '<div class="tip-b">ran: ' + esc(d.tools) + '</div>' : '') +
        (d.source ? '<div class="tip-b">+' + esc(d.written) + ' written ← ' + esc(d.source) + '</div>' : '');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test skills/cc-cost-meter/scripts/test/render-report.test.js`
Expected: PASS (new tests + all existing render tests — none asserted `data-prompt`/`serving`, so the timeline test still passes).

- [ ] **Step 5: Commit**

```bash
git add skills/cc-cost-meter/scripts/render-report.js skills/cc-cost-meter/assets/report-template.html skills/cc-cost-meter/scripts/test/render-report.test.js
git commit -m "feat(report): tooltip shows tools ran + what ate the written context"
```

---

### Task 3: Mock demo + full-suite verification

**Files:**
- Modify: `skills/cc-cost-meter/assets/mock-detail.json` (add `tools` + `contextSources` to the first two main calls)
- Verify: full test suite + `--mock` render

**Interfaces:**
- Consumes: nothing new. Produces: a `--mock` report whose chart tooltips demonstrate both new lines.

- [ ] **Step 1: Extend the mock payload**

In `skills/cc-cost-meter/assets/mock-detail.json`, the `calls` array's first entry is `seq: 1` (`isMain: true`, ends with `"ts": "2026-01-01T00:00:00.000Z"`). Add two fields to it — insert after its `"ts"` line (add a comma to the `ts` line):

```json
      "ts": "2026-01-01T00:00:00.000Z",
      "tools": ["Read", "Read", "Grep"],
      "contextSources": [
        { "tool": "Read", "target": "/repo/src/auth/token-service.js" },
        { "tool": "Read", "target": "/repo/src/auth/session.js" },
        { "tool": "Grep", "target": "verifyToken" }
      ]
```

Do the same for the `seq: 2` entry (its `"ts"` is `"2026-01-01T00:02:00.000Z"`):

```json
      "ts": "2026-01-01T00:02:00.000Z",
      "tools": ["Edit", "Bash"],
      "contextSources": [
        { "tool": "Bash", "target": "npm test -- auth.spec.ts" }
      ]
```

- [ ] **Step 2: Verify the mock JSON is valid and renders the new lines**

Run:
```bash
node skills/cc-cost-meter/scripts/render-report.js --mock --out /tmp/mock-report.html \
  && grep -c 'data-tools="Read ×2 · Grep"' /tmp/mock-report.html \
  && grep -c 'written ← Read token-service.js · Read session.js · Grep verifyToken' /tmp/mock-report.html
```
Expected: command exits 0; both `grep -c` print `1` (the native `<title>` for the seq-1 bar carries the tally and the basename'd source list).

- [ ] **Step 3: Run the full suite**

Run: `node --test skills/cc-cost-meter/scripts/test/*.test.js`
Expected: PASS — all tests, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add skills/cc-cost-meter/assets/mock-detail.json
git commit -m "test(report): mock payload demonstrates tooltip did/ate lines"
```

---

## Self-Review

**Spec coverage:**
- "did" line from `c.tools` → Task 2 (`toolTally`, `data-tools`, `ran:` line). ✓
- "ate" line from new `c.contextSources` top-3 → Task 1 (data) + Task 2 (`sourceLabel`, `data-source`, `written ←` line). ✓
- Drop `serving:`/`data-prompt` → Task 2 Steps 3b/3d + assertions. ✓
- No per-source numbers (Q1), top-3 (Q2) → `contextSources` carries only `{tool,target}`; `slice(0,3)`. ✓
- Native `<title>` fallback → Task 2 Step 3c. ✓
- Edge cases (no tools / no sources omit lines; basename; truncate; escaping) → helpers + ternaries + escaping test. ✓
- Tests on all three stages + mock → Tasks 1/2/3. ✓

**Placeholder scan:** none — every code/step block is concrete.

**Type consistency:** `contextSources: {tool,target}[]` defined in Task 1, consumed by `sourceLabel` in Task 2; `data-tools`/`data-source` produced in Task 2 Step 3b, consumed as `d.tools`/`d.source` in Step 3d; `toolsStr`/`sourcesStr` defined in Step 3b and reused in Step 3c. Consistent.
