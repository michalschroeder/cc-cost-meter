'use strict';
// "What if you had run /compact here?" — a deterministic counterfactual over the
// main session's per-step context sizes. A /compact replaces the window with a
// summary of POST tokens; every later step then re-reads (actual − removed) tokens
// instead of the full window, until a REAL reset in the session (which already
// shrank it). The compaction itself costs one re-read of the window at that step's
// cache-read rate (the summarization call). Savings are estimates: per-call rates
// are the actual ones (a shrunken window might drop below the >200k tier and be
// cheaper still), and cache-write effects are ignored.

const POST_TOKENS_DEFAULT = 15000; // typical post-/compact summary size when the session has no real compaction to learn from
const TRIGGER_TOKENS = 120000;     // policy: compact at a turn boundary once the window exceeds this
const RESET_DROP = 100000;         // same total-drop threshold session-detail uses to detect real resets

// Indices i such that a real reset happened AT step i (context total dropped by > RESET_DROP).
function realResets(main) {
  const tot = main.map((c) => c.tokens.cacheRead + c.tokens.cacheWrite + c.tokens.input);
  const at = new Set();
  for (let i = 1; i < tot.length; i++) if (tot[i - 1] - tot[i] > RESET_DROP) at.add(i);
  return at;
}

// Turn boundaries: index e where step e is the last step of its turn and e+1 exists.
function boundaries(main) {
  const out = [];
  for (let e = 0; e + 1 < main.length; e++) if (main[e].turnIndex !== main[e + 1].turnIndex) out.push(e);
  return out;
}

const rateOf = (c) => (c.tokens.cacheRead > 0 ? (c.cacheReadCost || 0) / c.tokens.cacheRead : 0);

function buildCompactionWhatIf(mainCalls, compactions) {
  const main = mainCalls || [];
  const posts = (compactions || []).map((c) => c.postTokens).filter((n) => n > 0).sort((a, b) => a - b);
  const post = posts.length ? posts[Math.floor(posts.length / 2)] : POST_TOKENS_DEFAULT;
  const resets = realResets(main);
  const bset = boundaries(main);

  // One simulation run; `decide(e, simCtx)` says whether to compact at boundary e.
  // Returns { saving, atSteps }: saving = actual cache-read spend − simulated spend
  // − summarization costs (one re-read of the window per compaction). A real reset
  // at step i zeroes `removed` — the session already shrank the window there.
  const run = (decide) => {
    let removed = 0, simCost = 0, actualCost = 0;
    const atSteps = [];
    const isB = new Set(bset);
    for (let i = 0; i < main.length; i++) {
      const c = main[i];
      if (resets.has(i)) removed = 0;
      const cr = c.tokens.cacheRead;
      const sim = Math.max(0, cr - removed);
      actualCost += c.cacheReadCost || 0;
      simCost += sim * rateOf(c);
      if (isB.has(i) && decide(i, sim)) {
        simCost += sim * rateOf(c);
        removed = Math.max(0, cr - post);
        atSteps.push(i);
      }
    }
    return { saving: actualCost - simCost, atSteps };
  };

  let best = null;
  for (const e of bset) {
    const r = run((i) => i === e);
    if (r.saving > 0 && (!best || r.saving > best.estSaving)) {
      best = { afterTurn: main[e].turnIndex, afterStep: e + 1, contextThen: main[e].tokens.cacheRead, estSaving: r.saving };
    }
  }
  const pol = run((i, sim) => sim > TRIGGER_TOKENS);
  const policy = { compactions: pol.atSteps.length, estSaving: Math.max(0, pol.saving),
    atTurns: pol.atSteps.map((i) => main[i].turnIndex) };
  return {
    note: 'Simulated /compact at turn boundaries. best = the single boundary with the largest estimated saving ' +
      '(null when none saves money); policy = compact at every turn boundary where the window exceeds triggerTokens. ' +
      'A compaction replaces the window with a postTokensAssumed-token summary and costs one re-read of the window. ' +
      'Estimates from per-step cache-read spend; real resets in the session end a simulated compaction\'s effect.',
    postTokensAssumed: post,
    triggerTokens: TRIGGER_TOKENS,
    best,
    policy,
  };
}

module.exports = { buildCompactionWhatIf, TRIGGER_TOKENS, POST_TOKENS_DEFAULT };
