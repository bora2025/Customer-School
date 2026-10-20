'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertParity, buildRotationValues } = require('./rotate-railway-trust-keys');

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
