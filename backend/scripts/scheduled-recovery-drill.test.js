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
