'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.learning');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_learning_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.LEARNING_CERTIFY_ALLOW_DROP !== 'learning-only') throw new Error('LEARNING_CERTIFY_ALLOW_DROP=learning-only is required');
  if (env.LEARNING_CERTIFY_DESTRUCTIVE_APPROVAL !== '014_allow_assignment_attempts') throw new Error('LEARNING_CERTIFY_DESTRUCTIVE_APPROVAL=014_allow_assignment_attempts is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Learning namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
async function migrate(prisma, approval = '014_allow_assignment_attempts') {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    const digest = crypto.createHash('sha256').update(sql).digest('hex');
    if (digest !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
    if (!sql.trim().startsWith(`-- wattanam-plugin-migration: ${migration.id}`)) throw new Error(`Migration ${migration.id} is missing its identity header`);
    if (migration.destructive && approval !== migration.id) throw new Error(`Destructive migration ${migration.id} requires explicit approval`);
    await prisma.$executeRawUnsafe(sql);
  }
}
function runtime(prisma) {
  const routes = new Map(); const notifications = [];
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({
      query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params),
      execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }),
      publish: async () => {},
    })),
  };
  const roster = { classId: 'class-1', className: 'Grade 1A', students: [{ studentId: 'student-1', userId: 'student-user-1', name: 'Student One' }] };
  const context = {
    permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } }, database,
    directory: {
      lookupUsers: async (ids) => ids.map((id) => ({ id, name: id, role: 'TEACHER' })),
      lookupClasses: async (ids) => ids.map((id) => ({ id, name: id })),
      classesForUser: async () => ['class-1'], getClassRoster: async () => roster,
    },
    notifications: { notifyInApp: async (userId, message, type) => { notifications.push({ userId, message, type }); } },
  };
  return { context, routes, notifications };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma);
  const expectedTables = ['assignment','assignment_submission','quiz_question','quiz_answer','course','lesson','lesson_page','course_enrollment','lesson_attempt','page_response','course_session','course_attendance','lesson_view'].map((name) => `${prefix}${name}`);
  const installedTables = await tables(prisma); for (const table of expectedTables) assert.ok(installedTables.includes(table), `${table} must exist`);
  const constraints = await prisma.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conrelid='${prefix}assignment_submission'::regclass AND contype='u' ORDER BY conname`);
  assert.ok(constraints.some((row) => row.conname === 'plugin_wattanam_learning_submission_attempt_key'), 'approved multi-attempt identity must exist');

  const { context, routes } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const value = routes.get(`${method} ${routePath}`); assert.ok(value, `${method} ${routePath} must register`); return value; };
  const teacher = { userId: 'teacher-1', role: 'TEACHER' }; const student = { userId: 'student-user-1', role: 'STUDENT' };
  const course = await route('POST', 'courses').handler({ principal: teacher, body: { title: 'Certification course', academicClassId: 'class-1' } });
  const lesson = await route('POST', 'courses/:id/lessons').handler({ principal: teacher, params: { id: course.id }, body: { title: 'Introduction', status: 'DRAFT', gradingMode: 'GRADED', totalPoints: 2, passingScore: 1, maxAttempts: 2 } });
  const page = await route('POST', 'lessons/:id/pages').handler({ principal: teacher, params: { id: lesson.id }, body: { title: 'Question', pageType: 'QUESTION', order: 0, content: { questionType: 'MCQ_SINGLE', prompt: '2 + 2?', points: 2, choices: [{ id: 'a', text: 'Four' }, { id: 'b', text: 'Five' }], correctChoiceId: 'a' } } });
  await route('PUT', 'lessons/:id').handler({ principal: teacher, params: { id: lesson.id }, body: { title: 'Introduction', status: 'PUBLISHED', gradingMode: 'GRADED', totalPoints: 2, passingScore: 1, maxAttempts: 2 } });
  for (const status of ['PUBLISHED', 'ENROLLMENT']) await route('PATCH', 'courses/:id/status').handler({ principal: teacher, params: { id: course.id }, body: { status } });
  await route('POST', 'courses/:id/enrollments').handler({ principal: teacher, params: { id: course.id }, body: { academicStudentId: 'student-1' } });
  await route('PATCH', 'courses/:id/status').handler({ principal: teacher, params: { id: course.id }, body: { status: 'ACTIVE' } });

  const play = await route('GET', 'lessons/:id/play').handler({ principal: student, params: { id: lesson.id } });
  assert.equal(JSON.stringify(play).includes('correctChoiceId'), false, 'student lesson payload must not expose answer keys');
  const starts = await Promise.all([
    route('POST', 'lessons/:id/attempts/start').handler({ principal: student, params: { id: lesson.id } }),
    route('POST', 'lessons/:id/attempts/start').handler({ principal: student, params: { id: lesson.id } }),
  ]);
  assert.equal(starts[0].id, starts[1].id, 'concurrent lesson starts must return one stable attempt');
  const response = await route('POST', 'attempts/:id/responses').handler({ principal: student, params: { id: starts[0].id }, body: { pageId: page.id, answer: { choiceId: 'a' } } });
  assert.equal(response.correct, true); assert.equal(response.pointsAwarded, 2);
  const finishes = await Promise.allSettled([1, 2].map(() => route('POST', 'attempts/:id/finish').handler({ principal: student, params: { id: starts[0].id } })));
  assert.equal(finishes.filter((entry) => entry.status === 'fulfilled').length, 1, 'exactly one concurrent finish may transition the attempt');
  const storedAttempt = await prisma.$queryRawUnsafe(`SELECT "status","score","passed" FROM "${prefix}lesson_attempt" WHERE "id"=$1`, starts[0].id);
  assert.deepEqual(storedAttempt, [{ status: 'COMPLETED', score: 2, passed: true }]);

  const session = await route('POST', 'courses/:id/sessions').handler({ principal: teacher, params: { id: course.id }, body: { lessonId: lesson.id, title: 'Class session', scheduledAt: new Date(Date.now() + 3600000).toISOString(), durationMinutes: 45, location: 'Room 1' } });
  await route('PUT', 'sessions/:id/attendance').handler({ principal: teacher, params: { id: session.id }, body: { academicStudentId: 'student-1', status: 'LATE', source: 'MANUAL' } });
  await route('PUT', 'sessions/:id/attendance').handler({ principal: teacher, params: { id: session.id }, body: { academicStudentId: 'student-1', status: 'PRESENT', source: 'MANUAL' } });
  const attendance = await prisma.$queryRawUnsafe(`SELECT "status" FROM "${prefix}course_attendance" WHERE "sessionId"=$1 AND "academicStudentId"='student-1'`, session.id);
  assert.deepEqual(attendance, [{ status: 'PRESENT' }]);

  const result = { format: 'wattanam-learning-postgres-certification-v1', postgres: true, migrations: manifest.migrations.length, destructiveMigrationApproved: true, tables: installedTables.length, routes: routes.size, concurrentStart: 'idempotent', concurrentFinish: 'serialized', answerKeyRedacted: true, courseAttendance: 'upserted', passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma, process.env.LEARNING_CERTIFY_DESTRUCTIVE_APPROVAL), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Learning PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
