'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMigrations, requireGuard } = require('./organizing-management-postgres-certification');

test('Organizing Management certification requires an exact disposable namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /ORGANIZING_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', ORGANIZING_CERTIFY_ALLOW_DROP: 'organizing-management-only' }));
});

test('Organizing Management certification verifies and applies all immutable migrations', async () => {
  const statements = [];
  await applyMigrations({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, 56);
  assert.match(statements[0], /wattanam-plugin-migration:\s*001_create_organization_foundation/);
  assert.match(statements[55], /wattanam-plugin-migration:\s*056_harden_calendar_and_settings/);
});
