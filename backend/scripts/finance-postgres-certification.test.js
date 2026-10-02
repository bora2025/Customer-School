'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, requireGuard } = require('./finance-postgres-certification');

test('Finance certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /FINANCE_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', FINANCE_CERTIFY_ALLOW_DROP: 'finance-only' }));
});

test('Finance certification verifies and applies all immutable migrations', async () => {
  const sql = []; await migrate({ $executeRawUnsafe: async (statement) => { sql.push(statement); } });
  assert.equal(sql.length, 4); assert.match(sql[0], /001_create_fee_record/); assert.match(sql[3], /004_create_payment_reversal/);
});
