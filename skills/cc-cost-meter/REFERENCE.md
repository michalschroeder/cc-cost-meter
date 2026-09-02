# Cost interpretation model

**Cost ≈ context-size × steps. Subagents are cheap; bloated MAIN-session context is the real cost.**

- The MAIN thread re-reading/re-caching its own accumulated context dominates: typically
  `cache-read` (~47%) + `cache-write` (~31%) ≫ `output` (~20%) ≫ fresh `input` (~2%).
- Each subagent spawns with its **own fresh ~5–35k context** — it does **not** inherit the
  parent's 200k+. It returns only a few-KB summary. So fan-out (planning, parallel review
  lenses, research) costs cents. In one measured $32.94 session, all 11 subagents (226 calls)
  were **$1.04 (3%)**; the main session (192 calls) was **$31.90 (97%)**.
- `summary.highContextCost` = the FULL spend on calls **above 200k context** — an **upper bound**
  on what earlier compaction could have saved (a `/compact` shrinks context to a summary, not
  zero, and the post-compact steps still cost something), not the exact saving.
- `summary.byTurnKind` "subagent-orchestration" cost is **not** the subagents — it's the parent
  taking steps while already at 200k+. The fix is always: shrink the parent's context.

## Levers, by impact

1. Keep MAIN-session context small — `/compact` or a fresh session between distinct phases.
   Context never shed = every later step pays the full tax.
2. Push heavy exploration INTO subagents — nearly free, keeps the parent lean.
3. Treat "subagent-orchestration" cost as a parent-context problem, not a subagent problem.

## How to read the detail JSON

- `legend` — the cost model, embedded so numbers are interpreted correctly.
- `components` — itemized `{input, output, cacheWrite, cacheRead, web, total}` dollars.
- `summary.contextGrowth` — `{firstCall, quartileAvgContext[4], peakContext}` per-step cacheRead:
  the honest growth curve. A turn's `tokens.cacheRead` is a SUM across its steps, NOT context size.
- `summary.toolTally` — canonical main-session tool counts. Do not recompute from `calls[]`.
- `summary.contextConsumers` — WHAT filled the context, by concrete target: each tool result
  (which file was Read, which Bash command ran, which pattern was Grepped) and user prompt,
  with `estTokens` (~chars/4) and `carriedCost` (the re-read tax on every later step). Includes
  synthetic rows so the table explains ~all of peak context: `session-overhead` (system prompt +
  tool defs) and the model's own output split by kind — `assistant-text` (prose replies),
  `assistant-thinking` (extended-thinking blocks) — its carried cost counts only the remaining
  steps of its own turn, because prior-turn thinking is stripped from context at the next user
  message, `assistant-tool-calls` (arguments it wrote:
  Edit payloads, Bash commands, subagent prompts; the label names the top tools). When
  assistant-* rows dominate, the session's cost driver is the model's own verbosity (long
  thinking, big Edit payloads), not what it read. Use `top` to name the exact files/commands
  that consumed the context; numbers are estimates — say so when reporting them.
- `summary.assistantOutput` — the drill-down behind those assistant-* rows. `byKind` splits the
  model's output_tokens (billed at the full output rate, the priciest tier) into
  `text`/`thinking`/`toolCalls` with apportioned cost. `thinking` explains the big bucket:
  `unstoredTokens` is interleaved thinking — billed in `output_tokens` but never written to the
  transcript (inferred as output_tokens minus visible chars/4 — an UPPER estimate: dense
  code/tool args run ~3–3.5 chars/token, so some of it is really tool-call payload) — vs
  `storedTokens` (saved thinking
  blocks); `byTurn` names WHICH prompts drove the reasoning; `topSteps` are the heaviest single
  bursts, each with its `trigger` — what landed in context right before (the tool result or
  prompt it was reacting to) — and the action it took next. The thinking TEXT is never
  persisted anywhere, so trigger → next-action is the maximum attribution the transcript
  supports. High thinking is intrinsic to debugging loops (every tool result
  triggers a reasoning pass) — the lever is fewer, bigger steps and pushing iterate-heavy loops
  into subagents, not "think less".
- `summary.bySkill` — cost per skill dispatch (skill name extracted from the expansion prompt or
  `/slash` command), with turns/steps/token sums. Scope caveat: it counts only the turns the
  dispatch itself drove — a skill whose instructions shaped the rest of the session (e.g. a
  workflow skill) costs more than its own turns show; its expansion also sits in context as a
  `user-prompt` consumer row with a carried cost.
- `summary.stepShape` / `modelSwitches` / `idleGaps` — batching (parallelSteps = steps that issued
  >1 tool call), model changes between steps (each re-writes the cache), and pauses >5 min (phase
  boundaries where a /compact was cheap).
- `byModel` / `byAgent` / `subagents` — cost split by model, by subagent task, and the subagent total.
- `turns` (execution order) carry `kind` / `avgContext` / `peakContext`.
