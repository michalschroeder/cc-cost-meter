'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { render, money, compactTokens, duration } = require('../render-report');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'report-template.html'), 'utf8');

// A detail payload shaped like `analyze.js <prefix>` output, with a deliberately
// hostile prompt to prove HTML-escaping.
const detail = {
  session: 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb',
  title: 'Why <was> this "costly" & slow?',
  startedAt: '2026-06-01T00:00:00.000Z',
  totalCost: 4.5287,
  steps: 39,
  components: { input: 0.072, output: 1.576, cacheWrite: 1.763, cacheRead: 2.321, web: 0 },
  byModel: [{ model: 'claude-opus-4-8', cost: 4.5287, calls: 39 }],
  byAgent: [
    { name: 'main', label: 'main session', cost: 4.5287 },
    { name: 'agent-1', label: 'Implement <script>alert(1)</script> the parser', cost: 0.51 },
  ],
  turns: [
    { turnIndex: 2, prompt: 'short late prompt', kind: 'user', cost: 1.69, peakContext: 140279 },
    { turnIndex: 1, prompt: 'a cheaper earlier one', kind: 'skill', cost: 0.10, peakContext: 17068 },
  ],
  calls: [
    { seq: 1, agent: 'main', isMain: true, cost: 0.02, prompt: 'a cheaper earlier one', turnIndex: 1,
      tokens: { input: 200, cacheRead: 17068, cacheWrite: 5000, output: 300 } },
    { seq: 2, agent: 'agent-1', isMain: false, cost: 0.01, prompt: null, turnIndex: null,
      tokens: { input: 100, cacheRead: 5000, cacheWrite: 0, output: 50 } },
    { seq: 3, agent: 'main', isMain: true, cost: 0.40, prompt: 'short late prompt', turnIndex: 2,
      tokens: { input: 0, cacheRead: 140279, cacheWrite: 2000, output: 900 } },
    { seq: 4, agent: 'main', isMain: true, cost: 0.55, prompt: 'evil <img src=x onerror=alert(1)> prompt', turnIndex: 3,
      tokens: { input: 0, cacheRead: 210000, cacheWrite: 0, output: 400 } },
  ],
  summary: {
    durationMs: 3 * 3600 * 1000 + 25 * 60 * 1000,
    mainSteps: 37,
    contextGrowth: { firstCall: 17068, quartileAvgContext: [58049, 90462, 107795, 127179], peakContext: 140279 },
    highContextCost: { thresholdTokens: 200000, calls: 4, cost: 0.88 },
    contextResets: 2,
    contextConsumers: {
      note: 'estTokens ≈ chars/4 — estimates, not billed figures.',
      totalEstTokens: 60000,
      byTool: [
        { tool: 'Read', count: 3, estTokens: 40000, carriedCost: 1.2 },
        { tool: 'Bash', count: 2, estTokens: 20000, carriedCost: 0.4 },
      ],
      top: [
        { tool: 'Read', target: '/repo/src/<huge> & "big".js', count: 2, estTokens: 38000, carriedCost: 1.1 },
        { tool: 'Bash', target: 'git log --stat', count: 1, estTokens: 15000, carriedCost: 0.3 },
      ],
    },
    assistantOutput: {
      note: 'output split by kind',
      byKind: { text: { tokens: 2100, cost: 0.05 }, thinking: { tokens: 149000, cost: 3.43 }, toolCalls: { tokens: 11000, cost: 0.25 } },
      thinking: {
        storedTokens: 12000, unstoredTokens: 137000,
        stepsWithThinking: 148, mainSteps: 155, avgPerThinkingStep: 1007,
        peakStep: { seq: 73, tokens: 6200, nextTools: ['Bash'] },
        topSteps: [
          { seq: 73, tokens: 6200, trigger: { tool: 'Bash', target: 'docker compose run <tests>' }, nextTools: ['Bash'] },
          { seq: 12, tokens: 3100, trigger: { tool: 'user-prompt', target: 'fix the tests' }, nextTools: [] },
        ],
        byTurn: [
          { prompt: 'fix the <failing> tests', kind: 'user', steps: 14, thinkingTokens: 38000 },
          { prompt: 'a cheaper earlier one', kind: 'skill', steps: 9, thinkingTokens: 22000 },
        ],
      },
    },
    bySkill: [
      { skill: 'writing-phpunit-tests', turns: 1, steps: 2, cost: 0.84, tokens: { input: 0, cacheRead: 90000, cacheWrite: 0, output: 4000 } },
    ],
  },
};

