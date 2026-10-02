'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { inspect, TARGET_TABLES } = require('./academic-admissions-adoption-preflight');
const { adopt, dryRun, journalPath } = require('./academic-admissions-adopt');
const { drill } = require('./academic-admissions-rollback-drill');
const { applyMigrations } = require('./academic-management-postgres-certification');

const [REGISTRATION_TABLE, SETTINGS_TABLE, FIELD_TABLE] = TARGET_TABLES;
const registrationSelect = { id: true, classId: true, nameKh: true, nameEn: true, email: true, phone: true, passwordHash: true, generatedPassword: true, photo: true, sex: true, dateOfBirth: true, address: true, generation: true, customFieldValues: true, status: true, rejectReason: true, studentId: true, createdAt: true, resolvedAt: true, resolvedBy: true };
const settingsSelect = { id: true, khmerNameMode: true, phoneMode: true, emailMode: true, photoMode: true, passwordMode: true, sexMode: true, dateOfBirthMode: true, addressMode: true, generationMode: true, updatedAt: true };
const fieldSelect = { id: true, key: true, label: true, fieldType: true, options: true, required: true, order: true, enabled: true, createdAt: true, updatedAt: true };

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'academic-admissions-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=academic-admissions-only is required');
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must differ');
  for (const url of [new URL(sourceUrl), new URL(targetUrl)]) if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  const targetDatabase = decodeURIComponent(new URL(targetUrl).pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-admissions-school';
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
  const readRegistrationSource = ({ after, limit }) => prisma.classRegistration.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: registrationSelect });
  const readFieldSource = ({ after, limit }) => prisma.classRegistrationField.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: fieldSelect });
  const targetState = async (table) => {
    const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
    const exists = found[0]?.exists === true;
    const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`) : [];
    return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 };
  };
  return {
    readRegistrationChunk: readRegistrationSource,
    readSettingsSingleton: () => prisma.classRegistrationSettings.findUnique({ where: { id: 'singleton' }, select: settingsSelect }),
    readFieldChunk: readFieldSource,
    targetState,
    targetCounts: async () => Object.fromEntries(await Promise.all(TARGET_TABLES.map(async (table) => [table, (await targetState(table)).rowCount]))),
    readRegistrationSourceChunk: readRegistrationSource,
    readFieldSourceChunk: readFieldSource,
    writeRegistrationTargetChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(`INSERT INTO "${REGISTRATION_TABLE}" ("id","classId","nameKh","nameEn","email","phone","passwordHash","generatedPassword","photo","sex","dateOfBirth","address","generation","customFieldValues","status","rejectReason","studentId","createdAt","resolvedAt","resolvedBy") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20) ON CONFLICT ("id") DO NOTHING`, row.id, row.classId, row.nameKh, row.nameEn, row.email, row.phone, row.passwordHash, row.generatedPassword, row.photo, row.sex, row.dateOfBirth, row.address, row.generation, row.customFieldValues ? JSON.stringify(row.customFieldValues) : null, row.status, row.rejectReason, row.studentId, row.createdAt, row.resolvedAt, row.resolvedBy);
    },
    writeSettingsTarget: (row) => prisma.$executeRawUnsafe(`INSERT INTO "${SETTINGS_TABLE}" ("id","khmerNameMode","phoneMode","emailMode","photoMode","passwordMode","sexMode","dateOfBirthMode","addressMode","generationMode","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT ("id") DO NOTHING`, row.id, row.khmerNameMode, row.phoneMode, row.emailMode, row.photoMode, row.passwordMode, row.sexMode, row.dateOfBirthMode, row.addressMode, row.generationMode, row.updatedAt),
    writeFieldTargetChunk: async (rows) => {
      for (const row of rows) await prisma.$executeRawUnsafe(`INSERT INTO "${FIELD_TABLE}" ("id","key","label","fieldType","options","required","order","enabled","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) ON CONFLICT ("id") DO NOTHING`, row.id, row.key, row.label, row.fieldType, row.options ? JSON.stringify(row.options) : null, row.required, row.order, row.enabled, row.createdAt, row.updatedAt);
    },
    readRegistrationTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","classId","nameKh","nameEn","email","phone","passwordHash","generatedPassword","photo","sex","dateOfBirth","address","generation","customFieldValues","status","rejectReason","studentId","createdAt","resolvedAt","resolvedBy" FROM "${REGISTRATION_TABLE}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit),
    readSettingsTargetSingleton: () => prisma.$queryRawUnsafe(`SELECT "id","khmerNameMode","phoneMode","emailMode","photoMode","passwordMode","sexMode","dateOfBirthMode","addressMode","generationMode","updatedAt" FROM "${SETTINGS_TABLE}" WHERE "id"='singleton' LIMIT 1`).then((rows) => rows[0] ?? null),
    readFieldTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","key","label","fieldType","options","required","order","enabled","createdAt","updatedAt" FROM "${FIELD_TABLE}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit),
  };
}

