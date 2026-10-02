'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configuration } = require('./academic-aggregate-restored-backup-certification');

const valid = {
  EXISTING_SCHOOL_REHEARSAL_ALLOW: 'academic-aggregate-only',
  SOURCE_DATABASE_URL: 'postgresql://user:pass@localhost/source_school',
  REHEARSAL_DATABASE_URL: 'postgresql://user:pass@localhost/restored_school',
  BACKUP_DIR: path.resolve(__dirname, '.aggregate-cert-fixture'),
  REHEARSAL_SCHOOL_SLUG: 'restored-academic-aggregate-school',
};

test('requires the exact aggregate destructive guard', () => {
  assert.throws(() => configuration({ ...valid, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'yes' }), /academic-aggregate-only/);
});

test('requires distinct PostgreSQL databases and a safe target name', () => {
  assert.throws(() => configuration({ ...valid, REHEARSAL_DATABASE_URL: valid.SOURCE_DATABASE_URL }), /distinct/);
  assert.throws(() => configuration({ ...valid, REHEARSAL_DATABASE_URL: 'postgresql://user:pass@localhost/unsafe-name' }), /unsafe/);
});

test('returns bounded non-secret aggregate coordinates', () => {
  const result = configuration(valid);
  assert.deepEqual(Object.keys(result).sort(), ['backupDir', 'slug', 'sourceUrl', 'targetDatabase', 'targetUrl']);
  assert.equal(result.targetDatabase, 'restored_school');
});
