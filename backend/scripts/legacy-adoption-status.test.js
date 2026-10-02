'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { target } = require('./legacy-adoption-status');

test('status proof requires an isolated database and confirmed slug', () => {
  assert.throws(() => target({}), /ADOPT_DATABASE_URL/);
  assert.throws(() => target({ ADOPT_DATABASE_URL: 'postgresql://test' }), /ADOPT_SCHOOL_SLUG/);
  assert.deepEqual(target({ ADOPT_DATABASE_URL: ' postgresql://test ', ADOPT_SCHOOL_SLUG: ' school ' }), { url: 'postgresql://test', slug: 'school' });
});
