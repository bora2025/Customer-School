'use strict';

// Read-only prerequisite for moving legacy academic departments and user memberships into the
// Academic Management plugin namespace. It emits metadata and hashes only, never names or account
// identifiers. Installing the signed plugin creates the target tables before this check can pass.
const crypto = require('node:crypto');

const TARGET_TABLES = Object.freeze([
  'plugin_wattanam_academic_management_department',
  'plugin_wattanam_academic_management_user_department',
]);

function updateHash(hash, kind, row) {
  hash.update(JSON.stringify([kind, ...row]));
  hash.update('\n');
}

async function inspect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('batchSize must be 1..1000');
  }

  const hash = crypto.createHash('sha256');
  const blockers = [];
  const departmentIds = new Set();
  let departmentCount = 0;
  let membershipCount = 0;
  let cursor = null;
  let previousId = null;

  while (true) {
    const rows = await adapter.readDepartmentChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('department adapter returned an invalid chunk');
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousId !== null && row.id <= previousId)) {
        throw new Error('department rows must have strictly increasing IDs');
      }
      if (typeof row.name !== 'string' || !row.name.trim()) blockers.push(`department ${row.id} has no name`);
      previousId = row.id;
      departmentIds.add(row.id);
      departmentCount++;
      updateHash(hash, 'department', [row.id, row.name, row.nameKh ?? null, row.description ?? null]);
    }
    cursor = rows.at(-1).id;
  }

  cursor = null;
  previousId = null;
  while (true) {
    const rows = await adapter.readMembershipChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('membership adapter returned an invalid chunk');
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.userId !== 'string' || !row.userId || (previousId !== null && row.userId <= previousId)) {
        throw new Error('membership rows must have strictly increasing user IDs');
      }
      if (typeof row.departmentId !== 'string' || !departmentIds.has(row.departmentId)) {
        blockers.push(`user membership ${row.userId} references an unknown department`);
      }
      previousId = row.userId;
      membershipCount++;
      updateHash(hash, 'membership', [row.userId, row.departmentId]);
    }
    cursor = rows.at(-1).userId;
  }

  const targets = await adapter.targetState(TARGET_TABLES);
  if (!Array.isArray(targets) || targets.length !== TARGET_TABLES.length) throw new Error('target adapter returned invalid state');
  for (const target of targets) {
    if (!target.exists) blockers.push(`target table ${target.table} is absent; install the signed plugin first`);
    if (target.exists && Number(target.rowCount) > 0) blockers.push(`target table ${target.table} is not empty`);
  }

  return {
    format: 'wattanam-academic-management-adoption-preflight-v1',
    readOnly: true,
    ready: blockers.length === 0,
    blockers,
    source: { departmentCount, membershipCount, sha256: hash.digest('hex') },
    target: { tables: targets },
    nextStep: 'Create a school-bound recovery backup, then run the guarded dry-run with this fingerprint',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await inspect({
      readDepartmentChunk: ({ after, limit }) => prisma.department.findMany({
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        orderBy: { id: 'asc' }, take: limit,
        select: { id: true, name: true, nameKh: true, description: true },
      }),
      readMembershipChunk: ({ after, limit }) => prisma.user.findMany({
        where: { departmentId: { not: null } },
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        orderBy: { id: 'asc' }, take: limit,
        select: { id: true, departmentId: true },
      }).then((rows) => rows.map((row) => ({ userId: row.id, departmentId: row.departmentId }))),
      targetState: async (tables) => Promise.all(tables.map(async (table) => {
        const existsRows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
        const exists = existsRows[0]?.exists === true;
        const countRows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
        return { table, exists, rowCount: exists ? Number(countRows[0]?.count || 0) : 0 };
      })),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Academic preflight failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { inspect, TARGET_TABLES };
