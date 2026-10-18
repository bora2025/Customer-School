'use strict';

// Destructive production-shaped certification for the Organizing Management namespace only.
// Run solely against a disposable PostgreSQL database with the exact opt-in guard below.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { resolvePluginSource } = require('./plugin-source-root');

const pluginRoot = resolvePluginSource('wattanam.organizing-management');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
const plugin = require(path.join(pluginRoot, manifest.backendEntry));
const prefix = 'plugin_wattanam_organizing_management_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.ORGANIZING_CERTIFY_ALLOW_DROP !== 'organizing-management-only') {
    throw new Error('ORGANIZING_CERTIFY_ALLOW_DROP=organizing-management-only is required');
  }
}

async function pluginTables(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`,
    `${prefix}%`,
  );
  return rows.map((row) => row.tablename);
}

async function resetNamespace(prisma) {
  const tables = await pluginTables(prisma);
  for (const table of tables.reverse()) {
    if (!table.startsWith(prefix)) throw new Error(`Refusing to drop non-plugin table ${table}`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
  const functions = await prisma.$queryRawUnsafe(
    `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE $1`,
    `${prefix}%`,
  );
  for (const fn of functions) {
    if (!fn.proname.startsWith(prefix)) throw new Error(`Refusing to drop non-plugin function ${fn.proname}`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "public"."${fn.proname}"(${fn.arguments}) CASCADE`);
  }
}

async function applyMigrations(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(pluginRoot, migration.path), 'utf8');
    const digest = crypto.createHash('sha256').update(sql).digest('hex');
    assert.equal(digest, migration.checksum, `checksum mismatch for ${migration.id}`);
    assert.match(sql, new RegExp(`wattanam-plugin-migration:\\s*${migration.id}`), `identity header missing for ${migration.id}`);
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
  return {
    routes,
    context: {
      sdkVersion: '1.3.0', pluginId: manifest.id,
      logger: { log() {}, warn() {}, error() {} },
      dependencies: { required: {}, optional: {}, isAvailable: async () => false },
      events: { publish() {}, subscribe: () => () => {} },
      durableEvents: { subscribe: () => () => {} },
      routes: { register(definition) { routes.set(`${definition.method} ${definition.path}`, definition); return () => routes.delete(`${definition.method} ${definition.path}`); } },
      jobs: { register: async () => () => {} },
      settings: { get: async (_key, fallback) => fallback, set: async () => {}, delete: async () => {} },
      storage: { readText: async () => null, writeText: async () => {}, readBinary: async () => null, writeBinary: async () => {}, delete: async () => {}, list: async () => [] },
      permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
      notifications: { sendEmail: async () => ({ skipped: true }), sendSms: async () => ({ skipped: true }), notifyInApp: async () => ({ id: 'certification' }) },
      database,
      readModels: { publish: async () => {}, read: async () => [] },
      directory: { resolveAudience: async () => [], lookupUsers: async () => [], lookupClasses: async () => [], lookupSubjects: async () => [], classesForUser: async () => [], getClassRoster: async () => ({ students: [] }), getEnrollmentAtDate: async () => ({ enrolled: false }) },
      realtime: { notifyUser() {} }, crypto: { hashBcrypt: async () => '$2b$12$certification' },
    },
  };
}

function request(body = {}, params = {}, query = {}, userId = 'certification-admin') {
  return { body, params, query, principal: { userId } };
}

async function call(routes, method, routePath, input) {
  const route = routes.get(`${method} ${routePath}`);
  assert.ok(route, `missing route ${method} ${routePath}`);
  return route.handler(input || request());
}