async function seedLegacy(prisma, slug) {
  await prisma.installation.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', schoolName: 'Restored Admissions School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' }, update: { schoolName: 'Restored Admissions School', schoolSlug: slug } });
  await prisma.class.upsert({ where: { id: 'rehearsal-admissions-class' }, create: { id: 'rehearsal-admissions-class', name: 'Admissions Grade 7', subject: 'Mathematics', registrationStatus: 'AVAILABLE' }, update: { registrationStatus: 'AVAILABLE' } });
  await prisma.classRegistrationSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', khmerNameMode: 'OPTIONAL', phoneMode: 'REQUIRED', emailMode: 'OPTIONAL', photoMode: 'OPTIONAL', passwordMode: 'REQUIRED', sexMode: 'OPTIONAL', dateOfBirthMode: 'OPTIONAL', addressMode: 'OPTIONAL', generationMode: 'OPTIONAL' }, update: { khmerNameMode: 'OPTIONAL', sexMode: 'OPTIONAL' } });
  await prisma.classRegistrationField.upsert({ where: { key: 'previous-school' }, create: { id: 'rehearsal-admissions-field', key: 'previous-school', label: 'Previous school', fieldType: 'TEXT', required: false, order: 1, enabled: true }, update: { label: 'Previous school', enabled: true } });
  const rows = [
    { id: 'rehearsal-admission-pending', classId: 'rehearsal-admissions-class', nameEn: 'Pending Learner', email: 'pending@example.invalid', passwordHash: '$2b$12$rehearsal', customFieldValues: { 'previous-school': 'Primary One' }, status: 'PENDING' },
    { id: 'rehearsal-admission-rejected', classId: 'rehearsal-admissions-class', nameEn: 'Rejected Learner', phone: '+85510000000', passwordHash: '$2b$12$rehearsal', status: 'REJECTED', rejectReason: 'Duplicate application', resolvedAt: new Date('2026-09-01T00:00:00.000Z'), resolvedBy: 'rehearsal-admin' },
  ];
  for (const row of rows) await prisma.classRegistration.upsert({ where: { id: row.id }, create: row, update: row });
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }
  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'existing-school-admissions-rehearsal' } });
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
    assert.equal(preflight.source.registrationCount, 2, 'representative legacy admissions are absent');
    assert.equal(preflight.source.fieldCount, 1, 'representative admissions custom field is absent');
    assert.equal(preflight.source.settingsPresent, true, 'representative admissions settings are absent');
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 };
    const countsBeforeDry = await migrationAdapter.targetCounts();
    const dry = await dryRun({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation });
    assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.deepEqual(await migrationAdapter.targetCounts(), countsBeforeDry, 'dry-run changed admissions target rows');
    assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter: migrationAdapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 });
    assert.equal(adopted.stage, 'reconciled');
    assert.equal(adopted.sha256, adopted.targetSha256);
    const rolled = await drill({ adapter: migrationAdapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } });
    assert.equal(rolled.rolledBack, true);
    const after = await inspect(migrationAdapter);
    assert.equal(after.source.sha256, preflight.source.sha256, 'legacy admissions changed during adoption or rollback');
    const targetCounts = await migrationAdapter.targetCounts();
    assert.equal(targetCounts[REGISTRATION_TABLE], 2, 'plugin registration rows were lost during rollback');
    assert.equal(targetCounts[SETTINGS_TABLE], 1, 'plugin settings row was lost during rollback');
    assert.equal(targetCounts[FIELD_TABLE], 1, 'plugin custom-field rows were lost during rollback');
    return { format: 'wattanam-existing-school-academic-admissions-rehearsal-v1', passed: true, sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase, schoolSlug: config.slug, backupFile: backupName, registrations: preflight.source.registrationCount, customFields: preflight.source.fieldCount, settingsPresent: preflight.source.settingsPresent, sourceSha256: preflight.source.sha256, targetSha256: adopted.targetSha256, dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true, pluginDataPreserved: true };
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

if (require.main === module) main().catch((error) => { process.stderr.write(`Existing-school Academic admissions rehearsal failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { adapter, certify, configuration, createEmptyTarget, seedLegacy };
