'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { migrate, requireGuard } = require('./document-designer-postgres-certification');
test('Document Designer certification requires an exact destructive namespace guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /DOCUMENT_DESIGNER_CERTIFY_ALLOW_DROP/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', DOCUMENT_DESIGNER_CERTIFY_ALLOW_DROP: 'document-designer-only' }));
});
test('Document Designer certification verifies its immutable migration', async () => {
  const statements = []; await migrate({ $executeRawUnsafe: async (sql) => { statements.push(sql); } });
  assert.equal(statements.length, 1); assert.match(statements[0], /001_create_template/);
});
