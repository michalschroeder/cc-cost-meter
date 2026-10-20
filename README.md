# cc-cost-meter

A [Claude Code](https://claude.com/claude-code) skill that explains where a session's tokens
and dollars went. It splits the spend by token type, model, turn, and subagent, names what
filled the context window, and renders an interactive HTML report.

Costs are recomputed from raw token counts times LiteLLM per-token prices, not read from
Claude's reported totals, so every number is itemized and auditable. Pure Node stdlib: no
install, no dependencies, and it runs offline against a bundled price snapshot.

[See a live sample report](https://michalschroeder.github.io/cc-cost-meter/): the full
interactive HTML for a mock session (context timeline, per-turn spend, thinking breakdown, grade).

<p align="center">
  <a href="https://michalschroeder.github.io/cc-cost-meter/">
    <img src="docs/assets/sample-report.png" alt="Sample cc-cost-meter report" width="640">
  </a>
</p>

## What it answers

- Why was this session expensive? What was the single biggest lever?
- Which files / commands / prompts filled the context window (and the carried re-read cost)?
- How much did reasoning (thinking tokens) cost, and which prompts drove it?
- How much did each skill dispatch / subagent / model cost?
- Where would a single `/compact` have paid off most, and how much would it have saved?
- What's the overall grade (1 to 5) for spending efficiency? The grade is anchored to a computed
  avoidable-share band shown under the badge, and past grades show up in `list` output.

## Usage

As a Claude Code skill:

```
/cc-cost-meter                         # list recent sessions, ask which to analyze
/cc-cost-meter 848c5b25                # detail report for a session (by id prefix)
/cc-cost-meter 848c5b25 --no-assess    # skip the grading subagents (auto when cost < $0.50)
/cc-cost-meter list --last 20          # rank recent sessions by cost (+ recorded grades)
/cc-cost-meter 848c5b25 --config-dir ~/.claude-other
```

A detail run prints a fixed cost-story skeleton inline (cost split, top context consumers, best
compact point, grade) and writes `session-cost-<shortid>.html` to the current directory.
Subagents write the turn labels, consumer labels, and the 1 to 5 "Spending less next time"
assessment from bundled prompts. Everything else is computed.

Or drive the analyzer directly (JSON output, no model needed):

```bash
cd skills/cc-cost-meter
node scripts/analyze.js list --last 10                 # recent sessions + period totals
node scripts/analyze.js <session-id-prefix>            # full per-session cost breakdown
```

Flags: `--config-dir <path>` (transcript root, default `~/.claude` or `$CLAUDE_CONFIG_DIR`),
`--last N` / `--since YYYY-MM-DD` (list mode), `--out <path>` (report path, skill /
`render-report.js` only), `--no-assess` (skill only).

## Install

Requires Node.js and Claude Code.

**As a Claude Code plugin (recommended).** This repo is its own plugin marketplace. In a
Claude Code session:

```
/plugin marketplace add michalschroeder/cc-cost-meter
/plugin install cc-cost-meter@cc-cost-meter
```

Then run `/cc-cost-meter` as usual. The `/` menu lists it as `/cc-cost-meter:cc-cost-meter`
because plugin skills are namespaced; the long form is only needed if another command already
uses the short name. The skill also triggers on its own when you ask where a session's cost went. To update, run
`/plugin marketplace update cc-cost-meter`, or turn on auto-update for the marketplace under
**Marketplaces** in `/plugin`.

**From a git clone.** The skill lives in [`skills/cc-cost-meter/`](skills/cc-cost-meter).
Clone the repo and symlink that directory into your Claude Code skills location:

```bash
git clone https://github.com/michalschroeder/cc-cost-meter.git ~/src/cc-cost-meter
mkdir -p ~/.claude/skills
ln -s ~/src/cc-cost-meter/skills/cc-cost-meter ~/.claude/skills/cc-cost-meter
```

For a single project, link into `<project>/.claude/skills/` instead. If you use a custom
config dir (`$CLAUDE_CONFIG_DIR`), link into its `skills/`.

Start a new Claude Code session and run `/cc-cost-meter list` to check it works.

**Update.** Pull the clone. The symlink picks up the new version, including the latest
price snapshot:

```bash
git -C ~/src/cc-cost-meter pull
```

**Uninstall.** `rm ~/.claude/skills/cc-cost-meter` (removes only the link), then delete the clone.

Prefer a plain copy? `cp -r skills/cc-cost-meter ~/.claude/skills/` works too, but you
update by hand.

**Via the [`skills`](https://github.com/vercel-labs/skills) CLI.** It installs straight from
this GitHub repo:

```bash
npx skills add michalschroeder/cc-cost-meter -g -a claude-code
```

Drop `-g` to install into the current project instead. Update with `npx skills update`.

> **Claude Code only.** The `skills` CLI can install into other agents (Cursor, Codex, …),
> but this skill reads Claude Code transcripts and depends on Claude Code features, so it
> won't work anywhere else. Keep `-a claude-code`.

## Layout

- `.claude-plugin/`: plugin and marketplace manifests, so the repo installs via `/plugin`.
- `skills/cc-cost-meter/`: the skill. Link or copy this into your skills location.
  - `SKILL.md`: the skill definition and workflow. Start here.
  - `scripts/analyze.js`: self-contained JSON analyzer. `grader-view.js` trims the payload
    for subagents, `apply-summaries.js` merges the model-written copy, `render-report.js`
    produces the HTML.
  - `scripts/lib/`: the cost engine (transcript parsing, per-call cost math, aggregation,
    compaction what-if, grade history).
  - `references/`: the subagent prompts (turns, consumers, grader, critic).
  - `data/model_prices.json`: bundled LiteLLM price snapshot, the offline default.
    `scripts/sync-prices.js` refreshes it from upstream; a daily GitHub Action opens a
    PR when rates drift.
  - `assets/report-template.html`: the HTML report template. `assets/mock-detail.json` is the
    demo payload behind the [sample report](https://michalschroeder.github.io/cc-cost-meter/).
    Run `node scripts/render-report.js --mock --out ../../docs/index.html` to regenerate it.
  - `REFERENCE.md`, `EVALUATION.md`, `DESIGN.md`: cost model, grading rubric, design notes.
  - `evals/`: grading reproducibility evals. See its README.

## Tests

```bash
node --test skills/cc-cost-meter/scripts/test/*.test.js
node skills/cc-cost-meter/scripts/render-report.js --mock --out /tmp/mock.html   # template preview
```

The skill appends each grade to `grades.jsonl` under `$XDG_STATE_HOME/cc-cost-meter/` (default
`~/.local/state/cc-cost-meter/`), one subdir per `--config-dir` profile.

## License

MIT. See [LICENSE](LICENSE).