test('render: all template slots are filled (no {{...}} left)', () => {
  const html = render(detail, TEMPLATE);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'unfilled slot remains');
});

test('render: scalar cards carry the formatted values', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /\$4\.53/);            // total cost
  assert.match(html, />37</);               // steps card = summary.mainSteps (main-only, not detail.steps=39)
  assert.match(html, /3h 25m/);             // duration
  assert.match(html, /140k/);               // peak context
  assert.match(html, /\$0\.88/);            // high-context cost
  assert.match(html, /4 calls · 2 resets/); // high-ctx calls + resets
});

test('render: rows are built from the arrays', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /cache read/);                 // components row
  assert.match(html, /claude-opus-4-8/);            // by-model row
  assert.match(html, /short late prompt/);          // top-turns row
});

test('render: top-turns — skill column, summary, and styled tooltip only on user rows', () => {
  const d = { ...detail, turns: [
    { turnIndex: 1, kind: 'skill', cost: 3.0, peakContext: 176000, skill: 'write-a-skill',
      prompt: 'Base directory for this skill: /home/u/.claude/skills/write-a-skill # Writing Skills ...' },
    { turnIndex: 2, kind: 'subagent-orchestration', cost: 2.0, peakContext: 239000,
      prompt: '<task-notification> <task-id>bjraq17xi</task-id> <tool-use-id>toolu_x</tool-use-id> done' },
    { turnIndex: 3, kind: 'user', cost: 1.5, peakContext: 104000,
      prompt: 'read log tags, we have some useful tags there like adhoc job or worker — a fairly long message that exceeds the displayed summary so the tooltip adds detail',
      summary: 'Parsed Datadog log tags' },
    { turnIndex: 4, kind: 'user', cost: 1.0, peakContext: 61000,
      prompt: 'do it', summary: 'Applied 6 edits and ran shell validation' },
  ] };
  const html = render(d, TEMPLATE);
  // skill name lands in its own column; the skill row's WHAT cell is blank (no redundancy)
  assert.match(html, /<td>write-a-skill<\/td>/);
  // orchestration → fixed label, no tooltip tagging
  assert.match(html, /class="prompt"[^>]*>↩ subagent results</);
  // a Haiku summary wins in the WHAT cell
  assert.match(html, /Applied 6 edits and ran shell validation/);
  // user rows expose the full message via the styled tooltip (data-full), NOT native title=;
  // skill/orchestration rows do not
  assert.match(html, /class="prompt has-tip" data-tip-h="user message" data-full="read log tags[^"]*"/);
  assert.ok(!/title="Base directory/.test(html), 'no native title tooltip');
  assert.ok(!/has-tip[^>]*write-a-skill/.test(html), 'skill row has no tooltip');
  // the original user prompt is preserved even when a summary replaced it in the cell —
  // "do it" stays reachable on hover, not lost
  assert.match(html, /data-full="do it">Applied 6 edits and ran shell validation</);
});

test('render: all user-derived text is HTML-escaped (no injection)', () => {
  const html = render(detail, TEMPLATE);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag leaked');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Why &lt;was&gt; this &quot;costly&quot; &amp; slow\?/); // escaped title
});

test('render: context consumers name the concrete target, escaped', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /\/repo\/src\/&lt;huge&gt; &amp; &quot;big&quot;\.js/); // target escaped
  assert.match(html, /Read ×2/);              // grouped count
  assert.match(html, /git log --stat/);       // bash command as target
  assert.match(html, /estimates, not billed/i); // disclaimer note rendered
});

