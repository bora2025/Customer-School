'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.human-resources');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_human_resources_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.HR_CERTIFY_ALLOW_DROP !== 'human-resources-only') throw new Error('HR_CERTIFY_ALLOW_DROP=human-resources-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Human Resources namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
async function migrate(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    const digest = crypto.createHash('sha256').update(sql).digest('hex');
    if (digest !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
    if (!sql.includes(`wattanam-plugin-migration: ${migration.id}`)) throw new Error(`Migration ${migration.id} is missing its identity header`);
    await prisma.$executeRawUnsafe(sql);
  }
}
function runtime(prisma) {
  const routes = new Map(); const projections = [];
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
    directory: { lookupUsers: async (ids) => ids.map((id) => ({ id, name: id, role: 'TEACHER' })) },
    readModels: { publish: async (...args) => { projections.push(args); } },
  };
  return { context, routes, projections };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma);
  assert.equal((await tables(prisma)).length, manifest.migrations.length);
  const { context, routes, projections } = runtime(prisma); await plugin.activate(context);
  const route = (method, path) => { const value = routes.get(`${method} ${path}`); assert.ok(value, `${method} ${path} must register`); return value; };

  await route('PUT', 'employees/:id/cv').handler({ params: { id: 'staff-1' }, body: { title: 'Teacher', summary: 'Private', skills: ['English'], education: [{ institution: 'University', startYear: 2010, endYear: 2014 }], workExperience: [], certifications: [] } });
  const cv = await route('GET', 'employees/:id/cv').handler({ params: { id: 'staff-1' } });
  assert.equal(cv.profile.title, 'Teacher'); assert.equal(cv.education.length, 1);

  const salary = await route('POST', 'payroll').handler({ principal: { userId: 'creator-1' }, body: { directoryUserId: 'staff-1', month: 9, year: 2026, currency: 'USD', baseMinor: 10000, allowancesMinor: 1000, deductionsMinor: 500 } });
  const concurrent = await Promise.allSettled(['approver-1', 'approver-2'].map((userId) => route('POST', 'payroll/:id/approve').handler({ params: { id: salary.id }, principal: { userId } })));
  assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1, 'exactly one concurrent payroll approval may succeed');
  const approved = await prisma.$queryRawUnsafe(`SELECT "approvedByDirectoryUserId" FROM "${prefix}salary" WHERE "id"=$1`, salary.id);
  await route('POST', 'payroll/:id/pay').handler({ params: { id: salary.id }, principal: { userId: approved[0].approvedByDirectoryUserId === 'payer-1' ? 'payer-2' : 'payer-1' } });
  const paid = await prisma.$queryRawUnsafe(`SELECT "status","netMinor"::text FROM "${prefix}salary" WHERE "id"=$1`, salary.id);
  assert.deepEqual(paid[0], { status: 'PAID', netMinor: '10500' });

  await route('POST', 'attendance').handler({ principal: { userId: 'marker-1' }, body: { directoryUserId: 'staff-1', date: '2026-09-26', session: 1, status: 'PRESENT' } });
  await route('POST', 'attendance').handler({ principal: { userId: 'marker-2' }, body: { directoryUserId: 'staff-1', date: '2026-09-26', session: 1, status: 'LATE' } });
  const attendance = await prisma.$queryRawUnsafe(`SELECT "status" FROM "${prefix}staff_attendance" WHERE "directoryUserId"='staff-1'`);
  assert.deepEqual(attendance, [{ status: 'LATE' }]);
  assert.ok(projections.some(([model, version, key, value]) => model === 'staff-attendance-summary' && version === 1 && key === 'staff-1' && !JSON.stringify(value).includes('markedByDirectoryUserId')));

  const result = { format: 'wattanam-human-resources-postgres-certification-v1', postgres: true, tables: manifest.migrations.length, routes: routes.size, concurrentApproval: 'serialized', passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Human Resources PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
