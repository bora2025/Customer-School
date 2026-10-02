'use strict';

// Additive-only StudyYear copy. Legacy study-year tables and routes remain authoritative
// until a separately approved cutover; this script never modifies legacy rows.
const fs = require('node:fs');
const path = require('node:path');
const { inspect, TARGET_TABLE } = require('./academic-study-years-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, loadJournal, runBackfill } = require('./plugin-adoption-toolkit');

function parseConfirmation(env) {
  if ((env.ATTENDANCE_STUDY_YEARS_NON_INTERACTIVE ?? env.ACADEMIC_STUDY_YEARS_NON_INTERACTIVE) !== 'true') {
    throw new Error('ATTENDANCE_STUDY_YEARS_NON_INTERACTIVE=true is required');
  }
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) {
    throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  }
  if (env.ACADEMIC_CONFIRM_SLUG !== slug) {
    throw new Error('ACADEMIC_CONFIRM_SLUG must exactly match the school slug');
  }
  const sourceSha256 = env.ATTENDANCE_STUDY_YEARS_SOURCE_SHA256 ?? env.ACADEMIC_STUDY_YEARS_SOURCE_SHA256;
  if (!/^[a-f0-9]{64}$/.test(sourceSha256 || '')) {
    throw new Error('ATTENDANCE_STUDY_YEARS_SOURCE_SHA256 must match the preflight fingerprint');
  }
  return { slug, sourceSha256 };
}

function journalPath(directory, slug) {
  return path.join(path.resolve(directory), `attendance-${slug}-study-years.journal.json`);
}

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const report = await inspect(adapter);
  const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) {
    blockers.push('source fingerprint changed after approval');
  }
  return {
    format: 'wattanam-attendance-study-years-adoption-dry-run-v1',
    dryRun: true,
    zeroWriteGuarantee: true,
    ready: blockers.length === 0,
    blockers,
    schoolSlug: confirmation.slug,
    source: report.source,
    target: report.target,
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    plannedSteps: [
      'create backup-bound study-year adoption journal',
      'copy study years idempotently in bounded chunks',
      'verify legacy study-year source fingerprint remained unchanged',
      'reconcile exact row counts, current-year count and source fingerprint',
      'leave legacy StudyYear storage and route ownership unchanged',
    ],
  };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const before = await inspect(adapter);
  const resumed = fs.existsSync(journalPath(directory, confirmation.slug));
  const activeBlockers = resumed ? before.blockers.filter((blocker) => !blocker.endsWith('is not empty')) : before.blockers;
  if (activeBlockers.length || before.source.sha256 !== confirmation.sourceSha256) {
    throw new Error('study-year preflight is blocked or fingerprint changed');
  }

  const journalFile = journalPath(directory, confirmation.slug);
  const maintenanceFile = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock');
  const identity = `attendance-study-years:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  const existingRows = await adapter.targetCount();
  if (!Number.isInteger(existingRows) || existingRows < 0) throw new Error('study-year target count is invalid');
  if (!resumed && existingRows !== 0) throw new Error('study-year target must be empty without a matching journal');

  if (!resumed) {
    atomicJson(journalFile, {
      format: 'wattanam-plugin-adoption-v1',
      identity,
      stage: 'prepared',
      cursor: null,
      processedRows: 0,
      chunks: [],
      backupSha256: backup.sha256,
    });
  } else {
    const existing = loadJournal(journalFile, identity);
    if (existing.backupSha256 !== backup.sha256) throw new Error('study-year adoption journal backup mismatch');
  }

  await runBackfill({
    identity,
    journalFile,
    maintenanceFile,
    chunkSize,
    adapter: {
      readChunk: async ({ after, limit }) => {
        const rows = await adapter.readSourceChunk({ after, limit });
        return { rows, nextCursor: rows.at(-1)?.year ?? after };
      },
      writeChunk: adapter.writeTargetChunk,
    },
  });

  const unchanged = await inspect({ ...adapter, targetState: async () => ({ table: TARGET_TABLE, exists: true, rowCount: 0 }) });
  if (unchanged.source.sha256 !== before.source.sha256) {
    throw new Error('legacy study-year source changed during copy; do not cut over');
  }

  const target = await inspect({
    readStudyYearChunk: adapter.readTargetChunk,
    targetState: async () => ({ table: TARGET_TABLE, exists: true, rowCount: 0 }),
  });

  if (!target.ready ||
      target.source.studyYearCount !== before.source.studyYearCount ||
      target.source.currentCount !== before.source.currentCount ||
      target.source.sha256 !== before.source.sha256) {
    throw new Error('study-year target reconciliation failed; legacy remains authoritative');
  }

  atomicJson(journalFile, {
    ...loadJournal(journalFile, identity),
    stage: 'reconciled',
    reconciledAt: new Date().toISOString(),
  });

  return {
    stage: 'reconciled',
    ...before.source,
    targetSha256: target.source.sha256,
    backupSha256: backup.sha256,
    journalFile,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  }
  const confirmation = parseConfirmation(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const select = {
    id: true,
    year: true,
    label: true,
    startDate: true,
    endDate: true,
    isCurrent: true,
    schoolName: true,
    logoUrl: true,
    createdAt: true,
    updatedAt: true,
  };
  const adapter = {
    readStudyYearChunk: ({ after, limit }) => prisma.studyYear.findMany({
      ...(after !== null ? { where: { year: { gt: after } } } : {}),
      orderBy: { year: 'asc' },
      take: limit,
      select,
    }),
    targetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS \"exists\"`);
      const exists = found[0]?.exists === true;
      const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS \"count\" FROM \"${table}\"`) : [];
      return { table, exists, rowCount: exists ? Number(count[0]?.count || 0) : 0 };
    },
    targetCount: async () => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS \"count\" FROM \"${TARGET_TABLE}\"`))[0]?.count || 0),
    readSourceChunk: ({ after, limit }) => prisma.studyYear.findMany({
      ...(after !== null ? { where: { year: { gt: after } } } : {}),
      orderBy: { year: 'asc' },
      take: limit,
      select,
    }).then((rows) => rows.map((row) => ({ ...row, id: row.id }))),
    writeTargetChunk: async (rows) => {
      for (const row of rows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO \"${TARGET_TABLE}\" (\"id\",\"year\",\"label\",\"startDate\",\"endDate\",\"isCurrent\",\"schoolName\",\"logoUrl\",\"createdAt\",\"updatedAt\") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (\"id\") DO NOTHING`,
          row.id,
          row.year,
          row.label,
          row.startDate,
          row.endDate,
          row.isCurrent,
          row.schoolName,
          row.logoUrl,
          row.createdAt,
          row.updatedAt,
        );
      }
    },
    readTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT \"id\",\"year\",\"label\",\"startDate\",\"endDate\",\"isCurrent\",\"schoolName\",\"logoUrl\",\"createdAt\",\"updatedAt\" FROM \"${TARGET_TABLE}\" WHERE \"year\" > $1 ORDER BY \"year\" ASC LIMIT $2`,
      after ?? Number.MIN_SAFE_INTEGER,
      limit,
    ),
  };

  try {
    const result = process.argv.includes('--dry-run')
      ? await dryRun({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation })
      : await adopt({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.dryRun && !result.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Attendance study-year adoption failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { adopt, dryRun, journalPath, parseConfirmation };