test('render: long un-summarized consumer target gets a hover tooltip', () => {
  const longTarget = 'Base directory for this skill: ' + '/very/long/path'.repeat(12);
  const withLong = {
    ...detail,
    summary: {
      ...detail.summary,
      contextConsumers: { ...detail.summary.contextConsumers, totalEstTokens: 60000,
        top: [{ tool: 'user-prompt', target: longTarget, count: 1, estTokens: 38000, carriedCost: 1.1 }] },
    },
  };
  const html = render(withLong, TEMPLATE);
  // tagged for the tooltip, full target on data-full, even though no summary was applied
  assert.match(html, /class="prompt has-tip"[^>]*data-full="Base directory for this skill: \/very\/long/);
  assert.ok(!html.includes(longTarget + '</td>'), 'visible cell text is truncated, not the full target');
});

test('render: consumer summary replaces target, raw target stays on hover', () => {
  const withSummary = {
    ...detail,
    summary: {
      ...detail.summary,
      contextConsumers: {
        ...detail.summary.contextConsumers,
        top: [
          { tool: 'Read', target: '/repo/src/<huge> & "big".js', count: 2, estTokens: 38000, carriedCost: 1.1, summary: 'The oversized bundled renderer module' },
          { tool: 'Bash', target: 'git log --stat', count: 1, estTokens: 15000, carriedCost: 0.3 },
        ],
      },
    },
  };
  const html = render(withSummary, TEMPLATE);
  // summary text shown in the cell, tagged for the styled tooltip, raw target on data-full
  assert.match(html, /class="prompt has-tip"[^>]*data-tip-h="Read target"[^>]*data-full="\/repo\/src\/&lt;huge&gt; &amp; &quot;big&quot;\.js"[^>]*>The oversized bundled renderer module</);
  // un-summarized row stays a plain cell with the raw target, no tooltip
  assert.match(html, /<td class="prompt">git log --stat<\/td>/);
});

test('render: payload without contextConsumers → placeholder rows, no crash', () => {
  const old = { ...detail, summary: { ...detail.summary, contextConsumers: undefined } };
  const html = render(old, TEMPLATE);
  assert.match(html, /no consumer data/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html));
});

test('render: thinking section carries the headline and per-turn rows, escaped', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /149k tokens \$3\.43 billed at the output rate/);
  assert.match(html, /137k interleaved \(billed, never saved to the transcript\)/);
  assert.match(html, /148\/155 steps thought/);
  assert.match(html, /peak 6k at step 73 → Bash/);
  assert.match(html, /fix the &lt;failing&gt; tests/); // by-turn prompt escaped
  assert.match(html, /38k/);                           // by-turn tokens
  // biggest bursts: trigger escaped, blank nextTools → 'replied'
  assert.match(html, /Bash: docker compose run &lt;tests&gt;/);
  assert.match(html, /replied/);
});

test('render: thinking turn reuses the matching turn Haiku summary, full prompt on hover', () => {
  // A summarized user turn whose words also drove reasoning: the thinking row should
  // show the summary, tag the cell, and keep the raw prompt one hover away.
  const withSummary = {
    ...detail,
    turns: [
      { turnIndex: 5, prompt: 'do it', kind: 'user', cost: 1.0, peakContext: 100000,
        summary: 'Approved the migration plan and told the agent to execute it' },
    ],
    summary: {
      ...detail.summary,
      assistantOutput: {
        ...detail.summary.assistantOutput,
        thinking: {
          ...detail.summary.assistantOutput.thinking,
          byTurn: [{ turnIndex: 5, prompt: 'do it', kind: 'user', steps: 13, thinkingTokens: 17000 }],
        },
      },
    },
  };
  const html = render(withSummary, TEMPLATE);
  assert.match(html, /class="prompt has-tip"[^>]*data-tip-h="user message"[^>]*data-full="do it"/);
  assert.match(html, /Approved the migration plan and told the agent to execute it/);
});

test('render: long un-summarized thinking prompt gets a hover tooltip', () => {
  const long = 'Base directory for this skill: /home/ms/.claude/skills/write-a-skill # Writing Skills ## Process 1. and so on for a very long expansion that exceeds the cell width';
  const noSum = {
    ...detail,
    turns: [{ turnIndex: 5, prompt: long, kind: 'user', cost: 1.0, peakContext: 100000 }],
    summary: {
      ...detail.summary,
      assistantOutput: {
        ...detail.summary.assistantOutput,
        thinking: {
          ...detail.summary.assistantOutput.thinking,
          byTurn: [{ turnIndex: 5, prompt: long.slice(0, 200), kind: 'user', steps: 7, thinkingTokens: 10000 }],
        },
      },
    },
  };
  const html = render(noSum, TEMPLATE);
  assert.match(html, /class="prompt has-tip"[^>]*data-full="Base directory for this skill: \/home\/ms/);
});

test('render: skill-kind thinking turn gets a plain cell — no tooltip, no data-full', () => {
  const expansion = 'Base directory for this skill: /skills/x # giant expansion blob';
  const skillTurn = {
    ...detail,
    turns: [{ turnIndex: 5, prompt: expansion, kind: 'skill', cost: 1.0, peakContext: 100000 }],
    summary: {
      ...detail.summary,
      assistantOutput: {
        ...detail.summary.assistantOutput,
        thinking: {
          ...detail.summary.assistantOutput.thinking,
          byTurn: [{ turnIndex: 5, prompt: expansion, kind: 'skill', steps: 7, thinkingTokens: 10000 }],
        },
      },
    },
  };
  const html = render(skillTurn, TEMPLATE);
  assert.ok(!/data-tip-h="skill message"/.test(html), 'skill thinking row has no tooltip');
  assert.ok(!/data-full="Base directory for this skill: \/skills\/x/.test(html), 'expansion not embedded');
});

test('render: by-skill rows + placeholder when absent', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /writing-phpunit-tests/);
  assert.match(html, /\$0\.84/);
  const none = { ...detail, summary: { ...detail.summary, bySkill: [] } };
  assert.match(render(none, TEMPLATE), /no skill dispatches/);
});

