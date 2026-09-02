# Grading evals

Measures the "Spending less next time" grade for reproducibility and advice quality.

## Layout
- `evals.json` — cases: a session prefix, the expectation, assertions (see `check.js` for types).
- `fixtures/<name>.grader.json` — trimmed payloads, generated, gitignored (they hold your prompts).
- `runs/<iteration>/<name>/run-<k>.json` — one grader+critic output per run, gitignored.

## Run one iteration
1. `./make-fixtures.sh` (after any analyzer change).
2. In a Claude Code session in this repo, for each case and for k = 1..3, dispatch the grader and
   critic exactly as `SKILL.md` step 5 does (prompts from `references/`, `{{GRADER_JSON_PATH}}` =
   the fixture, `{{SUMMARIES_JSON_PATH}}` = a turns map produced once per fixture by the turns
   prompt). Save the critic's final JSON to `runs/<iteration>/<name>/run-<k>.json`.
3. `node check.js runs/<iteration>` → per-case pass rate, rating spread across runs, failing
   assertions. A case whose three runs differ by more than one point is a reproducibility failure
   regardless of assertions.
4. Iterate on `references/grader-prompt.md` / `critic-prompt.md` / `EVALUATION.md`, bump the
   iteration, repeat. Keep `check.js` output of the last two iterations in the PR description.

## Baseline (iteration 1, 2026-09-03)

Three runs per case: `grader-prompt.md` → `critic-prompt.md` (both opus), turn labels from
`turns-prompt.md` (haiku), fixtures regenerated the same day.

```
FAIL kitchen-sink-opus-no-compact: runs=3 pass=96% ratings=[2,2,2] spread=0
ok   cheap-focused-session: runs=3 pass=100% ratings=[4,4,4] spread=0
ok   mid-session-with-subagents: runs=3 pass=100% ratings=[3,3,3] spread=0
  - kitchen-sink-opus-no-compact/run-2.json: some card matches /batch|one step|at once|in parallel/ — no card matched
overall pass 99%
```

Reproducibility is the headline: every case returned the same rating in all three runs
(spread 0), and each landed exactly on the computed `summary.avoidable.band` (2 / 4 / 3).
The single failure is card selection, not grading: in one kitchen-sink run the critic
swapped the batching card for the reducible-thinking lever (both supported by the data),
so the batching assertion found no match. 26 of 27 assertions pass.
