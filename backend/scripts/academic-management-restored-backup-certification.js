'use strict';

// Existing-school restored-backup rehearsal for the Academic Management foundation boundary.
// It copies representative legacy departments and memberships into the plugin namespace, proves
// exact reconciliation, then rolls routing metadata back without deleting either dataset.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, TARGET_TABLES } = require('./academic-management-adoption-preflight');
const { adopt, dryRun, journalPaths } = require('./academic-management-adopt');
const { applyMigrations } = require('./academic-management-postgres-certification');
const { loadJournal, rollbackRouting } = require('./plugin-adoption-toolkit');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'academic-management-foundation-only') {
    throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=academic-management-foundation-only is required');
  }
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must differ');
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  for (const url of [source, target]) {
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  }
  const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-academic-school';
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
    readDepartmentChunk: ({ after, limit }) => prisma.department.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit,
      select: { id: true, name: true, nameKh: true, description: true },
    }),
    readMembershipChunk: ({ after, limit }) => prisma.user.findMany({
      where: { departmentId: { not: null } }, ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      orderBy: { id: 'asc' }, take: limit, select: { id: true, departmentId: true },
    }).then((rows) => rows.map((row) => ({ userId: row.id, departmentId: row.departmentId }))),
    targetState: async (tables) => Promise.all(tables.map(async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(count[0]?.count || 0) : 0 };
    })),
    targetCounts: async () => ({
      departments: Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLES[0]}"`))[0]?.count || 0),
      memberships: Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLES[1]}"`))[0]?.count || 0),
    }),
    writeDepartmentChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(
        `INSERT INTO "${TARGET_TABLES[0]}" ("id","name","nameKh","description") VALUES ($1,$2,$3,$4) ON CONFLICT ("id") DO NOTHING`,
        row.id, row.name, row.nameKh, row.description,
      );
    },
    writeMembershipChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(
        `INSERT INTO "${TARGET_TABLES[1]}" ("userId","departmentId") VALUES ($1,$2) ON CONFLICT ("userId") DO NOTHING`,
        row.userId, row.departmentId,
      );
    },
    readTargetDepartmentChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "id","name","nameKh","description" FROM "${TARGET_TABLES[0]}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit,
    ),
    readTargetMembershipChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "userId","departmentId" FROM "${TARGET_TABLES[1]}" WHERE "userId" > $1 ORDER BY "userId" LIMIT $2`, after || '', limit,
    ),
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', schoolName: 'Restored Academic School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' },
    update: { schoolName: 'Restored Academic School', schoolSlug: slug },
  });
  const departments = [
    { id: 'rehearsal-department-languages', name: 'Languages', nameKh: null, description: 'Languages department' },
    { id: 'rehearsal-department-science', name: 'Science', nameKh: 'វិទ្យាសាស្ត្រ', description: 'Science department' },
  ];
  for (const row of departments) await prisma.department.upsert({ where: { id: row.id }, create: row, update: row });
  const users = [
    { id: 'rehearsal-academic-admin', email: 'academic-admin@example.invalid', password: '$2b$12$rehearsal', name: 'Academic Admin', role: 'ADMIN', departmentId: departments[0].id },
    { id: 'rehearsal-academic-teacher', email: 'academic-teacher@example.invalid', password: '$2b$12$rehearsal', name: 'Academic Teacher', role: 'TEACHER', departmentId: departments[1].id },
  ];
  for (const row of users) await prisma.user.upsert({ where: { id: row.id }, create: row, update: row });
}

async function rollbackFoundation({ directory, slug, sourceSha256, backupSha256, registry }) {
  const files = journalPaths(directory, slug);
  const identity = `academic:${slug}:${sourceSha256}:${backupSha256}`;
  for (const [phase, file] of [['departments', files.departments], ['memberships', files.memberships]]) {
    const phaseIdentity = `${identity}:${phase}`;
    const journal = loadJournal(file, phaseIdentity);
    assert.equal(journal.stage, 'reconciled', `${phase} journal is not reconciled`);
    rollbackRouting({ journalFile: file, registry, identity: phaseIdentity, legacyOwner: 'legacy' });
  }
  return { routeOwner: registry.routeOwner, pluginEnabled: registry.pluginEnabled };
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }

  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-academic-rehearsal' } });
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
    assert.ok(preflight.source.departmentCount >= 2 && preflight.source.membershipCount >= 2, 'representative legacy data is absent');
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const countsBeforeDryRun = await migrationAdapter.targetCounts();
    const dry = await dryRun({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.deepEqual(await migrationAdapter.targetCounts(), countsBeforeDryRun, 'dry-run changed target rows');
    const files = journalPaths(config.backupDir, config.slug);
    assert.equal(fs.existsSync(files.departments) || fs.existsSync(files.memberships), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    assert.equal(adopted.sha256, adopted.targetSha256);
    const registry = { routeOwner: 'plugin', pluginEnabled: true };
    const routing = await rollbackFoundation({ directory: config.backupDir, slug: config.slug, sourceSha256: adopted.sha256, backupSha256: adopted.backupSha256, registry });
    assert.deepEqual(routing, { routeOwner: 'legacy', pluginEnabled: false });
    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy source changed during adoption or rollback');
    const targetCounts = await migrationAdapter.targetCounts();
    assert.deepEqual(targetCounts, { departments: preflight.source.departmentCount, memberships: preflight.source.membershipCount });
    return {
      format: 'wattanam-existing-school-academic-foundation-rehearsal-v1', passed: true,
      sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase,
      schoolSlug: config.slug, backupFile: backupName, departments: preflight.source.departmentCount,
      memberships: preflight.source.membershipCount, sourceSha256: preflight.source.sha256,
      targetSha256: adopted.targetSha256, dryRunZeroWrite: true, adopted: true, rolledBack: true,
      legacyPreserved: true, pluginDataPreserved: true,
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
  process.stderr.write(`Existing-school Academic foundation rehearsal failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { adapter, certify, configuration, createEmptyTarget, rollbackFoundation, seedLegacy };