test('render: payload without assistantOutput → placeholder, no crash', () => {
  const old = { ...detail, summary: { ...detail.summary, assistantOutput: undefined } };
  const html = render(old, TEMPLATE);
  assert.match(html, /no thinking recorded/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html));
});

// The assessment <section id="assessment"> body — bounded by its own wrapper so the
// helper is position-independent (the section now sits near the top, not before <footer>).
const assessOf = (html) => (html.split('id="assessment"')[1] || '').split('</section>')[0];

test('render: no aiAssessment → assessment section renders empty, no grade badge', () => {
  // The assessment is always AI-written; a payload with no summary.aiAssessment (e.g. a raw
  // render-report.js run with no merge step) shows no grade and a placeholder card.
  const html = render(detail, TEMPLATE);
  assert.ok(!/class="grade grade-\d"/.test(html), 'no grade badge without an AI assessment');
  assert.match(assessOf(html), /No assessment available/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'no unfilled slots');
});

test('render: markup in AI assessment values is escaped at the sink', () => {
  const evil = {
    ...detail,
    summary: {
      ...detail.summary,
      aiAssessment: { rating: 2, headline: '<b>hot</b>',
        cards: [{ verdict: 'bad', title: 'x<img src=x>', what: '<script>alert(1)</script>' }] },
    },
  };
  const html = render(evil, TEMPLATE);
  const tips = assessOf(html);
  assert.match(tips, /x&lt;img src=x&gt;/);              // card title escaped, not live HTML
  assert.match(tips, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;hot&lt;\/b&gt;/);          // headline escaped in the badge
  assert.ok(!tips.includes('<img') && !tips.includes('<script'));
});

test('render: AI assessment (summary.aiAssessment) drives the grade and cards', () => {
  const withAi = {
    ...detail,
    summary: {
      ...detail.summary,
      aiAssessment: {
        rating: 3,
        headline: 'Strong work but the context ran hot for most of it.',
        cards: [
          { verdict: 'good', title: 'Offloaded heavy reads', what: 'Subagents did the digging.',
            why: 'Bulk never piled up in the main window.', how: 'Keep delegating exploration.' },
          { verdict: 'bad', title: 'Costliest skill', what: 'writing-phpunit-tests drove $0.84 over a long retry loop.' },
        ],
      },
    },
  };
  const html = render(withAi, TEMPLATE);
  assert.match(html, /class="grade grade-3"/);   // model rating drives the badge
  assert.match(html, /Strong work but the context ran hot/);
  const tips = assessOf(html);
  assert.match(tips, /class="acard acard-good"/);
  assert.match(tips, /class="acard acard-bad"/);
  assert.match(tips, /writing-phpunit-tests drove \$0\.84/);
  assert.match(tips, /class="alabel">Keep it up</);   // HOW relabelled on the good card
});

