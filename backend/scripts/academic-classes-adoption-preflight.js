'use strict';

// Read-only prerequisite for moving legacy classes into the Academic Management plugin
// namespace. The report includes only counts, blockers and deterministic hash evidence.
const crypto = require('node:crypto');

const TARGET_TABLE = 'plugin_wattanam_academic_management_class';

function normalize(row) {
  return [
    row.id,
    row.name,
    row.subject ?? null,
    row.teacherId ?? null,
    row.classAdminId ?? null,
    row.studyYearId ?? null,
    row.schedule ?? null,
    row.registrationStatus,
    row.thumbnail ?? null,
    row.description ?? null,
    row.price ?? null,
    Boolean(row.showPrice),
    row.createdAt ? new Date(row.createdAt).toISOString() : null,
    row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  ];
}

async function inspect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('batchSize must be 1..1000');
  }

  const hash = crypto.createHash('sha256');
  let cursor = null;
  let previousId = null;
  let classCount = 0;

  while (true) {
    const rows = await adapter.readClassChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('class adapter returned an invalid chunk');
    if (!rows.length) break;

    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousId !== null && row.id <= previousId)) {
        throw new Error('class rows must have strictly increasing IDs');
      }
      if (typeof row.name !== 'string' || !row.name.trim()) {
        throw new Error(`class ${row.id} has no name`);
      }
      previousId = row.id;
      classCount++;
      hash.update(`${JSON.stringify(normalize(row))}\n`);
    }

    cursor = rows.at(-1).id;
  }

  const target = await adapter.targetState(TARGET_TABLE);
  if (!target || target.table !== TARGET_TABLE || typeof target.exists !== 'boolean') {
    throw new Error('target adapter returned invalid state');
  }

  const blockers = [];
  if (!target.exists) blockers.push(`target table ${TARGET_TABLE} is absent; install the signed plugin first`);
  if (target.exists && Number(target.rowCount) > 0) blockers.push(`target table ${TARGET_TABLE} is not empty`);

  return {
    format: 'wattanam-academic-classes-adoption-preflight-v1',
    readOnly: true,
    ready: blockers.length === 0,
    blockers,
    source: { classCount, sha256: hash.digest('hex') },
    target,
    nextStep: 'Create a school-bound recovery backup, then run guarded dry-run/adoption with this fingerprint',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const report = await inspect({
      readClassChunk: ({ after, limit }) => prisma.class.findMany({
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: limit,
        select: {
          id: true,
          name: true,
          subject: true,
          teacherId: true,
          classAdminId: true,
          studyYearId: true,
          schedule: true,
          registrationStatus: true,
          thumbnail: true,
          description: true,
          price: true,
          showPrice: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      targetState: async (table) => {
        const existsRows = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
        const exists = existsRows[0]?.exists === true;
        const countRows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
        return { table, exists, rowCount: exists ? Number(countRows[0]?.count || 0) : 0 };
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Academic class preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { inspect, TARGET_TABLE, normalize };
