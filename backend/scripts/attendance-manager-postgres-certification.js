'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.attendance-manager');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_attendance_manager_';
const splitMigrationIds = new Set([
  '001_create_attendance_manager',
  '003_enforce_student_boundary',
  '004_add_corrections_scans_alerts_snapshots',
  '005_add_alert_delivery_ledger',
  '006_add_legacy_adoption_fields',
]);

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.ATTENDANCE_CERTIFY_ALLOW_DROP !== 'attendance-manager-only') throw new Error('ATTENDANCE_CERTIFY_ALLOW_DROP=attendance-manager-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Attendance Manager namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
async function migrate(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    const digest = crypto.createHash('sha256').update(sql).digest('hex');
    if (digest !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
    const identified = sql.trim().startsWith(`-- wattanam-plugin-migration: ${migration.id}`);
    if (!identified && !(migration.id === '001_create_attendance_manager' && digest === 'd02277c13ddbf7b0237f7059fb389f3fef36184edbfb907ff536515ef0b69233')) {
      throw new Error(`Migration ${migration.id} is missing its identity header`);
    }
    if (splitMigrationIds.has(migration.id)) {
      for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(`${statement};`);
    } else {
      await prisma.$executeRawUnsafe(sql);
    }
  }
}
function runtime(prisma) {
  const routes = new Map(); const projections = []; const jobs = new Map(); const notifications = []; const realtime = [];
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({
      query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params),
      execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }),
      publish: async () => {},
    })),
  };
  const roster = {
    contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
    classId: 'class-1', className: 'Grade 1A', asOfIsoDate: new Date().toISOString().slice(0, 10), source: 'plugin-enrollment-interval',
    students: [{ studentId: 'student-1', userId: 'student-user', studentNumber: 'S001', name: 'Student One', parentId: 'parent-user' }],
  };
  const context = {
    logger: { log: () => {} }, permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    events: { publish: () => {} }, database,
    directory: { classesForUser: async () => ['class-1'], getClassRoster: async (classId, asOfIsoDate) => ({ ...roster, classId, asOfIsoDate }) },
    readModels: { publish: async (...args) => { projections.push(args); }, read: async () => null },
    settings: { get: async (_key, fallback) => fallback },
    jobs: { register: async (job) => { jobs.set(job.id, job); return () => {}; } },
    notifications: { notifyInApp: async (userId, message, type) => { notifications.push({ userId, message, type }); } },
    realtime: { notifyUser: (userId, event, payload) => { realtime.push({ userId, event, payload }); } },
  };
  return { context, routes, projections, jobs, notifications, realtime };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma);
  const expectedTables = ['study_year', 'session', 'holiday', 'identifier', 'record', 'correction', 'scan', 'alert_rule', 'alert', 'alert_delivery', 'format_rule'].map((name) => `${prefix}${name}`);
  const installedTables = await tables(prisma);
  for (const table of expectedTables) assert.ok(installedTables.includes(table), `${table} must exist`);

  const { context, routes, projections, jobs, notifications, realtime } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const value = routes.get(`${method} ${routePath}`); assert.ok(value, `${method} ${routePath} must register`); return value; };
  const principal = { userId: 'admin-1', role: 'ADMIN' };
  const first = await route('POST', 'study-years').handler({ principal, body: { year: 2026, label: '2026-2027' } });
  const second = await route('POST', 'study-years').handler({ principal, body: { year: 2027, label: '2027-2028' } });
  await Promise.allSettled([first.id, second.id].map((id) => route('POST', 'study-years/:id/set-current').handler({ principal, params: { id }, body: {} })));
  const currentYears = await prisma.$queryRawUnsafe(`SELECT "id" FROM "${prefix}study_year" WHERE "isCurrent"=TRUE`);
  assert.equal(currentYears.length, 1, 'exactly one Study Year must remain current');

  const today = new Date().toISOString().slice(0, 10);
  const record = await route('POST', 'records').handler({ principal, body: { personId: 'student-1', personType: 'STUDENT', classId: 'class-1', date: today, session: 1, status: 'ABSENT' } });
  await assert.rejects(route('POST', 'records').handler({ principal, body: { personId: 'staff-1', personType: 'STAFF', classId: 'class-1', date: today, session: 1 } }), /personType is invalid/);
  const corrected = await route('PATCH', 'records/:id/correct').handler({ principal, params: { id: record.id }, body: { status: 'PERMISSION', permissionType: 'SICK', reason: 'Medical certificate received' } });
  assert.equal(corrected.status, 'PERMISSION');
  const corrections = await prisma.$queryRawUnsafe(`SELECT "previousValue","newValue" FROM "${prefix}correction" WHERE "recordId"=$1`, record.id);
  assert.equal(corrections.length, 1); assert.equal(corrections[0].previousValue.status, 'ABSENT');

  const summary = await route('GET', 'reports/summary').handler({ principal, query: { classId: 'class-1', date: today } });
  assert.deepEqual(summary, [{ personType: 'STUDENT', status: 'PERMISSION', count: 1 }]);
  const csv = await route('GET', 'reports/export.csv').handler({ principal, query: { classId: 'class-1', date: today } });
  assert.match(csv.content, /Student One/); assert.match(csv.content, /S001/);
  const studentProjection = projections.filter(([name]) => name === 'student-attendance-summary').at(-1)?.[3];
  assert.ok(studentProjection); assert.equal(JSON.stringify(studentProjection).includes('markedById'), false);

  await route('POST', 'records').handler({ principal, body: { personId: 'student-1', classId: 'class-1', date: today, session: 2, status: 'ABSENT' } });
  await route('POST', 'alert-rules').handler({ principal, body: { code: 'absence-one', threshold: 1, windowDays: 1, channels: ['IN_APP', 'REALTIME'] } });
  const alertJob = jobs.get('attendance-alerts'); assert.ok(alertJob, 'attendance alert job must register'); await alertJob.handler();
  const deliveries = await prisma.$queryRawUnsafe(`SELECT "userId","channel","status" FROM "${prefix}alert_delivery" ORDER BY "userId","channel"`);
  assert.equal(deliveries.length, 4); assert.ok(deliveries.every((delivery) => delivery.status === 'SENT'));
  assert.equal(notifications.length, 2); assert.equal(realtime.length, 2);

  const result = { format: 'wattanam-attendance-manager-postgres-certification-v1', postgres: true, migrations: manifest.migrations.length, tables: installedTables.length, routes: routes.size, studyYearInvariant: 'single-current', correctionAudit: true, alertDeliveries: deliveries.length, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Attendance Manager PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
