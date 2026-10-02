'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, TARGET_TABLE } = require('./academic-student-profiles-adoption-preflight');
const { adopt, dryRun, journalPath } = require('./academic-student-profiles-adopt');
const { drill } = require('./academic-student-profiles-rollback-drill');
const { applyMigrations } = require('./academic-management-postgres-certification');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'academic-student-profiles-only') {
    throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=academic-student-profiles-only is required');
  }
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
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-student-profile-school';
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

const studentSelect = { id: true, userId: true, studentNumber: true, parentId: true, qrCode: true, photo: true, sex: true, dateOfBirth: true, address: true, generation: true, nameKh: true, customFieldValues: true, createdAt: true, updatedAt: true };

function adapter(prisma) {
  const sourceChunk = ({ after, limit }) => prisma.student.findMany({
    ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: studentSelect,
  });
  return {
    readStudentChunk: sourceChunk,
    readSourceChunk: sourceChunk,
    targetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(count[0]?.count || 0) : 0 };
    },
    targetCount: async () => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLE}"`))[0]?.count || 0),
    writeTargetChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(
        `INSERT INTO "${TARGET_TABLE}" ("id","userId","studentNumber","guardianUserId","qrCode","photo","sex","dateOfBirth","address","generation","nameKh","customFieldValues","source","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'legacy-adoption',$13,$14) ON CONFLICT ("id") DO NOTHING`,
        row.id, row.userId, row.studentNumber, row.parentId, row.qrCode, row.photo, row.sex, row.dateOfBirth, row.address, row.generation, row.nameKh, JSON.stringify(row.customFieldValues || {}), row.createdAt, row.updatedAt,
      );
    },
    readTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "id","userId","studentNumber","guardianUserId" AS "parentId","qrCode","photo","sex","dateOfBirth","address","generation","nameKh","customFieldValues","createdAt","updatedAt" FROM "${TARGET_TABLE}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit,
    ),
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', schoolName: 'Restored Student Profile School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' },
    update: { schoolName: 'Restored Student Profile School', schoolSlug: slug },
  });
  const accounts = [
    { id: 'rehearsal-student-user-1', email: 'student-one@example.invalid', password: '$2b$12$rehearsal', name: 'Student One', role: 'STUDENT' },
    { id: 'rehearsal-student-user-2', email: 'student-two@example.invalid', password: '$2b$12$rehearsal', name: 'Student Two', role: 'STUDENT' },
    { id: 'rehearsal-parent-user', email: 'parent@example.invalid', password: '$2b$12$rehearsal', name: 'Parent', role: 'PARENT' },
  ];
  for (const row of accounts) await prisma.user.upsert({ where: { id: row.id }, create: row, update: row });
  const students = [
    { id: 'rehearsal-student-profile-1', userId: accounts[0].id, studentNumber: 'REST-001', parentId: accounts[2].id, qrCode: 'REST-QR-001', sex: 'FEMALE', dateOfBirth: new Date('2012-04-05T00:00:00.000Z'), address: 'Rehearsal address one', generation: '12', nameKh: 'សិស្ស មួយ', customFieldValues: { language: 'km' } },
    { id: 'rehearsal-student-profile-2', userId: accounts[1].id, studentNumber: 'REST-002', qrCode: 'REST-QR-002', sex: 'MALE', dateOfBirth: new Date('2011-08-09T00:00:00.000Z'), address: 'Rehearsal address two', generation: '11', nameKh: 'សិស្ស ពីរ', customFieldValues: { language: 'en' } },
  ];
  for (const row of students) await prisma.student.upsert({ where: { id: row.id }, create: row, update: row });
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }
  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-student-profile-rehearsal' } });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !before.has(name));
  if (!backupName) throw new Error('rehearsal backup was not created');
  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], {
    cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' },
  });
  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await applyMigrations(restored);
    const migrationAdapter = adapter(restored);
    const preflight = await inspect(migrationAdapter);
    assert.equal(preflight.ready, true, preflight.blockers.join('; '));
    assert.ok(preflight.source.studentProfileCount >= 2, 'representative legacy student profiles are absent');
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const targetBefore = await migrationAdapter.targetCount();
    const dry = await dryRun({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal(await migrationAdapter.targetCount(), targetBefore, 'dry-run changed target rows');
    assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    assert.equal(adopted.sha256, adopted.targetSha256);
    const rolled = await drill({ adapter: migrationAdapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } });
    assert.equal(rolled.rolledBack, true);
    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy source changed during adoption or rollback');
    assert.equal(await migrationAdapter.targetCount(), preflight.source.studentProfileCount, 'plugin data was lost during rollback');
    return {
      format: 'wattanam-existing-school-academic-student-profiles-rehearsal-v1', passed: true,
      sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase,
      schoolSlug: config.slug, backupFile: backupName, studentProfiles: preflight.source.studentProfileCount,
      sourceSha256: preflight.source.sha256, targetSha256: adopted.targetSha256,
      dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true, pluginDataPreserved: true,
    };
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

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Existing-school Academic student-profile rehearsal failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { adapter, certify, configuration, createEmptyTarget, seedLegacy };
