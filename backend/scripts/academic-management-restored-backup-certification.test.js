'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./academic-management-restored-backup-certification');

const base = {
  EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-management-foundation-only',
  SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_academic',
  REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_academic',
  BACKUP_DIR: path.resolve('tmp', 'existing-school-academic-rehearsal'),
};

test('requires the exact Academic rehearsal guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /academic-management-foundation-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});

test('rejects unsafe Academic target database names and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-academic' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});

test('returns validated non-secret Academic rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), {
    sourceUrl: base.SOURCE_DATABASE_URL,
    targetUrl: base.REHEARSAL_DATABASE_URL,
    targetDatabase: 'restored_academic',
    backupDir: base.BACKUP_DIR,
    slug: 'restored-academic-school',
  });
});
