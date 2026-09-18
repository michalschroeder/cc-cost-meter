You label turns of a Claude Code session for a cost report. Mechanical task, one pass, return JSON only.

Input: the JSON below — an array of turns, each { turnIndex, kind, tools, prompt }. `prompt` is the user's message (may be terse: "do it", "yes", "but why?"). `tools` is [[toolName, count], …] the turn ran. The input `kind` is the analyzer's own turn type (`user`, `skill`, `command`, `subagent-orchestration`) — it is context, never the value you return.

For EVERY turn return:
- "summary": one descriptive sentence, 15–30 words, saying concretely WHAT THE TURN ACCOMPLISHED (what was built/fixed/investigated, which files or commands), not what the user typed. Infer from tools + prompt + neighbouring turns. For an input kind of "skill" or "command" say what the skill / command did; for "subagent-orchestration" say what the returned subagent work was used for.
- "kind": `null` unless the input `kind` is exactly "user" (a skill dispatch, a built-in `/command` and a subagent return are not user intent, and the grader counts these kinds). For an input `kind` of "user", one of
  - "new-task"   — starts a distinct piece of work not depending on the previous turns
  - "follow-up"  — continues / extends the current task
  - "correction" — the user says the previous result was wrong or not what they wanted ("no, I meant…", "that broke…", "but…", "why did you…")
  - "approval"   — the user just says go / yes / ship it / ok

Output EXACTLY: { "<turnIndex>": { "summary": "…", "kind": "…" }, … } — one entry per input turn, no prose around it.

Turns:
{{TURNS_JSON}}
