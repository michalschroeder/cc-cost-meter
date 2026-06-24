# cc-cost-meter report: dual-audience Basic/Advanced redesign

Date: 2026-06-24
Status: approved (design), pending implementation plan

## Problem

The HTML report has 11 `<h2>` sections, ordered evidence-first / conclusion-last.
Two issues:

1. **Payoff is buried.** The "Spending less next time" assessment — the only thing most
   users want — is the last section. The grade badge sits at the top but its reasoning
   cards are at the very bottom, split from it.
2. **Redundancy and overload.** Several sections tell the same story at different zoom
   levels (by-tool vs top-consumers; two thinking sections), and small "by X" tables
   (by-model especially) are reference, not insight. A casual reader faces a wall; an
   expert wants all of it.

Goal: serve **both** audiences from one report — a clean default for the casual reader,
the full forensic detail one click away for the expert.

## Decisions (settled in brainstorming)

- **One global toggle, default Basic.** A single `Show advanced` switch; default view
  shows only core sections.
- **Basic set** = Verdict, Context-over-time, Where-it-went, What-filled-context, Top turns.
- **Advanced set** = Reasoning, By skill, By model, Subagents.
- **Merge the redundant pairs**: by-tool tally folds into the consumers section; the two
  thinking sections combine into one "Reasoning" section. 11 → 9 sections.
- **All sections always render** (including when empty) — no hide-on-empty.
- Toggle state **persists in `localStorage`**.
- Add a plain-language lead-in to "Where it went".

## New structure (9 sections)

Basic (always visible, default):

1. **Verdict** — grade badge + "Spending less next time" cards, moved to the **top**
   (reunite the badge with its cards).
2. **Context window over time** — timeline SVG + grouped growth bar (unchanged content).
3. **Where it went** — cost by component, with a one-line plain-language lead, e.g.
   "Most of this paid to *re-read* accumulated context, not to generate new text."
4. **What filled the context** — merged: per-item top-consumers table is the body; the
   by-tool tally folds in as a compact summary strip above it (no longer its own `<h2>`).
5. **Top turns**.

Advanced (hidden until toggled, `.adv` class):

6. **Reasoning** — merged "what the reasoning cost" + "biggest reasoning bursts" under one heading.
7. **By skill**
8. **By model**
9. **Subagents**

## Toggle mechanism (self-contained, no deps)

- `Show advanced ▸` switch in the report header.
- `<body class="basic">` by default; CSS rule hides `.adv` sections when body has `basic`.
- ~15-line inline `<script>` toggles the body class and writes the choice to
  `localStorage`; on load it reads the stored choice (default Basic if unset).
- TOC nav updates to the new order; advanced TOC entries also carry `.adv` so they
  disappear with their sections in Basic view.

## Touch points

- `assets/report-template.html` — reorder sections, drop two `<h2>` headings via merge,
  add toggle markup + CSS + inline script, update TOC, retint as needed.
- `scripts/render-report.js` — move `ASSESS_CARDS` slot up under the badge; combine
  `CONSUMER_TOOL_ROWS` into the consumers section; group the three thinking slots under
  one section. No new data fields.
- `scripts/test/render-report.test.js` — update assertions for renamed/merged headings
  and assert the toggle markup + `.adv` gating.

## Out of scope

- No changes to `scripts/analyze.js`, the JSON contract, or `scripts/apply-summaries.js`.
- **No changes to `scripts/lib/*` or `data/`** (vendored cost engine) — so **no SYNC.md
  impact**.
- `assets/mock-detail.json` unchanged; `--mock` continues to render every section.

## Testing

- Existing `node --test scripts/test/*.test.js` must stay green after assertion updates.
- New assertions: badge+cards adjacency at top, merged headings present / removed
  headings absent, `.adv` class on the four advanced sections, toggle script present,
  default `body class="basic"`.
- Manual: `node scripts/render-report.js --mock --out /tmp/mock.html`, verify Basic view
  hides advanced sections and the toggle reveals them.
