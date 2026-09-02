---
name: cc-cost-meter
description: >-
  Analyze why a Claude Code session was expensive — break down its token usage and cost
  by token type, model, turn, and subagent, and produce an HTML report. Use when the user
  asks where a session's cost or tokens went, why a session was costly, to analyze or audit
  token or dollar spend, to list recent sessions by cost, or mentions session cost, /compact
  savings, or context growth. Args: `[<session-id-prefix> | list]
  [--config-dir <path>] [--out <path>] [--last N] [--since YYYY-MM-DD]`. Examples:
  `/cc-cost-meter 848c5b25`,
  `/cc-cost-meter list --last 20 --config-dir ~/.claude-lendable`.
argument-hint: "[<session-id-prefix> | list] [--config-dir <path>] [--out <path>] [--last N] [--since YYYY-MM-DD]"
---

# cc-cost-meter

Drives `scripts/analyze.js` (self-contained, JSON-only) to explain a Claude Code session's
token usage and cost.

## Location — read first

The scripts are **bundled inside this skill** (pure Node stdlib, no install) — they do **NOT**
live in the user's repo, so don't `cd` there expecting to find them.

Every command below references the scripts via **`${CLAUDE_SKILL_DIR}`** — the Claude Code
substitution that expands to this skill's directory (works from any working directory). It is
already expanded to an absolute path in the text you are reading, so run the commands verbatim.
Without `--out` the report is written into the current working directory as
`session-cost-<shortid>.html`; the renderer prints the absolute path it wrote — relay that to
the user.

(Fallback: if a command ever shows a literal, unexpanded `${CLAUDE_SKILL_DIR}` or resolves to
an empty path, substitute the absolute path from the `Base directory for this skill: …` line
the loader printed.)

## Arguments

`/cc-cost-meter [<session-id-prefix> | list] [flags]` — parse the invocation for
these tokens **before** running the workflow; they map deterministically to the steps below.

| Token | Effect |
|---|---|
| `<session-id-prefix>` | Analyze that session (detail report). Omit → ask which (step 1). |
| `list` | List recent sessions by cost instead of a detail report. |
| `--config-dir <path>` | Non-default transcript root (e.g. `~/.claude-lendable`). Passed straight to `analyze.js`. |
| `--out <path>` | Report output path. Default: `./session-cost-<shortid>.html` in the current working directory. |
| `--last N` / `--since YYYY-MM-DD` | `list`-mode filters. |
| `--no-assess` | Skip the four grading subagents (turn/consumer labels and the "Spending less next time" grade). The report renders with "Assessment skipped". Also applied automatically when `totalCost < 0.50`. |

A **detail report** includes the model-written copy (step 5) unless `--no-assess` is given or the
session cost under $0.50 — grading a 40-cent session with four subagents costs more than the
session. (`list` mode produces no detail, so step 5 doesn't apply there.) Unknown flags: ignore.

### Examples

```bash
/cc-cost-meter 848c5b25                # detail report (model-written copy incl.)
/cc-cost-meter list --last 20          # rank recent sessions by cost
/cc-cost-meter 848c5b25 --config-dir ~/.claude-lendable
/cc-cost-meter 848c5b25 --no-assess    # skip the four grading subagents
```

## Workflow

1. **Select the session.**
   - If the user gave a session id/prefix, skip to step 2 with it.
   - Otherwise run `node ${CLAUDE_SKILL_DIR}/scripts/analyze.js list --last 10`, summarize the sessions
     inline (`title · $cost · age`, or `title · $cost · grade N/5 · age` when a row has a recorded
     grade), and ask which one to analyze.

2. **Pull the detail.** Run
   `node ${CLAUDE_SKILL_DIR}/scripts/analyze.js <prefix> > /tmp/detail.json` once, then read
   and parse that file. Step 5 reuses it — don't re-run `analyze.js` (each run re-parses the
   whole transcript tree). Read the `legend` field first — it states the cost model.

3. **Read the precomputed rollups, do NOT hand-aggregate `calls[]`.**
   Use `summary.contextGrowth`, `summary.byTurnKind`, `summary.toolTally`,
   `summary.highContextCost`, `summary.contextResets`, and `summary.contextConsumers`
   (for the manual-vs-auto /compact story read `summary.compactions[].trigger` — ground
   truth; **never** infer "auto-compacted" from the reset count, and if `compactions`
   is empty the trigger is simply unknown)
   (names the exact files/commands whose results filled the context, with estimated
   tokens and the carried re-read cost — lead with these when the user asks WHAT
   consumed the context). When `assistant-thinking` dominates the consumers, drill into
   `summary.assistantOutput.thinking` — stored vs unstored (interleaved) thinking, the
   per-turn attribution in `thinking.byTurn`, and `thinking.peakStep` — to say WHICH
   prompts drove the reasoning. `summary.bySkill` links cost to skill usage — the turns
   each skill dispatch drove. `summary.avoidable` (the computed grade anchor — `band` and
   `share`), `summary.compactionWhatIf` (`best` = the turn after which one `/compact` would
   have saved the most, with the estimate), `summary.stepShape` (batching), `summary.modelSwitches`,
   `summary.idleGaps`. Re-aggregating `calls[]` is a known trap: it over-counts
   tools ~3× and invents false "10× growth" from one early call. The script already
   computed the honest numbers — use them.

4. **Interpret** with the cost model in [REFERENCE.md](REFERENCE.md).

