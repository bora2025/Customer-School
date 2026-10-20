'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCutoverState, buildRuntimeUrls, databaseName, waitForDeployment } = require('./cutover-railway-runtime-database');
const fs = require('node:fs');
const path = require('node:path');

test('invokes the provisioner at the runtime image path', () => {
  const source = fs.readFileSync(path.join(__dirname, 'cutover-railway-runtime-database.js'), 'utf8');
  assert.match(source, /node', 'scripts\/provision-runtime-database-roles\.js'/);
  assert.doesNotMatch(source, /node', 'backend\/scripts\/provision-runtime-database-roles\.js'/);
});

test('builds distinct runtime URLs without changing the database target', () => {
  const admin = 'postgresql://owner:secret@postgres.railway.internal:5432/railway?schema=public';
  const urls = buildRuntimeUrls(admin, 'a'.repeat(32), 'b'.repeat(32));
  assert.equal(new URL(urls.api).username, 'wattanam_api');
  assert.equal(new URL(urls.worker).username, 'wattanam_worker');
  assert.equal(databaseName(urls.api), 'railway');
  assert.equal(new URL(urls.api).search, '?schema=public');
  assert.notEqual(urls.api, urls.worker);
});

test('requires the current shared identity and keeps migration credentials away from worker', () => {
  const url = 'postgresql://owner:secret@db:5432/railway';
  assert.equal(assertCutoverState({ DATABASE_URL: url }, { DATABASE_URL: url }, 'railway').database, 'railway');
  assert.throws(() => assertCutoverState({ DATABASE_URL: url }, { DATABASE_URL: url.replace('owner', 'worker') }, 'railway'), /shared database identity/);
  assert.throws(() => assertCutoverState({ DATABASE_URL: url }, { DATABASE_URL: url, MIGRATION_DATABASE_URL: url }, 'railway'), /worker must not/);
  assert.throws(() => assertCutoverState({ DATABASE_URL: url }, { DATABASE_URL: url }, 'other'), /exactly match/);
});

test('waits for the exact redeployment and fails closed on a terminal deployment', () => {
  let tick = 0;
  const success = waitForDeployment('api', 'certification', 'new', { timeoutMs: 10, intervalMs: 1, now: () => tick, pause: () => { tick += 1; }, list: () => [{ id: 'old', status: 'SUCCESS' }, { id: 'new', status: tick > 1 ? 'SUCCESS' : 'BUILDING' }] });
  assert.equal(success.id, 'new');
  assert.throws(() => waitForDeployment('worker', 'certification', 'bad', { timeoutMs: 10, now: () => 0, pause: () => {}, list: () => [{ id: 'bad', status: 'FAILED' }] }), /ended with FAILED/);
});
