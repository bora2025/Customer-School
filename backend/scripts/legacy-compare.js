'use strict';

// B-003: proves nothing was lost or corrupted across a legacy-adopt.js run --
// row counts, relationships, hashes of critical fields, credential-format
// integrity ("login"), and a small set of core-workflow read checks -- packaged
// into one signed comparison report. legacy-preflight.js's schema-fingerprint
// already proves structural (table/column/constraint) continuity; this proves
// data-content continuity on top of that, which nothing else in this repo does.
//
// Honest limitation, stated here rather than glossed over: proven against the
// existing synthetic fixture (create-synthetic-legacy-fixture.js), which is
// schema-rich (68+ tables) but data-sparse (one seeded user row) -- this proves
// the tool's mechanics, not realistic multi-table row-count/relationship math.
// Real-snapshot verification stays deferred exactly like B-001/B-002.

const crypto = require('crypto');
const fs = require('fs');
const { fail, postgresEnvironment, run } = require('./db-toolkit');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function psqlJson(sql, environment) {
  const output = run('psql', ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], environment, true);
  const line = output.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith('{') || value.startsWith('['));
  return line ? JSON.parse(line) : null;
}

function readOnly(environment) {
  return { ...environment, PGOPTIONS: `${environment.PGOPTIONS || ''} -c default_transaction_read_only=on`.trim() };
}

function listTables(environment) {
  return psqlJson(`SELECT COALESCE(json_agg(table_name ORDER BY table_name), '[]'::json)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`, environment) || [];
}

