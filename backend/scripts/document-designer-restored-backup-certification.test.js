'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { configuration } = require('./document-designer-restored-backup-certification');

const base = {
  EXISTING_SCHOOL_REHEARSAL_ALLOW: 'document-designer-only',
  SOURCE_DATABASE_URL: 'postgresql://user:password@localhost:5432/source_school',
  REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored_school',
  BACKUP_DIR: path.resolve('tmp', 'existing-school-rehearsal'),
};

test('requires the exact destructive rehearsal guard and distinct databases', () => {
  assert.throws(() => configuration({ ...base, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'true' }), /document-designer-only/);
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: base.SOURCE_DATABASE_URL }), /must differ/);
});

test('rejects unsafe target database names and filesystem roots', () => {
  assert.throws(() => configuration({ ...base, REHEARSAL_DATABASE_URL: 'postgresql://user:password@localhost:5432/restored-school' }), /unsafe/);
  assert.throws(() => configuration({ ...base, BACKUP_DIR: path.parse(path.resolve('.')).root }), /non-root/);
});

test('returns only validated, non-secret rehearsal coordinates', () => {
  assert.deepEqual(configuration(base), {
    sourceUrl: base.SOURCE_DATABASE_URL,
    targetUrl: base.REHEARSAL_DATABASE_URL,
    targetDatabase: 'restored_school',
    backupDir: base.BACKUP_DIR,
    slug: 'restored-document-school',
  });
});
