'use strict';
const path = require('path');
const os = require('os');

// State dir resolution. Data lives in our own XDG namespace; CLAUDE_CONFIG_DIR is
// only a per-profile KEY — its sanitized path becomes a profile subdir. Falsy
// source → empty profile → flat layout (single-profile users).
function resolveStateDir(configDir) {
  const xdgRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(xdgRoot, 'cc-cost-meter', profileOf(configDir));
}

// Profile subdir for a config dir. An explicit path that resolves to the default
// root (`~/.claude`) is the same profile as passing nothing — otherwise the same
// sessions would get two separate grade histories.
function profileOf(configDir) {
  if (!configDir) return '';
  let abs = String(configDir);
  if (abs === '~' || abs.startsWith('~/')) abs = path.join(os.homedir(), abs.slice(1));
  abs = path.resolve(abs).replace(/\/+$/, '');
  if (abs === path.join(os.homedir(), '.claude')) return '';
  return abs.replace(/^\//, '').replace(/\//g, '_');
}

module.exports = { resolveStateDir };
