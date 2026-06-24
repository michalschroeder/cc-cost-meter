# Report Basic/Advanced Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the HTML cost report into a dual-audience layout — verdict first, evidence below, with forensic sections gated behind a single Basic/Advanced toggle.

**Architecture:** The renderer (`scripts/render-report.js`) is a pure slot-filling transform — it builds a `{TOKEN: html}` map and does one global replace, with no awareness of section order. Therefore **all reordering, merging, and gating happen in `assets/report-template.html`**; the renderer is not modified. The toggle is server-rendered Basic (`<body class="basic">`) with a CSS rule hiding `.adv` blocks and a small inline `<script>` that flips the body class and persists the choice in `localStorage`.

**Tech Stack:** Plain HTML/CSS/vanilla JS (no deps, no build). Tests via `node --test`.

## Global Constraints

- Pure Node stdlib / no dependencies / no build step (copy verbatim from CLAUDE.md).
- **Do NOT touch `scripts/lib/*` or `data/`** — vendored cost engine; no SYNC.md impact.
- Do NOT change `scripts/analyze.js`, the JSON contract, or `scripts/apply-summaries.js`.
- All sections always render (including when empty) — no hide-on-empty.
- All user-derived text stays HTML-escaped (the renderer already does this; no slot semantics change).
- Test command (run from `skills/cc-cost-meter/`): `node --test scripts/test/*.test.js`.
- Manual visual check: `node scripts/render-report.js --mock --out /tmp/mock.html`.

## Final section order (target)

Inside `<div class="wrap">`:

1. `{{RATING_BADGE}}` (grade badge — already at top, unchanged)
2. `<nav class="toc">` — reordered links + advanced toggle button
3. KPI `.cards` strip (unchanged)
4. `.primer` cost-formula CTA (unchanged)
5. **Verdict** — `<section id="assessment">` "Spending less next time" (MOVED up from the bottom)
6. Context window over time (+ grouped growth bar) — unchanged content
7. Where it went — now full-width (pulled out of `.pair`)
8. What filled the context — MERGED (by-tool tally + per-item table + note)
9. Top turns
10. `<section id="thinking" class="adv">` Reasoning — MERGED (turn table + "Biggest reasoning bursts" demoted to `<h3>`)
11. `<div class="trio adv" id="reference">` — By skill / By model / Subagents
12. `<footer>` (unchanged)

`.adv` = hidden when `<body class="basic">`. Items 1–9 are Basic; 10–11 are Advanced.

## File structure

- Modify: `skills/cc-cost-meter/assets/report-template.html` — all structural + toggle changes.
- Modify: `skills/cc-cost-meter/scripts/test/render-report.test.js` — rebind `assessOf`, add gating/order/merge assertions.
- Unchanged: `scripts/render-report.js` (pure slot-filler), `assets/mock-detail.json`, all `lib/`.

All paths below are relative to `skills/cc-cost-meter/`.

---

### Task 1: Move the Verdict section to the top

**Files:**
- Modify: `assets/report-template.html` (move the `#tips` block; wrap as `<section id="assessment">`)
- Test: `scripts/test/render-report.test.js` (rebind `assessOf`; add order assertion)

**Interfaces:**
- Consumes: existing slots `{{RATING_BADGE}}`, `{{ASSESS_CARDS}}` (unchanged).
- Produces: an `<section id="assessment">…</section>` wrapper containing the assessment, positioned immediately after the `.primer` block and before the `<h2 id="context">`. No nested `<section>` inside it (cards are `<div>`s), so `</section>` cleanly bounds it.

- [ ] **Step 1: Update the `assessOf` test helper to bound the assessment by its wrapper**

In `scripts/test/render-report.test.js`, replace the current helper (around line 284):

```js
// Everything between the assessment grid and the footer (the .acard panels live here).
const assessOf = (html) => (html.split('class="assess"')[1] || '').split('<footer')[0];
```

with a wrapper-scoped version (robust to the section moving up):

```js
// The assessment <section id="assessment"> body — bounded by its own wrapper so the
// helper is position-independent (the section now sits near the top, not before <footer>).
const assessOf = (html) => (html.split('id="assessment"')[1] || '').split('</section>')[0];
```

- [ ] **Step 2: Add a test asserting the verdict renders before the context chart**

Append this test to `scripts/test/render-report.test.js`:

