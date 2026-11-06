#!/usr/bin/env node
'use strict';

// Blocking audit for the physical core web image. It fails only on high/critical advisories in
// packages that are present in the traced core standalone output (what the image ships). Advisories
// in legacy-only packages are reported but do not block; the full legacy tree is audited
// separately and non-blocking until that code is deleted.
//
// Requires a portable core build first: CORE_BUILD_NODE_MODULES_MODE=copy npm run build:core

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const frontendRoot = path.resolve(__dirname, '..');
const standalone = path.join(frontendRoot, '.core-build', '.next', 'standalone');
const BLOCKING = new Set(['high', 'critical']);

function shippedNodePath(nodePath) {
  return fs.existsSync(path.join(standalone, nodePath, 'package.json'));
}

function classify(report, isShipped = shippedNodePath) {
  const shipped = [];
  const legacyOnly = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities || {})) {
    if (!BLOCKING.has(vulnerability.severity)) continue;
    const nodes = vulnerability.nodes || [];
    const inCore = nodes.filter(isShipped);
    (inCore.length ? shipped : legacyOnly).push({ name, severity: vulnerability.severity, nodes: inCore.length ? inCore : nodes });
  }
  return { shipped, legacyOnly };
}

function main() {
  const modules = path.join(standalone, 'node_modules');
  let stat;
  try { stat = fs.lstatSync(modules); } catch { stat = null; }
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    console.error('No traced core standalone node_modules. Run: CORE_BUILD_NODE_MODULES_MODE=copy npm run build:core');
    process.exit(2);
  }

  // Windows exposes npm only as a .cmd shim, which needs a shell; the command line is a fixed string.
  // Drop npm_config_* inherited from an outer `npm run`; they carry root-project settings that the
  // frontend project rejects (e.g. EALLOWSCRIPTS).
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  const options = { cwd: frontendRoot, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  const result = process.platform === 'win32'
    ? spawnSync('npm audit --json', { ...options, shell: true })
    : spawnSync('npm', ['audit', '--json'], options);
  let report;
  try { report = JSON.parse(result.stdout); } catch {
    console.error(`npm audit did not return JSON (exit ${result.status}):\n${result.stderr}`);
    process.exit(2);
  }
  if (report.error) {
    console.error(`npm audit failed: ${JSON.stringify(report.error)}`);
    process.exit(2);
  }

  const { shipped, legacyOnly } = classify(report);
  for (const item of legacyOnly) {
    console.log(`not shipped in core (non-blocking): ${item.name} [${item.severity}] ${item.nodes.join(', ')}`);
  }
  if (shipped.length) {
    for (const item of shipped) console.error(`SHIPPED IN CORE: ${item.name} [${item.severity}] ${item.nodes.join(', ')}`);
    process.exit(1);
  }
  console.log('Core web image: no high or critical advisories in shipped dependencies.');
}

if (require.main === module) main();

module.exports = { classify };
