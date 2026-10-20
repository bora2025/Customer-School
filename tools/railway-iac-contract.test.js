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
  assert.match(source, /context\.isEnvironment\("plugin-certification-20261018"\)\s*\?\s*"plugin-cert-artifacts-20261018"\s*:\s*"plugin-artifacts"/);
  assert.match(source, /volume\("api-volume"/);
  assert.match(source, /volume\("worker-volume"/);
  assert.match(source, /volume\("postgres-volume"/);
  assert.match(source, /volumeMounts:\s*\{\s*"\/data": apiVolume\s*\}/);
  assert.match(source, /volumeMounts:\s*\{\s*"\/data": workerVolume\s*\}/);
  assert.match(source, /PLUGIN_REQUIRED_RUNTIME_ROLES:\s*preserve\(\)/);
  assert.match(source, /RAILWAY_DOCKERFILE_PATH:\s*preserve\(\)/);
  assert.match(source, /ENTITLEMENT_SECONDARY_PUBLIC_KEYS_JSON:\s*preserve\(\)/);
  assert.match(source, /UPDATE_REPOSITORY_PUBLIC_KEYS_JSON:\s*preserve\(\)/);
  assert.match(source, /PLUGIN_REVOKED_PUBLISHER_KEYS_JSON:\s*preserve\(\)/);
  assert.match(source, /PLUGIN_IN_PROCESS_PUBLISHERS:\s*preserve\(\)/);
  assert.match(source, /PLUGIN_SAFE_MODE:\s*preserve\(\)/);

  assert.doesNotMatch(source, /DATABASE_URL:\s*ref\(Postgres, "DATABASE_URL"\)/, 'IaC must not restore the shared owner database identity after runtime-role cutover');
  assert.match(source, /env:\s*\{[^\n]*DATABASE_URL:\s*preserve\(\)[^\n]*PROCESS_ROLE:\s*"api"/);
  assert.match(source, /env:\s*\{[^\n]*DATABASE_URL:\s*preserve\(\)[^\n]*PROCESS_ROLE:\s*"worker"/);
  assert.match(source, /MIGRATION_DATABASE_URL:\s*preserve\(\)/);
  assert.match(source, /PLUGIN_STORAGE_S3_ACCESS_KEY_ID:\s*ref\(pluginArtifacts, "ACCESS_KEY_ID"\)/);
  assert.match(source, /PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY:\s*ref\(pluginArtifacts, "SECRET_ACCESS_KEY"\)/);
  assert.match(source, /PLUGIN_STORAGE_S3_BUCKET:\s*ref\(pluginArtifacts, "BUCKET"\)/);
  assert.match(source, /PLUGIN_STORAGE_S3_ENDPOINT:\s*ref\(pluginArtifacts, "ENDPOINT"\)/);
  assert.match(source, /PROCESS_ROLE:\s*"api"/);
  assert.match(source, /PROCESS_ROLE:\s*"worker"/);
  assert.doesNotMatch(source, /(?:SECRET|PRIVATE_KEY|PASSWORD):\s*["'`](?!api|worker|core|s3)/, 'IaC must not embed secret values');
});

test('the repository root has no legacy Config-as-Code file and service references cannot override image commands', () => {
  assert.equal(fs.existsSync(path.join(root, 'railway.json')), false, 'root railway.json must remain removed after IaC ownership migration');
  for (const relative of ['backend/railway.json', 'frontend/railway.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    assert.equal(config.deploy?.startCommand, undefined, `${relative} must not override the selected image command`);
  }
});
