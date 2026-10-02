'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, requireGuard } = require('./human-resources-postgres-certification');
test('HR certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /HR_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', HR_CERTIFY_ALLOW_DROP: 'human-resources-only' }));
});
test('HR certification verifies and applies all immutable migrations', async () => {
  const sql = []; await migrate({ $executeRawUnsafe: async (statement) => { sql.push(statement); } });
  assert.equal(sql.length, 6); assert.match(sql[0], /001_create_employee_profile/); assert.match(sql[5], /006_create_staff_attendance/);
});
