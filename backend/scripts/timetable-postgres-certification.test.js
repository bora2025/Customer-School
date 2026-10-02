'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { migrate, requireGuard } = require('./timetable-postgres-certification');

test('Timetable certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgres://example', TIMETABLE_CERTIFY_ALLOW_DROP: 'yes' }), /timetable-only/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgres://example', TIMETABLE_CERTIFY_ALLOW_DROP: 'timetable-only' }));
});

test('Timetable certification verifies every immutable migration', async () => {
  const statements = [];
  await migrate({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, 10);
  assert.ok(statements.every((sql) => sql.trim().startsWith('-- wattanam-plugin-migration:')));
});
