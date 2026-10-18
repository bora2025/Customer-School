'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { discoverPluginRecoveryContracts, verifyPluginRecoveryContracts } = require('./plugin-recovery-contract');
const { resolvePluginSource } = require('./plugin-source-root');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-plugin-recovery-contract-'));
  const plugins = path.join(root, 'plugins');
  const data = path.join(root, 'data');
  const installed = path.join(plugins, 'wattanam.files', '1.2.3');
  fs.mkdirSync(installed, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const manifest = {
    schemaVersion: 1, id: 'wattanam.files', version: '1.2.3',
    operational: {
      healthCheck: 'runtime', dataClassification: ['personal-data'],
      backup: { database: 'required', files: 'required', restore: 'required' },
      uninstall: { dataRetention: 'preserve' }, pricing: 'marketplace',
    },
  };
  fs.writeFileSync(path.join(installed, 'plugin.json'), JSON.stringify(manifest));
  return { root, plugins, data, manifest, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('discovers declared backup participation and preserves an empty required file namespace', () => {
  const value = fixture();
  try {
    const contracts = discoverPluginRecoveryContracts(value.plugins, value.data, { ensureDataNamespaces: true });
    assert.equal(contracts.length, 1);
    assert.deepEqual(contracts[0].backup, { database: 'required', files: 'required', restore: 'required' });
    assert.equal(fs.statSync(path.join(value.data, 'wattanam.files')).isDirectory(), true);
    assert.deepEqual(verifyPluginRecoveryContracts(contracts, value.plugins, value.data, { file: 'school.dump', sha256: 'a'.repeat(64) }), {
      verified: true, pluginCount: 1, legacyExceptionCount: 0,
    });
  } finally { value.close(); }
});

test('fails closed for undeclared legacy plugins unless an explicit exception is recorded', () => {
  const value = fixture();
  try {
    delete value.manifest.operational;
    fs.writeFileSync(path.join(value.plugins, 'wattanam.files', '1.2.3', 'plugin.json'), JSON.stringify(value.manifest));
    assert.throws(() => discoverPluginRecoveryContracts(value.plugins, value.data), /operational/);
    const contracts = discoverPluginRecoveryContracts(value.plugins, value.data, { allowLegacy: true });
    assert.equal(contracts[0].legacyException, true);
    assert.equal(verifyPluginRecoveryContracts(contracts, value.plugins, value.data, { file: 'school.dump', sha256: 'b' }).legacyExceptionCount, 1);
  } finally { value.close(); }
});

test('restore verification rejects a changed manifest or a missing required file namespace', () => {
  const value = fixture();
  try {
    const contracts = discoverPluginRecoveryContracts(value.plugins, value.data, { ensureDataNamespaces: true });
    fs.writeFileSync(path.join(value.plugins, 'wattanam.files', '1.2.3', 'plugin.json'), JSON.stringify({ ...value.manifest, version: '1.2.4' }));
    assert.throws(() => verifyPluginRecoveryContracts(contracts, value.plugins, value.data, { file: 'school.dump', sha256: 'c' }), /absent or changed/);
    fs.writeFileSync(path.join(value.plugins, 'wattanam.files', '1.2.3', 'plugin.json'), JSON.stringify(value.manifest));
    const refreshed = discoverPluginRecoveryContracts(value.plugins, value.data);
    fs.rmSync(path.join(value.data, 'wattanam.files'), { recursive: true, force: true });
    assert.throws(() => verifyPluginRecoveryContracts(refreshed, value.plugins, value.data, { file: 'school.dump', sha256: 'd' }), /file namespace/);
  } finally { value.close(); }
});

test('Organizing Management participates in recovery without requiring a customer-core source copy', () => {
  const source = resolvePluginSource('wattanam.organizing-management');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wattanam-organizing-recovery-'));
  const plugins = path.join(root, 'plugins');
  const data = path.join(root, 'data');
  const installed = path.join(plugins, manifest.id, manifest.version);
  try {
    fs.mkdirSync(installed, { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    fs.copyFileSync(path.join(source, 'plugin.json'), path.join(installed, 'plugin.json'));
    const contracts = discoverPluginRecoveryContracts(plugins, data);
    assert.equal(contracts.length, 1);
    assert.deepEqual(contracts[0].dataClassification, ['employment-records', 'personal-data']);
    assert.deepEqual(contracts[0].backup, { database: 'required', files: 'none', restore: 'required' });
    assert.deepEqual(
      verifyPluginRecoveryContracts(contracts, plugins, data, { file: 'school.dump', sha256: 'e'.repeat(64) }),
      { verified: true, pluginCount: 1, legacyExceptionCount: 0 },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
