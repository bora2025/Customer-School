'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.communication');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_communication_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.COMMUNICATION_CERTIFY_ALLOW_DROP !== 'communication-only') throw new Error('COMMUNICATION_CERTIFY_ALLOW_DROP=communication-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Communication namespace');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
  }
}
async function migrate(prisma) {
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.join(root, migration.path), 'utf8');
    if (crypto.createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.id}`);
    if (!sql.includes(`wattanam-plugin-migration: ${migration.id}`)) throw new Error(`Migration ${migration.id} is missing its identity header`);
    await prisma.$executeRawUnsafe(sql);
  }
}
function runtime(prisma) {
  const routes = new Map(); const jobs = new Map(); const deliveries = []; const projections = [];
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({
      query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params),
      execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }),
      publish: async () => {},
    })),
  };
  const identities = new Map([
    ['parent-1', { id: 'parent-1', name: 'Parent', role: 'PARENT' }],
    ['student-1', { id: 'student-1', name: 'Student', role: 'STUDENT' }],
    ['parent-2', { id: 'parent-2', name: 'Other parent', role: 'PARENT' }],
    ['admin-1', { id: 'admin-1', name: 'Admin', role: 'ADMIN' }],
  ]);
  const context = {
    permissions: { register: () => () => {} }, navigation: { register: () => () => {} },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    jobs: { register: async (job) => { jobs.set(job.id, job); return () => jobs.delete(job.id); } },
    database,
    directory: {
      lookupUsers: async (ids) => ids.map((id) => identities.get(id)).filter(Boolean),
      classesForUser: async (userId) => userId === 'parent-1' || userId === 'student-1' ? ['class-1'] : [],
      getClassRoster: async () => ({ classId: 'class-1', students: [{ studentId: 'academic-1', userId: 'student-1', parentId: 'parent-1' }] }),
    },
    realtime: { notifyUser: (userId, event, payload) => { deliveries.push({ userId, event, payload }); } },
    readModels: { publish: async (...args) => { projections.push(args); } },
  };
  return { context, routes, jobs, deliveries, projections };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma); assert.equal((await tables(prisma)).length, 3);
  const { context, routes, jobs, deliveries, projections } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const found = routes.get(`${method} ${routePath}`); assert.ok(found, `${method} ${routePath} must register`); return found; };
  const message = await route('POST', 'messages').handler({ principal: { userId: 'parent-1' }, body: { receiverId: 'student-1', content: 'Certification message' } });
  assert.equal(message.deliveryQueued, true);
  const atomic = await prisma.$queryRawUnsafe(`SELECT m."id",o."id" AS "outboxId",o."deliveredAt" FROM "${prefix}message" m JOIN "${prefix}delivery_outbox" o ON o."messageId"=m."id" WHERE m."id"=$1`, message.id);
  assert.equal(atomic.length, 1); assert.equal(atomic[0].deliveredAt, null);
  const projection = projections.find(([model]) => model === 'student-communication-summary');
  assert.ok(projection); assert.equal(JSON.stringify(projection[3]).includes('Certification message'), false);

  const deliveryJob = jobs.get('communication-delivery-outbox'); assert.ok(deliveryJob); await deliveryJob.handler();
  assert.deepEqual(deliveries, [{ userId: 'student-1', event: 'communication.message', payload: { messageId: message.id, eventId: atomic[0].outboxId } }]);
  const delivered = await prisma.$queryRawUnsafe(`SELECT "attempts","deliveredAt","lastError" FROM "${prefix}delivery_outbox" WHERE "id"=$1`, atomic[0].outboxId);
  assert.equal(delivered[0].attempts, 1); assert.ok(delivered[0].deliveredAt instanceof Date); assert.equal(delivered[0].lastError, null);

  await assert.rejects(() => route('POST', 'messages').handler({ principal: { userId: 'parent-1' }, body: { receiverId: 'parent-2', content: 'Not allowed' } }), /cannot message|not authorized/);
  const post = await route('POST', 'posts').handler({ principal: { userId: 'admin-1' }, body: { title: 'Certification news', body: 'Published safely', type: 'TEXT', tags: ['certification'], published: true } });
  const published = await route('GET', 'posts/published').handler({ query: { limit: 10 } });
  assert.ok(published.some((entry) => entry.id === post.id && entry.published === true));

  const result = { format: 'wattanam-communication-postgres-certification-v1', postgres: true, tables: 3, routes: routes.size, delivery: 'receiver-targeted', passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Communication PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
