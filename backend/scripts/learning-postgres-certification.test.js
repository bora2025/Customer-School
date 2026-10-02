'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { migrate, requireGuard } = require('./learning-postgres-certification');

test('Learning certification requires namespace and destructive-migration approval guards', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgres://example', LEARNING_CERTIFY_ALLOW_DROP: 'learning-only' }), /DESTRUCTIVE_APPROVAL/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgres://example', LEARNING_CERTIFY_ALLOW_DROP: 'learning-only', LEARNING_CERTIFY_DESTRUCTIVE_APPROVAL: '014_allow_assignment_attempts' }));
});

test('Learning certification verifies all migrations and refuses unapproved destructive DDL', async () => {
  const prisma = { $executeRawUnsafe: async () => {} };
  await assert.rejects(migrate(prisma, ''), /requires explicit approval/);
  const statements = []; await migrate({ $executeRawUnsafe: async (sql) => { statements.push(sql); } }, '014_allow_assignment_attempts');
  assert.equal(statements.length, 14); assert.ok(statements.every((sql) => sql.trim().startsWith('-- wattanam-plugin-migration:')));
});
