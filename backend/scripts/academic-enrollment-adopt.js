'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, loadJournal, runBackfill } = require('./plugin-adoption-toolkit');

const TARGET_TABLE = 'plugin_wattanam_academic_management_enrollment_interval';

function interval(row) {
  if (!row?.studentId || !row.classId || !(row.createdAt instanceof Date || typeof row.createdAt === 'string')) {
    throw new Error('legacy enrollment row is invalid');
  }
  const validFrom = new Date(row.createdAt).toISOString().slice(0, 10);
  return { id: `legacy:${row.studentId}:${validFrom}`, studentId: row.studentId, classId: row.classId, validFrom, validTo: null, source: 'legacy-adoption' };
}

function fingerprint(rows) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) hash.update(`${JSON.stringify([row.id, row.studentId, row.classId, row.validFrom, row.validTo, row.source])}\n`);
  return hash.digest('hex');
}

async function inspect(adapter) {
  const source = (await adapter.readAllSource()).map(interval).sort((a, b) => a.id.localeCompare(b.id));
  const studentIds = new Set();
  const blockers = [];
  for (const row of source) {
    if (studentIds.has(row.studentId)) blockers.push(`student ${row.studentId} has multiple current legacy memberships`);
    studentIds.add(row.studentId);
  }
  const target = await adapter.targetState();
  if (!target.exists) blockers.push(`target table ${TARGET_TABLE} is absent; install the signed plugin first`);
  if (target.exists && Number(target.rowCount) > 0) blockers.push(`target table ${TARGET_TABLE} is not empty`);
  return {
    format: 'wattanam-academic-enrollment-adoption-preflight-v1', readOnly: true,
    ready: blockers.length === 0, blockers,
    source: { intervalCount: source.length, sha256: fingerprint(source) }, target,
  };
}

function confirmation(env) {
  if (env.ACADEMIC_ENROLLMENT_NON_INTERACTIVE !== 'true') throw new Error('ACADEMIC_ENROLLMENT_NON_INTERACTIVE=true is required');
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || env.ACADEMIC_CONFIRM_SLUG !== slug) throw new Error('school slug confirmation is invalid');
  if (!/^[a-f0-9]{64}$/.test(env.ACADEMIC_ENROLLMENT_SOURCE_SHA256 || '')) throw new Error('source fingerprint is invalid');
  return { slug, sourceSha256: env.ACADEMIC_ENROLLMENT_SOURCE_SHA256 };
}

function journalPath(directory, slug) {
  return path.join(path.resolve(directory), `academic-${slug}-enrollments.journal.json`);
}

async function adopt({ adapter, directory, backupName, approved, chunkSize = 250 }) {
  const backup = verifyRecoveryBackup(directory, backupName, approved.slug);
  const before = await inspect(adapter);
  if (!before.ready || before.source.sha256 !== approved.sourceSha256) throw new Error('enrollment preflight is blocked or fingerprint changed');
  const identity = `academic-enrollment:${approved.slug}:${before.source.sha256}:${backup.sha256}`;
  const journalFile = journalPath(directory, approved.slug);
  const maintenanceFile = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock');
  if (!fs.existsSync(journalFile)) atomicJson(journalFile, { format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', cursor: null, processedRows: 0, chunks: [], backupSha256: backup.sha256 });
  else if (loadJournal(journalFile, identity).backupSha256 !== backup.sha256) throw new Error('enrollment adoption journal backup mismatch');
  await runBackfill({
    identity, journalFile, maintenanceFile, chunkSize,
    adapter: {
      readChunk: async ({ after, limit }) => {
        const rows = (await adapter.readSourceChunk({ after, limit })).map(interval);
        return { rows, nextCursor: rows.at(-1)?.studentId || after };
      },
      writeChunk: adapter.writeTargetChunk,
    },
  });
  const unchanged = await inspect({ ...adapter, targetState: async () => ({ exists: true, rowCount: 0 }) });
  if (unchanged.source.sha256 !== before.source.sha256) throw new Error('legacy enrollment source changed during adoption');
  const targetRows = (await adapter.readAllTarget()).sort((a, b) => a.id.localeCompare(b.id));
  if (targetRows.length !== before.source.intervalCount || fingerprint(targetRows) !== before.source.sha256) throw new Error('enrollment interval reconciliation failed');
  const journal = loadJournal(journalFile, identity);
  atomicJson(journalFile, { ...journal, stage: 'reconciled', reconciledAt: new Date().toISOString() });
  return { stage: 'reconciled', intervalCount: targetRows.length, sha256: before.source.sha256, backupSha256: backup.sha256, journalFile };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!path.isAbsolute(process.env.BACKUP_DIR || '')) throw new Error('an absolute BACKUP_DIR is required');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const sourceSelect = { id: true, classId: true, createdAt: true };
  const adapter = {
    readAllSource: () => prisma.student.findMany({ where: { classId: { not: null } }, orderBy: { id: 'asc' }, select: sourceSelect }).then((rows) => rows.map((row) => ({ studentId: row.id, classId: row.classId, createdAt: row.createdAt }))),
    readSourceChunk: ({ after, limit }) => prisma.student.findMany({ where: { classId: { not: null } }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: sourceSelect }).then((rows) => rows.map((row) => ({ studentId: row.id, classId: row.classId, createdAt: row.createdAt }))),
    targetState: async () => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLE}"`) : []; return { table: TARGET_TABLE, exists, rowCount: Number(count[0]?.count || 0) }; },
    writeTargetChunk: async (rows) => { for (const row of rows) await prisma.$executeRawUnsafe(`INSERT INTO "${TARGET_TABLE}" ("id","studentId","classId","validFrom","validTo","source") VALUES ($1,$2,$3,$4::date,$5::date,$6) ON CONFLICT ("id") DO NOTHING`, row.id, row.studentId, row.classId, row.validFrom, row.validTo, row.source); },
    readAllTarget: () => prisma.$queryRawUnsafe(`SELECT "id","studentId","classId",to_char("validFrom",'YYYY-MM-DD') AS "validFrom",CASE WHEN "validTo" IS NULL THEN NULL ELSE to_char("validTo",'YYYY-MM-DD') END AS "validTo","source" FROM "${TARGET_TABLE}" ORDER BY "id"`),
  };
  try {
    const approved = confirmation(process.env);
    const result = process.argv.includes('--dry-run') ? await inspect(adapter) : await adopt({ adapter, directory: process.env.BACKUP_DIR, backupName: process.env.ACADEMIC_BACKUP_FILE, approved });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.ready === false) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Academic enrollment adoption failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { TARGET_TABLE, adopt, confirmation, fingerprint, inspect, interval, journalPath };
