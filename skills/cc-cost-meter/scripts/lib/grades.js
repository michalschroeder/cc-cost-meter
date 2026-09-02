'use strict';
const fs = require('fs');
const path = require('path');

const FILE = 'grades.jsonl';

// Append one grade record. Best-effort: a missing/unwritable state dir is not fatal
// (the report was already rendered) — the caller logs and moves on.
function recordGrade(stateDir, rec) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(path.join(stateDir, FILE), JSON.stringify(rec) + '\n');
}

// Map<session, record> — last record per session wins (a re-graded session
// supersedes its earlier grade).
function readGrades(stateDir) {
  const m = new Map();
  let raw; try { raw = fs.readFileSync(path.join(stateDir, FILE), 'utf8'); } catch { return m; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o && typeof o.session === 'string') m.set(o.session, o);
  }
  return m;
}

module.exports = { recordGrade, readGrades };
