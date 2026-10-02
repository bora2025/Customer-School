'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { migrate, requireGuard } = require('./examination-postgres-certification');

test('Examination certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgres://example', EXAMINATION_CERTIFY_ALLOW_DROP: 'yes' }), /examination-only/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgres://example', EXAMINATION_CERTIFY_ALLOW_DROP: 'examination-only' }));
});

test('Examination certification verifies every immutable migration', async () => {
  const statements = [];
  await migrate({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, 10);
  assert.ok(statements.every((sql) => sql.trim().startsWith('-- wattanam-plugin-migration:')));
});
