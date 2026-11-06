'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configuration, latestRecoverySet } = require('./scheduled-recovery-drill');

test('requires a separately named recovery-only PostgreSQL target and explicit confirmation', () => {
  const base = { BACKUP_DIR: path.resolve('backups'), DATABASE_URL: 'postgresql://u:p@db/live', RECOVERY_DRILL_CONFIRM_TARGET: 'EMPTY' };
  assert.equal(configuration({ ...base, RECOVERY_DRILL_DATABASE_URL: 'postgresql://u:p@db/customer_recovery_drill' }).targetDatabase, 'customer_recovery_drill');
  assert.throws(() => configuration({ ...base, RECOVERY_DRILL_DATABASE_URL: base.DATABASE_URL }), /must differ/);
  assert.throws(() => configuration({ ...base, RECOVERY_DRILL_DATABASE_URL: 'postgresql://u:p@db/production' }), /database name/);
});
test('selects only the newest strict v2 recovery set', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-drill-selection-'));
  try {
    const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
    write('wattanam-recovery-old.recovery-set.json', { format: 'wattanam-recovery-set-v2', createdAt: '2026-01-01T00:00:00Z', contractVerification: { verified: true, legacyExceptionCount: 0 } });
    write('wattanam-recovery-legacy.recovery-set.json', { format: 'wattanam-recovery-set-v2', createdAt: '2026-12-01T00:00:00Z', contractVerification: { verified: true, legacyExceptionCount: 1 } });
    write('wattanam-recovery-new.recovery-set.json', { format: 'wattanam-recovery-set-v2', createdAt: '2026-10-01T00:00:00Z', contractVerification: { verified: true, legacyExceptionCount: 0 } });
    assert.equal(path.basename(latestRecoverySet(directory).file), 'wattanam-recovery-new.recovery-set.json');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('creates the recovery-named target database on the rehearsal server only when missing', () => {
  const { ensureTargetDatabase } = require('./scheduled-recovery-drill');
  const calls = [];
  const fakeSpawn = (exists) => (command, args, options) => {
    const sql = args[args.length - 1];
    calls.push({ command, sql, database: options.env.PGDATABASE, host: options.env.PGHOST });
    return { status: 0, stdout: sql.startsWith('SELECT') && exists ? '1\n' : '', stderr: '' };
  };
  const target = 'postgresql://drill:secret@recovery-drill.railway.internal:5432/recovery_drill';
  assert.equal(ensureTargetDatabase(target, 'recovery_drill', fakeSpawn(false)), true);
  assert.deepEqual(calls.map((call) => call.sql), [
    "SELECT 1 FROM pg_database WHERE datname = 'recovery_drill'",
    'CREATE DATABASE "recovery_drill"',
  ]);
  assert.ok(calls.every((call) => call.command === 'psql' && call.database === 'postgres' && call.host === 'recovery-drill.railway.internal'));
  calls.length = 0;
  assert.equal(ensureTargetDatabase(target, 'recovery_drill', fakeSpawn(true)), false);
  assert.equal(calls.length, 1, 'an existing database is reused, never recreated');
});

test('refuses database names that could inject SQL', () => {
  const { ensureTargetDatabase } = require('./scheduled-recovery-drill');
  assert.throws(() => ensureTargetDatabase('postgresql://u:p@h/x', 'recovery_drill"; DROP DATABASE railway; --', () => ({ status: 0 })), /letters, digits and underscores/);
});
