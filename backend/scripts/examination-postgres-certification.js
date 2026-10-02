'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.examination');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_examination_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.EXAMINATION_CERTIFY_ALLOW_DROP !== 'examination-only') throw new Error('EXAMINATION_CERTIFY_ALLOW_DROP=examination-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Examination namespace');
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
  const routes = new Map(); const projections = []; const notifications = [];
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
      lookupSubjects: async (ids) => ids.map((id) => ({ id, name: 'Mathematics', code: 'MATH' })),
      classesForUser: async () => ['class-1'], getClassRoster: async () => roster,
    },
    notifications: { notifyInApp: async (userId, message, type) => { notifications.push({ userId, message, type }); } },
    readModels: { publish: async (...args) => { projections.push(args); } },
  };
  return { context, routes, projections, notifications };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma);
  const expectedTables = ['exam', 'question', 'attempt', 'score_sheet', 'score_sheet_class', 'score_subject', 'score_tab', 'score_entry'].map((name) => `${prefix}${name}`);
  const installedTables = await tables(prisma); for (const table of expectedTables) assert.ok(installedTables.includes(table), `${table} must exist`);
  const { context, routes, projections } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const value = routes.get(`${method} ${routePath}`); assert.ok(value, `${method} ${routePath} must register`); return value; };
  const teacher = { userId: 'teacher-1', role: 'TEACHER' }; const student = { userId: 'student-user-1', role: 'STUDENT' };

  const exam = await route('POST', 'exams').handler({ principal: teacher, body: {
    title: 'Certification exam', academicClassId: 'class-1', totalMarks: 2, passMark: 1, maxAttempts: 2,
    questions: [{ text: '2 + 2?', type: 'MCQ', marks: 2, data: { choices: [{ id: 'a', text: 'Four', isCorrect: true }, { id: 'b', text: 'Five', isCorrect: false }] } }],
  } });
  await route('PATCH', 'exams/:id/status').handler({ principal: teacher, params: { id: exam.id }, body: { status: 'PUBLISHED' } });
  await route('PATCH', 'exams/:id/status').handler({ principal: teacher, params: { id: exam.id }, body: { status: 'ACTIVE' } });
  const take = await route('GET', 'exams/:id/take').handler({ principal: student, params: { id: exam.id } });
  assert.equal(JSON.stringify(take).includes('isCorrect'), false, 'student payload must not expose answer keys');
  const questionId = take.questions[0].id;

  const starts = await Promise.all([
    route('POST', 'exams/:id/attempts/start').handler({ principal: student, params: { id: exam.id } }),
    route('POST', 'exams/:id/attempts/start').handler({ principal: student, params: { id: exam.id } }),
  ]);
  assert.equal(starts[0].id, starts[1].id, 'concurrent starts must return one stable attempt');
  const submissions = await Promise.allSettled([1, 2].map(() => route('POST', 'attempts/:id/submit').handler({ principal: student, params: { id: starts[0].id }, body: { answers: { [questionId]: 'a' } } })));
  assert.equal(submissions.filter((entry) => entry.status === 'fulfilled').length, 1, 'exactly one concurrent submission may transition the attempt');
  const storedAttempt = await prisma.$queryRawUnsafe(`SELECT "status","score","grade","attemptNumber" FROM "${prefix}attempt" WHERE "id"=$1`, starts[0].id);
  assert.deepEqual(storedAttempt, [{ status: 'GRADED', score: 2, grade: 'PASS', attemptNumber: 1 }]);

  const gradebook = await route('POST', 'gradebooks').handler({ principal: teacher, body: { name: 'Certification gradebook', classIds: ['class-1'] } });
  const subject = await route('POST', 'gradebooks/:id/subjects').handler({ principal: teacher, params: { id: gradebook.id }, body: { name: 'Mathematics', academicSubjectId: 'subject-1', maxScore: 100 } });
  const tab = await route('POST', 'gradebooks/:id/tabs').handler({ principal: teacher, params: { id: gradebook.id }, body: { label: 'Semester 1', type: 'SEMESTER' } });
  const bulk = await route('POST', 'gradebooks/:id/scores/bulk').handler({ principal: teacher, params: { id: gradebook.id }, body: { entries: [{ academicStudentId: 'student-1', scoreTabId: tab.id, subjectId: subject.id, score: 91 }] } });
  assert.equal(bulk.updated, 1);
  const report = await route('GET', 'gradebooks/:id/report').handler({ principal: teacher, params: { id: gradebook.id } });
  assert.equal(report.reportRows.length, 1); assert.equal(report.reportRows[0].score, 91);
  const gradeProjection = projections.filter(([name]) => name === 'student-grade-summary').at(-1)?.[3];
  assert.ok(gradeProjection); assert.equal(/answer|question|manualMarks|feedback/i.test(JSON.stringify(gradeProjection)), false);

  const result = { format: 'wattanam-examination-postgres-certification-v1', postgres: true, migrations: manifest.migrations.length, tables: installedTables.length, routes: routes.size, concurrentStart: 'idempotent', concurrentSubmit: 'serialized', answerKeyRedacted: true, gradebookRows: report.reportRows.length, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Examination PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