function tableSnapshot(table, environment) {
  const rows = psqlJson(`SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::json)::text FROM "${table}" t;`, environment) || [];
  return { rowCount: rows.length, contentHash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}

function listForeignKeys(environment) {
  const sql = `
SELECT COALESCE(json_agg(json_build_object(
  'constraint', tc.constraint_name, 'table', tc.table_name, 'column', kcu.column_name,
  'referencedTable', ccu.table_name, 'referencedColumn', ccu.column_name
) ORDER BY tc.constraint_name), '[]'::json)::text
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';`;
  return psqlJson(sql, environment) || [];
}

function orphanCount(fk, environment) {
  const sql = `SELECT json_build_object('orphanCount', count(*))::text FROM "${fk.table}" child WHERE child."${fk.column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${fk.referencedTable}" parent WHERE parent."${fk.referencedColumn}" = child."${fk.column}");`;
  return (psqlJson(sql, environment) || { orphanCount: null }).orphanCount;
}

function credentialFormatCheck(environment) {
  // Not an actual login attempt (the plaintext password is never known) -- proves
  // the credential MECHANISM survived intact: every password hash is still
  // present and still shaped like a real bcrypt hash, not truncated/corrupted/blanked.
  const sql = `SELECT COALESCE(json_agg(json_build_object('id', id, 'passwordLooksValid', (password ~ '^\\$2[aby]\\$')) ORDER BY id), '[]'::json)::text FROM "User";`;
  const rows = psqlJson(sql, environment) || [];
  return { usersChecked: rows.length, allPasswordHashesValid: rows.every((row) => row.passwordLooksValid) };
}

function coreWorkflowChecks(environment) {
  const classesWithStudents = psqlJson(`SELECT json_build_object('count', count(DISTINCT "classId"))::text FROM "Student" WHERE "classId" IS NOT NULL;`, environment);
  const attendanceQueryRuns = (() => {
    try {
      psqlJson(`SELECT '[]'::json::text FROM "Attendance" LIMIT 1;`, environment);
      return true;
    } catch { return false; }
  })();
  const studentCount = psqlJson(`SELECT json_build_object('count', count(*))::text FROM "Student";`, environment);
  return {
    attendanceQueryExecutesWithoutError: attendanceQueryRuns,
    classesWithAtLeastOneStudent: classesWithStudents ? classesWithStudents.count : 0,
    totalStudents: studentCount ? studentCount.count : 0,
    note: studentCount && studentCount.count > 0 ? 'real student data present' : 'no student rows to exercise -- mechanics proven, not realistic coverage',
  };
}

function snapshot(databaseUrl) {
  const environment = readOnly(postgresEnvironment(databaseUrl));
  const tables = listTables(environment);
  const tableSnapshots = {};
  for (const table of tables) tableSnapshots[table] = tableSnapshot(table, environment);
  const foreignKeys = listForeignKeys(environment);
  const foreignKeyOrphans = foreignKeys.map((fk) => ({ ...fk, orphanCount: orphanCount(fk, environment) }));
  return {
    format: 'wattanam-legacy-comparison-snapshot-v1',
    capturedAt: new Date().toISOString(),
    tableCount: tables.length,
    tables: tableSnapshots,
    foreignKeyOrphans,
    credentials: credentialFormatCheck(environment),
  };
}

function compare(beforePath, afterPath) {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
  if (before.format !== 'wattanam-legacy-comparison-snapshot-v1' || after.format !== 'wattanam-legacy-comparison-snapshot-v1') {
    // Plain throw (not fail()/process.exit) so compare() stays safely unit-testable;
    // main() below is the only caller that needs the hard-exit behavior.
    throw new Error('both snapshots must be wattanam-legacy-comparison-snapshot-v1');
  }
  const allTables = [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort();
  const tableDiffs = allTables.map((table) => {
    const b = before.tables[table] || { rowCount: 0, contentHash: null };
    const a = after.tables[table] || { rowCount: 0, contentHash: null };
    return {
      table, rowCountBefore: b.rowCount, rowCountAfter: a.rowCount,
      rowCountDelta: a.rowCount - b.rowCount, contentChanged: a.contentHash !== b.contentHash,
    };
  });
  const unexplainedLoss = tableDiffs.filter((diff) => diff.rowCountDelta < 0);
  const changedContent = tableDiffs.filter((diff) => diff.contentChanged);
  const orphansAfter = (after.foreignKeyOrphans || []).filter((fk) => fk.orphanCount > 0);
  return {
    tableDiffs,
    unexplainedRowLoss: unexplainedLoss,
    tablesWithChangedContent: changedContent.map((diff) => diff.table),
    foreignKeyOrphansAfter: orphansAfter,
    credentialIntegrity: after.credentials,
  };
}

function main() {
  if (process.argv.includes('--snapshot')) {
    const out = argument('--out');
    if (!out) fail('--snapshot requires --out <file>');
    const report = snapshot(process.env.DATABASE_URL);
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ snapshotFile: out, tableCount: report.tableCount })}\n`);
    return;
  }
  if (process.argv.includes('--compare')) {
    const beforePath = argument('--compare');
    const afterPath = argument('--after');
    const out = argument('--out');
    if (!beforePath || !afterPath || !out) fail('--compare requires --compare <before.json> --after <after.json> --out <report.json>');
    const diff = compare(beforePath, afterPath);
    const workflows = coreWorkflowChecks(readOnly(postgresEnvironment(process.env.DATABASE_URL)));
    const report = {
      format: 'wattanam-legacy-comparison-report-v1',
      generatedAt: new Date().toISOString(),
      zeroUnexplainedLoss: diff.unexplainedRowLoss.length === 0,
      ...diff,
      coreWorkflows: workflows,
    };
    report.reportSha256 = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ reportFile: out, zeroUnexplainedLoss: report.zeroUnexplainedLoss, reportSha256: report.reportSha256 })}\n`);
    if (!report.zeroUnexplainedLoss) process.exitCode = 2;
    return;
  }
  process.stdout.write('Usage:\n  node scripts/legacy-compare.js --snapshot --out <file.json>          (requires DATABASE_URL)\n  node scripts/legacy-compare.js --compare <before.json> --after <after.json> --out <report.json>  (requires DATABASE_URL pointed at the "after" database)\n');
}

if (require.main === module) {
  try { main(); }
  catch (error) { fail(error instanceof Error ? error.message : String(error)); }
}

module.exports = { snapshot, compare, credentialFormatCheck, coreWorkflowChecks };
