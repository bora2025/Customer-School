'use strict';

// Production-shaped database certification for the Academic Management foundation. This command
// is intentionally destructive only to the plugin's own namespace and therefore requires an exact
// opt-in. Run it only against a disposable database (CI, restored rehearsal, or certification).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.academic-management');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
const plugin = require(path.join(pluginRoot, manifest.backendEntry));
const namespacePrefix = 'plugin_wattanam_academic_management_';
const immutableHeaderless = new Map([
  ['003_create_enrollment_interval', '6a7304a8ea29c064a394144ba0fa4aa9288e62fabe03a9f0a81224401d969861'],
  ['004_create_study_year', '19a750f6164c3f10c13dc9e2f871c54e58db450f983082f028e38d03175554ca'],
  ['005_create_class', '79a804f2e8d9d5005c58c30cede604ced6b473baa2cfff5fa3e8879602d1a11b'],
  ['006_create_class_registration', 'a6eaa58785201a91f2236dbbe777eb7900600e71eb193c9052b99a860f53ce67'],
  ['007_create_class_registration_settings', 'f7fac966cf3f0d9156898a3a297e7a17747d50a77090af8c85634449a2ba734f'],
  ['008_create_class_registration_field', 'b550055dd6951c330f7f8fb0719fb2bfef722c0066486c8a3a2f64946caffa18'],
]);

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.ACADEMIC_CERTIFY_ALLOW_DROP !== 'academic-management-only') {
    throw new Error('ACADEMIC_CERTIFY_ALLOW_DROP=academic-management-only is required');
  }
}

async function pluginTables(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`,
    `${namespacePrefix}%`,
  );
  return rows.map((row) => row.tablename);
}

async function dropPluginTables(prisma) {
  const tables = await pluginTables(prisma);
  for (const table of tables.reverse()) {
    if (!table.startsWith(namespacePrefix)) throw new Error('Refusing to drop a table outside the Academic Management namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}

async function applyMigrations(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(pluginRoot, migration.path), 'utf8');
    if (!sql.includes(`wattanam-plugin-migration: ${migration.id}`)) {
      const pinned = immutableHeaderless.get(migration.id);
      const digest = crypto.createHash('sha256').update(sql).digest('hex');
      if (!pinned || digest !== pinned || migration.checksum !== pinned) throw new Error(`Migration ${migration.id} is missing its identity header`);
    }
    await prisma.$executeRawUnsafe(sql);
  }
}

function runtime(prisma) {
  const routes = new Map();
  const durableEvents = [];
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({
      query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params),
      execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }),
      publish: async (event) => { durableEvents.push(event); },
    })),
  };
  const context = {
    sdkVersion: '1.1.0', pluginId: manifest.id, logger: { log() {}, warn() {}, error() {} },
    dependencies: { required: {}, optional: {}, isAvailable: async () => false },
    events: { publish() {}, subscribe: () => () => {} },
    durableEvents: { subscribe: () => () => {} },
    routes: { register: (definition) => { routes.set(`${definition.method} ${definition.path}`, definition); return () => routes.delete(`${definition.method} ${definition.path}`); } },
    jobs: { register: async () => () => {} },
    settings: { get: async (_key, fallback) => fallback, set: async () => {}, delete: async () => {} },
    storage: { readText: async () => null, writeText: async () => {}, readBinary: async () => null, writeBinary: async () => {}, delete: async () => {}, list: async () => [] },
    permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
    notifications: { sendEmail: async () => ({ skipped: true }), sendSms: async () => ({ skipped: true }), notifyInApp: async () => ({ id: 'certification' }) },
    database,
    readModels: { publish: async () => {}, read: async () => [] },
    directory: {
      resolveAudience: async () => [], lookupUsers: async () => [], lookupClasses: async () => [], lookupSubjects: async () => [],
      classesForUser: async () => [], getClassRoster: async () => ({ students: [] }), getEnrollmentAtDate: async () => ({ enrolled: false }),
    },
    realtime: { notifyUser() {} }, crypto: { hashBcrypt: async () => '$2b$12$certification' },
    accounts: { createStudent: async () => { throw new Error('not exercised'); }, updateStudent: async () => { throw new Error('not exercised'); }, resolveParent: async () => { throw new Error('not exercised'); }, assignGuardian: async () => {} },
  };
  return { context, routes, durableEvents };
}

async function certify(prisma) {
  await dropPluginTables(prisma);
  await applyMigrations(prisma);
  const tables = await pluginTables(prisma);
  assert.equal(tables.length, manifest.migrations.length, 'every immutable Academic migration must create exactly one namespaced table');

  const { context, routes, durableEvents } = runtime(prisma);
  await plugin.activate(context);
  const admin = { userId: 'certification-admin', role: 'ADMIN' };
  const createDepartment = routes.get('POST departments');
  const updateDepartment = routes.get('PUT departments/:id');
  const deleteDepartment = routes.get('DELETE departments/:id');
  const createSubject = routes.get('POST subjects');
  const updateSubject = routes.get('PUT subjects/:id');
  const subjectContract = routes.get('GET contracts/subjects');
  for (const route of [createDepartment, updateDepartment, deleteDepartment, createSubject, updateSubject, subjectContract]) assert.ok(route, 'required Academic route was not registered');

  const department = await createDepartment.handler({ body: { name: 'Certification Science' }, principal: admin });
  const updatedDepartment = await updateDepartment.handler({ params: { id: department.id }, body: { name: 'Certification Sciences' }, principal: admin });
  assert.equal(updatedDepartment.name, 'Certification Sciences');
  await assert.rejects(
    () => createDepartment.handler({ body: { name: 'Certification Sciences' }, principal: admin }),
    /23505|unique|duplicate|already exists/i,
    'PostgreSQL must enforce the department uniqueness constraint',
  );

  const subject = await createSubject.handler({ body: { code: 'CERT', name: 'Certification Subject' }, principal: admin });
  const updatedSubject = await updateSubject.handler({ params: { id: subject.id }, body: { name: 'Certified Subject' }, principal: admin });
  assert.equal(updatedSubject.name, 'Certified Subject');
  const contract = await subjectContract.handler({ query: {}, principal: admin });
  assert.ok(contract.subjects.some((entry) => entry.id === subject.id && entry.code === 'CERT'));

  await deleteDepartment.handler({ params: { id: department.id }, body: { idempotencyKey: `delete-department:${department.id}` }, principal: admin });
  const departmentCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${namespacePrefix}department"`);
  assert.equal(Number(departmentCount[0].count), 0);
  assert.ok(durableEvents.some((event) => event.event === 'wattanam.academic-management.department.created'));
  assert.ok(durableEvents.some((event) => event.event === 'wattanam.academic-management.subject.created'));

  const result = { format: 'wattanam-academic-management-postgres-certification-v1', postgres: true, tables: tables.length, routes: routes.size, durableEvents: durableEvents.length, passed: true };
  await dropPluginTables(prisma);
  return result;
}

async function main() {
  requireGuard();
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); }
  finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Academic PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { applyMigrations, certify, dropPluginTables, pluginTables, requireGuard };
