'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-classes-restored-backup-certification');
const base = { EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-classes-only', SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_classes', REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_classes', BACKUP_DIR: path.resolve('tmp', 'existing-school-classes-rehearsal') };
test('requires exact class guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /academic-classes-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});
test('rejects unsafe class targets and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-classes' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});
test('returns validated non-secret class rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), { sourceUrl: base.SOURCE_DATABASE_URL, targetUrl: base.REHEARSAL_DATABASE_URL, targetDatabase: 'restored_classes', backupDir: base.BACKUP_DIR, slug: 'restored-classes-school' });
});