```js
test('render: verdict section renders before the context chart (payoff first)', () => {
  const html = render(detail, TEMPLATE);
  const iAssess = html.indexOf('id="assessment"');
  const iContext = html.indexOf('id="context"');
  assert.ok(iAssess > -1 && iContext > -1, 'both sections present');
  assert.ok(iAssess < iContext, 'assessment must come before the context section');
});
```

- [ ] **Step 3: Run the assessment + new tests to verify they fail**

Run: `node --test scripts/test/render-report.test.js`
Expected: FAIL — the new order test fails (assessment still last) and `assessOf` finds no `id="assessment"` yet, so the escape/empty/AI-assessment tests fail.

- [ ] **Step 4: Move and wrap the assessment block in the template**

In `assets/report-template.html`, CUT this block (currently lines ~508–519):

```html
  <h2 id="tips" class="tint-olive">Spending less next time</h2>
  <p class="explain">An assessment of this session: where the money went and what to do differently.
  Read the cards as leads to check, not as final verdicts. The cost of a session is driven mostly by
  one thing, the size of the context multiplied by the number of steps, because everything left in
  the conversation is re-read on every later step. That makes keeping the context small, with /compact
  or a fresh session, almost always the biggest lever. When a card blames a more visible detail, such
  as a short "do it" prompt or one expensive skill, it is often pointing at <em>where</em> the spend
  happened rather than the underlying cause: that same prompt would have cost about the same in any
  large context, because what you paid for was re-reading the window it ran in, not the words you
  typed. So treat each card as a place to look, confirm it against the tables above, and act on the
  structural lever (a smaller context) before the cosmetic one (longer prompts).</p>
  <div class="assess">{{ASSESS_CARDS}}</div>
```

PASTE it immediately after the closing `</div>` of the `.primer` block (currently line 363, the line `</div>` that closes `<div class="primer">`) and before `<h2 id="context" class="tint-olive">`, wrapping it in a `<section>` and changing the heading id from `tips` to keep the anchor on the section:

```html
  <section id="assessment">
  <h2 class="tint-olive">Spending less next time</h2>
  <p class="explain">An assessment of this session: where the money went and what to do differently.
  Read the cards as leads to check, not as final verdicts. The cost of a session is driven mostly by
  one thing, the size of the context multiplied by the number of steps, because everything left in
  the conversation is re-read on every later step. That makes keeping the context small, with /compact
  or a fresh session, almost always the biggest lever. When a card blames a more visible detail, such
  as a short "do it" prompt or one expensive skill, it is often pointing at <em>where</em> the spend
  happened rather than the underlying cause: that same prompt would have cost about the same in any
  large context, because what you paid for was re-reading the window it ran in, not the words you
  typed. So treat each card as a place to look, confirm it against the tables above, and act on the
  structural lever (a smaller context) before the cosmetic one (longer prompts).</p>
  <div class="assess">{{ASSESS_CARDS}}</div>
  </section>
```

(The `#tips` anchor moves to `id="assessment"` on the section; the toc link is updated in Task 4.)

- [ ] **Step 5: Run the full suite to verify green**

Run: `node --test scripts/test/*.test.js`
Expected: PASS (all files). The order test passes; `assessOf` resolves to the assessment section.

- [ ] **Step 6: Commit**

```bash
git add assets/report-template.html scripts/test/render-report.test.js
git commit -m "feat(report): move verdict section to top, wrap as #assessment"
```

---

### Task 2: Merge the two context-consumer sections into one

**Files:**
- Modify: `assets/report-template.html` (un-pair "Where it went"; fold by-tool table into the consumers section)
- Test: `scripts/test/render-report.test.js` (assert both tables live in one section)

**Interfaces:**
- Consumes: existing slots `{{WHERE_IT_WENT_ROWS}}`, `{{CONSUMER_TOOL_ROWS}}`, `{{CONSUMER_ROWS}}`, `{{CONSUMERS_NOTE}}` (unchanged).
- Produces: `<h2 id="where">` standalone full-width; a single `<h2 id="consumers">What filled the context</h2>` section containing the by-tool tally (`<h3>` + table) above the per-item table.

- [ ] **Step 1: Add a test asserting the merged structure**

Append to `scripts/test/render-report.test.js`:

