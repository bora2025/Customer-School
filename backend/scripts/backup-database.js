'use strict';

const fs = require('fs');
const path = require('path');
const { backupDirectory, fail, installationSlug, schemaLineage, postgresEnvironment, postgresClient, run, sha256, timestamp } = require('./db-toolkit');

if (process.argv.includes('--help')) {
  process.stdout.write('Usage: node scripts/backup-database.js\nRequires DATABASE_URL; optional BACKUP_DIR and BACKUP_RETENTION_DAYS.\n');
  process.exit(0);
}

const environment = postgresEnvironment();
const directory = backupDirectory();
const base = `wattanam-${timestamp()}`;
const temporary = path.join(directory, `${base}.dump.partial`);
const archive = path.join(directory, `${base}.dump`);
const manifestPath = path.join(directory, `${base}.manifest.json`);

// `db-toolkit.run` exits immediately when a child command fails. Keep partial
// dumps from accumulating even on that early-exit path.
process.on('exit', () => {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
});

try {
  const pgDump = postgresClient('pg_dump', environment);
  run(pgDump, ['--format=custom', '--compress=6', '--no-owner', '--no-acl', '--file', temporary], environment);
  fs.renameSync(temporary, archive);
  const manifest = {
    format: 'pg_dump-custom-v1',
    createdAt: new Date().toISOString(),
    file: path.basename(archive),
    sizeBytes: fs.statSync(archive).size,
    sha256: sha256(archive),
    installationSlug: installationSlug(environment),
    schemaLineage: schemaLineage(environment),
    appVersion: process.env.APP_VERSION || null,
    postgresVersion: run(pgDump, ['--version'], environment, true),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || '0');
  if (Number.isFinite(retentionDays) && retentionDays > 0) {
    const cutoff = Date.now() - retentionDays * 86400000;
    for (const name of fs.readdirSync(directory)) {
      if (!/^wattanam-\d{8}T\d{6}Z\.(dump|manifest\.json)$/.test(name)) continue;
      const target = path.join(directory, name);
      if (fs.statSync(target).mtimeMs < cutoff) fs.unlinkSync(target);
    }
  }
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} catch (error) {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  fail(error instanceof Error ? error.message : String(error));
}