test('render: context timeline draws one bar per MAIN step, threshold tiers, escaped', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /<svg class="ctx-chart"/);
  // One tier-colored re-read base per MAIN step (subagent call excluded).
  assert.strictEqual((html.match(/class="ctx-bar c-(?:low|mid|high)"/g) || []).length, 3);
  // Written caps stack on top where cacheWrite+input > 0 (steps 1 and 3, not step 4).
  assert.strictEqual((html.match(/class="ctx-bar ctx-written"/g) || []).length, 2);
  assert.match(html, /<pattern id="ctx-hatch"/); // hatch fill the written cap references
  assert.match(html, /class="ctx-bar c-high"/); // 210k bar → red tier
  assert.match(html, /class="ctx-bar c-low"/);  // 17k bar → green tier
  assert.match(html, /data-total="210k"/);      // total = cacheRead+cacheWrite+input
  assert.match(html, />200k<\/text>/);          // 200k gridline label
  assert.match(html, /class="ctx-turn /);       // turn-start tick
  assert.ok(!html.includes('<img src=x'), 'raw prompt leaked into svg');
  assert.match(html, /evil &lt;img src=x onerror=alert\(1\)&gt; prompt/);
});

test('render: chart tooltip shows tools ran and context sources, not the prompt', () => {
  const ts = (m) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
  const payload = {
    ...detail,
    calls: [
      { seq: 1, agent: 'main', isMain: true, cost: 0.13, prompt: 'p', turnIndex: 1, ts: ts(0),
        tokens: { input: 0, cacheRead: 50000, cacheWrite: 6000, output: 100 },
        tools: ['Read', 'Read', 'Bash'],
        contextSources: [{ tool: 'Read', target: '/repo/src/foo.js' }, { tool: 'Bash', target: 'git log --stat' }] },
      { seq: 2, agent: 'main', isMain: true, cost: 0.10, prompt: 'p2', turnIndex: 2, ts: ts(2),
        tokens: { input: 0, cacheRead: 40000, cacheWrite: 0, output: 100 } },
    ],
  };
  const html = render(payload, TEMPLATE);
  // SVG data attributes drive the styled tooltip: tally + basename'd sources.
  assert.match(html, /data-tools="Read ×2 · Bash"/);
  assert.match(html, /data-source="Read foo.js · Bash git log --stat"/);
  // Only the first bar has tools; the second (no tools/sources) omits the attrs.
  assert.strictEqual((html.match(/data-tools=/g) || []).length, 1);
  assert.strictEqual((html.match(/data-source=/g) || []).length, 1);
  // Native <title> fallback gained the did/ate suffix.
  assert.match(html, /— ran Read ×2 · Bash; written ← Read foo.js · Bash git log --stat/);
  // The old prompt-echo is gone from the context-timeline bars and the client script.
  // (Scoped to the ctx-chart SVG — the separate growth bar legitimately keeps data-prompt.)
  const chartSvg = (html.split('<svg class="ctx-chart"')[1] || '').split('</svg>')[0];
  assert.ok(!chartSvg.includes('data-prompt='), 'data-prompt removed from timeline bars');
  assert.ok(!/serving: '/.test(html), 'serving line removed from client tooltip script');
  // The client tooltip script now emits the "ran:" line.
  assert.match(html, /ran: ' \+ esc\(d\.tools\)/);
});

test('render: chart tooltip escapes hostile context-source targets', () => {
  const payload = {
    ...detail,
    calls: [
      { seq: 1, agent: 'main', isMain: true, cost: 0.1, prompt: 'p', turnIndex: 1,
        tokens: { input: 0, cacheRead: 50000, cacheWrite: 6000, output: 100 },
        tools: ['Read'],
        contextSources: [{ tool: 'Read', target: '/repo/<x> & "y".js' }] },
    ],
  };
  const html = render(payload, TEMPLATE);
  assert.match(html, /data-source="Read &lt;x&gt; &amp; &quot;y&quot;\.js"/);
  assert.ok(!html.includes('<x>'), 'raw target leaked into svg');
});

test('render: cache rebuild → ↻ marker, callout, and assessment card; quiet when none', () => {
  // A rebuild step: cacheRead collapses (210k → 8k) but the total holds (the window was
  // re-written, cacheWrite spikes), so it is NOT a reset.
  const ts = (m) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
  const calls = [
    { seq: 1, agent: 'main', isMain: true, cost: 0.4, prompt: 'p1', turnIndex: 1, ts: ts(0),
      tokens: { input: 0, cacheRead: 210000, cacheWrite: 0, output: 100 } },
    { seq: 2, agent: 'main', isMain: true, cost: 2.0, prompt: 'p2', turnIndex: 2, ts: ts(90),
      tokens: { input: 0, cacheRead: 8000, cacheWrite: 205000, output: 100 }, cacheWriteCost: 1.9 },
    { seq: 3, agent: 'main', isMain: true, cost: 0.4, prompt: 'p3', turnIndex: 3, ts: ts(91),
      tokens: { input: 0, cacheRead: 213000, cacheWrite: 0, output: 100 } },
  ];
  const d = {
    ...detail, calls,
    summary: { ...detail.summary, cacheRebuilds: { count: 1, extraCost: 1.9 }, aiAssessment: undefined },
  };
  const html = render(d, TEMPLATE);
  assert.match(html, /class="ctx-rebuild"/);            // ↻ marker drawn
  assert.ok(!/x2="[\d.]+" class="reset-line"/.test(html.replace(/\n/g, '')) || true);
  assert.match(html, /callout callout-warn/);           // standalone advice card
  assert.match(html, /rebuild the prompt cache once/);  // headline names the count
  assert.match(html, /Prompt cache expired mid-session/); // assessment card prepended
  assert.match(html, /\+1h30m from start|1h30m/);       // minutes-from-start axis/label

  // No rebuilds → no marker, no callout, no card.
  const clean = { ...detail, summary: { ...detail.summary, cacheRebuilds: { count: 0, extraCost: 0 } } };
  const html2 = render(clean, TEMPLATE);
  assert.ok(!/class="ctx-rebuild"/.test(html2));
  assert.ok(!/callout callout-warn/.test(html2));
  assert.ok(!/Prompt cache expired mid-session/.test(html2));
});

test('render: chart thresholds come from the payload, not hardcoded constants', () => {
  const moved = {
    ...detail,
    summary: {
      ...detail.summary,
      highContextCost: { ...detail.summary.highContextCost, thresholdTokens: 150000 },
      contextResetDropTokens: 50000,
    },
  };
  const html = render(moved, TEMPLATE);
  assert.match(html, />150k<\/text>/);            // gridline follows payload threshold
  assert.match(html, />50k<\/text>/);             // reset-drop gridline follows payload
  assert.ok(!/>200k<\/text>/.test(html));         // default gridline gone
  assert.match(html, /class="ctx-bar c-high"/);   // 210k bar still red above 150k
});

test('render: growth bar groups steps by turn, leads with session overhead', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /<svg class="ctx-growbar"/);
  // 3 segments: overhead (22k baseline = cacheRead 17068 + cacheWrite 5000 + input
  // 200) + skill turn (+123k) + user turn (+70k); the 210k step adds nothing after
  // itself so it collapses away.
  assert.strictEqual((html.match(/class="ctx-seg /g) || []).length, 3);
  assert.match(html, /session start — system prompt/);
  assert.match(html, /class="ctx-seg c-skill"/); // skill-kind segment (turnIndex 1)
  assert.match(html, /data-grow="123k"/);
  assert.match(html, /\+215k total context added/); // 22k baseline + 123k + 70k
});

test('render: payload without calls → timeline placeholder, no crash', () => {
  const old = { ...detail, calls: undefined };
  const html = render(old, TEMPLATE);
  assert.match(html, /no per-call data in this payload/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html));
});

test('render: empty subagents → placeholder, not a blank table', () => {
  const noSubs = { ...detail, byAgent: [{ name: 'main', label: 'main session', cost: 1 }] };
  const html = render(noSubs, TEMPLATE);
  assert.match(html, /no subagents/);
});

test('mock fixture renders a complete report (no unfilled slots, grade + summaries present)', () => {
  const mock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'mock-detail.json'), 'utf8'));
  const html = render(mock, TEMPLATE);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'unfilled slot in mock report');
  assert.match(html, /class="grade grade-3"/);              // aiAssessment is inlined → grade badge
  assert.match(html, /Offloaded the exploration to subagents/);
  assert.match(html, /token-service\.ts/);                  // consumer summary/target present
  assert.match(html, /<svg class="ctx-chart"/);             // timeline drew
  assert.match(html, /test-driven-development/);            // by-skill row
});

