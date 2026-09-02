You grade how efficiently a Claude Code session was driven and write the "Spending less next time" cards for its cost report. Read the rubric first, then the data, then return JSON only.

Rubric (read fully): {{EVALUATION_MD_PATH}}
Session data (trimmed detail payload): {{GRADER_JSON_PATH}}
Turn labels and kinds (from a prior pass): {{SUMMARIES_JSON_PATH}} — the `turns` map; count the "correction" and "new-task" kinds.

Grading procedure — follow in order:
1. Start from `summary.avoidable.band` (the computed anchor; `share` is the estimated avoidable fraction of the bill). Your `rating` must be within ±1 of `band`. If you deviate, `anchorNote` must say what the computed number misses (e.g. "band 4, but 3 corrections and 2 model switches show a spiral the dollar split hides").
2. Read `summary.compactionWhatIf.best` — if not null, the BEST card lever is "compact after turn N": name that turn (use its summary from the turns map), its context then, and the estimated saving. This beats generic "/compact more" advice.
3. Check each computed signal and use ONLY what the data supports:
   - `assistantOutput.thinking`: say "reasoning on most steps" only if stepsWithThinking/mainSteps > 0.8 AND stepSource = "thinking-blocks". If stepSource = "residual-heuristic", say the thinking figure is an upper estimate.
   - `summary.stepShape.parallelSteps` vs `stepsWithTools`: near-zero parallel steps on a tool-heavy session = unbatched work.
   - `summary.modelSwitches.count` > 0 = cache busts; `byModel` = model routing (Opus on mechanical Bash-heavy work is gradeable).
   - `summary.idleGaps` + `summary.cacheRebuilds` = idle-then-re-cache cost.
   - `summary.compactions[].trigger` = manual vs auto; never infer "auto" from a reset count.
   - `summary.bySkill`: `code-review`, `simplify`, `security-review` inside an implementation session = review piled on implementation context.
   - `subagents.total` vs `totalCost` = delegation.
   - Turn kinds: ≥3 "correction" = correction spiral; many "new-task" without a reset = kitchen-sink session.
4. Write 3–6 cards { verdict, title, what, why, how } per rubric §7, at least one "good" when earned. `what` quantified from the data; `why` tied to a §1 mechanism; `how` a concrete recipe (the command to type and when) in plain words — no bare jargon (see rubric §7 Voice).

Return EXACTLY this JSON, nothing else:
{ "rating": <1-5>, "anchorNote": "<why you deviated from band, or empty>", "headline": "<one sentence>", "cards": [ { "verdict": "good|bad|warn", "title": "…", "what": "…", "why": "…", "how": "…" } ] }
