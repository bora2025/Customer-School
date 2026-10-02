'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireGuard, seed } = require('./reporting-postgres-certification');

test('Reporting certification requires an exact read-model write guard', () => {
  assert.throws(() => requireGuard({}), /DATABASE_URL/);
  assert.throws(() => requireGuard({ DATABASE_URL: 'postgresql://example/db' }), /REPORTING_CERTIFY_ALLOW_WRITE/);
  assert.doesNotThrow(() => requireGuard({ DATABASE_URL: 'postgresql://example/db', REPORTING_CERTIFY_ALLOW_WRITE: 'reporting-readmodels-only' }));
});

test('Reporting seed writes only bounded version-one read-model fixtures', async () => {
  const calls = []; await seed({ $executeRawUnsafe: async (...args) => { calls.push(args); } });
  assert.equal(calls.length, 3); assert.ok(calls.every((call) => call[0].includes('PluginReadModel') && call[0].includes(',1,') && String(call[3]).startsWith('report-cert-')));
});
