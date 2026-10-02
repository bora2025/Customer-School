'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CLASSIFICATIONS = new Set([
  'education-records', 'personal-data', 'communications', 'financial-records',
  'employment-records', 'location-data', 'generated-documents',
]);

function safeSegment(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(value);
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateOperational(manifest, label) {
  const value = manifest?.operational;
  if (!value || value.healthCheck !== 'runtime' || value.pricing !== 'marketplace') {
    throw new Error(`${label} has no supported operational health/pricing contract`);
  }
  if (!Array.isArray(value.dataClassification) || !value.dataClassification.length
    || value.dataClassification.some((item) => !CLASSIFICATIONS.has(item))) {
    throw new Error(`${label} has an invalid data classification`);
  }
  if (!value.backup || !['required', 'none'].includes(value.backup.database)
    || !['required', 'none'].includes(value.backup.files) || value.backup.restore !== 'required') {
    throw new Error(`${label} has an invalid backup/restore contract`);
  }
  if (value.uninstall?.dataRetention !== 'preserve') {
    throw new Error(`${label} does not preserve data on uninstall`);
  }
  return value;
}

function discoverPluginRecoveryContracts(pluginRoot, pluginDataRoot, { allowLegacy = false, ensureDataNamespaces = false } = {}) {
  const contracts = [];
  if (!fs.existsSync(pluginRoot)) return contracts;
  for (const pluginEntry of fs.readdirSync(pluginRoot, { withFileTypes: true })) {
    if (!pluginEntry.isDirectory() || pluginEntry.name.startsWith('.')) continue;
    if (!safeSegment(pluginEntry.name)) throw new Error(`Plugin recovery source has an unsafe plugin directory: ${pluginEntry.name}`);
    const pluginPath = path.join(pluginRoot, pluginEntry.name);
    for (const versionEntry of fs.readdirSync(pluginPath, { withFileTypes: true })) {
      if (!versionEntry.isDirectory() || versionEntry.name.startsWith('.')) continue;
      const manifestPath = path.join(pluginPath, versionEntry.name, 'plugin.json');
      if (!fs.existsSync(manifestPath)) throw new Error(`Plugin recovery source is missing ${pluginEntry.name}/${versionEntry.name}/plugin.json`);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
      catch { throw new Error(`Plugin recovery manifest is invalid JSON: ${pluginEntry.name}/${versionEntry.name}`); }
      if (manifest.id !== pluginEntry.name || manifest.version !== versionEntry.name) {
        throw new Error(`Plugin recovery manifest identity does not match its directory: ${pluginEntry.name}/${versionEntry.name}`);
      }
      let operational;
      try { operational = validateOperational(manifest, `${manifest.id}@${manifest.version}`); }
      catch (error) {
        if (!allowLegacy) throw error;
        contracts.push({ id: manifest.id, version: manifest.version, manifestPath: `${manifest.id}/${manifest.version}/plugin.json`, manifestSha256: digest(manifestPath), legacyException: true });
        continue;
      }
      if (operational.backup.files === 'required' && ensureDataNamespaces) {
        fs.mkdirSync(path.join(pluginDataRoot, manifest.id), { recursive: true, mode: 0o700 });
      }
      contracts.push({
        id: manifest.id,
        version: manifest.version,
        manifestPath: `${manifest.id}/${manifest.version}/plugin.json`,
        manifestSha256: digest(manifestPath),
        dataClassification: [...new Set(operational.dataClassification)].sort(),
        backup: operational.backup,
        uninstall: operational.uninstall,
        pricing: operational.pricing,
      });
    }
  }
  return contracts.sort((left, right) => `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`));
}

function verifyPluginRecoveryContracts(contracts, pluginRoot, pluginDataRoot, database) {
  if (!Array.isArray(contracts)) throw new Error('Recovery set has no plugin recovery contracts');
  const seen = new Set();
  for (const contract of contracts) {
    const key = `${contract?.id}@${contract?.version}`;
    if (!safeSegment(contract?.id) || typeof contract?.version !== 'string' || seen.has(key)) throw new Error(`Recovery set has an invalid or duplicate plugin contract: ${key}`);
    seen.add(key);
    const manifestPath = path.resolve(pluginRoot, ...String(contract.manifestPath || '').split('/'));
    if (!manifestPath.startsWith(`${path.resolve(pluginRoot)}${path.sep}`) || !fs.existsSync(manifestPath) || digest(manifestPath) !== contract.manifestSha256) {
      throw new Error(`Recovery set plugin manifest is absent or changed: ${key}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== contract.id || manifest.version !== contract.version) throw new Error(`Recovery set plugin identity changed: ${key}`);
    if (contract.legacyException === true) continue;
    const operational = validateOperational(manifest, key);
    if (JSON.stringify([...new Set(operational.dataClassification)].sort()) !== JSON.stringify(contract.dataClassification)
      || JSON.stringify(operational.backup) !== JSON.stringify(contract.backup)
      || operational.uninstall.dataRetention !== contract.uninstall?.dataRetention || operational.pricing !== contract.pricing) {
      throw new Error(`Recovery set operational contract changed: ${key}`);
    }
    if (contract.backup.database === 'required' && (!database?.file || !database?.sha256)) throw new Error(`Recovery set omits required database coverage: ${key}`);
    if (contract.backup.files === 'required') {
      const namespace = path.join(pluginDataRoot, contract.id);
      if (!fs.existsSync(namespace) || !fs.statSync(namespace).isDirectory()) throw new Error(`Recovery set omits required plugin file namespace: ${key}`);
    }
  }
  return { verified: true, pluginCount: contracts.length, legacyExceptionCount: contracts.filter((item) => item.legacyException === true).length };
}

module.exports = { CLASSIFICATIONS, discoverPluginRecoveryContracts, validateOperational, verifyPluginRecoveryContracts };
