'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, requireGuard } = require('./communication-postgres-certification');
test('Communication certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /COMMUNICATION_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', COMMUNICATION_CERTIFY_ALLOW_DROP: 'communication-only' }));
});
test('Communication certification verifies and applies all immutable migrations', async () => {
  const sql = []; await migrate({ $executeRawUnsafe: async (statement) => { sql.push(statement); } });
  assert.equal(sql.length, 3); assert.match(sql[0], /001_create_message/); assert.match(sql[2], /003_create_delivery_outbox/);
});
