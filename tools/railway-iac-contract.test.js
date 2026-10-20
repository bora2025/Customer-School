const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '.railway', 'railway.ts'), 'utf8');

test('Railway IaC owns the complete production topology without embedding secrets', () => {
  assert.match(source, /project\("customer-school"/);
  assert.doesNotMatch(source, /github\(/, 'production services must use immutable release images, not independent source builds');
  for (const variable of ['API_IMAGE', 'WEB_IMAGE', 'GATEWAY_IMAGE']) {
    assert.match(source, new RegExp(`releaseImage\\("${variable}"\\)`));
  }

  for (const service of ['web', 'api', 'worker', 'gateway']) {
    assert.match(source, new RegExp(`service\\("${service}"`), `${service} service must be declared`);
  }

  assert.match(source, /postgres\("Postgres"/);
  assert.match(source, /volume\("api-volume"/);
  assert.match(source, /volume\("worker-volume"/);
  assert.match(source, /volume\("postgres-volume"/);
  assert.match(source, /volumeMounts:\s*\{\s*"\/data": apiVolume\s*\}/);
  assert.match(source, /volumeMounts:\s*\{\s*"\/data": workerVolume\s*\}/);
  assert.match(source, /PLUGIN_REQUIRED_RUNTIME_ROLES:\s*preserve\(\)/);
  assert.match(source, /RAILWAY_DOCKERFILE_PATH:\s*preserve\(\)/);
  assert.match(source, /ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON:\s*preserve\(\)/);
  assert.match(source, /UPDATE_REPOSITORY_PUBLIC_KEYS_JSON:\s*preserve\(\)/);

  const envBlocks = [...source.matchAll(/env:\s*\{([^}]*)\}/gs)];
  assert.equal(envBlocks.length, 4, 'every application service must preserve its existing environment');
  for (const [, envBlock] of envBlocks) {
    const assignments = [...envBlock.matchAll(/:\s*([^,}]+)/g)].map((match) => match[1].trim());
    assert.ok(assignments.length > 0);
    assert.ok(assignments.every((value) => value === 'preserve()'), 'IaC must not contain plaintext environment values');
  }
});

test('legacy Config-as-Code files stay non-authoritative and cannot override image commands', () => {
  for (const relative of ['railway.json', 'backend/railway.json', 'frontend/railway.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    assert.equal(config.deploy?.startCommand, undefined, `${relative} must not override the selected image command`);
  }
});
