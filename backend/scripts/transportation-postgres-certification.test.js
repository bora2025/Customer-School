'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, requireGuard } = require('./transportation-postgres-certification');

test('Transportation certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /TRANSPORTATION_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', TRANSPORTATION_CERTIFY_ALLOW_DROP: 'transportation-only' }));
});

test('Transportation certification verifies and applies all immutable migrations', async () => {
  const sql = []; await migrate({ $executeRawUnsafe: async (statement) => { sql.push(statement); } });
  assert.equal(sql.length, 5); assert.match(sql[0], /001_create_route/); assert.match(sql[4], /005_create_rider_assignment/);
});
