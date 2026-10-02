'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expectedSchemaLineage, postgresClientExecutable, safeRelativePath, walkDirectoryChecksums, verifyDirectoryChecksums, sha256 } = require('./db-toolkit');

test('expectedSchemaLineage selects core and legacy restore boundaries', () => {
  assert.equal(expectedSchemaLineage('core'), 'wattanam-core-v1');
  assert.equal(expectedSchemaLineage('legacy-full'), 'wattanam-legacy-v1');
  assert.equal(expectedSchemaLineage(undefined), 'wattanam-legacy-v1');
  assert.throws(() => expectedSchemaLineage('unknown'), /must be core or legacy-full/);
});

test('selects a PostgreSQL client matching the connected server major when available', () => {
  assert.equal(postgresClientExecutable('pg_dump', '160011', (candidate) => candidate.includes('/16/')), '/usr/lib/postgresql/16/bin/pg_dump');
  assert.equal(postgresClientExecutable('pg_restore', '180006', (candidate) => candidate.includes('/18/')), '/usr/lib/postgresql/18/bin/pg_restore');
  assert.equal(postgresClientExecutable('pg_dump', '160011', () => false), 'pg_dump');
  assert.throws(() => postgresClientExecutable('psql', '160011'), /unsupported/);
  assert.throws(() => postgresClientExecutable('pg_dump', 'not-a-version'), /invalid/);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-db-toolkit-'));
}

test('safeRelativePath rejects traversal, absolute, and null-byte paths', () => {
  assert.equal(safeRelativePath('a/b.txt'), true);
  assert.equal(safeRelativePath('../escape.txt'), false);
  assert.equal(safeRelativePath('a/../../escape.txt'), false);
  assert.equal(safeRelativePath('/absolute.txt'), false);
  assert.equal(safeRelativePath('a\\b.txt'), false);
  assert.equal(safeRelativePath('a\0b.txt'), false);
  assert.equal(safeRelativePath(''), false);
});

test('walkDirectoryChecksums returns an empty manifest for a missing or empty directory', () => {
  const missing = path.join(os.tmpdir(), `wattanam-db-toolkit-missing-${Date.now()}`);
  assert.deepEqual(walkDirectoryChecksums(missing), { algorithm: 'sha256', files: {} });

  const empty = tempDir();
  try { assert.deepEqual(walkDirectoryChecksums(empty), { algorithm: 'sha256', files: {} }); }
  finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('walkDirectoryChecksums hashes nested files with forward-slash relative paths', () => {
  const root = tempDir();
  try {
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'top.txt'), 'top');
    fs.writeFileSync(path.join(root, 'nested', 'child.txt'), 'child');
    const manifest = walkDirectoryChecksums(root);
    assert.equal(manifest.algorithm, 'sha256');
    assert.deepEqual(Object.keys(manifest.files).sort(), ['nested/child.txt', 'top.txt']);
    assert.equal(manifest.files['top.txt'], sha256(path.join(root, 'top.txt')));
    assert.equal(manifest.files['nested/child.txt'], sha256(path.join(root, 'nested', 'child.txt')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verifyDirectoryChecksums passes for an identical directory and fails on any drift', () => {
  const root = tempDir();
  try {
    fs.writeFileSync(path.join(root, 'a.txt'), 'unchanged');
    const manifest = walkDirectoryChecksums(root);

    assert.doesNotThrow(() => verifyDirectoryChecksums(root, manifest));

    fs.writeFileSync(path.join(root, 'a.txt'), 'tampered');
    assert.throws(() => verifyDirectoryChecksums(root, manifest), /checksum mismatch/);

    fs.writeFileSync(path.join(root, 'a.txt'), 'unchanged');
    fs.writeFileSync(path.join(root, 'extra.txt'), 'unexpected');
    assert.throws(() => verifyDirectoryChecksums(root, manifest), /do not match the manifest file list/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
