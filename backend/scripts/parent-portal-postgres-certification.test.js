'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, requireGuard } = require('./parent-portal-postgres-certification');

test('Parent Portal certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /PARENT_PORTAL_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', PARENT_PORTAL_CERTIFY_ALLOW_DROP: 'parent-portal-only' }));
});

test('Parent Portal certification verifies and applies the immutable migration', async () => {
  const sql = []; await migrate({ $executeRawUnsafe: async (statement) => { sql.push(statement); } });
  assert.equal(sql.length, 3); assert.match(sql.join('\n'), /001_create_parent_link_request/);
});
