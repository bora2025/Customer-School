'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Railway defers startup to each selected image instead of overriding core with legacy paths', () => {
  for (const service of ['backend', 'frontend']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, service, 'railway.json'), 'utf8'));
    assert.equal(config.deploy.startCommand, undefined, `${service}/railway.json must not override its Docker image command`);
  }
  assert.match(fs.readFileSync(path.join(root, 'backend', 'Dockerfile.core'), 'utf8'), /dist-core\/main\.js/);
  assert.match(fs.readFileSync(path.join(root, 'backend', 'Dockerfile.core'), 'utf8'), /PROCESS_ROLE.*worker.*dist-core\/worker\.js/);
  const webpack = fs.readFileSync(path.join(root, 'backend', 'webpack.core.config.js'), 'utf8');
  assert.match(webpack, /main: '\.\/src\/main-core\.ts'/);
  assert.match(webpack, /worker: '\.\/src\/worker-core\.ts'/);
  assert.match(fs.readFileSync(path.join(root, 'frontend', 'Dockerfile.core'), 'utf8'), /CMD \["node", "server\.js"\]/);
});
