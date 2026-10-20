'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Docker context excludes nested generated dependency and build trees', () => {
  const ignored = read('.dockerignore');
  for (const pattern of ['**/node_modules', '**/.next', '**/.core-build', '**/dist', '**/build']) {
    assert.match(ignored, new RegExp(`^${pattern.replaceAll('*', '\\*').replaceAll('.', '\\.').replaceAll('/', '\\/')}$`, 'm'));
  }
});

test('production application images use the supported Node 24 runtime line', () => {
  for (const file of ['backend/Dockerfile.core', 'frontend/Dockerfile.core']) {
    const dockerfile = read(file);
    const nodeImages = [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+).*$/gm)].map((match) => match[1]);
    assert.ok(nodeImages.length > 0, `${file} must declare a Node base image`);
    assert.ok(nodeImages.every((image) => image === 'node:24-slim'), `${file} must use node:24-slim in every stage`);
  }
});

test('core backend image includes the S3 recovery migration command', () => {
  const webpack = read('backend/webpack.core.config.js');
  const dockerfile = read('backend/Dockerfile.core');
  assert.match(webpack, /'storage-migrate': '\.\/src\/storage\/storage-migrate-cli\.ts'/);
  assert.match(dockerfile, /COPY --chown=node:node --from=builder \/app\/dist-core \.\/dist-core/);
  assert.match(dockerfile, /PROCESS_ROLE.*worker.*dist-core\/worker\.js.*scripts\/deploy-migrations\.js/s);
  assert.match(dockerfile, /COPY --chown=node:node[^\n]*backend\/scripts\/provision-runtime-database-roles\.js[^\n]*\.\/scripts\//, 'least-privilege role provisioner must ship in the runtime image');
  assert.match(dockerfile, /COPY --chown=node:node[^\n]*backend\/scripts\/scheduled-recovery-drill\.js[^\n]*\.\/scripts\//, 'scheduled recovery drill must ship in the runtime image');
});

test('frontend uses the advisory-clean Tailwind 4 build contract', () => {
  const packageJson = JSON.parse(read('frontend/package.json'));
  assert.match(packageJson.devDependencies.tailwindcss, /^\^?4\./);
  assert.match(packageJson.devDependencies['@tailwindcss/postcss'], /^\^?4\./);
  assert.equal(packageJson.devDependencies.autoprefixer, undefined);
  assert.equal(packageJson.devDependencies['eslint-config-next'], undefined);
  assert.equal(packageJson.scripts.lint, 'tsc --noEmit');

  const postcss = read('frontend/postcss.config.js');
  const styles = read('frontend/app/styles.css');
  assert.match(postcss, /'@tailwindcss\/postcss'/);
  assert.match(styles, /^@import "tailwindcss";/);
  assert.doesNotMatch(styles, /@tailwind\s|@screen\s/);
  assert.doesNotMatch(styles, /@apply\s+(?:card|btn|badge|glass-card)(?:\s|;)/);
});

test('self-hosted core topology requires digest-addressable images and core distribution', () => {
  const compose = read('docker-compose.core.yml');
  for (const variable of ['POSTGRES_IMAGE', 'API_IMAGE', 'WEB_IMAGE', 'GATEWAY_IMAGE']) {
    assert.match(compose, new RegExp(`\\$\\{${variable}:\\?${variable} must be digest-pinned\\}`));
  }
  assert.match(compose, /WATTANAM_DISTRIBUTION: core/);
  assert.match(compose, /PROCESS_ROLE: combined/);
  assert.match(compose, /profiles: \["operations"\]/);
  assert.match(compose, /profiles: \["recovery-drill"\]/);
});
