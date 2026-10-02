'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-subjects-restored-backup-certification');
const base = { EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-subjects-only', SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_subjects', REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_subjects', BACKUP_DIR: path.resolve('tmp', 'existing-school-subjects-rehearsal') };
test('requires exact subject guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /academic-subjects-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});
test('rejects unsafe subject targets and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-subjects' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});
test('returns validated non-secret subject rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), { sourceUrl: base.SOURCE_DATABASE_URL, targetUrl: base.REHEARSAL_DATABASE_URL, targetDatabase: 'restored_subjects', backupDir: base.BACKUP_DIR, slug: 'restored-subjects-school' });
});
