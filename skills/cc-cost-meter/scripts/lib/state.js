'use strict';
const path = require('path');
const os = require('os');

// State dir resolution. Data lives in our own XDG namespace; CLAUDE_CONFIG_DIR is
// only a per-profile KEY — its sanitized path becomes a profile subdir. Falsy
// source → empty profile → flat layout (single-profile users).
function resolveStateDir(configDir) {
  const xdgRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  const profile = configDir ? configDir.replace(/^\//, '').replace(/\//g, '_') : '';
  return path.join(xdgRoot, 'cc-cost-meter', profile);
}

module.exports = { resolveStateDir };
