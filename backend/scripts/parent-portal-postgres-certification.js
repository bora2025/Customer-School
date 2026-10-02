'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.parent-portal');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_parent_portal_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.PARENT_PORTAL_CERTIFY_ALLOW_DROP !== 'parent-portal-only') throw new Error('PARENT_PORTAL_CERTIFY_ALLOW_DROP=parent-portal-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Parent Portal namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
async function migrate(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    if (crypto.createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
    if (!sql.includes(`wattanam-plugin-migration: ${migration.id}`)) throw new Error(`Migration ${migration.id} is missing its identity header`);
    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(`${statement};`);
    }
  }
}
function runtime(prisma) {
  const routes = new Map(); const navigation = []; const notifications = []; const reads = []; let guardianId = null; let resolveCount = 0; let assignCount = 0;
  const adapter = (client) => ({
    query: (sql, params = []) => client.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await client.$executeRawUnsafe(sql, ...params) }),
  });
  const database = { ...adapter(prisma), transaction: (work) => prisma.$transaction((tx) => work(adapter(tx))) };
  const roster = () => ({ classId: 'class-1', className: 'Grade 1', students: [{ studentId: 'student-1', userId: 'student-user-1', studentNumber: 'S001', name: 'Student One', parentId: guardianId }] });
  const providers = new Map([
    ['wattanam.attendance-manager:student-attendance-summary', { version: 1, data: { studentId: 'student-1', present: 12 } }],
    ['wattanam.transportation:student-transport-summary', { version: 1, data: { studentId: 'student-1', assignments: [] } }],
  ]);
  const context = {
    database,
    permissions: { register: () => () => {} },
    navigation: { register: (items) => { navigation.push(...items); return () => {}; } },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    directory: {
      classesForUser: async (userId, role) => role === 'STUDENT' && userId === 'student-user-1' || role === 'PARENT' && userId === 'parent-1' ? ['class-1'] : [],
      getClassRoster: async () => roster(),
    },
    accounts: {
      resolveParent: async () => { resolveCount += 1; return { id: 'parent-1', role: 'PARENT', created: true }; },
      assignGuardian: async ({ parentId }) => { assignCount += 1; guardianId = parentId; },
    },
    crypto: { hashBcrypt: async () => '$2b$12$certification-opaque' },
    readModels: { read: async (owner, model, versions, key) => { reads.push({ owner, model, versions, key }); const row = providers.get(`${owner}:${model}`); if (owner === 'wattanam.examination') throw new Error('provider unavailable'); return row ? [row] : []; } },
    realtime: { notifyUser: (userId, event, payload) => { notifications.push({ userId, event, payload }); } },
  };
  return { context, routes, navigation, notifications, reads, stats: () => ({ guardianId, resolveCount, assignCount }) };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma); assert.equal((await tables(prisma)).length, 1);
  const state = runtime(prisma); await plugin.activate(state.context);
  const route = (method, routePath) => { const found = state.routes.get(`${method} ${routePath}`); assert.ok(found, `${method} ${routePath} must register`); return found; };
  assert.deepEqual(state.navigation.find((item) => item.id === 'parent-portal')?.dashboard, { title: 'Parent Portal', description: 'View linked children and permitted summaries from installed plugins.', priority: 150 });

  const request = await route('POST', 'link/request').handler({ principal: { userId: 'student-user-1' }, body: { parentEmail: 'parent@example.test', parentName: 'Parent One' } });
  const approval = () => route('PATCH', 'requests/:id').handler({ params: { id: request.id }, principal: { userId: 'admin-1' }, body: { action: 'APPROVE' } });
  const attempts = await Promise.allSettled([approval(), approval()]);
  assert.equal(attempts.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((entry) => entry.status === 'rejected').length, 1);
  assert.match(String(attempts.find((entry) => entry.status === 'rejected').reason?.message), /already resolved/);
  assert.deepEqual(state.stats(), { guardianId: 'parent-1', resolveCount: 1, assignCount: 1 });

  const children = await route('GET', 'children').handler({ principal: { userId: 'parent-1' } });
  assert.equal(children.length, 1); assert.equal(children[0].studentId, 'student-1');
  await assert.rejects(() => route('GET', 'children/:studentId/overview').handler({ principal: { userId: 'parent-1' }, params: { studentId: 'student-2' } }), /not linked/);
  assert.equal(state.reads.length, 0);
  const overview = await route('GET', 'children/:studentId/overview').handler({ principal: { userId: 'parent-1' }, params: { studentId: 'student-1' } });
  assert.equal(overview.sections['student-attendance-summary'].available, true);
  assert.deepEqual(overview.sections['student-fee-balance'], { available: false, reason: 'not-published' });
  assert.deepEqual(overview.sections['student-grade-summary'], { available: false, reason: 'adapter-unavailable' });
  assert.equal(state.reads.length, 5); assert.ok(state.reads.every((entry) => entry.key === 'student-1' && entry.versions[0] === 1));

  const result = { format: 'wattanam-parent-portal-postgres-certification-v1', postgres: true, tables: 1, concurrentResolutionSerialized: true, rowScoped: true, optionalProvidersDegrade: true, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Parent Portal PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
