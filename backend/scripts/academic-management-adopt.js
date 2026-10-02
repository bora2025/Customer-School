'use strict';

// Additive-only department/membership adoption. Legacy Department and User.departmentId remain
// authoritative until a separately approved cutover; this script never deletes or changes them.
const fs = require('node:fs');
const path = require('node:path');
const { inspect, TARGET_TABLES } = require('./academic-management-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, loadJournal, runBackfill } = require('./plugin-adoption-toolkit');

function parseConfirmation(env) {
  if (env.ACADEMIC_ADOPT_NON_INTERACTIVE !== 'true') throw new Error('ACADEMIC_ADOPT_NON_INTERACTIVE=true is required');
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  if (env.ACADEMIC_CONFIRM_SLUG !== slug) throw new Error('ACADEMIC_CONFIRM_SLUG must exactly match the school slug');
  if (!/^[a-f0-9]{64}$/.test(env.ACADEMIC_SOURCE_SHA256 || '')) throw new Error('ACADEMIC_SOURCE_SHA256 must match the preflight fingerprint');
  return { slug, sourceSha256: env.ACADEMIC_SOURCE_SHA256 };
}

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const report = await inspect(adapter);
  const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) blockers.push('source fingerprint changed after approval');
  return {
    format: 'wattanam-academic-management-adoption-dry-run-v1',
    dryRun: true,
    zeroWriteGuarantee: true,
    ready: blockers.length === 0,
    blockers,
    schoolSlug: confirmation.slug,
    source: report.source,
    target: report.target,
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    plannedSteps: [
      'create backup-bound department and membership journals',
      'copy departments idempotently in bounded chunks',
      'copy user-department memberships after departments',
      'verify the legacy source fingerprint remained unchanged',
      'reconcile exact department and membership counts and fingerprint',
      'leave legacy Department and User.departmentId unchanged',
    ],
  };
}

