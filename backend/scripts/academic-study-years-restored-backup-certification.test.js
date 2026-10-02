'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-study-years-restored-backup-certification');
const base = { EXISTING_SCHOOL_REHEARSAL_ALLOW: 'attendance-study-years-only', SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_study_years', REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_study_years', BACKUP_DIR: path.resolve('tmp', 'existing-school-study-years-rehearsal') };
test('requires exact Study Year guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /attendance-study-years-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});
test('rejects unsafe Study Year targets and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-study-years' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});
test('returns validated non-secret Study Year rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), { sourceUrl: base.SOURCE_DATABASE_URL, targetUrl: base.REHEARSAL_DATABASE_URL, targetDatabase: 'restored_study_years', backupDir: base.BACKUP_DIR, slug: 'restored-study-years-school' });
});
