'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '.github', 'workflows', 'core-release.yml'), 'utf8');

test('core release builds one backend artifact and signs every immutable image', () => {
  assert.equal((source.match(/file: backend\/Dockerfile\.core/g) || []).length, 1);
  assert.match(source, /BACKEND_IMAGE: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/wattanam-customer-school-backend@\$\{\{ steps\.backend\.outputs\.digest \}\}/);
  assert.match(source, /cosign sign --yes "\$BACKEND_IMAGE"/);
  assert.match(source, /node tools\/generate-core-release-blueprint\.js core-release-blueprint\.json/);
  assert.match(source, /node tools\/verify-core-image-signatures\.js --blueprint core-release-blueprint\.json/);
});

test('release workflow has least required publishing and keyless-signing permissions', () => {
  assert.match(source, /contents:\s*read/);
  assert.match(source, /packages:\s*write/);
  assert.match(source, /id-token:\s*write/);
});
