'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, TARGET_TABLE } = require('./academic-study-years-adoption-preflight');
const { adopt, dryRun, journalPath } = require('./academic-study-years-adopt');
const { drill } = require('./academic-study-years-rollback-drill');
const { migrate } = require('./attendance-manager-postgres-certification');

const select = { id: true, year: true, label: true, startDate: true, endDate: true, isCurrent: true, schoolName: true, logoUrl: true, createdAt: true, updatedAt: true };

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'attendance-study-years-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=attendance-study-years-only is required');
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must differ');
  for (const url of [new URL(sourceUrl), new URL(targetUrl)]) if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  const targetDatabase = decodeURIComponent(new URL(targetUrl).pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-study-years-school';
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
  const admin = { ...postgresEnvironment(targetUrl), PGDATABASE: 'postgres' };
  const exists = run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', `SELECT 1 FROM pg_database WHERE datname = '${database}'`], { env: admin });
  if (exists === '1') throw new Error(`rehearsal target database ${database} already exists; refusing to replace it`);
  run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', `CREATE DATABASE "${database}"`], { env: admin, stdio: ['ignore', 'pipe', 'pipe'] });
}

function adapter(prisma) {
  const sourceChunk = ({ after, limit }) => prisma.studyYear.findMany({ ...(after !== null ? { where: { year: { gt: after } } } : {}), orderBy: { year: 'asc' }, take: limit, select });
  return {
    readStudyYearChunk: sourceChunk,
    readSourceChunk: sourceChunk,
    targetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 };
    },
    targetCount: async () => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLE}"`))[0]?.count || 0),
    writeTargetChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(`INSERT INTO "${TARGET_TABLE}" ("id","year","label","startDate","endDate","isCurrent","schoolName","logoUrl","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT ("id") DO NOTHING`, row.id, row.year, row.label, row.startDate, row.endDate, row.isCurrent, row.schoolName, row.logoUrl, row.createdAt, row.updatedAt);
    },
    readTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","year","label","startDate","endDate","isCurrent","schoolName","logoUrl","createdAt","updatedAt" FROM "${TARGET_TABLE}" WHERE "year" > $1 ORDER BY "year" LIMIT $2`, after ?? Number.MIN_SAFE_INTEGER, limit),
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', schoolName: 'Restored Study Years School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' }, update: { schoolName: 'Restored Study Years School', schoolSlug: slug } });
  const rows = [
    { id: 'rehearsal-year-2095', year: 2095, label: '2095-2096', startDate: new Date('2095-01-01T00:00:00.000Z'), endDate: new Date('2095-12-31T00:00:00.000Z'), isCurrent: false, schoolName: 'Restored Study Years School', logoUrl: 'https://example.invalid/logo.png' },
    { id: 'rehearsal-year-2096', year: 2096, label: '2096-2097', startDate: new Date('2096-01-01T00:00:00.000Z'), endDate: new Date('2096-12-31T00:00:00.000Z'), isCurrent: true, schoolName: 'Restored Study Years School', logoUrl: null },
  ];
  for (const row of rows) await prisma.studyYear.upsert({ where: { id: row.id }, create: row, update: row });
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }
  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-study-years-rehearsal' } });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !before.has(name));
  if (!backupName) throw new Error('rehearsal backup was not created');
  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await migrate(restored);
    const migrationAdapter = adapter(restored);
    const preflight = await inspect(migrationAdapter);
    assert.equal(preflight.ready, true, preflight.blockers.join('; '));
    assert.equal(preflight.source.studyYearCount, 2, 'representative legacy study years are absent');
    assert.equal(preflight.source.currentCount, 1, 'representative current Study Year is absent');
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const beforeDry = await migrationAdapter.targetCount();
    const dry = await dryRun({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal(await migrationAdapter.targetCount(), beforeDry, 'dry-run changed target rows');
    assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    assert.equal(adopted.sha256, adopted.targetSha256);
    const rolled = await drill({ adapter: migrationAdapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } });
    assert.equal(rolled.rolledBack, true);
    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy StudyYear rows changed during adoption or rollback');
    assert.equal(await migrationAdapter.targetCount(), 2, 'plugin Study Year rows were lost during rollback');
    return { format: 'wattanam-existing-school-attendance-study-years-rehearsal-v1', passed: true, sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase, schoolSlug: config.slug, backupFile: backupName, studyYears: preflight.source.studyYearCount, currentYears: preflight.source.currentCount, sourceSha256: preflight.source.sha256, targetSha256: adopted.targetSha256, dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true, pluginDataPreserved: true };
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

if (require.main === module) main().catch((error) => { process.stderr.write(`Existing-school Attendance Study Year rehearsal failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { adapter, certify, configuration, createEmptyTarget, seedLegacy };
