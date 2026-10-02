'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertFixtureTarget } = require('./create-synthetic-legacy-fixture');

test('fixture requires explicit guard, alternate URL, and primary-target separation', () => {
  assert.throws(() => assertFixtureTarget({}), /ALLOW_SYNTHETIC/);
  assert.throws(() => assertFixtureTarget({ ALLOW_SYNTHETIC_LEGACY_FIXTURE: 'true' }), /ADOPT_DATABASE_URL/);
  assert.throws(() => assertFixtureTarget({ ALLOW_SYNTHETIC_LEGACY_FIXTURE: 'true', ADOPT_DATABASE_URL: 'same', DATABASE_URL: 'same' }), /refuses/);
  assert.doesNotThrow(() => assertFixtureTarget({ ALLOW_SYNTHETIC_LEGACY_FIXTURE: 'true', ADOPT_DATABASE_URL: 'test', DATABASE_URL: 'primary' }));
});
