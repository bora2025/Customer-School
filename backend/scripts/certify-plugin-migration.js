'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suites = [
  { id: 'adoption', command: process.execPath, args: ['--test', 'scripts/plugin-adoption-toolkit.test.js', 'scripts/compatibility-proxies.test.js'] },
  { id: 'lifecycle', command: process.execPath, args: ['node_modules/jest/bin/jest.js', '--runInBand', 'src/plugins/plugins.service.spec.ts', 'src/plugins/plugin-runtime.service.spec.ts', 'src/plugins/plugin-rollout.service.spec.ts', 'src/plugins/plugin-package-tool.spec.ts', 'src/plugins/reference-plugin.spec.ts'] },
  { id: 'recovery', command: process.execPath, args: ['--test', 'scripts/db-toolkit.test.js', 'scripts/legacy-compare.test.js'] },
  { id: 'security', command: process.execPath, args: ['node_modules/jest/bin/jest.js', '--runInBand', 'src/plugins/plugin-package.spec.ts', 'src/plugins/plugin-security-fixtures.spec.ts', 'src/plugins/plugin-sql-guard.spec.ts', 'src/plugins/plugin-permissions.service.spec.ts'] },
];

function certify({ cwd = path.resolve(__dirname, '..'), execute = spawnSync }) {
  const results = suites.map((suite) => {
    const command = suite.command;
    const started = Date.now();
    const result = execute(command, suite.args, { cwd, encoding: 'utf8', windowsHide: true });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const count = output.match(/(?:Tests:\s+|ℹ tests )(\d+)/)?.[1] || null;
    return { id: suite.id, passed: !result.error && result.status === 0, exitCode: result.status, durationMs: Date.now() - started,
      testCount: count ? Number(count) : null,
      outputSha256: crypto.createHash('sha256').update(output).digest('hex'),
      ...(!result.error && result.status === 0 ? {} : { diagnostic: result.error?.message || output.slice(-2000) }) };
  });
  const report = { format: 'wattanam-plugin-migration-certification-v1', generatedAt: new Date().toISOString(), passed: results.every((result) => result.passed), suites: results };
  report.reportSha256 = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
  return report;
}

function main() {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : null;
  if (!out) throw new Error('--out <report.json> is required');
  const target = path.resolve(out);
  const report = certify({});
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ report: target, passed: report.passed, reportSha256: report.reportSha256 })}\n`);
  if (!report.passed) process.exitCode = 2;
}

if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; } }
module.exports = { certify, suites };
