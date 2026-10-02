'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.transportation');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_transportation_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.TRANSPORTATION_CERTIFY_ALLOW_DROP !== 'transportation-only') throw new Error('TRANSPORTATION_CERTIFY_ALLOW_DROP=transportation-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Transportation namespace');
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
  const routes = new Map(); const deliveries = []; const projections = []; const navigation = [];
  const database = {
    query: (sql, params = []) => prisma.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await prisma.$executeRawUnsafe(sql, ...params) }),
    transaction: (work) => prisma.$transaction((tx) => work({
      query: (sql, params = []) => tx.$queryRawUnsafe(sql, ...params),
      execute: async (sql, params = []) => ({ count: await tx.$executeRawUnsafe(sql, ...params) }),
    })),
  };
  const roster = { classId: 'class-1', students: [{ studentId: 'student-1', userId: 'student-user-1', parentId: 'parent-1' }] };
  const context = {
    database,
    permissions: { register: () => () => {} },
    navigation: { register: (items) => { navigation.push(...items); return () => {}; } },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    directory: {
      lookupUsers: async (ids) => ids.includes('driver-1') ? [{ id: 'driver-1', role: 'OFFICER' }] : [],
      classesForUser: async (userId, role) => userId === 'parent-1' && role === 'PARENT' ? ['class-1'] : [],
      getClassRoster: async () => roster,
    },
    realtime: { notifyUser: (userId, event, payload) => { deliveries.push({ userId, event, payload }); } },
    readModels: { publish: async (...args) => { projections.push(args); } },
  };
  return { context, routes, deliveries, projections, navigation };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma); assert.equal((await tables(prisma)).length, 5);
  const { context, routes, deliveries, projections, navigation } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const found = routes.get(`${method} ${routePath}`); assert.ok(found, `${method} ${routePath} must register`); return found; };
  const dashboard = navigation.find((item) => item.id === 'transportation')?.dashboard;
  assert.deepEqual(dashboard, { title: 'Transportation', description: 'Manage routes, vehicles, riders, and parent-safe live tracking.', priority: 80 });

  const createdRoute = await route('POST', 'routes').handler({ body: { name: 'North route', description: 'Certification route' } });
  const stop = await route('POST', 'routes/:id/stops').handler({ params: { id: createdRoute.id }, body: { name: 'North gate', latitude: 11.56, longitude: 104.93, order: 1 } });
  assert.equal(stop.routeId, createdRoute.id);
  const vehicle = await route('POST', 'vehicles').handler({ principal: { userId: 'admin-1' }, body: { name: 'Bus 1', plateNumber: 'CERT-001', capacity: 30, routeId: createdRoute.id, driverDirectoryUserId: 'driver-1' } });
  const today = new Date().toISOString().slice(0, 10);
  const rider = await route('POST', 'vehicles/:id/riders').handler({ params: { id: vehicle.id }, principal: { userId: 'admin-1' }, body: { academicClassId: 'class-1', academicStudentId: 'student-1', activeFrom: today } });
  assert.equal(rider.directoryUserId, 'student-user-1');
  const location = await route('POST', 'vehicles/:id/location').handler({ params: { id: vehicle.id }, principal: { userId: 'driver-1' }, body: { latitude: 11.57, longitude: 104.94, speed: 32, heading: 180 } });
  assert.equal(location.vehicleId, vehicle.id);
  assert.deepEqual(new Set(deliveries.map((entry) => entry.userId)), new Set(['student-user-1', 'parent-1']));
  assert.ok(deliveries.every((entry) => entry.event === 'transportation.location'));
  const projection = projections.find(([model]) => model === 'student-transport-summary');
  assert.ok(projection); assert.equal(projection[2], 'student-1');
  assert.equal(JSON.stringify(projection[3]).includes('driver-1'), false);

  const parentVehicles = await route('GET', 'parent/vehicles').handler({ principal: { userId: 'parent-1', role: 'PARENT' } });
  assert.equal(parentVehicles.length, 1); assert.equal(parentVehicles[0].academicStudentId, 'student-1');
  await assert.rejects(() => route('POST', 'vehicles/:id/location').handler({ params: { id: vehicle.id }, principal: { userId: 'driver-1' }, body: { latitude: 91, longitude: 104.94 } }), /latitude must be between/);

  const result = { format: 'wattanam-transportation-postgres-certification-v1', postgres: true, tables: 5, routes: routes.size, recipients: deliveries.length, parentScoped: true, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Transportation PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
