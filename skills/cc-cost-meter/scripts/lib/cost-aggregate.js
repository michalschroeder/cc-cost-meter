'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectDirs } = require('./transcript');
const { getModelCosts } = require('./pricing');
const { calculateCost } = require('./cost-compute');

// Local calendar YYYY-MM-DD from an ISO timestamp, or null if unparseable.
function dayKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Parse one transcript into a per-file call list: [{ id, dayKey, cost }].
// within-file dedup: keep the LAST occurrence per message.id (final usage),
// carrying the FIRST occurrence's timestamp. id-less calls get id:null (always
// kept; never globally deduped).
function parseFileCalls(file, pricing) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const byKey = new Map();   // internalKey -> { id, ts, usage, model }
  const order = [];          // first-seen internal keys
  let synth = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.type !== 'assistant' || !o.message) continue;
    const m = o.message;
    if (!m.usage || !m.model) continue;
    const realId = typeof m.id === 'string' && m.id ? m.id : null;
    const key = realId || `__synth__${synth++}`;
    if (!byKey.has(key)) order.push(key);
    const prev = byKey.get(key);
    byKey.set(key, { id: realId, ts: prev ? prev.ts : o.timestamp, usage: m.usage, model: m.model });
  }
  const calls = [];
  for (const key of order) {
    const { id, ts, usage, model } = byKey.get(key);
    const dk = dayKey(ts);
    if (!dk) continue;
    const cost = calculateCost(usage, getModelCosts(pricing.map, model));
    calls.push({ id, dayKey: dk, cost });
  }
  return calls;
}

// Aggregate all transcripts under configDir's projects/* (main session files
// AND nested <session>/subagents/agent-*.jsonl, attributed to the parent). Returns
// { perSession: {id:{days,total}}, byDay: {key:cost}, files: {path:{...,calls}}, pricingHash }.
// Every file is parsed on each call (one full pass over the transcript tree);
// global dedup (first occurrence wins) runs files mtime-ascending.
function aggregate(configDir, pricing) {
  const root = configDir || path.join(os.homedir(), '.claude');

  const candidates = [];
  const addCandidate = (file, sessionId) => {
    if (!sessionId) return;
    let st; try { st = fs.statSync(file); } catch { return; }
    candidates.push({ file, sessionId, mtime: st.mtimeMs, size: st.size });
  };
  for (const d of projectDirs(root)) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        addCandidate(path.join(d, e.name), e.name.slice(0, -'.jsonl'.length));
      } else if (e.isDirectory()) {
        // Subagent transcripts live under <sessionId>/subagents/agent-*.jsonl.
        // Anthropic bills their token usage, so include them, attributed to the
        // parent session (the dir name) — keeps per-session totals complete.
        const subDir = path.join(d, e.name, 'subagents');
        let subEntries;
        try { subEntries = fs.readdirSync(subDir, { withFileTypes: true }); } catch { continue; }
        for (const se of subEntries) {
          // Only agent-*.jsonl are billable subagent transcripts; ignore any
          // other sidecar files CC may place under subagents/ (e.g. *.meta.json).
          if (se.isFile() && se.name.startsWith('agent-') && se.name.endsWith('.jsonl')) {
            addCandidate(path.join(subDir, se.name), e.name);
          }
        }
      }
    }
  }
  candidates.sort((a, b) => a.mtime - b.mtime); // oldest first → first-occurrence wins

  const files = {};
  const perSession = {};
  const byDay = {};
  const seen = new Set();
  for (const c of candidates) {
    const calls = parseFileCalls(c.file, pricing);
    files[c.file] = { mtime: c.mtime, size: c.size, sessionId: c.sessionId, calls };
    const ps = perSession[c.sessionId] || (perSession[c.sessionId] = { days: {}, total: 0 });
    for (const call of calls) {
      if (call.id) { if (seen.has(call.id)) continue; seen.add(call.id); }
      ps.days[call.dayKey] = (ps.days[call.dayKey] || 0) + call.cost;
      ps.total += call.cost;
      byDay[call.dayKey] = (byDay[call.dayKey] || 0) + call.cost;
    }
  }
  return { perSession, byDay, files, pricingHash: pricing.pricingHash };
}

module.exports = { dayKey, parseFileCalls, aggregate };
