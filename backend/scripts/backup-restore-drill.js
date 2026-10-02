'use strict';

// B-008: quarterly restore drill. Backs up the source (via the already-verified
// backup-recovery-set.js), restores it into a completely separate target
// database/directories (the source is never touched, matching real-world
// backup-drill practice -- a routine drill must never risk production), proves
// byte-for-byte identity via legacy-compare.js's snapshot/compare (reused as a
// library, not just for legacy adoption), measures the actual restore time
// against the stated 4-hour RTO target, and writes a self-hashed evidence
// report meant to be retained outside the project being drilled (committed to
// docs/, or shipped to wherever this repo's own operator keeps drill evidence).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fail, backupDirectory, timestamp } = require('./db-toolkit');
const { snapshot, compare } = require('./legacy-compare');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv.includes('--help')) {
  process.stdout.write(
    'Usage: node scripts/backup-restore-drill.js [--out <report.json>]\n' +
    'Requires DATABASE_URL (source, real data, never modified) and RESTORE_DATABASE_URL (a fresh, empty, disposable target).\n' +
    'Optional: RTO_TARGET_SECONDS (default 14400 = 4 hours, matching the stated RTO target).\n',
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL is required (the source being drilled; it is only ever read from, never modified)');
if (!process.env.RESTORE_DATABASE_URL) fail('RESTORE_DATABASE_URL is required (a fresh, empty, disposable target -- never the source)');

function runScript(scriptName, args) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName), ...args], { env: process.env, encoding: 'utf8' });
  if (result.error) fail(`${scriptName} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${scriptName} failed:\n${result.stderr || result.stdout}`);
  // Not every wrapped script emits JSON (restore-recovery-set.js prints a plain-text
  // summary this drill doesn't need the return value from) -- only backup-recovery-set.js's
  // journal is actually consumed by the caller, so a non-JSON last line is not an error here.
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return {};
  try { return JSON.parse(lines[lines.length - 1]); } catch { return {}; }
}

const rtoTargetSeconds = Number(process.env.RTO_TARGET_SECONDS || 4 * 60 * 60);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-restore-drill-'));
const restorePluginDir = path.join(workDir, 'plugins');
const restorePluginDataDir = path.join(workDir, 'plugin-data');

const drillStartedAt = new Date();
process.stderr.write('Snapshotting the source before backup (read-only)...\n');
const before = snapshot(process.env.DATABASE_URL);
const beforePath = path.join(workDir, 'before.json');
fs.writeFileSync(beforePath, JSON.stringify(before));

process.stderr.write('Running a real recovery-set backup of the source...\n');
const backupStartedAt = new Date();
const journal = runScript('backup-recovery-set.js', []);
const backupCompletedAt = new Date();
const journalPath = path.join(backupDirectory(), journal.journalFile);

process.stderr.write(`Restoring into the fresh target (RESTORE_DATABASE_URL) -- the source is not touched...\n`);
const restoreStartedAt = new Date();
runScript('restore-recovery-set.js', [
  '--from', journalPath, '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url',
  '--plugin-dir', restorePluginDir, '--plugin-data-dir', restorePluginDataDir,
]);
const restoreCompletedAt = new Date();

process.stderr.write('Snapshotting the restored target (read-only)...\n');
const after = snapshot(process.env.RESTORE_DATABASE_URL);
const afterPath = path.join(workDir, 'after.json');
fs.writeFileSync(afterPath, JSON.stringify(after));

const diff = compare(beforePath, afterPath);
const rtoSeconds = (restoreCompletedAt.getTime() - restoreStartedAt.getTime()) / 1000;
// A drill demands exact identity, not the adoption tool's tolerance for
// expected changes (Installation/AuditLog rows differing across a migration) --
// any content change at all here means the restore did not reproduce the source.
const identical = diff.unexplainedRowLoss.length === 0 && diff.tablesWithChangedContent.length === 0 && diff.foreignKeyOrphansAfter.length === 0;
const withinRto = rtoSeconds <= rtoTargetSeconds;

const report = {
  format: 'wattanam-restore-drill-report-v1',
  drillStartedAt: drillStartedAt.toISOString(),
  backup: {
    startedAt: backupStartedAt.toISOString(), completedAt: backupCompletedAt.toISOString(),
    durationSeconds: (backupCompletedAt.getTime() - backupStartedAt.getTime()) / 1000, journalFile: journal.journalFile,
  },
  restore: { startedAt: restoreStartedAt.toISOString(), completedAt: restoreCompletedAt.toISOString() },
  rto: { measuredSeconds: rtoSeconds, targetSeconds: rtoTargetSeconds, withinTarget: withinRto },
  identity: {
    tableCount: before.tableCount,
    unexplainedRowLoss: diff.unexplainedRowLoss,
    tablesWithChangedContent: diff.tablesWithChangedContent,
    foreignKeyOrphansAfter: diff.foreignKeyOrphansAfter,
    credentialIntegrity: diff.credentialIntegrity,
    exactMatch: identical,
  },
  passed: identical && withinRto,
};
report.reportSha256 = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');

const outPath = argument('--out') || path.join(backupDirectory(), `wattanam-restore-drill-${timestamp()}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ reportFile: outPath, passed: report.passed, rtoSeconds, exactMatch: identical })}\n`);
if (!report.passed) process.exitCode = 2;
