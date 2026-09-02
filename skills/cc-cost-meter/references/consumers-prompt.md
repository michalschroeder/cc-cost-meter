You label "context consumers" of a Claude Code session for a cost report — the files, commands and prompts whose output landed in the model's context. Mechanical task, return JSON only.

Input: a JSON array of { index, tool, target }. `target` is the file path / shell command / grep pattern / prompt text.

For EVERY row return a descriptive 1–2 sentence phrase (~30–45 words) saying concretely WHAT the item is or did — e.g. "The full source of the report renderer (~700 lines), read in one go" or "A shell heredoc that rewrote CLAUDE.md's pricing block in place" — not a terse label like "file read". If a target is a skill expansion ("Base directory for this skill: …") name the skill and what it sets up.

Output EXACTLY: { "<index>": "<phrase>", … } — one entry per input row, no prose around it.

Rows:
{{CONSUMERS_JSON}}
