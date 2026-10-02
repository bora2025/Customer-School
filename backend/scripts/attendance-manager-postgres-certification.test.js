'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { migrate, requireGuard } = require('./attendance-manager-postgres-certification');

test('Attendance certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgres://example', ATTENDANCE_CERTIFY_ALLOW_DROP: 'yes' }), /attendance-manager-only/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgres://example', ATTENDANCE_CERTIFY_ALLOW_DROP: 'attendance-manager-only' }));
});

test('Attendance certification verifies immutable migrations and executes published multi-statement files safely', async () => {
  const statements = [];
  await migrate({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.ok(statements.length > 6);
  assert.ok(statements.some((sql) => sql.includes('plugin_wattanam_attendance_manager_record')));
  assert.ok(statements.every((sql) => !/^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)));
});
