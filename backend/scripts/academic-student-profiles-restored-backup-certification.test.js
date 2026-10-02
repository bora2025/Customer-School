'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-student-profiles-restored-backup-certification');

const base = {
  EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-student-profiles-only',
  SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_profiles',
  REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_profiles',
  BACKUP_DIR: path.resolve('tmp', 'existing-school-profile-rehearsal'),
};

test('requires exact student-profile guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /academic-student-profiles-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});

test('rejects unsafe student-profile targets and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-profiles' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});

test('returns validated non-secret student-profile rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), {
    sourceUrl: base.SOURCE_DATABASE_URL,
    targetUrl: base.REHEARSAL_DATABASE_URL,
    targetDatabase: 'restored_profiles',
    backupDir: base.BACKUP_DIR,
    slug: 'restored-student-profile-school',
  });
});
