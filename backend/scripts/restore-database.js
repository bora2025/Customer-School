'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { expectedSchemaLineage, fail, installationSlug, schemaLineage, postgresEnvironment, postgresClient, run, sha256 } = require('./db-toolkit');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node scripts/restore-database.js --from <archive.dump> --confirm-target <school-slug|EMPTY> --yes-replace [--use-restore-database-url]\n');
  process.exit(0);
}

const sourceArg = argument('--from');
const confirmation = argument('--confirm-target');
if (!sourceArg || !confirmation || !process.argv.includes('--yes-replace')) fail('restore requires --from, --confirm-target, and --yes-replace');
const useValidationTarget = process.argv.includes('--use-restore-database-url');
if (useValidationTarget && !process.env.RESTORE_DATABASE_URL) fail('RESTORE_DATABASE_URL is required with --use-restore-database-url');

const archive = path.resolve(sourceArg);
if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) fail('backup archive does not exist');
const manifestPath = archive.replace(/\.dump$/, '.manifest.json');
if (manifestPath === archive || !fs.existsSync(manifestPath)) fail('matching backup manifest is required');

let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { fail('backup manifest is invalid JSON'); }
if (manifest.format !== 'pg_dump-custom-v1') fail('unsupported backup format');
if (manifest.file !== path.basename(archive)) fail('manifest does not match archive filename');
if (manifest.sha256 !== sha256(archive)) fail('backup checksum verification failed');
const expectedLineage = expectedSchemaLineage();
if (expectedLineage === 'wattanam-core-v1' && manifest.schemaLineage !== expectedLineage) {
  fail(`core restore requires a ${expectedLineage} backup manifest`);
}
if (manifest.schemaLineage && manifest.schemaLineage !== expectedLineage) {
  fail(`backup lineage ${manifest.schemaLineage} is incompatible with ${process.env.WATTANAM_DISTRIBUTION || 'legacy-full'}`);
}

const baseEnvironment = postgresEnvironment(useValidationTarget ? process.env.RESTORE_DATABASE_URL : process.env.DATABASE_URL);
const environment = {
  ...baseEnvironment,
  PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '15',
  PGOPTIONS: `${baseEnvironment.PGOPTIONS || ''} -c lock_timeout=30s -c statement_timeout=30min`.trim(),
};
process.stderr.write('Validating backup archive and target identity...\n');
const pgRestore = postgresClient('pg_restore', environment);
run(pgRestore, ['--list', archive], environment, true);
const targetSlug = installationSlug(environment) || 'EMPTY';
if (confirmation !== targetSlug) fail(`target confirmation mismatch; expected ${targetSlug}`);

if (targetSlug !== 'EMPTY') {
  const preBackup = spawnSync(process.execPath, [path.join(__dirname, 'backup-database.js')], {
    env: { ...process.env, DATABASE_URL: useValidationTarget ? process.env.RESTORE_DATABASE_URL : process.env.DATABASE_URL },
    stdio: 'inherit',
  });
  if (preBackup.status !== 0) fail('pre-restore backup failed; restore cancelled');
}

process.stderr.write(`Restoring into confirmed target ${targetSlug}...\n`);
run(pgRestore, ['--clean', '--if-exists', '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error', '--dbname', environment.PGDATABASE, archive], environment);
process.stderr.write('Verifying restored installation identity...\n');
const restoredSlug = installationSlug(environment);
if (manifest.installationSlug && restoredSlug !== manifest.installationSlug) fail('restore completed but installation identity verification failed');
const restoredLineage = schemaLineage(environment);
if (manifest.schemaLineage && restoredLineage !== manifest.schemaLineage) fail('restore completed but schema lineage verification failed');
process.stdout.write(`Restore verified for ${restoredSlug || 'legacy installation'} from ${path.basename(archive)}\n`);
