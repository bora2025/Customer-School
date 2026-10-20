'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('./generate-core-release-blueprint');

const digest = (name, character) => `ghcr.io/wattanam/${name}@sha256:${character.repeat(64)}`;
const environment = {
  BACKEND_IMAGE: digest('backend', 'a'), WEB_IMAGE: digest('web', 'b'), GATEWAY_IMAGE: digest('gateway', 'c'),
  POSTGRES_IMAGE: 'postgres:18-alpine', RELEASE_VERSION: '1.2.3', GITHUB_SHA: 'abc123', GITHUB_REPOSITORY: 'bora2025/Customer-School',
};

test('one backend build is assigned to both API and worker by exact digest', () => {
  const blueprint = generate(environment);
  assert.equal(blueprint.services.api.image, blueprint.services.worker.image);
  assert.equal(blueprint.invariants.backendImageParity, true);
  assert.equal(blueprint.services.api.variables.PROCESS_ROLE, 'api');
  assert.equal(blueprint.services.worker.variables.PROCESS_ROLE, 'worker');
});

test('rejects mutable tags and missing release identity', () => {
  assert.throws(() => generate({ ...environment, BACKEND_IMAGE: 'ghcr.io/wattanam/backend:latest' }), /digest-pinned/);
  assert.throws(() => generate({ ...environment, GITHUB_REPOSITORY: '' }), /GITHUB_REPOSITORY/);
});
