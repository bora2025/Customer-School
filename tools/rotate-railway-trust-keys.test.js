'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertParity, buildRotationValues, waitForDeployment } = require('./rotate-railway-trust-keys');

const oldPem = '-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----';
const newPem = '-----BEGIN PUBLIC KEY-----\nnew\n-----END PUBLIC KEY-----';
test('rotation retains the previous primary as overlap and promotes the new key', () => {
  const values = buildRotationValues('update', { UPDATE_REPOSITORY_KEY_ID: 'old', UPDATE_REPOSITORY_PUBLIC_KEY: oldPem, UPDATE_REPOSITORY_PUBLIC_KEYS_JSON: '{"older":"pem"}' }, 'new', newPem);
  assert.equal(values.UPDATE_REPOSITORY_KEY_ID, 'new');
  assert.equal(values.UPDATE_REPOSITORY_PUBLIC_KEY, newPem);
  assert.deepEqual(JSON.parse(values.UPDATE_REPOSITORY_PUBLIC_KEYS_JSON), { older: 'pem', old: oldPem });
});
test('rotation removes the promoted key from the secondary bundle', () => {
  const values = buildRotationValues('entitlement', { ENTITLEMENT_KEY_ID: 'old', ENTITLEMENT_PUBLIC_KEY: oldPem, ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON: JSON.stringify({ new: newPem }) }, 'new', newPem);
  assert.deepEqual(JSON.parse(values.ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON), { old: oldPem });
});
test('rotation fails closed on split-runtime trust drift', () => {
  assert.throws(() => assertParity({ UPDATE_REPOSITORY_KEY_ID: 'a', UPDATE_REPOSITORY_PUBLIC_KEY: oldPem }, { UPDATE_REPOSITORY_KEY_ID: 'b', UPDATE_REPOSITORY_PUBLIC_KEY: oldPem }, 'update'), /differs between API and worker/);
});
test('rotation waits for each exact deployment and fails on terminal state', () => {
  let tick = 0;
  const result = waitForDeployment('api', 'certification', 'new', { timeoutMs: 10, intervalMs: 1, now: () => tick, pause: () => { tick += 1; }, list: () => [{ id: 'old', status: 'SUCCESS' }, { id: 'new', status: tick > 1 ? 'SUCCESS' : 'DEPLOYING' }] });
  assert.equal(result.id, 'new');
  assert.throws(() => waitForDeployment('worker', 'certification', 'bad', { timeoutMs: 10, now: () => 0, pause: () => {}, list: () => [{ id: 'bad', status: 'FAILED' }] }), /ended with FAILED/);
});
