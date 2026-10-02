'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const semver = require('semver');

test('compatibility proxies are thin, Prisma-free, owned and removal-versioned', () => {
  const registry = require('./compatibility-proxies.json');
  assert.ok(registry.proxies.length > 0);
  for (const proxy of registry.proxies) {
    const source = fs.readFileSync(path.join(__dirname, '..', proxy.source), 'utf8');
    assert.ok(source.split(/\r?\n/).length <= proxy.maxSourceLines, `${proxy.id} exceeds thin proxy limit`);
    assert.doesNotMatch(source, /@prisma|PrismaClient|this\.prisma|\bprisma\./i);
    assert.match(source, new RegExp(proxy.ownerPlugin.replaceAll('.', '\\.')));
    assert.ok(semver.valid(proxy.removeAfterCore), `${proxy.id} requires a removal version`);
  }
});

test('portable recovery set binds database registry/grants, plugin code and mutable files', () => {
  const create = fs.readFileSync(path.join(__dirname, 'backup-recovery-set.js'), 'utf8');
  const restore = fs.readFileSync(path.join(__dirname, 'restore-recovery-set.js'), 'utf8');
  assert.match(create, /backup-database\.js/);
  assert.match(create, /pluginFiles/);
  assert.match(create, /pluginData/);
  assert.match(restore, /database restore failed; plugin files were not touched/);
  assert.match(restore, /Staging and verifying plugin archives before database restore/);
  assert.match(restore, /validateArchiveEntries/);
  assert.match(restore, /replaceDirectory/);
  assert.match(restore, /pre-restore-/);
  assert.match(restore, /verifyDirectoryChecksums\(pluginTarget/);
  assert.match(restore, /verifyDirectoryChecksums\(pluginDataTarget/);
});
