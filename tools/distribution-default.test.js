const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('LC2-002: legacy compatibility stays explicit while every new deployment path is core-first', () => {
  const environment = source('backend/src/config/environment.ts');
  const compose = source('docker-compose.core.yml');
  const provisioner = source('tools/provision-railway-school.js');
  const backendImage = source('backend/Dockerfile.core');
  const frontendImage = source('frontend/Dockerfile.core');
  const rootExample = source('.env.example');
  const backendExample = source('backend/.env.example');

  // Production fails closed when the distribution is missing and requires a bounded legacy waiver.
  assert.match(environment, /WATTANAM_DISTRIBUTION is required in production/);
  assert.match(environment, /LEGACY_FULL_APPROVED_UNTIL/);
  assert.equal((compose.match(/WATTANAM_DISTRIBUTION: core/g) || []).length, 5);
  assert.doesNotMatch(compose, /legacy-full/);
  assert.match(backendImage, /ENV WATTANAM_DISTRIBUTION=core/);
  assert.match(frontendImage, /ENV WATTANAM_DISTRIBUTION=core/);
  assert.match(provisioner, /arg\('distribution'\) \|\| 'core'/);
  assert.match(provisioner, /WATTANAM_DISTRIBUTION: distribution/);
  // The self-hosted root example is a new deployment; the backend-only developer example keeps
  // legacy-full so an existing source checkout is never silently cut over.
  assert.match(rootExample, /^WATTANAM_DISTRIBUTION=core$/m);
  assert.match(backendExample, /^WATTANAM_DISTRIBUTION=legacy-full$/m);
  assert.match(provisioner, /legacy-full is an explicit migration\/rollback compatibility mode/);
});
