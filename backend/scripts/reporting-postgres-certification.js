'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.reporting');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const keyPrefix = 'report-cert-';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.REPORTING_CERTIFY_ALLOW_WRITE !== 'reporting-readmodels-only') throw new Error('REPORTING_CERTIFY_ALLOW_WRITE=reporting-readmodels-only is required');
}
async function cleanup(prisma) {
  await prisma.$executeRawUnsafe('DELETE FROM "PluginReadModel" WHERE "recordKey" LIKE $1', `${keyPrefix}%`);
}
async function seed(prisma) {
  const records = [
    ['wattanam.attendance-manager', 'student-attendance-summary', `${keyPrefix}student-1`, { counts: { PRESENT: 7, LATE: 1, ABSENT: 2 }, scannerCode: 'must-not-export' }],
    ['wattanam.finance', 'student-fee-balance', `${keyPrefix}student-1`, { currencies: [{ currency: 'USD', balanceMinor: '1250' }], receiptDetails: 'must-not-export' }],
    ['wattanam.human-resources', 'staff-attendance-summary', `${keyPrefix}staff-1`, { recent: [{ date: '2026-09-26', session: 1, status: 'PRESENT' }], markedBy: 'must-not-export' }],
  ];
  for (const [owner, model, key, data] of records) await prisma.$executeRawUnsafe('INSERT INTO "PluginReadModel" ("ownerPluginId","modelName","schemaVersion","recordKey","dataJson") VALUES ($1,$2,1,$3,$4)', owner, model, key, JSON.stringify(data));
}
function runtime(prisma) {
  const routes = new Map(); const navigation = []; const reads = [];
  const context = {
    permissions: { register: () => () => {} },
    navigation: { register: (items) => { navigation.push(...items); return () => {}; } },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    directory: {
      getClassRoster: async () => ({ classId: 'class-1', className: 'Grade 1', students: [
        { studentId: `${keyPrefix}student-1`, studentNumber: '+123', name: '=HYPERLINK("https://example.test")' },
        { studentId: `${keyPrefix}student-2`, studentNumber: 'S002', name: 'Student Two' },
      ] }),
      resolveAudience: async () => [
        { id: `${keyPrefix}staff-1`, role: 'TEACHER', email: 'private@example.test' },
        { id: `${keyPrefix}student-user`, role: 'STUDENT' },
      ],
      lookupUsers: async (ids) => ids.map((id) => ({ id, name: 'Teacher One', role: 'TEACHER', phone: 'private' })),
    },
    readModels: { read: async (owner, model, versions, keys) => {
      reads.push({ owner, model, versions, keys });
      if (owner === 'wattanam.transportation') throw new Error('optional provider disabled');
      const rows = await prisma.$queryRawUnsafe('SELECT "recordKey","schemaVersion","dataJson" FROM "PluginReadModel" WHERE "ownerPluginId"=$1 AND "modelName"=$2 AND "schemaVersion"=ANY($3::int[]) AND "recordKey"=ANY($4::text[]) ORDER BY "recordKey"', owner, model, versions, keys);
      return rows.map((row) => ({ key: row.recordKey, version: row.schemaVersion, data: JSON.parse(row.dataJson) }));
    } },
  };
  return { context, routes, navigation, reads };
}
async function certify(prisma) {
  assert.equal(manifest.migrations.length, 0); assert.ok(!manifest.capabilities.includes('database.read') && !manifest.capabilities.includes('database.write'));
  await cleanup(prisma); await seed(prisma);
  const state = runtime(prisma); await plugin.activate(state.context);
  const route = (method, routePath) => { const found = state.routes.get(`${method} ${routePath}`); assert.ok(found, `${method} ${routePath} must register`); return found; };
  assert.deepEqual(state.navigation.find((item) => item.id === 'student-summary')?.dashboard, { title: 'Reporting', description: 'Build privacy-minimized reports from installed plugin read models.', priority: 160 });
  const request = { principal: { role: 'SCHOOL_ADMIN' }, query: { classId: 'class-1', asOfIsoDate: '2026-09-26' } };
  await assert.rejects(() => route('GET', 'student-summaries').handler({ principal: { role: 'TEACHER' }, query: { classId: 'class-1' } }), /school administrator/);
  assert.equal(state.reads.length, 0);
  const rows = await route('GET', 'student-summaries').handler(request);
  assert.equal(rows.length, 2); assert.equal(rows[0].attendancePresent, 7); assert.equal(rows[0].feeBalance, 'USD 1250');
  assert.equal(rows[0].gradeEntries, 0); assert.equal(rows[0].transportVehicle, ''); assert.equal(rows[0].unreadMessages, 0);
  assert.doesNotMatch(JSON.stringify(rows), /scannerCode|receiptDetails|must-not-export/);
  assert.equal(state.reads.length, 5); assert.ok(state.reads.every((entry) => entry.versions[0] === 1 && entry.keys.length === 2));
  const csv = await route('GET', 'student-summaries/export.csv').handler(request);
  assert.ok(csv.content.startsWith('\uFEFF')); assert.match(csv.content, /'\+123/); assert.match(csv.content, /'=HYPERLINK/); assert.doesNotMatch(csv.content, /must-not-export/);
  const staff = await route('GET', 'staff-summaries').handler({ principal: { role: 'ADMIN' }, query: { date: '2026-09-26' } });
  assert.deepEqual(staff, [{ staffId: `${keyPrefix}staff-1`, staffName: 'Teacher One', role: 'TEACHER', present: 1, late: 0, absent: 0, excused: 0, recordedSessions: 1 }]);
  assert.doesNotMatch(JSON.stringify(staff), /private|markedBy|must-not-export/);
  const result = { format: 'wattanam-reporting-postgres-certification-v1', postgres: true, pluginTables: 0, keyedReadModels: true, optionalProvidersDegrade: true, csvFormulaSafe: true, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Reporting PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, requireGuard, seed };