```js
test('render: consumers merged — by-tool tally and per-item table share one section', () => {
  const html = render(detail, TEMPLATE);
  // exactly one "what filled the context" heading (the separate by-tool h2 is gone)
  assert.strictEqual((html.match(/id="consumers"/g) || []).length, 1);
  // both the by-tool rollup (Read/Bash with result counts) and the per-item table render
  assert.match(html, /<tbody>[\s\S]*Read[\s\S]*Bash[\s\S]*<\/tbody>/); // by-tool rows
  assert.match(html, /id="consumers-table"/);                          // per-item table id kept
  // "Where it went" is now its own full-width section, not paired with by-tool
  assert.match(html, /id="where"/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/test/render-report.test.js`
Expected: FAIL — two `id="consumers"`-adjacent headings exist today (the by-tool section uses `id="consumers"`, and there's a separate "Top context consumers" h2 without an id), and the structure differs.

- [ ] **Step 3: Restructure the template**

In `assets/report-template.html`, REPLACE the entire `<div class="pair">…</div>` block plus the separate "Top context consumers" block (currently lines ~408–445) — that is, from `<div class="pair">` through `<p class="note">{{CONSUMERS_NOTE}}</p>` — with:

```html
  <section>
    <h2 id="where" class="tint-sage">Where it went</h2>
    <p class="explain">Your total cost, split into the four things you actually pay for.
    <strong>cache read</strong> is the model re-reading the conversation at every step. This is
    usually the biggest slice, and the main reason long sessions get expensive.
    <strong>output</strong> is everything the model wrote back, including the private thinking you
    never see. <strong>cache write</strong> is the cost of saving new material once, so that later
    steps can re-read it more cheaply. <strong>input</strong> is brand-new text that has not been
    saved yet, and it is usually tiny.</p>
    <table><thead><tr><th scope="col" data-sort="text">component</th><th scope="col" class="num" data-sort="num" data-sum="money">cost</th><th scope="col">share</th></tr></thead>
    <tbody>{{WHERE_IT_WENT_ROWS}}</tbody></table>
  </section>

  <h2 id="consumers" class="tint-salmon">What filled the context</h2>
  <p class="explain">What took up room in the conversation. <strong>carried cost</strong> is the
  repeat charge for keeping it around: once a file or a command's output lands in the conversation,
  the model re-reads it at every later step until the session ends or the conversation is cleared. A
  big row here is a good thing to hand off to a helper (a subagent) next time — the helper reads it in
  its own separate conversation and sends back only a short summary, so the bulky original never weighs
  down your main chat.</p>
  <h3>By tool — where it came from</h3>
  <table><thead><tr><th scope="col" data-sort="text">tool</th><th scope="col" class="num" data-sort="num" data-sum="int">results</th><th scope="col" class="num" data-sort="num" data-sum="tokens">est tokens</th><th scope="col" class="num" data-sort="num" data-sum="money">carried cost</th><th scope="col">share</th></tr></thead>
  <tbody>{{CONSUMER_TOOL_ROWS}}</tbody></table>
  <h3>Item by item — the exact file, command, or message</h3>
  <p class="explain">A <strong>×3</strong> after a tool name means the same thing landed three times;
  a file read three times costs its full size three times over, plus the repeat charge for keeping each
  copy around. The <strong>assistant-*</strong> rows are the model's own words: its visible replies
  (assistant-text), its private thinking (assistant-thinking), and the text it typed into its tools
  (assistant-tool-calls). When those rows are near the top, the cost came mostly from how much the
  model itself wrote, not from what it read.</p>
  <table id="consumers-table" data-total-label="Total (shown)"><thead><tr><th scope="col" class="num" data-sort="num" data-sum="tokens">est tokens</th><th scope="col">share</th><th scope="col" class="num" data-sort="num" data-sum="money">carried cost</th><th scope="col" data-sort="text">tool</th><th scope="col">target (file · command · prompt)</th></tr></thead>
  <tbody>{{CONSUMER_ROWS}}</tbody></table>
  <p class="note">{{CONSUMERS_NOTE}}</p>
```

- [ ] **Step 4: Run the full suite to verify green**

Run: `node --test scripts/test/*.test.js`
Expected: PASS. The existing consumer tests (`Read ×2`, `git log --stat`, target-escaping, summary-on-hover, placeholder) still match — the `{{CONSUMER_ROWS}}` table and `id="consumers-table"` are unchanged; only the surrounding headings moved.

- [ ] **Step 5: Commit**

```bash
git add assets/report-template.html scripts/test/render-report.test.js
git commit -m "feat(report): merge by-tool + per-item consumers into one section"
```

---

### Task 3: Merge the two thinking sections into one "Reasoning"

**Files:**
- Modify: `assets/report-template.html` (one `<h2>`, demote "Biggest reasoning bursts" to `<h3>`, wrap as a section)
- Test: `scripts/test/render-report.test.js` (assert single reasoning h2)

**Interfaces:**
- Consumes: existing slots `{{THINKING_SUMMARY}}`, `{{THINKING_TURN_ROWS}}`, `{{THINKING_STEP_ROWS}}` (unchanged).
- Produces: `<section id="thinking">` with one `<h2 class="think">Reasoning: what it cost</h2>` and an `<h3>` for the bursts table. (The `.adv` class is added in Task 4 — not here.)

- [ ] **Step 1: Add a test asserting a single reasoning heading**

Append to `scripts/test/render-report.test.js`:

```js
test('render: thinking merged — one Reasoning h2, bursts demoted to h3', () => {
  const html = render(detail, TEMPLATE);
  // only one h2 carries the "think" tint now (the bursts h2 became an h3)
  assert.strictEqual((html.match(/<h2[^>]*class="think"/g) || []).length, 1);
  assert.match(html, /<h3>Biggest reasoning bursts<\/h3>/);
  // both tables still render
  assert.match(html, /id="thinking-turns-table"/);
  assert.match(html, /Bash: docker compose run &lt;tests&gt;/); // burst trigger still present
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/test/render-report.test.js`
Expected: FAIL — there are currently two `<h2 class="think">` headings and no `<h3>Biggest reasoning bursts</h3>`.

- [ ] **Step 3: Restructure the template**

In `assets/report-template.html`, REPLACE the two thinking blocks (currently lines ~447–468) — from `<h2 id="thinking" class="think">` through the closing `</table>` after `{{THINKING_STEP_ROWS}}` — with:

```html
  <section id="thinking">
  <h2 class="think">Reasoning: what it cost</h2>
  <p class="explain">Before most replies and tool actions, the model thinks privately. That thinking
  is charged at the output rate, the most expensive rate, but the text is never saved anywhere, so
  no tool can show it to you. The <strong>interleaved</strong> figure is exactly that hidden
  thinking. The table shows which of your messages set off the most reasoning. A lot of steps under
  one message usually means a debugging loop: every test run or error that comes back sets off
  another round of thinking. The fix is fewer, bigger steps, for example running several commands at
  once or handing a repetitive retry loop to a helper. It is not about making the model "think
  less".</p>
  <p class="note">{{THINKING_SUMMARY}}</p>
  <table id="thinking-turns-table" data-total-label="Total (shown)"><thead><tr><th scope="col" class="num" data-sort="num" data-sum="tokens">tokens</th><th scope="col">share</th><th scope="col" class="num" data-sort="num" data-sum="int">steps</th><th scope="col">prompt that drove the reasoning</th></tr></thead>
  <tbody>{{THINKING_TURN_ROWS}}</tbody></table>
  <h3>Biggest reasoning bursts</h3>
  <p class="explain">The individual steps where the model thought the hardest.
  <strong>trigger</strong> is what had just landed in the conversation, the tool result or message
  it was reacting to. <strong>next action</strong> is what it decided to do next. A big burst right
  before an important action, like making a large edit, is just the model taking time to plan, which
  is normal. But repeated bursts after the same command usually mean the model kept working out the
  same answer over and over, a sign that loop would have been better handed to a helper.</p>
  <table data-total-label="Total (shown)"><thead><tr><th scope="col" class="num" data-sort="num" data-sum="tokens">tokens</th><th scope="col" class="num" data-sort="num">step</th><th scope="col">trigger (what landed in context right before)</th><th scope="col">next action</th></tr></thead>
  <tbody>{{THINKING_STEP_ROWS}}</tbody></table>
  </section>
```

- [ ] **Step 4: Run the full suite to verify green**

Run: `node --test scripts/test/*.test.js`
Expected: PASS. Existing thinking-row tests still match (table ids and row content unchanged).

- [ ] **Step 5: Commit**

```bash
git add assets/report-template.html scripts/test/render-report.test.js
git commit -m "feat(report): merge thinking sections into one Reasoning section"
```

---

### Task 4: Advanced gating + toggle + TOC reorder

**Files:**
- Modify: `assets/report-template.html` (body class, `.adv` CSS, toggle button, toc reorder, wrap advanced sections, toggle script)
- Test: `scripts/test/render-report.test.js` (assert Basic default, `.adv` gating, toggle present)

**Interfaces:**
- Consumes: the `<section id="thinking">` (Task 3) and the `<div class="trio">` (existing).
- Produces: `<body class="basic">`; CSS `body.basic .adv{display:none}`; a `#adv-toggle` button in the toc; `.adv` on the thinking section, the trio div, and the advanced toc links.

- [ ] **Step 1: Add gating/toggle tests**

Append to `scripts/test/render-report.test.js`:

```js
test('render: report ships in Basic mode with advanced sections gated', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /<body class="basic">/);                 // server-rendered Basic
  assert.match(html, /<section id="thinking" class="adv">/);  // Reasoning is advanced
  assert.match(html, /<div class="trio adv"/);                // by skill/model/subagents advanced
  assert.match(html, /id="adv-toggle"[^>]*aria-expanded="false"/); // toggle present, collapsed
  assert.match(html, />Show advanced</);                      // default button label
  assert.match(html, /body\.basic \.adv\s*\{\s*display:none/); // the gating CSS rule exists
});

test('render: advanced toc links are gated, basic ones are not', () => {
  const html = render(detail, TEMPLATE);
  // an advanced jump-link (Reasoning) carries .adv; a basic one (Where it went) does not
  assert.match(html, /<a class="adv" href="#thinking">/);
  assert.match(html, /<a href="#where">Where it went<\/a>/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/test/render-report.test.js`
Expected: FAIL — body has no `basic` class, no `.adv` markup, no toggle button.

- [ ] **Step 3: Set the body to Basic**

In `assets/report-template.html`, change (line 307):

```html
<body>
```

to:

```html
<body class="basic">
```

- [ ] **Step 4: Add the gating + toggle-button CSS**

In the `<style>` block, immediately after the `.toc a:focus-visible { … }` rule (currently line 134), insert:

```css
  /* Basic/Advanced disclosure: the report ships Basic (body.basic) and the toggle
     reveals .adv blocks. Printing always shows everything. */
  body.basic .adv { display:none; }
  body.basic .toc a.adv { display:none; }
  .toc-adv { margin-left:auto; font-family:var(--font-head); font-size:15px; font-weight:700;
    text-transform:uppercase; letter-spacing:.03em; color:var(--link); background:var(--canvas);
    border:1px solid var(--frame); box-shadow:2px 2px 0 #000; padding:4px 12px; cursor:pointer; }
  .toc-adv:hover { color:var(--red); }
  .toc-adv:focus-visible { outline:2px solid var(--ink); outline-offset:1px; }
  @media print { body.basic .adv { display:revert; } .toc-adv { display:none; } }
```

- [ ] **Step 5: Reorder the toc, mark advanced links, add the toggle button**

Replace the whole `<nav class="toc" …>…</nav>` block (currently lines 323–334) with:

```html
  <nav class="toc" aria-label="Report sections">
    <span class="toc-cost">{{TOTAL_COST}}</span>
    <a href="#assessment">Spend less</a>
    <a href="#context">Context</a>
    <a href="#where">Where it went</a>
    <a href="#consumers">What filled it</a>
    <a href="#turns">Top turns</a>
    <a class="adv" href="#thinking">Reasoning</a>
    <a class="adv" href="#skill">Skills</a>
    <a class="adv" href="#model">Models</a>
    <a class="adv" href="#subagents">Subagents</a>
    <button type="button" id="adv-toggle" class="toc-adv" aria-expanded="false"
      aria-controls="thinking reference">Show advanced</button>
  </nav>
```

- [ ] **Step 6: Mark the Reasoning section advanced**

In the block added in Task 3, change:

```html
  <section id="thinking">
```

to:

```html
  <section id="thinking" class="adv">
```

- [ ] **Step 7: Mark the trio (by skill/model/subagents) advanced and give it an id**

Change (currently line 470):

```html
  <div class="trio">
```

to:

```html
  <div class="trio adv" id="reference">
```

- [ ] **Step 8: Add the toggle script**

In the `<script>` block, immediately before the final `</script>` (line 728), insert:

```js
// Basic/Advanced disclosure. The report is server-rendered in Basic (body.basic);
// this restores the reader's last choice from localStorage and wires the toggle.
(function () {
  var body = document.body, btn = document.getElementById('adv-toggle');
  if (!btn) return;
  var KEY = 'ccm-show-advanced';
  function apply(show) {
    body.classList.toggle('basic', !show);
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    btn.textContent = show ? 'Hide advanced' : 'Show advanced';
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked — stay Basic */ }
  if (saved === '1') apply(true);
  btn.addEventListener('click', function () {
    var show = body.classList.contains('basic'); // currently Basic → about to reveal
    apply(show);
    try { localStorage.setItem(KEY, show ? '1' : '0'); } catch (e) { /* ignore */ }
  });
})();
```

- [ ] **Step 9: Run the full suite to verify green**

Run: `node --test scripts/test/*.test.js`
Expected: PASS (all files, including the two new gating tests).

- [ ] **Step 10: Commit**

```bash
git add assets/report-template.html scripts/test/render-report.test.js
git commit -m "feat(report): gate advanced sections behind a Basic/Advanced toggle"
```

---

### Task 5: Verify the rendered report end-to-end

**Files:**
- No source changes (verification only). If the mock render reveals a defect, fix it in the relevant file and re-run.

- [ ] **Step 1: Render the mock report**

Run: `node scripts/render-report.js --mock --out /tmp/mock-report.html`
Expected: prints `/tmp/mock-report.html`, exit 0.

- [ ] **Step 2: Confirm Basic default and the advanced gating in the markup**

Run: `grep -c 'class="adv"' /tmp/mock-report.html`
Expected: ≥ 3 (Reasoning section + trio + advanced toc links).

Run: `grep -o '<body class="basic">' /tmp/mock-report.html`
Expected: one match.

- [ ] **Step 3: Eyeball the report in a browser (manual)**

Open `/tmp/mock-report.html`. Confirm:
- The grade badge + "Spending less next time" cards are at the top (before the context chart).
- "What filled the context" shows the by-tool tally above the item-by-item table.
- One "Reasoning" section; "Biggest reasoning bursts" is a sub-heading inside it.
- In Basic (default), Reasoning + By skill/model/subagents are hidden; the four advanced toc links are hidden; the button reads "Show advanced".
- Clicking "Show advanced" reveals them and the button reads "Hide advanced"; reloading the page keeps them shown (localStorage); clicking again hides them and persists.

- [ ] **Step 4: Run the full suite once more**

Run: `node --test scripts/test/*.test.js`
Expected: PASS, all files.

- [ ] **Step 5: Final commit (if any fixes were made in Steps 1–4; otherwise skip)**

```bash
git add -A
git commit -m "fix(report): adjustments from mock-render verification"
```

---

## Self-Review

**Spec coverage:**
- One global toggle, default Basic → Task 4 (`<body class="basic">` + `#adv-toggle`). ✓
- Basic set (Verdict, Context, Where, What-filled, Top turns) → Tasks 1–2 + order in Task 4. ✓
- Advanced set (Reasoning, By skill/model/subagents) → Task 4 `.adv`. ✓
- Merge redundant pairs → Task 2 (consumers), Task 3 (thinking). ✓
- All sections always render → no hide-on-empty introduced; only display gating. ✓
- Persist toggle in localStorage → Task 4 Step 8. ✓
- Plain-language lead-in to "Where it went" → its `<p class="explain">` is retained verbatim in Task 2. ✓ (No further rewrite needed; the existing copy already opens in plain language.)
- No `lib/`/`data/` changes; no SYNC.md impact → only template + test touched. ✓

**Note on the spec's "render-report.js change":** the spec listed `render-report.js` as a touch point. Implementation analysis shows the renderer is a pure, order-independent slot-filler, so reorder/merge/gating are entirely template-side and the renderer needs no edit. This is a refinement, not a scope change.

**Placeholder scan:** no TBD/TODO; every code step shows complete markup/CSS/JS.

**Type/identifier consistency:** `id="assessment"` (Task 1) matches the `assessOf` helper and the toc link `#assessment` (Task 4); `id="thinking"` matches toc `#thinking` and `aria-controls="thinking reference"`; `id="reference"` matches the trio and the same `aria-controls`; `id="consumers"`/`id="consumers-table"` match the merged section (Task 2) and the existing tooltip wiring (`'#consumers-table'` in the page script, untouched). localStorage key `ccm-show-advanced` is used consistently in Task 4 Step 8.
