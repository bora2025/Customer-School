'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-admissions-restored-backup-certification');
const base = { EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-admissions-only', SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_admissions', REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_admissions', BACKUP_DIR: path.resolve('tmp', 'existing-school-admissions-rehearsal') };
test('requires exact admissions guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /academic-admissions-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});
test('rejects unsafe admissions targets and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-admissions' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});
test('returns validated non-secret admissions rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), { sourceUrl: base.SOURCE_DATABASE_URL, targetUrl: base.REHEARSAL_DATABASE_URL, targetDatabase: 'restored_admissions', backupDir: base.BACKUP_DIR, slug: 'restored-admissions-school' });
});
