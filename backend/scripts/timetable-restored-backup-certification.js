'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { postgresEnvironment } = require('./db-toolkit');
const { DATASETS, fingerprint, inspect } = require('./timetable-adoption-preflight');
const { adopt, dryRun, journalPath, productionAdapter } = require('./timetable-adopt');
const { drill } = require('./timetable-rollback-drill');
const { migrate } = require('./timetable-postgres-certification');

function configuration(env = process.env) {
  if (env.EXISTING_SCHOOL_REHEARSAL_ALLOW !== 'timetable-only') throw new Error('EXISTING_SCHOOL_REHEARSAL_ALLOW=timetable-only is required');
  const sourceUrl = env.SOURCE_DATABASE_URL?.trim(); const targetUrl = env.REHEARSAL_DATABASE_URL?.trim();
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and REHEARSAL_DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and rehearsal database URLs must be distinct');
  const source = new URL(sourceUrl); const target = new URL(targetUrl);
  for (const url of [source, target]) if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('rehearsal URLs must use PostgreSQL');
  const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(targetDatabase)) throw new Error('rehearsal database name is unsafe');
  const backupDir = path.resolve(env.BACKUP_DIR || '');
  if (!env.BACKUP_DIR || backupDir === path.parse(backupDir).root) throw new Error('a non-root absolute BACKUP_DIR is required');
  const slug = env.REHEARSAL_SCHOOL_SLUG || 'restored-timetable-school';
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
  const environment = postgresEnvironment(targetUrl); const admin = { ...environment, PGDATABASE: 'postgres' };
  const exists = run('psql', ['--no-psqlrc', '--tuples-only', '--no-align', '--command', `SELECT 1 FROM pg_database WHERE datname = '${database}'`], { env: admin });
  if (exists === '1') throw new Error(`rehearsal target database ${database} already exists; refusing to replace it`);
  run('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command', `CREATE DATABASE "${database}"`], { env: admin });
}
async function seedLegacy(prisma, slug) {
  const audit = { createdAt: new Date('2093-01-01T00:00:00.000Z'), updatedAt: new Date('2093-01-01T00:00:00.000Z') };
  await prisma.installation.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', schoolName: 'Restored Timetable School', schoolSlug: slug, locale: 'en', timezone: 'UTC', currency: 'USD', coreVersion: '0.1.0' }, update: { schoolSlug: slug } });
  await prisma.timetable.create({ data: { id: 'timetable-cert-document', name: 'Certification timetable', short: 'CERT', academicYear: '2093-2094', periodsPerDay: 6, numberOfDays: 5, weekend: ['SATURDAY', 'SUNDAY'], periodTimes: JSON.stringify(['07:00','08:00','09:00','10:00','13:00','14:00']), timeOffRules: JSON.stringify({ teacher: [] }), distribution: JSON.stringify({ balanced: true }), homeworkPrep: JSON.stringify({ enabled: false }), maxOnDay: 4, docNotes: 'Restored-school fixture', status: 'PUBLISHED', ...audit } });
  await prisma.timetableSubject.create({ data: { id: 'timetable-cert-subject', timetableId: 'timetable-cert-document', name: 'Mathematics', short: 'MATH', color: '#334155', classroomCount: 1, customFields: { faculty: 'Science' }, ...audit } });
  await prisma.timetableClass.create({ data: { id: 'timetable-cert-class', timetableId: 'timetable-cert-document', name: 'Grade 1A', short: 'G1A', printSubjectPicture: false, customFields: { level: 1 }, ...audit } });
  await prisma.timetableClassroom.create({ data: { id: 'timetable-cert-classroom', timetableId: 'timetable-cert-document', name: 'Room 101', short: 'R101', customFields: { building: 'A' }, ...audit } });
  await prisma.timetableTeacher.create({ data: { id: 'timetable-cert-teacher', timetableId: 'timetable-cert-document', firstName: 'Certification', lastName: 'Teacher', short: 'CT', sex: 'FEMALE', email: 'teacher@example.invalid', classTeacherId: 'timetable-cert-class', qrCode: 'TIMETABLE-CERT-TEACHER', ...audit } });
  await prisma.timetableLesson.create({ data: { id: 'timetable-cert-lesson', timetableId: 'timetable-cert-document', teacherId: 'timetable-cert-teacher', subjectId: 'timetable-cert-subject', classId: 'timetable-cert-class', perWeek: 2, lessonType: 'SINGLE', ...audit } });
  await prisma.timetableEntry.create({ data: { id: 'timetable-cert-entry', timetableId: 'timetable-cert-document', lessonId: 'timetable-cert-lesson', classId: 'timetable-cert-class', teacherId: 'timetable-cert-teacher', subjectId: 'timetable-cert-subject', classroomId: 'timetable-cert-classroom', day: 1, period: 1, ...audit } });
  await prisma.timetableTeacherAttendance.create({ data: { id: 'timetable-cert-attendance', teacherId: 'timetable-cert-teacher', date: new Date('2093-02-01T00:00:00.000Z'), period: 1, status: 'PRESENT', checkIn: new Date('2093-02-01T07:01:00.000Z'), ...audit } });
}
function datasetCounts(report) { return Object.fromEntries(DATASETS.map(({ name }) => [name, report.source.datasets[name].count])); }
async function certify(env = process.env) {
  const config = configuration(env); fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 }); const { PrismaClient } = require('@prisma/client');
  run(process.execPath, ['scripts/deploy-migrations.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const source = new PrismaClient({ datasources: { db: { url: config.sourceUrl } } }); try { await seedLegacy(source, config.slug); } finally { await source.$disconnect(); }
  const existing = new Set(fs.readdirSync(config.backupDir));
  run(process.execPath, ['scripts/backup-database.js'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full', APP_VERSION: 'timetable-existing-school-rehearsal' } });
  const backupName = fs.readdirSync(config.backupDir).find((name) => name.endsWith('.dump') && !existing.has(name)); if (!backupName) throw new Error('rehearsal backup was not created');
  createEmptyTarget(config.targetUrl, config.targetDatabase);
  run(process.execPath, ['scripts/restore-database.js', '--from', path.join(config.backupDir, backupName), '--confirm-target', 'EMPTY', '--yes-replace', '--use-restore-database-url'], { cwd: path.resolve(__dirname, '..'), env: { ...env, DATABASE_URL: config.sourceUrl, RESTORE_DATABASE_URL: config.targetUrl, BACKUP_DIR: config.backupDir, WATTANAM_DISTRIBUTION: 'legacy-full' } });
  const restored = new PrismaClient({ datasources: { db: { url: config.targetUrl } } });
  try {
    await migrate(restored); const adapter = productionAdapter(restored); const preflight = await inspect(adapter);
    assert.equal(preflight.ready, true, preflight.blockers.join('; ')); for (const { name } of DATASETS) assert.ok(preflight.source.datasets[name].count > 0, `${name} fixture is absent`);
    const confirmation = { slug: config.slug, sourceSha256: preflight.source.sha256 }; const beforeDryRun = await fingerprint(adapter.readTargetChunk);
    const dry = await dryRun({ adapter, directory: config.backupDir, backupName, confirmation }); assert.equal(dry.ready, true, dry.blockers.join('; '));
    assert.equal((await fingerprint(adapter.readTargetChunk)).sha256, beforeDryRun.sha256, 'dry-run changed plugin tables'); assert.equal(fs.existsSync(journalPath(config.backupDir, config.slug)), false, 'dry-run created a journal');
    const adopted = await adopt({ adapter, directory: config.backupDir, backupName, confirmation, chunkSize: 1 }); assert.equal(adopted.stage, 'reconciled'); assert.equal(adopted.source.sha256, adopted.target.sha256);
    const rolled = await drill({ adapter, directory: config.backupDir, backupName, slug: config.slug, registry: { routeOwner: 'plugin', pluginEnabled: true } }); assert.equal(rolled.rolledBack, true);
    const after = await inspect(adapter); const target = await fingerprint(adapter.readTargetChunk); assert.equal(after.source.sha256, preflight.source.sha256); assert.equal(target.sha256, preflight.source.sha256);
    return { format: 'wattanam-existing-school-timetable-rehearsal-v1', passed: true, sourceDatabase: new URL(config.sourceUrl).pathname.slice(1), targetDatabase: config.targetDatabase, schoolSlug: config.slug, backupFile: backupName, datasets: datasetCounts(preflight), sourceSha256: preflight.source.sha256, targetSha256: target.sha256, dryRunZeroWrite: true, adopted: true, rolledBack: true, legacyPreserved: true, pluginDataPreserved: true };
  } finally { await restored.$disconnect(); }
}
async function main() { const result = await certify(); const index = process.argv.indexOf('--out'); if (index >= 0) { const output = process.argv[index + 1]; if (!output) throw new Error('--out requires a report path'); const target = path.resolve(output); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }); } process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }
if (require.main === module) main().catch((error) => { process.stderr.write(`Existing-school Timetable rehearsal failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, configuration, createEmptyTarget, datasetCounts, seedLegacy };
