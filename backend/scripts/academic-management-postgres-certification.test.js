'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMigrations, requireGuard } = require('./academic-management-postgres-certification');

test('Academic PostgreSQL certification requires a database and an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /ACADEMIC_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', ACADEMIC_CERTIFY_ALLOW_DROP: 'academic-management-only' }));
});

test('Academic PostgreSQL certification accepts only identified or checksum-pinned immutable migrations', async () => {
  const statements = [];
  await applyMigrations({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, 10);
  assert.match(statements[0], /wattanam-plugin-migration: 001_create_department/);
  assert.match(statements[9], /wattanam-plugin-migration: 010_create_subject/);
});
