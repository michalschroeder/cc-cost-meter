# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single Claude Code skill (`skills/cc-cost-meter/`) that explains where a Claude Code
session's tokens and dollars went, and renders an interactive HTML report. Pure Node stdlib —
no dependencies, no build step, no install. Costs are **recomputed from raw token counts ×
bundled LiteLLM per-token prices**, never read from Claude's reported totals.

## Commands

```bash
# Run the full test suite (node's built-in runner, no framework)
node --test skills/cc-cost-meter/scripts/test/*.test.js

# Run one test file
node --test skills/cc-cost-meter/scripts/test/smoke.test.js

# Drive the analyzer directly (JSON to stdout, no model needed)
cd skills/cc-cost-meter
node scripts/analyze.js list --last 10          # rank recent sessions by cost
node scripts/analyze.js <session-id-prefix>     # full per-session detail JSON

# Preview the report template with no session/model — renders a bundled mock payload
node scripts/render-report.js --mock --out /tmp/mock-report.html
```

`analyze.js` reads transcripts from `--config-dir <path>` (or `$CLAUDE_CONFIG_DIR`, default
`~/.claude`). There is no lint step.

## Architecture

The skill is a three-stage pipeline; the JSON between stages is the contract:

```
analyze.js  ──JSON──▶  (model writes summaries)  ──▶  apply-summaries.js  ──▶  render-report.js  ──▶  HTML
```

1. **`scripts/analyze.js`** — self-contained JSON analyzer. Two modes: `list` (rank sessions,
   uses `cost-aggregate`) and detail (one session id-prefix, uses `session-detail.buildDetail`).
   Emits a `legend` field that documents the cost model inline — read it first. Does **no** model
   calls.
2. **The model** (the skill's `SKILL.md` workflow, run by Claude) dispatches subagents to write
   human copy — turn summaries, context-consumer labels, and the 1–5 "Spending less next time"
   assessment — and merges them into one `summaries.json`.
3. **`scripts/apply-summaries.js`** merges that JSON back into the detail payload (turns by
   `turnIndex`, consumers by index, tips → `aiAssessment`), piped into **`scripts/render-report.js`**
   which produces the standalone HTML from `assets/report-template.html`.

### Cost engine (`scripts/lib/`)

The cost math is the substance. Key modules:
- `transcript.js` — parse `.jsonl` transcripts in-process (no jq); list sessions, find files.
- `cost-compute.js` — per-call cost from a usage record × prices (cache-write TTL split, etc.).
- `cost-aggregate.js` — roll per-call costs up across all sessions (list mode).
- `session-detail.js` — the big one (~600 lines): builds the full per-session detail —
  per-turn rollups, `contextGrowth`, `contextConsumers`, `assistantOutput.thinking`, `bySkill`,
  `highContextCost`. Precomputes all rollups so consumers do **not** re-aggregate `calls[]`.
- `pricing.js` — load the bundled `data/model_prices.json` snapshot (offline; no network).

**Do not re-aggregate `calls[]` to recompute totals** — the precomputed `summary.*` rollups are
the honest numbers; raw re-aggregation over-counts tools ~3× and invents false growth. This is a
documented trap (see `SKILL.md` step 3).

## Vendoring — important

`scripts/lib/*.js` and `data/model_prices.json` are a **vendored copy** of the cost engine from
the canonical [claude-statusline](https://github.com/michalschroeder/claude-statusline) repo.
Do not treat them as original source. To change cost logic, change it upstream and re-sync per
**`skills/cc-cost-meter/SYNC.md`**. The one intentional local delta: in `lib/pricing.js` the
`BUNDLED` path is `__dirname/../../data` (data sits at the skill root). Re-apply after any re-copy.

## Reference docs

- `skills/cc-cost-meter/SKILL.md` — the skill definition and full workflow (start here for behavior).
- `skills/cc-cost-meter/REFERENCE.md` — the cost interpretation model (subagents cheap, main-context bloat is the cost).
- `skills/cc-cost-meter/EVALUATION.md` — the 1–5 grading rubric the assessment subagent reads.
