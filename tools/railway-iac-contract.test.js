const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '.railway', 'railway.ts'), 'utf8');

test('Railway IaC owns the complete production topology without embedding secrets', () => {
  assert.match(source, /project\("customer-school"/);
  assert.match(source, /github\("bora2025\/Customer-School"\)/);

  for (const service of ['web', 'api', 'gateway']) {
    assert.match(source, new RegExp(`service\\("${service}"`), `${service} service must be declared`);
  }

  assert.match(source, /postgres\("Postgres"/);
  assert.match(source, /volume\("api-volume"/);
  assert.match(source, /volume\("postgres-volume"/);
  assert.match(source, /volumeMounts:\s*\{\s*"\/data": apiVolume\s*\}/);

  const envBlocks = [...source.matchAll(/env:\s*\{([^}]*)\}/gs)];
  assert.equal(envBlocks.length, 3, 'every application service must preserve its existing environment');
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
