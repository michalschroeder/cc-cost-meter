# cc-cost-meter

A [Claude Code](https://claude.com/claude-code) skill that explains **where a session's
tokens and dollars went**. It breaks a session's spend down by token type, model, turn, and
subagent, attributes what filled the context window, and produces an interactive HTML report.

Costs are **recomputed from raw token counts × LiteLLM per-token prices** (not Claude's
reported totals), so the numbers are itemized and auditable. Pure Node stdlib — no install,
no dependencies, runs offline against a bundled price snapshot.

**▶ [See a live sample report](https://michalschroeder.github.io/cc-cost-meter/)** — the full
interactive HTML for a mock session (context timeline, per-turn spend, thinking breakdown, grade).

## What it answers

- Why was this session expensive? What was the single biggest lever?
- Which files / commands / prompts filled the context window (and the carried re-read cost)?
- How much did reasoning (thinking tokens) cost, and which prompts drove it?
- How much did each skill dispatch / subagent / model cost?
- How much would a `/compact` have saved (spend above 200k context)?

## Usage

As a Claude Code skill:

```
/cc-cost-meter 848c5b25                # detail report for a session (by id prefix)
/cc-cost-meter list --last 20          # rank recent sessions by cost
/cc-cost-meter 848c5b25 --config-dir ~/.claude-other
```

Or drive the analyzer directly (JSON output, no model needed):

```bash
cd skills/cc-cost-meter
node scripts/analyze.js list --last 10                 # recent sessions + budget periods
node scripts/analyze.js <session-id-prefix>            # full per-session cost breakdown
```

Flags: `--config-dir <path>` (transcript root, default `~/.claude`), `--out <path>`
(report path), `--last N`, `--since YYYY-MM-DD`.

## Install

The skill lives in [`skills/cc-cost-meter/`](skills/cc-cost-meter). Copy that directory into
your Claude Code skills location, then invoke `/cc-cost-meter`:

```bash
cp -r skills/cc-cost-meter ~/.claude/skills/        # or a project's .agents/skills/
```

## Layout

- `skills/cc-cost-meter/` — the skill (copy this into your skills location).
  - `SKILL.md` — the skill definition and workflow (start here).
  - `scripts/analyze.js` — self-contained JSON analyzer; `render-report.js`, `apply-summaries.js`.
  - `scripts/lib/` — the cost engine (transcript parsing, per-call cost math, aggregation).
  - `data/model_prices.json` — bundled LiteLLM price snapshot (offline default).
  - `assets/report-template.html` — the HTML report template; `assets/mock-detail.json` — the
    demo payload behind the [sample report](https://michalschroeder.github.io/cc-cost-meter/)
    (`node scripts/render-report.js --mock --out ../../docs/index.html` to regenerate it).
  - `REFERENCE.md` / `DESIGN.md` — the cost model and design notes.
  - `SYNC.md` — how the cost engine is vendored from
    [claude-statusline](https://github.com/michalschroeder/claude-statusline).

## Tests

```bash
node --test skills/cc-cost-meter/scripts/test/*.test.js
```

## License

MIT — see [LICENSE](LICENSE).
