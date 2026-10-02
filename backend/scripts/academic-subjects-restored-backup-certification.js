'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, TARGET_TABLE } = require('./academic-subjects-adoption-preflight');
const { adopt, dryRun, journalPath } = require('./academic-subjects-adopt');
const { rollback } = require('./academic-subjects-rollback-drill');
const { applyMigrations } = require('./academic-management-postgres-certification');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'academic-subjects-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=academic-subjects-only is required');
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must differ');
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  for (const url of [source, target]) if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-subjects-school';
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
  run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', `CREATE DATABASE "${database}"`], { env: admin, stdio: ['ignore', 'pipe', 'pipe'] });
}

function adapter(prisma) {
  return {
    readClassSubjectChunk: ({ after, limit }) => prisma.class.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, subject: true } }),
    targetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 };
    },
    writeSubjects: (subjects) => prisma.$transaction(subjects.map((subject) => prisma.$executeRawUnsafe(
      `INSERT INTO "${TARGET_TABLE}" ("id","code","name","active","createdAt","updatedAt") VALUES ($1,$2,$3,TRUE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`, subject.id, subject.code, subject.name,
    ))),
    readTargetSubjects: () => prisma.$queryRawUnsafe(`SELECT "id","code","name" FROM "${TARGET_TABLE}" ORDER BY "id"`),
    findSubjects: (ids) => ids.length ? prisma.$queryRawUnsafe(`SELECT "id" FROM "${TARGET_TABLE}" WHERE "id" = ANY($1::text[])`, ids) : Promise.resolve([]),
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', schoolName: 'Restored Subjects School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' },
    update: { schoolName: 'Restored Subjects School', schoolSlug: slug },
  });
  const classes = [
    { id: 'rehearsal-subject-class-1', name: 'Mathematics Alpha', subject: 'Mathematics', registrationStatus: 'HIDDEN' },
    { id: 'rehearsal-subject-class-2', name: 'Mathematics Beta', subject: '  mathematics  ', registrationStatus: 'HIDDEN' },
    { id: 'rehearsal-subject-class-3', name: 'Science Alpha', subject: 'Science', registrationStatus: 'HIDDEN' },
  ];
  for (const row of classes) await prisma.class.upsert({ where: { id: row.id }, create: row, update: row });
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }
  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-subjects-rehearsal' } });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !before.has(name));
  if (!backupName) throw new Error('rehearsal backup was not created');
  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await applyMigrations(restored);
    const migrationAdapter = adapter(restored);
    const preflight = await inspect(migrationAdapter);
    assert.equal(preflight.ready, true, preflight.blockers.join('; '));
    assert.equal(preflight.source.classCount, 3, 'representative legacy classes are absent');
    assert.equal(preflight.source.subjectCount, 2, 'case/space subject deduplication failed');
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const beforeDry = (await migrationAdapter.targetState(TARGET_TABLE)).rowCount;
    const dry = await dryRun({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal((await migrationAdapter.targetState(TARGET_TABLE)).rowCount, beforeDry, 'dry-run changed target rows');
    assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(adopted.stage, 'reconciled');
    const registry = { routeOwner: 'plugin', pluginEnabled: true };
    const rolled = await rollback({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation, registry });
    assert.equal(rolled.rolledBack, true);
    assert.equal(rolled.pluginDataPreserved, true);
    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy Class.subject values changed');
    assert.equal((await migrationAdapter.readTargetSubjects()).length, preflight.source.subjectCount, 'plugin subjects were lost during rollback');
    return { format: 'wattanam-existing-school-academic-subjects-rehearsal-v1', passed: true, sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase, schoolSlug: config.slug, backupFile: backupName, legacyClasses: preflight.source.classCount, canonicalSubjects: preflight.source.subjectCount, sourceSha256: preflight.source.sha256, targetSha256: adopted.sourceSha256, dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true, pluginDataPreserved: true };
  } finally { await restored.$disconnect(); }
}

async function main() {
  const result = await certify();
  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0) {
    const output = process.argv[outIndex + 1];
    if (!output) throw new Error('--out requires a report path');
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Existing-school Academic subject rehearsal failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { adapter, certify, configuration, createEmptyTarget, seedLegacy };
