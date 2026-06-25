# Context-chart tooltip: from "serving: <prompt>" to did + ate

## Problem

The per-step tooltip on the context timeline ends with `serving: <turn prompt>`.
That line is low value: it's the turn's *user* prompt, so it repeats identically
across every step in a turn, truncates mid-word, and never says what the step
actually did or what consumed the newly-written context. Example seen in the wild:

```
STEP 39 · 95K CONTEXT
$0.13
89k re-read + 6k written · +24m from start
serving: A, and answer the 3 questions: standalone callout and add it also as…
```

## Goal

Replace the prompt line with two value lines that answer:
1. **What did this step do?** — the tools the step's assistant invoked.
2. **What ate the newly-written context?** — the largest things that landed in
   context right before this step (up to 3), named, no token estimates.

Target tooltip:

```
STEP 39 · 95K CONTEXT
$0.13
89k re-read + 6k written · +24m from start
ran: Read ×2 · Bash · Edit
+6k written ← Read foo.js · Bash git log · Grep
```

## Data layer — `scripts/lib/session-detail.js`

Two sources, both reusing existing machinery; no new cost math.

1. **`c.tools`** — already attached to every `perCall` entry (`call.tools.slice()`).
   The chart currently ignores it. → the `ran:` line.

2. **`c.contextSources`** — new field on each **main** call: the top-3 events that
   landed in context right before that call (= what was newly written into this
   step), each `{ tool, target }`, sorted by `estTokens` desc then trimmed to 3.
   Subagent calls get no `contextSources`.

   Derivation reuses the proven `afterStep` → per-call mapping that
   `assistantOutput.topSteps[].trigger` already relies on. `triggerByIdx` keeps
   only the single biggest event per `afterStep`; we need the top 3, so build a
   sibling map that keeps all events per `afterStep`, then attach per main call:

   ```js
   // After consumerEvents are complete and triggerByIdx is built:
   const sourcesByIdx = new Map(); // afterStep → events[]
   for (const e of consumerEvents) {
     const arr = sourcesByIdx.get(e.afterStep) || [];
     arr.push(e); sourcesByIdx.set(e.afterStep, arr);
   }
   mainCalls.forEach((c, j) => {
     const evs = sourcesByIdx.get(mainIdx[j]);
     if (evs && evs.length) {
       c.contextSources = evs
         .slice().sort((a, b) => b.estTokens - a.estTokens).slice(0, 3)
         .map((e) => ({ tool: e.tool, target: e.target }));
     }
   });
   ```

   `mainCalls` holds references into `perCall`, which `analyze.js` emits verbatim
   as `calls`, so the field reaches the renderer. `estTokens` is used only for
   ranking and is intentionally NOT serialized (the tooltip shows no per-source
   numbers — decided in design Q1).

## Renderer — `scripts/render-report.js` (`contextTimeline`)

- Add two helpers near the existing `ctxOf`/`writtenOf` group:
  - `toolTally(tools)` → `"Read ×2 · Bash · Edit"` (count duplicates, `×N` only
    when >1, joined by ` · `). Empty/absent → `''`.
  - `sourceLabel(src)` → `"Read foo.js"`: tool name + basename of `target`
    (last path segment for file paths; otherwise the target truncated to ~24
    chars). `user-prompt` → `"your message"`. Joined list built by the caller.
- On the cached (base) bar, emit `data-tools="<tally>"` and
  `data-source="<src1 · src2 · src3>"` (omit attribute when empty).
- Remove `data-prompt` from the bars and the `serving:` line from the JS tooltip.
- Native `<title>` fallback (no-JS / a11y): one concise line, e.g.
  `step N · Tk context · $cost · +Nm — ran Read ×2, Bash; +Yk written (Read foo.js, Bash git log)`.
  Keep it short; reuse the same tally/source strings.

## Template — `assets/report-template.html` (chart branch of `html()`)

Replace the `serving:` line (lines ~614–617) with:

```js
return '<div class="tip-h">Step ' + esc(d.step) + ' · ' + esc(d.total) + ' context</div>' +
  '<div class="tip-cost">' + esc(d.cost) + '</div>' +
  '<div class="tip-b">' + esc(d.cached) + ' re-read + ' + esc(d.written) + ' written · +' + esc(d.mins) + ' from start</div>' +
  (d.tools  ? '<div class="tip-b">ran: ' + esc(d.tools) + '</div>' : '') +
  (d.source ? '<div class="tip-b">+' + esc(d.written) + ' written ← ' + esc(d.source) + '</div>' : '');
```

## Edge cases

- Step ran no tools → omit the `ran:` line.
- No `contextSources` (session-start step, no consumer events, subagent) → omit
  the `written ←` line. A pure-text reply with neither drops to 3 lines (accepted, design Q3).
- Long / non-path `target` → truncate to ~24 chars; file paths shown as basename.
- All targets HTML-escaped (paths/commands can contain `<`, `&`, quotes).

## Tests

- **session-detail**: a main call whose preceding events are a 4k Read, 1.5k Bash,
  0.5k Grep gets `contextSources` = those three, Read first; a 4th smaller event is
  dropped; subagent calls have no `contextSources`; a step with no preceding events
  has none.
- **render-report**: tooltip bar carries `data-tools` and `data-source`; `serving`
  and `data-prompt` are gone; native `<title>` shows the did/ate one-liner; chart
  still renders when `tools`/`contextSources` are absent (back-compat with old
  payloads); escaping holds for a hostile target.
- **mock**: extend `assets/mock-detail.json` so `--mock` demonstrates both lines.

## Out of scope

- Per-source token figures in the tooltip (decided against, Q1).
- Changing the turn-tick hover below the axis (still shows the full prompt).
- Any change to cost math, tiers, reset/rebuild markers.
