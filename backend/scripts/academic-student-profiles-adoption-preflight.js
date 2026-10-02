'use strict';

// Read-only prerequisite for moving legacy Student academic profile attributes into the
// Academic Management namespace. Output contains counts and a fingerprint, never PII.
const crypto = require('node:crypto');

const TARGET_TABLE = 'plugin_wattanam_academic_management_student_profile';
const SEX_VALUES = new Set(['MALE', 'FEMALE', 'OTHER']);

function updateHash(hash, row) {
  const birthDate = row.dateOfBirth == null ? null : new Date(row.dateOfBirth);
  hash.update(JSON.stringify([
    row.id,
    row.userId,
    row.studentNumber ?? null,
    row.parentId ?? null,
    row.qrCode ?? null,
    row.photo ?? null,
    row.sex ?? null,
    birthDate == null ? null : Number.isFinite(birthDate.getTime()) ? birthDate.toISOString().slice(0, 10) : String(row.dateOfBirth),
    row.address ?? null,
    row.generation ?? null,
    row.nameKh ?? null,
    row.customFieldValues ?? {},
  ]));
  hash.update('\n');
}

async function inspect(adapter, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be 1..1000');

  const hash = crypto.createHash('sha256');
  const userIds = new Set();
  const qrCodes = new Set();
  let sourceCount = 0;
  let duplicateUserCount = 0;
  let duplicateQrCount = 0;
  let invalidSexCount = 0;
  let invalidDateCount = 0;
  let cursor = null;
  let previousId = null;

  while (true) {
    const rows = await adapter.readStudentChunk({ after: cursor, limit: batchSize });
    if (!Array.isArray(rows) || rows.length > batchSize) throw new Error('student-profile adapter returned an invalid chunk');
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id || (previousId !== null && row.id <= previousId)) throw new Error('student-profile rows must have strictly increasing IDs');
      if (typeof row.userId !== 'string' || !row.userId) throw new Error('student-profile row has an invalid userId');
      if (userIds.has(row.userId)) duplicateUserCount++;
      userIds.add(row.userId);
      if (row.qrCode) {
        if (qrCodes.has(row.qrCode)) duplicateQrCount++;
        qrCodes.add(row.qrCode);
      }
      if (row.sex != null && !SEX_VALUES.has(row.sex)) invalidSexCount++;
      if (row.dateOfBirth != null && !Number.isFinite(new Date(row.dateOfBirth).getTime())) invalidDateCount++;
      previousId = row.id;
      sourceCount++;
      updateHash(hash, row);
    }
    cursor = rows.at(-1).id;
  }

  const blockers = [];
  if (duplicateUserCount) blockers.push(`${duplicateUserCount} duplicate core identity mapping(s)`);
  if (duplicateQrCount) blockers.push(`${duplicateQrCount} duplicate QR code mapping(s)`);
  if (invalidSexCount) blockers.push(`${invalidSexCount} unsupported sex value(s)`);
  if (invalidDateCount) blockers.push(`${invalidDateCount} invalid birth date value(s)`);

  const target = await adapter.targetState(TARGET_TABLE);
  if (!target || target.table !== TARGET_TABLE || typeof target.exists !== 'boolean') throw new Error('target adapter returned invalid state');
  if (!target.exists) blockers.push(`target table ${TARGET_TABLE} is absent; install the signed plugin first`);
  if (target.exists && Number(target.rowCount) > 0) blockers.push(`target table ${TARGET_TABLE} is not empty`);

  return {
    format: 'wattanam-academic-student-profile-adoption-preflight-v1',
    readOnly: true,
    ready: blockers.length === 0,
    blockers,
    source: { studentProfileCount: sourceCount, duplicateUserCount, duplicateQrCount, invalidSexCount, invalidDateCount, sha256: hash.digest('hex') },
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
      readStudentChunk: ({ after, limit }) => prisma.student.findMany({
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        orderBy: { id: 'asc' }, take: limit,
        select: { id: true, userId: true, studentNumber: true, parentId: true, qrCode: true, photo: true, sex: true, dateOfBirth: true, address: true, generation: true, nameKh: true, customFieldValues: true },
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
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Academic student-profile preflight failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { inspect, TARGET_TABLE };
