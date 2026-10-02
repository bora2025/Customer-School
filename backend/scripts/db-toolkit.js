'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function postgresEnvironment(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) fail('DATABASE_URL is required');
  let url;
  try { url = new URL(databaseUrl); } catch { fail('DATABASE_URL is not a valid URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('DATABASE_URL must use PostgreSQL');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) fail('DATABASE_URL must include a database name');
  const sslMode = url.searchParams.get('sslmode');
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

function run(command, args, environment, capture = false) {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    fail(`${command} exited with status ${result.status}`);
  }
  return capture ? String(result.stdout || '').trim() : '';
}

function postgresClientExecutable(command, serverVersionNumber, exists = fs.existsSync) {
  if (!['pg_dump', 'pg_restore'].includes(command)) throw new Error(`unsupported PostgreSQL client command: ${command}`);
  const version = Number(String(serverVersionNumber).trim());
  if (!Number.isInteger(version) || version < 100000) throw new Error(`invalid PostgreSQL server_version_num: ${serverVersionNumber}`);
  const major = Math.floor(version / 10000);
  const candidate = `/usr/lib/postgresql/${major}/bin/${command}`;
  return exists(candidate) ? candidate : command;
}

function postgresClient(command, environment) {
  const versionNumber = run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', 'SHOW server_version_num'], environment, true);
  return postgresClientExecutable(command, versionNumber);
}

function backupDirectory() {
  const directory = path.resolve(process.env.BACKUP_DIR || '/data/backups');
  if (directory === path.parse(directory).root) fail('BACKUP_DIR cannot be a filesystem root');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function installationSlug(environment) {
  const sql = 'SELECT "schoolSlug" FROM "Installation" WHERE "id" = \'singleton\' LIMIT 1';
  const result = spawnSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', sql], {
    env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 ? String(result.stdout || '').trim() || null : null;
}

function schemaLineage(environment) {
  const sql = 'SELECT "lineage" FROM "_wattanam_schema_lineage" WHERE "id" = \'singleton\' LIMIT 1';
  const result = spawnSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', sql], {
    env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 ? String(result.stdout || '').trim() || null : null;
}

function expectedSchemaLineage(distribution = process.env.WATTANAM_DISTRIBUTION) {
  const value = String(distribution || 'legacy-full').trim().toLowerCase();
  if (value === 'core') return 'wattanam-core-v1';
  if (value === 'legacy-full') return 'wattanam-legacy-v1';
  throw new Error(`WATTANAM_DISTRIBUTION must be core or legacy-full (got "${value}")`);
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Same relative-path safety rule as backend/src/plugins/plugin-package.ts's safePackagePath.
function safeRelativePath(name) {
  return !!name && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !name.split('/').includes('..');
}

function namedDirectory(envVar, fallback) {
  const directory = path.resolve(process.env[envVar] || fallback);
  if (directory === path.parse(directory).root) fail(`${envVar} cannot be a filesystem root`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function pluginDirectory() {
  return namedDirectory('PLUGIN_DIR', '/data/plugins');
}

function pluginDataDirectory() {
  return namedDirectory('PLUGIN_DATA_DIR', '/data/plugin-data');
}

// Walks `root` and returns a { algorithm: 'sha256', files: { relativePath: hex } }
// manifest -- the same shape backend/src/plugins/plugin-package.ts's ChecksumsFile
// uses for signed plugin packages. Rejects symlinks and unsafe paths the same way
// verifyInstalledDirectory() does, since this walks the same class of directory.
//
// Throws plain Error (not fail()/process.exit) so it stays safely unit-testable --
// callers running as a one-shot script let it propagate as an uncaught exception,
// which still exits non-zero.
function walkDirectoryChecksums(root) {
  const files = {};
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Recovery-set source contains a symlink: ${absolute}`);
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (!safeRelativePath(relative)) throw new Error(`Recovery-set source has an unsafe path: ${relative}`);
      files[relative] = sha256(absolute);
    }
  };
  if (fs.existsSync(root)) visit(root);
  return { algorithm: 'sha256', files };
}

function verifyDirectoryChecksums(root, manifest) {
  if (manifest.algorithm !== 'sha256') throw new Error('Recovery-set manifest uses an unsupported checksum algorithm');
  const actual = walkDirectoryChecksums(root);
  const expectedNames = Object.keys(manifest.files).sort();
  const actualNames = Object.keys(actual.files).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) throw new Error('Recovery-set restored files do not match the manifest file list');
  for (const name of expectedNames) {
    if (manifest.files[name] !== actual.files[name]) throw new Error(`Recovery-set checksum mismatch: ${name}`);
  }
}

function tar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) fail(`tar could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`tar exited with status ${result.status}: ${result.stderr || ''}`);
}

module.exports = {
  backupDirectory, fail, installationSlug, schemaLineage, expectedSchemaLineage, postgresEnvironment, postgresClient, postgresClientExecutable, run, sha256, timestamp,
  pluginDirectory, pluginDataDirectory, walkDirectoryChecksums, verifyDirectoryChecksums, tar, safeRelativePath,
};
