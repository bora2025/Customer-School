'use strict';

// One restored-school gate for every Academic cutover dataset. Individual rehearsals prove each
// rollback path; this gate proves their journals and exact fingerprints coexist on one backup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const foundationCert = require('./academic-management-restored-backup-certification');
const profileCert = require('./academic-student-profiles-restored-backup-certification');
const enrollmentCert = require('./academic-enrollment-restored-backup-certification');
const classesCert = require('./academic-classes-restored-backup-certification');
const subjectsCert = require('./academic-subjects-restored-backup-certification');
const admissionsCert = require('./academic-admissions-restored-backup-certification');
const studyYearsCert = require('./academic-study-years-restored-backup-certification');
const { applyMigrations } = require('./academic-management-postgres-certification');
const { migrate: migrateAttendance } = require('./attendance-manager-postgres-certification');
const foundationPreflight = require('./academic-management-adoption-preflight');
const foundationAdopt = require('./academic-management-adopt');
const profilePreflight = require('./academic-student-profiles-adoption-preflight');
const profileAdopt = require('./academic-student-profiles-adopt');
const enrollmentPreflight = require('./academic-enrollment-adopt');
const classesPreflight = require('./academic-classes-adoption-preflight');
const classesAdopt = require('./academic-classes-adopt');
const subjectsPreflight = require('./academic-subjects-adoption-preflight');
const subjectsAdopt = require('./academic-subjects-adopt');
const admissionsPreflight = require('./academic-admissions-adoption-preflight');
const admissionsAdopt = require('./academic-admissions-adopt');
const studyYearsPreflight = require('./academic-study-years-adoption-preflight');
const studyYearsAdopt = require('./academic-study-years-adopt');
const { check } = require('./academic-management-cutover-readiness');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'academic-aggregate-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=academic-aggregate-only is required');
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim();
  const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl || sourceUrl === targetUrl) throw new Error('distinct SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  for (const url of [new URL(sourceUrl), new URL(targetUrl)]) if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  const targetDatabase = decodeURIComponent(new URL(targetUrl).pathname.slice(1));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-academic-aggregate-school';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('REHEARSAL_SCHOOL_SLUG is invalid');
  return { sourceUrl, targetUrl, targetDatabase, backupDir, slug };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-3000)}`);
}

function createEmptyTarget(targetUrl, database) {
  const admin = { ...postgresEnvironment(targetUrl), PGDATABASE: 'postgres' };
  const found = spawnSync('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', `SELECT 1 FROM pg_database WHERE datname = '${database}'`], { env: admin, encoding: 'utf8', windowsHide: true });
  if (found.error || found.status !== 0) throw found.error || new Error(found.stderr);
  if (found.stdout.trim() === '1') throw new Error(`rehearsal target database ${database} already exists; refusing to replace it`);
  run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', `CREATE DATABASE "${database}"`], { env: admin });
}

async function adoptBoundary({ inspect, adopt, adapter, backupDir, backupName, slug, approvalName = 'confirmation' }) {
  const report = await inspect(adapter);
  assert.equal(report.ready, true, report.blockers.join('; '));
  const approval = { slug, sourceSha256: report.source.sha256 };
  const result = await adopt({ adapter, directory: backupDir, backupName, [approvalName]: approval, chunkSize: 1 });
  assert.equal(result.stage, 'reconciled');
  return report.source;
}

function cutoverAdapter(prisma, adapters) {
  const [foundation, profile, enrollment, classes, subjects, admissions, studyYears] = adapters;
  const exists = async (table) => {
    const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
    const present = rows[0]?.exists === true;
    const counts = present ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
    return { table, exists: present, rowCount: present ? Number(counts[0]?.count || 0) : 0 };
  };
  return {
    readDepartmentChunk: foundation.readDepartmentChunk,
    readMembershipChunk: foundation.readMembershipChunk,
    readTargetDepartmentChunk: foundation.readTargetDepartmentChunk,
    readTargetMembershipChunk: foundation.readTargetMembershipChunk,
    targetState: foundation.targetState,
    readStudyYearChunk: studyYears.readStudyYearChunk,
    readTargetStudyYearChunk: studyYears.readTargetChunk,
    studyYearTargetState: exists,
    readClassChunk: classes.readClassChunk,
    readTargetClassChunk: classes.readTargetChunk,
    classTargetState: exists,
    readRegistrationChunk: admissions.readRegistrationChunk,
    readSettingsSingleton: admissions.readSettingsSingleton,
    readFieldChunk: admissions.readFieldChunk,
    readTargetRegistrationChunk: admissions.readRegistrationTargetChunk,
    readTargetSettingsSingleton: admissions.readSettingsTargetSingleton,
    readTargetFieldChunk: admissions.readFieldTargetChunk,
    admissionsTargetState: exists,
    readStudentChunk: profile.readStudentChunk,
    readTargetStudentProfileChunk: profile.readTargetChunk,
    studentProfileTargetState: exists,
    readEnrollmentSource: enrollment.readAllSource,
    readTargetEnrollment: enrollment.readAllTarget,
    enrollmentTargetState: enrollment.targetState,
    readClassSubjectChunk: subjects.readClassSubjectChunk,
    readTargetSubjectChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id", "name" AS "subject" FROM "${subjectsPreflight.TARGET_TABLE}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit),
    subjectTargetState: exists,
    pluginState: () => prisma.pluginInstallation.findUnique({ where: { id: 'wattanam.academic-management' }, select: { status: true, version: true } }),
    studyYearPluginState: () => prisma.pluginInstallation.findUnique({ where: { id: 'wattanam.attendance-manager' }, select: { status: true, version: true } }),
  };
}

async function certify(env = process.env) {
  const config = configuration(env);
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } });
  try {
    for (const seed of [foundationCert.seedLegacy, profileCert.seedLegacy, enrollmentCert.seedLegacy, classesCert.seedLegacy, subjectsCert.seedLegacy, admissionsCert.seedLegacy]) await seed(source, config.slug);
    // The Classes fixture already owns the representative 2096 row. Add a distinct current year
    // rather than replaying the standalone Study Year fixture with a conflicting unique `year`.
    await source.studyYear.upsert({
      where: { id: 'rehearsal-aggregate-year-2095' },
      create: { id: 'rehearsal-aggregate-year-2095', year: 2095, label: '2095-2096', startDate: new Date('2095-01-01T00:00:00.000Z'), endDate: new Date('2095-12-31T00:00:00.000Z'), isCurrent: true, schoolName: 'Restored Academic Aggregate School' },
      update: { isCurrent: true },
    });
  } finally { await source.$disconnect(); }
  const before = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'academic-aggregate-rehearsal' } });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !before.has(name));
  if (!backupName) throw new Error('aggregate rehearsal backup was not created');
  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await applyMigrations(restored);
    await migrateAttendance(restored);
    const adapters = [foundationCert.adapter(restored), profileCert.adapter(restored), enrollmentCert.adapter(restored), classesCert.adapter(restored), subjectsCert.adapter(restored), admissionsCert.adapter(restored), studyYearsCert.adapter(restored)];
    const sources = {};
    sources.foundation = await adoptBoundary({ inspect: foundationPreflight.inspect, adopt: foundationAdopt.adopt, adapter: adapters[0], backupDir: config.backupDir, backupName, slug: config.slug });
    sources.studentProfiles = await adoptBoundary({ inspect: profilePreflight.inspect, adopt: profileAdopt.adopt, adapter: adapters[1], backupDir: config.backupDir, backupName, slug: config.slug });
    sources.enrollment = await adoptBoundary({ inspect: enrollmentPreflight.inspect, adopt: enrollmentPreflight.adopt, adapter: adapters[2], backupDir: config.backupDir, backupName, slug: config.slug, approvalName: 'approved' });
    sources.classes = await adoptBoundary({ inspect: classesPreflight.inspect, adopt: classesAdopt.adopt, adapter: adapters[3], backupDir: config.backupDir, backupName, slug: config.slug });
    sources.subjects = await adoptBoundary({ inspect: subjectsPreflight.inspect, adopt: subjectsAdopt.adopt, adapter: adapters[4], backupDir: config.backupDir, backupName, slug: config.slug });
    sources.admissions = await adoptBoundary({ inspect: admissionsPreflight.inspect, adopt: admissionsAdopt.adopt, adapter: adapters[5], backupDir: config.backupDir, backupName, slug: config.slug });
    sources.studyYears = await adoptBoundary({ inspect: studyYearsPreflight.inspect, adopt: studyYearsAdopt.adopt, adapter: adapters[6], backupDir: config.backupDir, backupName, slug: config.slug });
    for (const plugin of [
      { id: 'wattanam.academic-management', name: 'Academic Management', version: '0.1.12' },
      { id: 'wattanam.attendance-manager', name: 'Attendance Manager', version: '0.1.8' },
    ]) await restored.pluginInstallation.upsert({ where: { id: plugin.id }, create: { ...plugin, publisher: 'wattanam', status: 'active', manifestJson: '{}', packageSha256: '0'.repeat(64), installedPath: `/certification/${plugin.id}`, activatedAt: new Date() }, update: { status: 'active', version: plugin.version, activatedAt: new Date(), lastError: null } });
    const report = await check({ adapter: cutoverAdapter(restored, adapters), directory: config.backupDir, backupName, slug: config.slug });
    assert.equal(report.ready, true, report.blockers.join('; '));
    return { format: 'wattanam-existing-school-academic-aggregate-rehearsal-v1', passed: true, sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase, schoolSlug: config.slug, backupFile: backupName, ready: report.ready, blockers: report.blockers, source: report.source, target: report.target, journals: report.journals, plugins: { academicManagement: report.plugin, attendanceManager: report.studyYearPlugin } };
  } finally { await restored.$disconnect(); }
}

async function main() {
  const result = await certify();
  const index = process.argv.indexOf('--out');
  if (index >= 0) {
    const output = process.argv[index + 1];
    if (!output) throw new Error('--out requires a report path');
    const target = path.resolve(output); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Existing-school Academic aggregate rehearsal failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, configuration, createEmptyTarget, cutoverAdapter };