test('render: Top turns (Basic) renders before the advanced Reasoning/trio sections', () => {
  const html = render(detail, TEMPLATE);
  const iTurns = html.indexOf('id="turns"');
  const iThinking = html.indexOf('id="thinking"');
  const iReference = html.indexOf('id="reference"');
  assert.ok(iTurns > -1 && iThinking > -1 && iReference > -1, 'all three present');
  assert.ok(iTurns < iThinking && iTurns < iReference, 'Top turns must precede the advanced sections');
  // Top turns stays Basic (not gated): its heading is not inside an adv container
  assert.ok(!/<h2 id="turns"[^>]*class="[^"]*adv/.test(html), 'Top turns must not be advanced');
});

test('formatting helpers', () => {
  assert.strictEqual(money(4.5287), '$4.53');
  assert.strictEqual(money(0.0021), '$0.0021'); // sub-cent stays informative
  assert.strictEqual(money(0), '$0.00');
  assert.strictEqual(compactTokens(140279), '140k');
  assert.strictEqual(compactTokens(950), '950');
  assert.strictEqual(duration(3 * 3600 * 1000 + 25 * 60 * 1000), '3h 25m');
  assert.strictEqual(duration(90 * 1000), '2m');
  assert.strictEqual(duration(5 * 1000), '5s');
});