async function certify(prisma) {
  await resetNamespace(prisma);
  await applyMigrations(prisma);
  const tables = await pluginTables(prisma);
  for (const required of ['organization_profile', 'position', 'employee', 'calendar_event', 'day_off_request', 'attendance_setting', 'attendance_record', 'scan_attempt', 'compensation_adjustment', 'payroll_record', 'permission_request', 'id_card_template']) {
    assert.ok(tables.includes(`${prefix}${required}`), `required workflow table is missing: ${required}`);
  }
  assert.ok(tables.length >= 18, 'complete Organizing Management schema must be present');

  const { context, routes } = runtime(prisma);
  await plugin.activate(context);
  assert.deepEqual(plugin.health(), { status: 'ready' });
  assert.ok(routes.size >= 35, 'complete workforce route surface must register');

  const organization = await call(routes, 'PUT', 'organization', request({ name: 'Certification Company', organizationType: 'COMPANY', timezone: 'Asia/Phnom_Penh' }));
  assert.equal(organization.name, 'Certification Company');
  const position = await call(routes, 'POST', 'positions', request({ code: 'OPS', title: 'Operations Manager', department: 'Operations' }));
  const employee = await call(routes, 'POST', 'employees', request({ employeeNumber: 'CERT-001', fullName: 'Certification Employee', email: 'employee@example.test', positionId: position.id, position: 'Operations Manager', department: 'Operations', employmentType: 'EMPLOYEE', employmentStatus: 'ACTIVE', startDate: '2026-01-01' }));
  assert.equal(employee.employeeNumber, 'CERT-001');
  await call(routes, 'PUT', 'attendance-settings', request({ workDays: [1, 2, 3, 4, 5, 6, 7], checkInTime: '00:00', lateAfterTime: '23:59', checkOutTime: '23:59', minimumCheckoutMinutes: 1, maximumOfflineMinutes: 15 }));

  const qrRows = await prisma.$queryRawUnsafe(`SELECT "qrIdentifier" FROM ${prefix}employee WHERE "id"=$1`, employee.id);
  assert.equal(qrRows.length, 1);
  const firstScan = await call(routes, 'POST', 'attendance/scan', request({ code: qrRows[0].qrIdentifier, mode: 'USB', idempotencyKey: 'cert-check-in', clientTimestamp: new Date().toISOString() }));
  assert.equal(firstScan.action, 'CHECK_IN');
  const replay = await call(routes, 'POST', 'attendance/scan', request({ code: qrRows[0].qrIdentifier, mode: 'USB', idempotencyKey: 'cert-check-in', clientTimestamp: new Date().toISOString() }));
  assert.equal(replay.idempotentReplay, true);
  await prisma.$executeRawUnsafe(`UPDATE ${prefix}attendance_record SET "checkInAt"=CURRENT_TIMESTAMP-INTERVAL '2 minutes' WHERE "id"=$1`, firstScan.recordId);
  const secondScan = await call(routes, 'POST', 'attendance/scan', request({ code: qrRows[0].qrIdentifier, mode: 'CAMERA', idempotencyKey: 'cert-check-out', clientTimestamp: new Date().toISOString() }));
  assert.equal(secondScan.action, 'CHECK_OUT');

  const attendance = await call(routes, 'GET', 'attendance/records', request({}, {}, {}));
  assert.equal(attendance.length, 1);
  assert.ok(attendance[0].checkOutAt);
  const attendanceDate = new Date(attendance[0].attendanceDate).toISOString().slice(0, 10);
  await call(routes, 'PUT', 'salary/:employeeId', request({ baseSalaryMinor: 100000, salaryCurrency: 'USD', salaryBasis: 'MONTHLY' }, { employeeId: employee.id }));
  await call(routes, 'POST', 'compensation', request({ employeeId: employee.id, adjustmentType: 'GOOD_JOB_REWARD', amountMinor: 5000, currency: 'USD', effectiveDate: attendanceDate, reason: 'Certification reward' }));
  const payroll = await call(routes, 'POST', 'payroll/calculate', request({ employeeId: employee.id, periodStart: attendanceDate, periodEnd: attendanceDate }));
  assert.equal(Number(payroll.netPayMinor), 105000);
  const dashboard = await call(routes, 'GET', 'dashboard', request());
  assert.equal(Number(dashboard.workforce.active), 1);
  assert.equal(Number(dashboard.attendance.attended), 1);

  return { passed: true, pluginId: manifest.id, version: manifest.version, migrations: manifest.migrations.length, tables: tables.length, routes: routes.size, workflows: ['organization', 'position', 'employee', 'settings', 'usb-scan', 'idempotent-replay', 'camera-checkout', 'attendance-report', 'salary', 'reward', 'payroll', 'dashboard'] };
}

async function main() {
  requireGuard();
  const prisma = new PrismaClient();
  try {
    const result = await certify(prisma);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await resetNamespace(prisma);
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { applyMigrations, certify, pluginTables, requireGuard, resetNamespace, runtime };
