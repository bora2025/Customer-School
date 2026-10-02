'use strict';

// Read-only prerequisite for moving legacy study years into the Attendance Manager plugin
// namespace. The report includes only counts, blockers, and a deterministic hash.
const crypto = require('node:crypto');

const TARGET_TABLE = 'plugin_wattanam_attendance_manager_study_year';

function updateHash(hash, row) {
  hash.update(JSON.stringify([
    row.id,
    row.year,
    row.label ?? null,
    row.startDate ? new Date(row.startDate).toISOString() : null,
    row.endDate ? new Date(row.endDate).toISOString() : null,
    Boolean(row.isCurrent),
    row.schoolName ?? null,
    row.logoUrl ?? null,
  ]));
  hash.update('\n');
}

async function inspect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('batchSize must be 1..1000');
  }

  const hash = crypto.createHash('sha256');
  const blockers = [];
  let sourceCount = 0;
  let currentCount = 0;
  let cursor = null;
  let previousYear = null;

  while (true) {
    const rows = await adapter.readStudyYearChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('study-year adapter returned an invalid chunk');
    if (!rows.length) break;

    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id) throw new Error('study-year row has an invalid id');
      if (!Number.isInteger(row.year) || (previousYear !== null && row.year <= previousYear)) {
        throw new Error('study-year rows must have strictly increasing year values');
      }
      if (row.isCurrent) currentCount++;
      previousYear = row.year;
      sourceCount++;
      updateHash(hash, row);
    }

    cursor = rows.at(-1).year;
  }

  if (currentCount > 1) blockers.push('legacy study-year source has more than one current year');

  const target = await adapter.targetState(TARGET_TABLE);
  if (!target || target.table !== TARGET_TABLE || typeof target.exists !== 'boolean') {
    throw new Error('target adapter returned invalid state');
  }
  if (!target.exists) blockers.push(`target table ${TARGET_TABLE} is absent; install the signed plugin first`);
  if (target.exists && Number(target.rowCount) > 0) blockers.push(`target table ${TARGET_TABLE} is not empty`);

  return {
    format: 'wattanam-attendance-study-years-adoption-preflight-v1',
    readOnly: true,
    ready: blockers.length === 0,
    blockers,
    source: { studyYearCount: sourceCount, currentCount, sha256: hash.digest('hex') },
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
      readStudyYearChunk: ({ after, limit }) => prisma.studyYear.findMany({
        ...(after !== null ? { where: { year: { gt: after } } } : {}),
        orderBy: { year: 'asc' },
        take: limit,
        select: {
          id: true,
          year: true,
          label: true,
          startDate: true,
          endDate: true,
          isCurrent: true,
          schoolName: true,
          logoUrl: true,
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
    process.stderr.write(`Attendance study-year preflight failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { inspect, TARGET_TABLE };