function journalPaths(directory, slug) {
  const root = path.resolve(directory);
  return {
    departments: path.join(root, `academic-${slug}-departments.journal.json`),
    memberships: path.join(root, `academic-${slug}-memberships.journal.json`),
    maintenance: path.join(root, 'plugin-adoption.maintenance.lock'),
  };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const files = journalPaths(directory, confirmation.slug);
  const resumed = fs.existsSync(files.departments) || fs.existsSync(files.memberships);
  const before = await inspect(adapter);
  const activeBlockers = resumed ? before.blockers.filter((blocker) => !blocker.endsWith('is not empty')) : before.blockers;
  if (activeBlockers.length || before.source.sha256 !== confirmation.sourceSha256) throw new Error('source preflight is blocked or fingerprint changed');
  const identity = `academic:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  const counts = await adapter.targetCounts();
  for (const [phase, journalFile] of [['departments', files.departments], ['memberships', files.memberships]]) {
    const count = counts[phase];
    if (!Number.isInteger(count) || count < 0) throw new Error('academic target count is invalid');
    if (!fs.existsSync(journalFile) && count !== 0) {
      throw new Error(`academic ${phase} target must be empty without a matching journal`);
    }
    if (fs.existsSync(journalFile)) {
      const existing = loadJournal(journalFile, `${identity}:${phase}`);
      if (existing.backupSha256 !== backup.sha256) throw new Error('adoption journal backup mismatch');
    }
  }

  for (const [phase, journalFile] of [['departments', files.departments], ['memberships', files.memberships]]) {
    const phaseIdentity = `${identity}:${phase}`;
    if (!fs.existsSync(journalFile)) {
      atomicJson(journalFile, { format: 'wattanam-plugin-adoption-v1', identity: phaseIdentity, stage: 'prepared', cursor: null, processedRows: 0, chunks: [], backupSha256: backup.sha256 });
    }
    const sourceReader = phase === 'departments' ? adapter.readDepartmentChunk : adapter.readMembershipChunk;
    const targetWriter = phase === 'departments' ? adapter.writeDepartmentChunk : adapter.writeMembershipChunk;
    await runBackfill({
      identity: phaseIdentity, journalFile, maintenanceFile: files.maintenance, chunkSize,
      adapter: {
        readChunk: async ({ after, limit }) => {
          const rows = await sourceReader({ after, limit });
          const cursor = phase === 'departments' ? rows.at(-1)?.id : rows.at(-1)?.userId;
          // The shared backfill engine hashes row.id to derive a chunk idempotency key.
          // Memberships are keyed by userId, so provide the stable key without changing
          // the target writer's userId/departmentId contract.
          return { rows: phase === 'memberships' ? rows.map((row) => ({ ...row, id: row.userId })) : rows, nextCursor: cursor || after };
        },
        writeChunk: targetWriter,
      },
    });
  }

  const after = await inspect(adapter);
  if (after.source.sha256 !== before.source.sha256) throw new Error('legacy academic source changed during copy; do not cut over');
  const target = await inspect({
    readDepartmentChunk: adapter.readTargetDepartmentChunk,
    readMembershipChunk: adapter.readTargetMembershipChunk,
    targetState: async () => TARGET_TABLES.map((table) => ({ table, exists: true, rowCount: 0 })),
  });
  if (!target.ready || target.source.departmentCount !== before.source.departmentCount ||
      target.source.membershipCount !== before.source.membershipCount || target.source.sha256 !== before.source.sha256) {
    throw new Error('academic target reconciliation failed; legacy remains authoritative');
  }
  for (const [phase, journalFile] of [['departments', files.departments], ['memberships', files.memberships]]) {
    const phaseIdentity = `${identity}:${phase}`;
    atomicJson(journalFile, { ...loadJournal(journalFile, phaseIdentity), stage: 'reconciled', reconciledAt: new Date().toISOString() });
  }
  return { stage: 'reconciled', ...before.source, targetSha256: target.source.sha256, backupSha256: backup.sha256, journals: files };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const confirmation = parseConfirmation(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const adapter = {
    readDepartmentChunk: ({ after, limit }) => prisma.department.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, name: true, nameKh: true, description: true } }),
    readMembershipChunk: ({ after, limit }) => prisma.user.findMany({ where: { departmentId: { not: null } }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, departmentId: true } }).then((rows) => rows.map((row) => ({ userId: row.id, departmentId: row.departmentId }))),
    targetState: async (tables) => Promise.all(tables.map(async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const count = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(count[0]?.count || 0) : 0 }; })),
    targetCounts: async () => ({ departments: Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLES[0]}"`))[0]?.count || 0), memberships: Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${TARGET_TABLES[1]}"`))[0]?.count || 0) }),
    writeDepartmentChunk: async (rows) => { for (const row of rows) await prisma.$executeRawUnsafe(`INSERT INTO "${TARGET_TABLES[0]}" ("id","name","nameKh","description") VALUES ($1,$2,$3,$4) ON CONFLICT ("id") DO NOTHING`, row.id, row.name, row.nameKh, row.description); },
    writeMembershipChunk: async (rows) => { for (const row of rows) await prisma.$executeRawUnsafe(`INSERT INTO "${TARGET_TABLES[1]}" ("userId","departmentId") VALUES ($1,$2) ON CONFLICT ("userId") DO NOTHING`, row.userId, row.departmentId); },
    readTargetDepartmentChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","name","nameKh","description" FROM "${TARGET_TABLES[0]}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit),
    readTargetMembershipChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "userId","departmentId" FROM "${TARGET_TABLES[1]}" WHERE "userId" > $1 ORDER BY "userId" LIMIT $2`, after || '', limit),
  };
  try {
    const result = process.argv.includes('--dry-run') ? await dryRun({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation }) : await adopt({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.dryRun && !result.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Academic adoption failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { adopt, dryRun, journalPaths, parseConfirmation };
