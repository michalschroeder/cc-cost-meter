#!/usr/bin/env bash
# Regenerate evals/fixtures/<name>.grader.json from the sessions named in evals.json.
# Fixtures hold your own prompts → the directory is gitignored. Re-run after any
# analyzer change so assertions see current fields.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
skill="$(cd "$here/.." && pwd)"
mkdir -p "$here/fixtures"
node -e '
const e = require(process.argv[1]);
for (const c of e.evals) console.log([c.name, c.session, c.config_dir || ""].join("\t"));
' "$here/evals.json" | while IFS=$'\t' read -r name session cfg; do
  args=("$session"); [ -n "$cfg" ] && args+=(--config-dir "$cfg")
  node "$skill/scripts/analyze.js" "${args[@]}" > "$here/fixtures/$name.detail.json"
  node "$skill/scripts/grader-view.js" < "$here/fixtures/$name.detail.json" > "$here/fixtures/$name.grader.json"
  echo "wrote fixtures/$name.grader.json"
done