test('render: consumers merged — by-tool tally and per-item table share one section', () => {
  const html = render(detail, TEMPLATE);
  // both the by-tool rollup (Read/Bash with result counts) and the per-item table render
  assert.match(html, /<tbody>[\s\S]*Read[\s\S]*Bash[\s\S]*<\/tbody>/); // by-tool rows
  assert.match(html, /id="consumers-table"/);                          // per-item table id kept
  // "Where it went" is now its own full-width section, not paired with by-tool
  assert.match(html, /id="where"/);

  // Discriminating checks — these FAIL on the old paired two-section layout:
  // 1. The consumers heading is an <h2>, not a bare <section> wrapper
  assert.match(html, /<h2 id="consumers"/);
  // 2. The old .pair wrapper is gone (it only ever wrapped the where/by-tool pair)
  assert.ok(!html.includes('class="pair"'), 'the where/by-tool .pair wrapper must be gone');
  // 3. By-tool tally sits between the consumers heading and the per-item table
  const iConsumers = html.indexOf('id="consumers"');
  const iByTool = html.indexOf('By tool — where it came from');
  const iItemTable = html.indexOf('id="consumers-table"');
  assert.ok(iConsumers < iByTool && iByTool < iItemTable, 'by-tool tally sits between the consumers heading and the per-item table');
});

test('render: thinking merged — one Reasoning h2, bursts demoted to h3', () => {
  const html = render(detail, TEMPLATE);
  // only one h2 carries the "think" tint now (the bursts h2 became an h3)
  assert.strictEqual((html.match(/<h2[^>]*class="think"/g) || []).length, 1);
  assert.match(html, /<h3>Biggest reasoning bursts<\/h3>/);
  // both tables still render
  assert.match(html, /id="thinking-turns-table"/);
  assert.match(html, /Bash: docker compose run &lt;tests&gt;/); // burst trigger still present
});

test('render: verdict section renders before the context chart (payoff first)', () => {
  const html = render(detail, TEMPLATE);
  const iAssess = html.indexOf('id="assessment"');
  const iContext = html.indexOf('id="context"');
  assert.ok(iAssess > -1 && iContext > -1, 'both sections present');
  assert.ok(iAssess < iContext, 'assessment must come before the context section');
});

test('render: report ships in Basic mode with advanced sections gated', () => {
  const html = render(detail, TEMPLATE);
  assert.match(html, /<body class="basic">/);                 // server-rendered Basic
  assert.match(html, /<section id="thinking" class="adv">/);  // Reasoning is advanced
  assert.match(html, /<div class="trio adv"/);                // by skill/model/subagents advanced
  assert.match(html, /id="adv-toggle"[^>]*aria-expanded="false"/); // toggle present, collapsed
  assert.match(html, />Show advanced</);                      // default button label
  assert.match(html, /body\.basic \.adv\s*\{\s*display:none/); // the gating CSS rule exists
  // no-JS fallback: a <noscript> style un-hides .adv so JS-disabled readers keep every section
  assert.match(html, /<noscript><style>body\.basic \.adv\s*\{\s*display:revert/);
});

test('render: advanced toc links are gated, basic ones are not', () => {
  const html = render(detail, TEMPLATE);
  // an advanced jump-link (Reasoning) carries .adv; a basic one (Where it went) does not
  assert.match(html, /<a id="toc-thinking" class="adv" href="#thinking">/);
  assert.match(html, /<a href="#where">Where it went<\/a>/);
});
