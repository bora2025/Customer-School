'use strict';

// B-012: bundles the existing PostgreSQL backup (backup-database.js, unchanged)
// together with plugin files (PLUGIN_DIR) and plugin data (PLUGIN_DATA_DIR) into
// one recovery-set journal, following the same journal-format precedent as
// legacy-adopt.js (a top-level JSON binding every artifact's checksum). Plugin
// *settings* and manifest *metadata* are already database rows (PluginSetting,
// PluginInstallation.manifestJson) and are covered by the database backup alone --
// only the physical files under PLUGIN_DIR/PLUGIN_DATA_DIR need bundling here.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  backupDirectory, fail, installationSlug, pluginDataDirectory, pluginDirectory,
  postgresEnvironment, sha256, tar, timestamp, walkDirectoryChecksums,
} = require('./db-toolkit');
const { discoverPluginRecoveryContracts, verifyPluginRecoveryContracts } = require('./plugin-recovery-contract');

if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node scripts/backup-recovery-set.js\nRequires DATABASE_URL; optional BACKUP_DIR, PLUGIN_DIR, PLUGIN_DATA_DIR.\n');
  process.exit(0);
}

if (process.env.PLUGIN_STORAGE_PROVIDER === 's3') {
  fail('PLUGIN_STORAGE_PROVIDER=s3 has no local plugin-data mirror; run storage:migrate --direction s3-to-local, then use dual-s3-primary during backup');
}

function runBackupDatabase() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'backup-database.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.error) fail(`backup-database.js could not start: ${result.error.message}`);
  if (result.status !== 0) fail('backup-database.js failed; recovery-set backup cancelled');
  const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function archiveDirectory(directory, archivePath) {
  const manifest = walkDirectoryChecksums(directory);
  tar(['-cf', archivePath, '-C', directory, '.']);
  return {
    manifest,
    archive: { file: path.basename(archivePath), sha256: sha256(archivePath), sizeBytes: fs.statSync(archivePath).size },
  };
}

const directory = backupDirectory();
const environment = postgresEnvironment();
const slug = installationSlug(environment) || 'legacy';
const base = `wattanam-recovery-${timestamp()}`;

const contracts = discoverPluginRecoveryContracts(pluginDirectory(), pluginDataDirectory(), {
  // Existing schools retain old immutable package generations for rollback. Those historical
  // manifests predate the operational contract and must remain recoverable. They are recorded as
  // explicit journal exceptions; strict release/certification jobs reject them.
  allowLegacy: process.env.REQUIRE_PLUGIN_BACKUP_CONTRACTS !== 'true',
  ensureDataNamespaces: true,
});
const database = runBackupDatabase();
const pluginFiles = archiveDirectory(pluginDirectory(), path.join(directory, `${base}-plugin-files.tar`));
const pluginData = archiveDirectory(pluginDataDirectory(), path.join(directory, `${base}-plugin-data.tar`));
const contractVerification = verifyPluginRecoveryContracts(contracts, pluginDirectory(), pluginDataDirectory(), database);

const journal = {
  format: 'wattanam-recovery-set-v2',
  createdAt: new Date().toISOString(),
  installationSlug: slug,
  database: { file: database.file, sha256: database.sha256, sizeBytes: database.sizeBytes },
  pluginFiles: { archive: pluginFiles.archive, checksums: pluginFiles.manifest },
  pluginData: { archive: pluginData.archive, checksums: pluginData.manifest },
  pluginContracts: contracts,
  contractVerification,
};

const journalPath = path.join(directory, `${base}.recovery-set.json`);
fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ journalFile: path.basename(journalPath), ...journal })}\n`);