5. **Report.**
   - **Narrate the cost story inline using this fixed skeleton — exact headings, this order,
     every detail run.** Only the `<one sentence>` and the two lever lines are free text.

     ```markdown
     ## <session title> — $<total> total

     <one sentence: where the money went — the dominant token type / driver>

     **Cost split**
     - Token type: cache-read $X (Y%) · cache-write $X (Y%) · output $X (Y%) · input $X (Y%)
     - Main vs subagents: main $X (Y%) · subagents $X (Y%)

     **What filled the context** (of ~<peakContext> peak)
     1. <row.tool> — <target or summary> — ~<estTokens> tok, carried $<carriedCost>
     2. …
     3. …

     **Best compact point:** after turn <best.afterTurn> ("<that turn's summary>") at ~<best.contextThen> context — est. ~$<best.estSaving> saved. (Or: "none found — no boundary would have paid for itself.")

     **Grade:** <N>/5 (computed anchor <band>/5, ~<share>% avoidable) — <assessment headline>

     **Report:** <absolute path>
     ```

     Fill from fixed fields — do NOT improvise the numbers: token-type + main/subagent split from
     `components` / `byAgent`; the three rows are the top 3 of `summary.contextConsumers.top`
     **whatever their `tool`** (synthetic rows like `session-overhead` or `assistant-thinking` are
     real answers to "what filled it"; for an `unexplained` row say so); the compact line from
     `summary.compactionWhatIf.best`; the grade from `summary.aiAssessment.rating` /
     `.headline` and the anchor from `summary.avoidable`. When the assessment was skipped, the
     Grade line reads `**Grade:** skipped (<reason>) — computed anchor <band>/5`.

   - **Model-written copy** — four subagents (the Agent tool), each handling its whole batch in one
     call. The prompts are bundled files; read each, substitute the `{{…}}` slots, dispatch verbatim.

     ```bash
     # 1. Trim the payload for the subagents (never hand them detail.json — calls[] alone is ~400 KB):
     node ${CLAUDE_SKILL_DIR}/scripts/grader-view.js < /tmp/detail.json > /tmp/grader.json
     ```

     | # | Subagent | Model | Prompt file | Slots | Returns |
     |---|---|---|---|---|---|
     | 1 | turns | `haiku` | `${CLAUDE_SKILL_DIR}/references/turns-prompt.md` | `{{TURNS_JSON}}` = ALL `turns` from `/tmp/grader.json` as `[{turnIndex, kind, tools, prompt}]` | `{ "<turnIndex>": { summary, kind } }` |
     | 2 | consumers | `haiku` | `${CLAUDE_SKILL_DIR}/references/consumers-prompt.md` | `{{CONSUMERS_JSON}}` = `summary.contextConsumers.top` rows with `synthetic` **not** true, as `[{index, tool, target}]` (index = position in `top`) | `{ "<index>": "<phrase>" }` |
     | 3 | grader | `opus` | `${CLAUDE_SKILL_DIR}/references/grader-prompt.md` | `{{EVALUATION_MD_PATH}}`, `{{GRADER_JSON_PATH}}` (= `/tmp/grader.json`), `{{SUMMARIES_JSON_PATH}}` | `{ rating, anchorNote, headline, cards }` |
     | 4 | critic | `opus` | `${CLAUDE_SKILL_DIR}/references/critic-prompt.md` | same three paths + `{{DRAFT_JSON}}` = subagent 3's output | final `{ rating, anchorNote, headline, cards }` |

     Order: 1 and 2 in parallel → write `/tmp/summaries.json` with `turns` + `consumers` → 3 (it reads
     the turn kinds from that file) → 4 → add the critic's output as `tips` to `/tmp/summaries.json`.
     With `--no-assess` (or cost < $0.50) skip all four and write
     `{ "tips": { "skipped": "--no-assess" } }` or `{ "tips": { "skipped": "session under $0.50" } }`.

     ```bash
     # 2. Merge + render (the renderer needs the FULL detail, not grader.json):
     node ${CLAUDE_SKILL_DIR}/scripts/apply-summaries.js --summaries /tmp/summaries.json --record-grade < /tmp/detail.json \
       | node ${CLAUDE_SKILL_DIR}/scripts/render-report.js
     ```
     Add `--config-dir <path>` (same value passed to `analyze.js`) when the user gave one, so the
     grade is recorded under that profile's state dir.

     `/tmp/summaries.json` final shape:
     `{ "turns": { "<turnIndex>": { "summary": "…", "kind": "…" } }, "consumers": { "<index>": "…" },
        "tips": { "rating": 2, "anchorNote": "…", "headline": "…", "cards": [ … ] } }`.
     `apply-summaries.js` merges it (turns by `turnIndex` → `summary` + `userKind`; consumers by
     index; tips → `summary.aiAssessment`; `anchorNote` is for the critic, not rendered). The renderer
     prints the absolute path it wrote — relay it. It draws the grade badge with the computed anchor
     beneath it, so a reader sees both the model's grade and the number it was anchored to.

## Notes

- Costs are recomputed from raw tokens × LiteLLM prices — never Claude's reported cost.
  Dollars are API-equivalent value; a subscription (Pro/Max) user didn't marginally pay them.
- The analyzer is offline; it uses the bundled `data/model_prices.json` snapshot.
- The grade is anchored: `summary.avoidable.band` is computed from the compaction counterfactual,
  reducible thinking and cache rebuilds; the grader may move ±1 with a stated reason. Two reports
  of the same session should agree within one point.
