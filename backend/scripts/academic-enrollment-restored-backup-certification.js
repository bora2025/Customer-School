'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, adopt, TARGET_TABLE } = require('./academic-enrollment-adopt');
const { drill, journalPath } = require('./academic-enrollment-rollback-drill');
const { applyMigrations } = require('./academic-management-postgres-certification');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'academic-enrollment-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=academic-enrollment-only is required');
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
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-enrollment-school';
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
  const sourceSelect = { id: true, classId: true, createdAt: true };
  return {
    readAllSource: () => prisma.student.findMany({ where: { classId: { not: null } }, orderBy: { id: 'asc' }, select: sourceSelect }).then((rows) => rows.map((row) => ({ studentId: row.id, classId: row.classId, createdAt: row.createdAt }))),
    readSourceChunk: ({ after, limit }) => prisma.student.findMany({ where: { classId: { not: null } }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: sourceSelect }).then((rows) => rows.map((row) => ({ studentId: row.id, classId: row.classId, createdAt: row.createdAt }))),
    targetState: async () => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLE}"`) : [];
      return { table: TARGET_TABLE, exists, rowCount: Number(count[0]?.count || 0) };
    },
    writeTargetChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(
        `INSERT INTO "${TARGET_TABLE}" ("id","studentId","classId","validFrom","validTo","source") VALUES ($1,$2,$3,$4::date,$5::date,$6) ON CONFLICT ("id") DO NOTHING`,
        row.id, row.studentId, row.classId, row.validFrom, row.validTo, row.source,
      );
    },
    readAllTarget: () => prisma.$queryRawUnsafe(
      `SELECT "id","studentId","classId",to_char("validFrom",'YYYY-MM-DD') AS "validFrom",CASE WHEN "validTo" IS NULL THEN NULL ELSE to_char("validTo",'YYYY-MM-DD') END AS "validTo","source" FROM "${TARGET_TABLE}" ORDER BY "id"`,
    ),
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', schoolName: 'Restored Enrollment School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' },
    update: { schoolName: 'Restored Enrollment School', schoolSlug: slug },
  });
  const teacher = { id: 'rehearsal-enrollment-teacher', email: 'enrollment-teacher@example.invalid', password: '$2b$12$rehearsal', name: 'Enrollment Teacher', role: 'TEACHER' };
  await prisma.user.upsert({ where: { id: teacher.id }, create: teacher, update: teacher });
  const classRow = { id: 'rehearsal-enrollment-class', name: 'Enrollment Class', subject: 'General', teacherId: teacher.id, registrationStatus: 'HIDDEN' };
  await prisma.class.upsert({ where: { id: classRow.id }, create: classRow, update: classRow });
  const users = [
    { id: 'rehearsal-enrollment-user-1', email: 'enrollment-one@example.invalid', password: '$2b$12$rehearsal', name: 'Enrollment One', role: 'STUDENT' },
    { id: 'rehearsal-enrollment-user-2', email: 'enrollment-two@example.invalid', password: '$2b$12$rehearsal', name: 'Enrollment Two', role: 'STUDENT' },
  ];
  for (const row of users) await prisma.user.upsert({ where: { id: row.id }, create: row, update: row });
  const students = [
    { id: 'rehearsal-enrollment-student-1', userId: users[0].id, classId: classRow.id, studentNumber: 'ENR-001' },
    { id: 'rehearsal-enrollment-student-2', userId: users[1].id, classId: classRow.id, studentNumber: 'ENR-002' },
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
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-enrollment-rehearsal' } });
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
    assert.ok(preflight.source.intervalCount >= 2, 'representative legacy enrollments are absent');
    const approved = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const targetBefore = (await migrationAdapter.targetState()).rowCount;
    const dry = await inspect(migrationAdapter);
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal((await migrationAdapter.targetState()).rowCount, targetBefore, 'dry-run inspection changed target rows');
    assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run inspection created a journal');
    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, approved, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    const targetRows = await migrationAdapter.readAllTarget();
    assert.equal(targetRows.length, preflight.source.intervalCount);
    const rolled = await drill({ adapter: migrationAdapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } });
    assert.equal(rolled.rolledBack, true);
    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy Student.classId changed during adoption or rollback');
    assert.equal((await migrationAdapter.readAllTarget()).length, preflight.source.intervalCount, 'plugin enrollment data was lost during rollback');
    return {
      format: 'wattanam-existing-school-academic-enrollment-rehearsal-v1', passed: true,
      sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase,
      schoolSlug: config.slug, backupFile: backupName, enrollmentIntervals: preflight.source.intervalCount,
      sourceSha256: preflight.source.sha256, targetSha256: adopted.sha256,
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
  process.stderr.write(`Existing-school Academic enrollment rehearsal failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { adapter, certify, configuration, createEmptyTarget, seedLegacy };
