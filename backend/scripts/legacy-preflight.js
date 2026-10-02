'use strict';

const crypto = require('crypto');
const { postgresEnvironment, run } = require('./db-toolkit');

const BASELINE = '20260827000000_baseline';
const LEGACY_ANCHORS = ['User', 'Class', 'Student'];
const MIN_POSTGRES_MAJOR = 14;
const MAX_POSTGRES_MAJOR = 18;
const CAPACITY_MULTIPLIER = 2;
const CAPACITY_HEADROOM_BYTES = 256 * 1024 * 1024;

function adoptionReadiness(snapshot, requirements = {}) {
  const classification = classify(snapshot);
  const databaseBytes = Number(snapshot.databaseBytes || 0);
  const postgresMajor = Number.parseInt(String(snapshot.databaseVersion || '').split('.')[0], 10);
  const requiredCapacityBytes = Math.ceil(databaseBytes * CAPACITY_MULTIPLIER + CAPACITY_HEADROOM_BYTES);
  const availableCapacityBytes = Number(requirements.availableCapacityBytes || 0);
  const blockers = [];
  if (classification.state !== 'legacy_unadopted') blockers.push(`source schema state must be legacy_unadopted (found ${classification.state})`);
  if (!Number.isInteger(postgresMajor) || postgresMajor < MIN_POSTGRES_MAJOR || postgresMajor > MAX_POSTGRES_MAJOR) {
    blockers.push(`PostgreSQL major version must be ${MIN_POSTGRES_MAJOR}-${MAX_POSTGRES_MAJOR}`);
  }
  const actualFingerprint = fingerprint(snapshot);
  if (!requirements.approvedFingerprint) blockers.push('approved source schema fingerprint is required');
  else if (requirements.approvedFingerprint !== actualFingerprint) blockers.push('source schema fingerprint does not match approval');
  if (!Number.isFinite(availableCapacityBytes) || availableCapacityBytes <= 0) blockers.push('target capacity bytes are required');
  else if (availableCapacityBytes < requiredCapacityBytes) blockers.push(`target capacity is insufficient (requires ${requiredCapacityBytes} bytes)`);
  return {
    ready: blockers.length === 0,
    blockers,
    postgresMajor: Number.isInteger(postgresMajor) ? postgresMajor : null,
    supportedPostgresRange: `${MIN_POSTGRES_MAJOR}-${MAX_POSTGRES_MAJOR}`,
    requiredCapacityBytes,
    availableCapacityBytes: availableCapacityBytes > 0 ? availableCapacityBytes : null,
    approvedFingerprintMatches: Boolean(requirements.approvedFingerprint) && requirements.approvedFingerprint === actualFingerprint,
  };
}

function classify(snapshot) {
  const tables = new Set(snapshot.tables || []);
  const migrations = new Set(snapshot.migrations || []);
  if (tables.size === 0) {
    return { state: 'empty', nextAction: 'migrate_deploy', safeToMutate: true };
  }
  if (migrations.has(BASELINE)) {
    return { state: 'managed', nextAction: 'migrate_deploy', safeToMutate: true };
  }
  const anchors = LEGACY_ANCHORS.filter((name) => tables.has(name));
  if (anchors.length === LEGACY_ANCHORS.length && !tables.has('_prisma_migrations')) {
    return { state: 'legacy_unadopted', nextAction: 'schema_diff_backup_restore_then_adopt', safeToMutate: false };
  }
  return {
    state: 'unsupported_partial',
    nextAction: 'stop_and_review',
    safeToMutate: false,
    missingLegacyAnchors: LEGACY_ANCHORS.filter((name) => !tables.has(name)),
  };
}

function fingerprint(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify({
    tables: [...(snapshot.tables || [])].sort(),
    columns: [...(snapshot.columns || [])].sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`)),
    constraints: [...(snapshot.constraints || [])].sort(),
  })).digest('hex');
}

function querySnapshot(environment) {
  const sql = `
WITH public_tables AS (
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
), public_columns AS (
  SELECT table_name, column_name, data_type, is_nullable, ordinal_position, COALESCE(column_default, '') AS column_default
  FROM information_schema.columns WHERE table_schema = 'public'
), public_constraints AS (
  SELECT table_name || ':' || constraint_name || ':' || constraint_type AS value
  FROM information_schema.table_constraints WHERE table_schema = 'public'
)
SELECT json_build_object(
  'databaseVersion', current_setting('server_version'),
  'databaseBytes', pg_database_size(current_database()),
  'tables', COALESCE((SELECT json_agg(table_name ORDER BY table_name) FROM public_tables), '[]'::json),
  'columns', COALESCE((SELECT json_agg(json_build_object('table', table_name, 'column', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) ORDER BY table_name, ordinal_position) FROM public_columns), '[]'::json),
  'constraints', COALESCE((SELECT json_agg(value ORDER BY value) FROM public_constraints), '[]'::json)
)::text;`;
  const readOnlyEnvironment = {
    ...environment,
    PGOPTIONS: `${environment.PGOPTIONS || ''} -c default_transaction_read_only=on`.trim(),
  };
  const output = run('psql', ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], readOnlyEnvironment, true);
  const line = output.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith('{'));
  if (!line) throw new Error('PostgreSQL preflight did not return a metadata snapshot');
  const snapshot = JSON.parse(line);
  snapshot.migrations = [];
  if (snapshot.tables.includes('_prisma_migrations')) {
    const migrationOutput = run('psql', ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', 'SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name'], readOnlyEnvironment, true);
    snapshot.migrations = migrationOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  return snapshot;
}

function buildReport(snapshot, requirements) {
  const result = classify(snapshot);
  return {
    format: 'wattanam-legacy-preflight-v1',
    generatedAt: new Date().toISOString(),
    state: result.state,
    nextAction: result.nextAction,
    safeToMutate: result.safeToMutate,
    missingLegacyAnchors: result.missingLegacyAnchors || [],
    databaseVersion: snapshot.databaseVersion,
    databaseBytes: snapshot.databaseBytes,
    tableCount: (snapshot.tables || []).length,
    columnCount: (snapshot.columns || []).length,
    migrationCount: (snapshot.migrations || []).length,
    appliedMigrations: snapshot.migrations || [],
    schemaFingerprint: fingerprint(snapshot),
    containsCustomerRows: false,
    ...(requirements ? { adoptionReadiness: adoptionReadiness(snapshot, requirements) } : {}),
  };
}

function main() {
  const selectors = [
    ['--use-restore-database-url', 'RESTORE_DATABASE_URL'],
    ['--use-install-database-url', 'INSTALL_DATABASE_URL'],
    ['--use-adopt-database-url', 'ADOPT_DATABASE_URL'],
  ].filter(([flag]) => process.argv.includes(flag));
  if (selectors.length > 1) throw new Error('select only one alternate database URL');
  const selected = selectors[0];
  if (selected && !process.env[selected[1]]) throw new Error(`${selected[1]} is required with ${selected[0]}`);
  const report = buildReport(querySnapshot(postgresEnvironment(selected ? process.env[selected[1]] : process.env.DATABASE_URL)), {
    approvedFingerprint: process.env.ADOPT_APPROVED_SCHEMA_FINGERPRINT?.trim(),
    availableCapacityBytes: process.env.ADOPT_TARGET_CAPACITY_BYTES?.trim(),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.state === 'unsupported_partial' || !report.adoptionReadiness.ready) process.exitCode = 2;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`ERROR: legacy preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { BASELINE, LEGACY_ANCHORS, adoptionReadiness, buildReport, classify, fingerprint, querySnapshot };
