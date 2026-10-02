'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.timetable');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_timetable_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.TIMETABLE_CERTIFY_ALLOW_DROP !== 'timetable-only') throw new Error('TIMETABLE_CERTIFY_ALLOW_DROP=timetable-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Timetable namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
async function migrate(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    const digest = crypto.createHash('sha256').update(sql).digest('hex');
    if (digest !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
    if (!sql.trim().startsWith(`-- wattanam-plugin-migration: ${migration.id}`)) throw new Error(`Migration ${migration.id} is missing its identity header`);
    await prisma.$executeRawUnsafe(sql);
  }
}
function runtime(prisma) {
  const routes = new Map();
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({
      query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params),
      execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }),
      publish: async () => {},
    })),
  };
  const context = {
    permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    database,
    directory: {
      lookupClasses: async (ids) => ids.map((id) => ({ id, name: `Academic ${id}` })),
      lookupUsers: async (ids) => ids.map((id) => ({ id, name: `Teacher ${id}`, role: 'TEACHER' })),
    },
    settings: { get: async (_key, fallback) => fallback },
  };
  return { context, routes };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma);
  const expectedTables = ['document', 'subject', 'class', 'classroom', 'teacher', 'lesson', 'entry', 'teacher_attendance'].map((name) => `${prefix}${name}`);
  const installedTables = await tables(prisma); for (const table of expectedTables) assert.ok(installedTables.includes(table), `${table} must exist`);
  assert.deepEqual(manifest.dependencies, { 'wattanam.academic-management': '>=0.1.0 <1.0.0' });

  const { context, routes } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const value = routes.get(`${method} ${routePath}`); assert.ok(value, `${method} ${routePath} must register`); return value; };
  const timetable = await route('POST', 'timetables').handler({ body: { name: 'Certification timetable', academicYear: '2026-2027', numberOfDays: 2, periodsPerDay: 2, weekend: ['SATURDAY', 'SUNDAY'], periodTimes: ['07:00', '08:00'] } });
  const subject = await route('POST', 'subjects').handler({ body: { timetableId: timetable.id, name: 'Mathematics', short: 'MATH' } });
  const schoolClass = await route('POST', 'classes').handler({ body: { timetableId: timetable.id, name: 'Grade 1A', short: 'G1A', academicClassId: 'academic-class-1' } });
  const classroom = await route('POST', 'classrooms').handler({ body: { timetableId: timetable.id, name: 'Room 1', short: 'R1' } });
  const teacher = await route('POST', 'teachers').handler({ body: { timetableId: timetable.id, firstName: 'One', lastName: 'Teacher', short: 'T1', directoryUserId: 'teacher-user-1' } });
  const lesson = await route('POST', 'lessons').handler({ body: { timetableId: timetable.id, teacherId: teacher.id, subjectId: subject.id, classId: schoolClass.id, perWeek: 2, lessonType: 'SINGLE' } });

  const preview = await route('GET', 'timetables/:id/generation-preview').handler({ params: { id: timetable.id } });
  assert.equal(preview.complete, true); assert.equal(preview.entries.length, 2);
  assert.equal((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${prefix}entry"`))[0].count, 0, 'preview must not mutate storage');

  const competingEntry = { timetableId: timetable.id, lessonId: lesson.id, classId: schoolClass.id, teacherId: teacher.id, subjectId: subject.id, classroomId: classroom.id, day: 1, period: 1 };
  const collisions = await Promise.allSettled([1, 2].map(() => route('POST', 'entries').handler({ body: competingEntry })));
  assert.equal(collisions.filter((entry) => entry.status === 'fulfilled').length, 1, 'database must reject a concurrent schedule collision');
  const savedEntry = collisions.find((entry) => entry.status === 'fulfilled').value;
  await route('DELETE', 'entries/:id').handler({ params: { id: savedEntry.id } });

  const generated = await route('POST', 'timetables/:id/generate').handler({ params: { id: timetable.id } });
  assert.equal(generated.saved, true); assert.equal(generated.generated, 2);
  const storedEntries = await prisma.$queryRawUnsafe(`SELECT "day","period" FROM "${prefix}entry" WHERE "timetableId"=$1 ORDER BY "day","period"`, timetable.id);
  assert.equal(storedEntries.length, 2);

  const today = new Date().toISOString().slice(0, 10);
  await Promise.all([
    route('POST', 'teacher-attendance/mark').handler({ body: { teacherId: teacher.id, date: today, period: 1, status: 'PRESENT' } }),
    route('POST', 'teacher-attendance/mark').handler({ body: { teacherId: teacher.id, date: today, period: 1, status: 'LATE' } }),
  ]);
  const attendanceRows = await prisma.$queryRawUnsafe(`SELECT "status" FROM "${prefix}teacher_attendance" WHERE "teacherId"=$1 AND "date"=$2::date AND "period"=1`, teacher.id, today);
  assert.equal(attendanceRows.length, 1, 'teacher attendance upsert must remain unique');
  const report = await route('GET', 'timetables/:id/teacher-attendance/monthly').handler({ params: { id: timetable.id }, query: { startDate: today, endDate: today } });
  assert.equal(report.length, 1); assert.equal(report[0].total, 1);

  const result = { format: 'wattanam-timetable-postgres-certification-v1', postgres: true, migrations: manifest.migrations.length, tables: installedTables.length, routes: routes.size, previewNonMutating: true, collisionSerialized: true, generatedEntries: storedEntries.length, teacherAttendanceRows: attendanceRows.length, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Timetable PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
