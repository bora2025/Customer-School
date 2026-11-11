'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { configuration, roleStatements } = require('./provision-runtime-database-roles');

const base = { DATABASE_URL: 'postgresql://admin:secret@localhost:5432/wattanam_test', RUNTIME_API_DATABASE_PASSWORD: 'a'.repeat(32), RUNTIME_WORKER_DATABASE_PASSWORD: 'b'.repeat(32) };

test('is dry-run by default and requires exact database confirmation for writes', () => {
  assert.equal(configuration(base, []).execute, false);
  assert.throws(() => configuration(base, ['--execute']), /confirm-database/);
  assert.equal(configuration(base, ['--execute', '--confirm-database', 'wattanam_test']).execute, true);
});

test('creates bounded non-administrative roles and denies worker schema creation', () => {
  const config = configuration(base, ['--execute', '--confirm-database', 'wattanam_test']);
  const sql = roleStatements(config).join('\n');
  assert.match(sql, /wattanam_api/);
  assert.match(sql, /wattanam_worker/);
  // The API user manages the per-plugin roles, so it alone may create roles; neither is a superuser.
  assert.match(sql, /ALTER ROLE "wattanam_api" NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /ALTER ROLE "wattanam_worker" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /GRANT USAGE ON SCHEMA public TO "wattanam_api" WITH GRANT OPTION/);
  assert.doesNotMatch(sql, /GRANT USAGE ON SCHEMA public TO "wattanam_worker" WITH GRANT OPTION/);
  assert.doesNotMatch(sql, /\bSUPERUSER\b(?<!NOSUPERUSER)/);
  assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM "wattanam_worker"/);
  assert.doesNotMatch(sql, /GRANT ALL/);
});

test('does not expose passwords in dry-run coordinates', async () => {
  const config = configuration(base, []);
  const { provision } = require('./provision-runtime-database-roles');
  const result = await provision(config);
  assert.equal(JSON.stringify(result).includes(base.RUNTIME_API_DATABASE_PASSWORD), false);
  assert.equal(JSON.stringify(result).includes(base.RUNTIME_WORKER_DATABASE_PASSWORD), false);
});
