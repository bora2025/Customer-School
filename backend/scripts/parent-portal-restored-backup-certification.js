'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { fingerprint, inspect } = require('./parent-portal-adoption-preflight');
const { adopt, dryRun, journalPath, productionAdapter } = require('./parent-portal-adopt');
const { drill } = require('./parent-portal-rollback-drill');
const { migrate } = require('./parent-portal-postgres-certification');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'parent-portal-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=parent-portal-only is required');
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must be distinct');
  for (const url of [new URL(sourceUrl), new URL(targetUrl)]) if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  const targetDatabase = decodeURIComponent(new URL(targetUrl).pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-parent-school';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('REHEARSAL_SCHOOL_SLUG is invalid');
  return { sourceUrl, targetUrl, targetDatabase, backupDir, slug };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-2000)}`);
  return String(result.stdout || '').trim();
}

function createEmptyTarget(targetUrl, database) {
  const environment = postgresEnvironment(targetUrl);
  const admin = { ...environment, PGDATABASE: 'postgres' };
  const exists = run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', `SELECT 1 FROM pg_database WHERE datname = '${database}'`], { env: admin });
  if (exists === '1') throw new Error(`rehearsal target database ${database} already exists; refusing to replace it`);
  run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', `CREATE DATABASE "${database}"`], { env: admin });
}

async function seedLegacy(prisma, slug) {
  const createdAt = new Date('2089-01-01T00:00:00.000Z');
  await prisma.installation.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', schoolName: 'Restored Parent School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' }, update: { schoolSlug: slug } });
  await prisma.user.create({ data: { id: 'parent-cert-admin', email: 'parent-admin@example.invalid', password: 'not-a-login-secret', name: 'Certification Admin', role: 'ADMIN', createdAt, updatedAt: createdAt } });
  await prisma.user.create({ data: { id: 'parent-cert-student-user', email: 'parent-student@example.invalid', password: 'not-a-login-secret', name: 'Certification Student', role: 'STUDENT', createdAt, updatedAt: createdAt } });
  await prisma.class.create({ data: { id: 'parent-cert-class', name: 'Certification Class', createdAt, updatedAt: createdAt } });
  await prisma.student.create({ data: { id: 'parent-cert-student', userId: 'parent-cert-student-user', classId: 'parent-cert-class', studentNumber: 'PAR-001', createdAt, updatedAt: createdAt } });
  await prisma.parentLinkRequest.create({ data: { id: 'parent-cert-request', studentId: 'parent-cert-student', parentEmail: 'guardian@example.invalid', parentName: 'Certification Guardian', parentPhone: '+855000000000', note: 'Synthetic fixture', status: 'APPROVED', resolvedBy: 'parent-cert-admin', createdAt, resolvedAt: new Date('2089-01-02T00:00:00.000Z') } });
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }
  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'parent-portal-existing-school-rehearsal' } });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !before.has(name));
  if (!backupName) throw new Error('rehearsal backup was not created');
  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await migrate(restored);
    const adapter = productionAdapter(restored);
    const preflight = await inspect(adapter);
    assert.equal(preflight.ready, true, preflight.blockers.join('; '));
    assert.equal(preflight.source.datasets.linkRequests.count, 1);
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const empty = await fingerprint(adapter.readTargetChunk);
    const dry = await dryRun({ adapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal((await fingerprint(adapter.readTargetChunk)).sha256, empty.sha256, 'dry-run changed plugin tables');
    assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    assert.equal(adopted.source.sha256, adopted.target.sha256);
    const rolled = await drill({ adapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } });
    assert.equal(rolled.rolledBack, true);
    const after = await inspect(adapter);
    const target = await fingerprint(adapter.readTargetChunk);
    assert.equal(after.source.sha256, preflight.source.sha256);
    assert.equal(target.sha256, preflight.source.sha256);
    return { format: 'wattanam-existing-school-parent-portal-rehearsal-v1', passed: true, sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase, schoolSlug: config.slug, backupFile: backupName, datasets: { linkRequests: 1 }, sourceSha256: preflight.source.sha256, targetSha256: target.sha256, dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true, pluginDataPreserved: true };
  } finally { await restored.$disconnect(); }
}

async function main() {
  const result = await certify();
  const index = process.argv.indexOf('--out');
  if (index >= 0) {
    const output = process.argv[index + 1];
    if (!output) throw new Error('--out requires a report path');
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Existing-school Parent Portal rehearsal failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, configuration, createEmptyTarget, seedLegacy };
