'use strict';

// B-012: restores a recovery-set journal produced by backup-recovery-set.js --
// the database (via the existing, unchanged restore-database.js) plus the
// plugin-files and plugin-data archives, into a fresh or in-place target.
// Verifies every checksum against the journal before touching anything, and
// again after extraction, matching restore-database.js's verify-first pattern.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  fail, pluginDataDirectory, pluginDirectory, safeRelativePath, sha256, tar, verifyDirectoryChecksums,
} = require('./db-toolkit');
const { verifyPluginRecoveryContracts } = require('./plugin-recovery-contract');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv.includes('--help')) {
  process.stdout.write(
    'Usage: node scripts/restore-recovery-set.js --from <journal.json> --confirm-target <school-slug|EMPTY> --yes-replace ' +
    '[--use-restore-database-url] [--plugin-dir <dir>] [--plugin-data-dir <dir>]\n',
  );
  process.exit(0);
}

if (process.env.PLUGIN_STORAGE_PROVIDER === 's3') {
  fail('restore into S3 requires a local staging target; use PLUGIN_STORAGE_PROVIDER=dual-local-primary, restore, then run local-to-s3 migration and cut over');
}

const journalArg = argument('--from');
const confirmation = argument('--confirm-target');
if (!journalArg || !confirmation || !process.argv.includes('--yes-replace')) fail('restore requires --from, --confirm-target, and --yes-replace');

const journalPath = path.resolve(journalArg);
if (!fs.existsSync(journalPath)) fail('recovery-set journal does not exist');
let journal;
try { journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')); } catch { fail('recovery-set journal is invalid JSON'); }
if (!['wattanam-recovery-set-v1', 'wattanam-recovery-set-v2'].includes(journal.format)) fail('unsupported recovery-set journal format');

const directory = path.dirname(journalPath);
const databaseArchive = path.join(directory, journal.database.file);
const pluginFilesArchive = path.join(directory, journal.pluginFiles.archive.file);
const pluginDataArchive = path.join(directory, journal.pluginData.archive.file);

function validateArchiveEntries(archive) {
  const listed = spawnSync('tar', ['-tf', archive], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (listed.error) fail(`tar could not inspect recovery archive: ${listed.error.message}`);
  if (listed.status !== 0) fail(`tar could not inspect recovery archive: ${listed.stderr || listed.status}`);
  for (const original of String(listed.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const name = original.replace(/^\.\//, '').replace(/\/$/, '');
    if (!name) continue;
    if (!safeRelativePath(name) || path.isAbsolute(name) || /^[A-Za-z]:/.test(name)) fail(`recovery-set archive contains an unsafe path: ${original}`);
  }
}

function stageArchive(target, archive, manifest, label) {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o750 });
  const stagingRoot = fs.mkdtempSync(path.join(parent, `.wattanam-${label}-restore-`));
  const staged = path.join(stagingRoot, 'content');
  fs.mkdirSync(staged, { recursive: true, mode: 0o750 });
  validateArchiveEntries(archive);
  tar(['-xf', archive, '-C', staged]);
  verifyDirectoryChecksums(staged, manifest);
  return { stagingRoot, staged };
}

function replaceDirectory(target, staged, label) {
  const previous = `${target}.pre-restore-${process.pid}`;
  if (fs.existsSync(previous)) fail(`${label} pre-restore directory already exists: ${previous}`);
  let movedPrevious = false;
  try {
    if (fs.existsSync(target)) { fs.renameSync(target, previous); movedPrevious = true; }
    fs.renameSync(staged, target);
    return {
      commit() { if (movedPrevious) fs.rmSync(previous, { recursive: true, force: true }); },
      rollback() {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        if (movedPrevious && fs.existsSync(previous)) fs.renameSync(previous, target);
      },
    };
  } catch (error) {
    if (!fs.existsSync(target) && movedPrevious && fs.existsSync(previous)) fs.renameSync(previous, target);
    throw error;
  }
}

process.stderr.write('Verifying recovery-set archives against the journal...\n');
for (const [file, expected, label] of [
  [databaseArchive, journal.database.sha256, 'database'],
  [pluginFilesArchive, journal.pluginFiles.archive.sha256, 'plugin-files'],
  [pluginDataArchive, journal.pluginData.archive.sha256, 'plugin-data'],
]) {
  if (!fs.existsSync(file)) fail(`recovery-set ${label} archive is missing: ${file}`);
  if (sha256(file) !== expected) fail(`recovery-set ${label} archive checksum mismatch`);
}

const pluginTarget = argument('--plugin-dir') ? path.resolve(argument('--plugin-dir')) : pluginDirectory();
const pluginDataTarget = argument('--plugin-data-dir') ? path.resolve(argument('--plugin-data-dir')) : pluginDataDirectory();
process.stderr.write('Staging and verifying plugin archives before database restore...\n');
const pluginStage = stageArchive(pluginTarget, pluginFilesArchive, journal.pluginFiles.checksums, 'plugin-files');
const pluginDataStage = stageArchive(pluginDataTarget, pluginDataArchive, journal.pluginData.checksums, 'plugin-data');
if (journal.format === 'wattanam-recovery-set-v2') {
  try { verifyPluginRecoveryContracts(journal.pluginContracts, pluginStage.staged, pluginDataStage.staged, journal.database); }
  catch (error) {
    fs.rmSync(pluginStage.stagingRoot, { recursive: true, force: true });
    fs.rmSync(pluginDataStage.stagingRoot, { recursive: true, force: true });
    fail(`plugin recovery contract verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.stderr.write('Restoring database...\n');
const restoreArgs = [path.join(__dirname, 'restore-database.js'), '--from', databaseArchive, '--confirm-target', confirmation, '--yes-replace'];
if (process.argv.includes('--use-restore-database-url')) restoreArgs.push('--use-restore-database-url');
const dbRestore = spawnSync(process.execPath, restoreArgs, { env: process.env, encoding: 'utf8', stdio: 'inherit' });
if (dbRestore.error) fail(`restore-database.js could not start: ${dbRestore.error.message}`);
if (dbRestore.status !== 0) {
  fs.rmSync(pluginStage.stagingRoot, { recursive: true, force: true });
  fs.rmSync(pluginDataStage.stagingRoot, { recursive: true, force: true });
  fail('database restore failed; plugin files were not touched');
}

process.stderr.write(`Replacing plugin files at ${pluginTarget}...\n`);
let pluginSwap;
let pluginDataSwap;
try {
  pluginSwap = replaceDirectory(pluginTarget, pluginStage.staged, 'plugin-files');
  pluginDataSwap = replaceDirectory(pluginDataTarget, pluginDataStage.staged, 'plugin-data');
  verifyDirectoryChecksums(pluginTarget, journal.pluginFiles.checksums);
  verifyDirectoryChecksums(pluginDataTarget, journal.pluginData.checksums);
  pluginSwap.commit(); pluginDataSwap.commit();
} catch (error) {
  try { pluginDataSwap?.rollback(); } catch { /* retain original failure */ }
  try { pluginSwap?.rollback(); } catch { /* retain original failure */ }
  fail(`plugin recovery directory swap failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  fs.rmSync(pluginStage.stagingRoot, { recursive: true, force: true });
  fs.rmSync(pluginDataStage.stagingRoot, { recursive: true, force: true });
}

process.stdout.write(`Recovery set restored: database, ${Object.keys(journal.pluginFiles.checksums.files).length} plugin file(s), ${Object.keys(journal.pluginData.checksums.files).length} plugin data file(s)\n`);
