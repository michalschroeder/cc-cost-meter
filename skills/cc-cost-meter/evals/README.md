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
