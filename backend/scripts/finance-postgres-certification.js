'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', 'plugins', 'wattanam.finance');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const plugin = require(path.join(root, manifest.backendEntry));
const prefix = 'plugin_wattanam_finance_';

function requireGuard(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.FINANCE_CERTIFY_ALLOW_DROP !== 'finance-only') throw new Error('FINANCE_CERTIFY_ALLOW_DROP=finance-only is required');
}
async function tables(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1 ORDER BY tablename`, `${prefix}%`);
  return rows.map((row) => row.tablename);
}
async function cleanup(prisma) {
  for (const table of (await tables(prisma)).reverse()) {
    if (!table.startsWith(prefix)) throw new Error('Refusing to drop a table outside the Finance namespace');
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
  const routes = new Map(); const projections = []; const navigation = [];
  const adapter = (client) => ({
    query: (sql, params = []) => client.$queryRawUnsafe(sql, ...params),
    execute: async (sql, params = []) => ({ count: await client.$executeRawUnsafe(sql, ...params) }),
  });
  const database = { ...adapter(prisma), transaction: (work) => prisma.$transaction((tx) => work(adapter(tx))) };
  const context = {
    database,
    permissions: { register: () => () => {} },
    navigation: { register: (items) => { navigation.push(...items); return () => {}; } },
    routes: { register: (route) => { routes.set(`${route.method} ${route.path}`, route); return () => {}; } },
    directory: { getEnrollmentAtDate: async (studentId) => ({ enrolled: studentId === 'student-1', classId: 'class-1' }) },
    readModels: { publish: async (...args) => { projections.push(args); } },
  };
  return { context, routes, projections, navigation };
}
async function certify(prisma) {
  await cleanup(prisma); await migrate(prisma); assert.equal((await tables(prisma)).length, 4);
  const { context, routes, projections, navigation } = runtime(prisma); await plugin.activate(context);
  const route = (method, routePath) => { const found = routes.get(`${method} ${routePath}`); assert.ok(found, `${method} ${routePath} must register`); return found; };
  assert.deepEqual(navigation.find((item) => item.id === 'fees')?.dashboard, { title: 'Finance', description: 'Manage student fees, immutable receipts, and financial summaries.', priority: 90 });

  const fee = await route('POST', 'fees').handler({ principal: { userId: 'accountant-1' }, body: { academicStudentId: 'student-1', currency: 'USD', totalMinor: 10000, discountMinor: 0, dueDate: '2026-10-01' } });
  await assert.rejects(() => route('POST', 'fees').handler({ principal: { userId: 'accountant-1' }, body: { academicStudentId: 'not-enrolled', currency: 'USD', totalMinor: 100, dueDate: '2026-10-01' } }), /not enrolled/);

  const paymentRequest = () => route('POST', 'fees/:id/payments').handler({ params: { id: fee.id }, principal: { userId: 'cashier-1' }, body: { amountMinor: 6000, note: 'Certification payment' } });
  const concurrent = await Promise.allSettled([paymentRequest(), paymentRequest()]);
  const successful = concurrent.filter((entry) => entry.status === 'fulfilled');
  const rejected = concurrent.filter((entry) => entry.status === 'rejected');
  assert.equal(successful.length, 1); assert.equal(rejected.length, 1); assert.match(String(rejected[0].reason?.message), /exceeds outstanding/);
  const payment = successful[0].value;

  const before = await prisma.$queryRawUnsafe(`SELECT "id","receiptNumber","amountMinor"::text,"currency","note","createdByDirectoryUserId","createdAt" FROM "${prefix}fee_payment" WHERE "id"=$1`, payment.id);
  assert.equal(before.length, 1);
  const reversal = await route('POST', 'payments/:id/reversal').handler({ params: { id: payment.id }, principal: { userId: 'finance-manager-1' }, body: { reason: 'Certification reversal' } });
  assert.equal(reversal.amountMinor, '6000');
  await assert.rejects(() => route('POST', 'payments/:id/reversal').handler({ params: { id: payment.id }, principal: { userId: 'finance-manager-1' }, body: { reason: 'Duplicate reversal' } }), /already reversed/);
  const after = await prisma.$queryRawUnsafe(`SELECT "id","receiptNumber","amountMinor"::text,"currency","note","createdByDirectoryUserId","createdAt" FROM "${prefix}fee_payment" WHERE "id"=$1`, payment.id);
  assert.deepEqual(after, before);
  const ledger = await prisma.$queryRawUnsafe(`SELECT "feePaymentId","feeRecordId","amountMinor"::text,"currency","reason" FROM "${prefix}payment_reversal" WHERE "feePaymentId"=$1`, payment.id);
  assert.deepEqual(ledger, [{ feePaymentId: payment.id, feeRecordId: fee.id, amountMinor: '6000', currency: 'USD', reason: 'Certification reversal' }]);
  const storedFee = await prisma.$queryRawUnsafe(`SELECT "paidMinor"::text FROM "${prefix}fee_record" WHERE "id"=$1`, fee.id);
  assert.equal(storedFee[0].paidMinor, '0');
  const lastProjection = projections.filter(([model]) => model === 'student-fee-balance').at(-1);
  assert.ok(lastProjection); assert.equal(lastProjection[2], 'student-1'); assert.equal(lastProjection[3].currencies[0].balanceMinor, '10000');

  const result = { format: 'wattanam-finance-postgres-certification-v1', postgres: true, tables: 4, concurrentOverpaymentPrevented: true, immutableReceipt: true, compensatingReversal: true, passed: true };
  await cleanup(prisma); return result;
}
async function main() { requireGuard(); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { process.stdout.write(`${JSON.stringify(await certify(prisma), null, 2)}\n`); } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Finance PostgreSQL certification failed: ${error.stack || error.message}\n`); process.exitCode = 1; });
module.exports = { certify, cleanup, migrate, requireGuard, tables };
