'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configuration } = require('./parent-portal-restored-backup-certification');

const valid = {
  EXISTING_SCHOOL_REHEARSAL_ALLOW: 'parent-portal-only',
  SOURCE_DATABASE_URL: 'postgresql://user:pass@localhost/source_school',
  REHEARSAL_DATABASE_URL: 'postgresql://user:pass@localhost/restored_school',
  BACKUP_DIR: path.resolve(__dirname, '.parent-portal-cert-fixture'),
  REHEARSAL_SCHOOL_SLUG: 'restored-parent-school',
};

test('requires the exact Parent Portal destructive guard', () => {
  assert.throws(() => configuration({ ...valid, EXISTING_SCHOOL_REHEARSAL_ALLOW: 'yes' }), /parent-portal-only/);
});

test('requires distinct PostgreSQL databases and a safe target', () => {
  assert.throws(() => configuration({ ...valid, REHEARSAL_DATABASE_URL: valid.SOURCE_DATABASE_URL }), /distinct/);
  assert.throws(() => configuration({ ...valid, REHEARSAL_DATABASE_URL: 'postgresql://user:pass@localhost/unsafe-name' }), /unsafe/);
});

test('returns bounded non-secret rehearsal coordinates', () => {
  assert.deepEqual(Object.keys(configuration(valid)).sort(), ['backupDir', 'slug', 'sourceUrl', 'targetDatabase', 'targetUrl']);
});
