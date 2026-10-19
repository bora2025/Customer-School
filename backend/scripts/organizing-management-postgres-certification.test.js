'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMigrations, declaredMigrationIds, requireGuard } = require('./organizing-management-postgres-certification');

test('Organizing Management certification requires an exact disposable namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /ORGANIZING_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', ORGANIZING_CERTIFY_ALLOW_DROP: 'organizing-management-only' }));
});

test('Organizing Management certification verifies and applies all immutable migrations', async () => {
  const statements = [];
  await applyMigrations({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, declaredMigrationIds.length);
  assert.match(statements[0], new RegExp(`wattanam-plugin-migration:\\s*${declaredMigrationIds[0]}`));
  assert.match(statements.at(-1), new RegExp(`wattanam-plugin-migration:\\s*${declaredMigrationIds.at(-1)}`));
});
