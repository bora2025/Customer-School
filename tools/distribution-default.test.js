const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('LC2-002: runtime upgrades stay compatible while new-school provisioning is core-first', () => {
  const environment = source('backend/src/config/environment.ts');
  const compose = source('docker-compose.yml');
  const provisioner = source('tools/provision-railway-school.js');
  const rootExample = source('.env.example');
  const backendExample = source('backend/.env.example');

  assert.match(environment, /WATTANAM_DISTRIBUTION\?\.trim\(\)\.toLowerCase\(\) \|\| 'legacy-full'/);
  assert.equal((compose.match(/WATTANAM_DISTRIBUTION: \$\{WATTANAM_DISTRIBUTION:-legacy-full\}/g) || []).length, 2);
  assert.match(provisioner, /arg\('distribution'\) \|\| 'core'/);
  assert.match(provisioner, /WATTANAM_DISTRIBUTION: distribution/);
  assert.match(rootExample, /^WATTANAM_DISTRIBUTION=legacy-full$/m);
  assert.match(backendExample, /^WATTANAM_DISTRIBUTION=legacy-full$/m);
  assert.match(provisioner, /legacy-full is an explicit migration\/rollback compatibility mode/);
});
