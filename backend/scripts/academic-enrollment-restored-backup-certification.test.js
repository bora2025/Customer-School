'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-enrollment-restored-backup-certification');

const base = {
  EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-enrollment-only',
  SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_enrollment',
  REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_enrollment',
  BACKUP_DIR: path.resolve('tmp', 'existing-school-enrollment-rehearsal'),
};

test('requires exact enrollment guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /academic-enrollment-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});

test('rejects unsafe enrollment targets and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-enrollment' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});

test('returns validated non-secret enrollment rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), {
    sourceUrl: base.SOURCE_DATABASE_URL,
    targetUrl: base.REHEARSAL_DATABASE_URL,
    targetDatabase: 'restored_enrollment',
    backupDir: base.BACKUP_DIR,
    slug: 'restored-enrollment-school',
  });
});
