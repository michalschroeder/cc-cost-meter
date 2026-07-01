# Context-window chart: cache-rebuild clarity redesign

Date: 2026-06-25
Scope: the "Context window over time" chart only (`contextTimeline` in
`scripts/render-report.js`), its detection logic in `scripts/lib/session-detail.js`,
the chart's prose/legend in `assets/report-template.html`, the assessment note, and
tests. The "grouped by message" chart and all other sections are untouched.

## Problem

The chart plots only `cacheRead` as bar height. When the prompt cache expires and is
rebuilt, `cacheRead` collapses for one step while that step re-writes the whole window
(`cacheWrite` spikes, cost spikes). The conversation never shrank, but the chart shows a
drop-to-near-zero then an instant refill, and the dashed "conversation cleared" line
mislabels it as a /compact. Proven on session 5a2d4c42: step 87=201k, step 88=9k/$1.96
(rebuild), step 89=204k.

## Decisions (approved)

1. **Bar model = real context.** Total height = `cacheRead + cacheWrite + input`.
   - Cached segment (bottom) = `cacheRead`, tier-colored green/amber/red by the *cacheRead*
     value (unchanged — keeps exact parity with the "spent above 200k" card).
   - Written segment (top, stacked) = `cacheWrite + input`, single **hatched-slate** fill.
   - A rebuild = short green cached base + tall written cap, same total height → no fake drop.
   - A real /compact = total height drops and stays low.
2. **Reset line fires on total-context drop**, not cacheRead drop → rebuilds no longer draw
   the dashed "cleared" line. Threshold reuses `RESET_DROP` (100k).
3. **Cache-rebuild detection** (reuses `RESET_DROP`): a step where `cacheRead` collapsed
   (`prevCacheRead - cacheRead > RESET_DROP`) BUT total context held (no total drop > RESET_DROP).
   Marked with its own glyph (⟳) under the axis, distinct from the clear line.
4. **Timeline = option A** (step-spaced bars + time annotations):
   - hover shows "+Nm from start" per bar (from `ts` vs first `ts`).
   - a few X-axis minutes-from-start labels (quartiles).
   - a **gap marker** before any step preceded by an idle gap > cache TTL.
5. **Warning** (deterministic, when rebuilds > 0): standalone callout under the chart AND a
   line folded into the "Spending less next time" assessment.

## Data / API changes

`session-detail.js buildSummary`:
- new `summary.cacheRebuilds = { count, extraCost }` where extraCost = sum of `cacheWrite`
  cost on detected rebuild steps.
- detection uses total = `input + cacheRead + cacheWrite` per main call.

`render-report.js`:
- `ctxOf` → split into `cachedOf` (cacheRead) and `writtenOf` (cacheWrite+input); total = sum.
- `contextTimeline` draws two stacked rects per step; tier color on cached segment only;
  hatched-slate on written segment; reset line keyed on total drop; rebuild glyph; per-bar
  `data-cached / data-written / data-total / data-mins`; quartile time labels.
- new `cacheRebuildCallout(summary)` → callout HTML (empty string when count 0).
- assessment note: append the rebuild line when count > 0.

`report-template.html`:
- rewrite the chart `.explain` prose (two segments, true height, rebuild vs clear, time).
- legend: add "cached (re-read)", "written this step", "cache rebuilt" entries.
- add `{{CACHE_REBUILD_CALLOUT}}` placeholder under the chart legend.
- hatched-slate fill + glyph CSS.

## Cache TTL fact (for copy)

~1 hour on a Claude subscription; ~5 minutes on API-key usage. A gap longer than that
forces a full cache re-write.

## Tests

- `smoke`/detail: `summary.cacheRebuilds` present and correct on a crafted rebuild fixture.
- `render-report`: timeline emits two segments + rebuild glyph; callout appears iff count>0.
- `--mock` payload gains a rebuild step so the preview exercises the new path.

## Out of scope

Time-spaced bars (option B); changes to the message-grouped chart; changing
`highContextCost` semantics (still cacheRead-based, matching the cached segment).
