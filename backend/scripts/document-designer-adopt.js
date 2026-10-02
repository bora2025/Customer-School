'use strict';

// Additive-only legacy CardTemplate copy. Never changes legacy routes or source rows.
// A verified, school-bound pg_dump and explicit slug confirmation are prerequisites.
const fs = require('fs');
const path = require('path');
const { sha256 } = require('./db-toolkit');
const { inspect, TARGET_TABLE } = require('./document-designer-adoption-preflight');
const { atomicJson, loadJournal, runBackfill } = require('./plugin-adoption-toolkit');

const PERMISSION_GRANTS = Object.freeze({
  'wattanam.document-designer.view': ['ADMIN', 'SCHOOL_ADMIN', 'WATTAMAN', 'WATTAMAN_REPORTER', 'CLASS_ADMIN', 'ACCOUNTER', 'TEACHER', 'STUDENT', 'PARENT'],
  'wattanam.document-designer.edit': ['ADMIN'],
  'wattanam.document-designer.generate': ['ADMIN'],
  'wattanam.document-designer.print': ['ADMIN'],
});

function parseConfirmation(env) {
  if (env.DOCUMENT_DESIGNER_ADOPT_NON_INTERACTIVE !== 'true') throw new Error('DOCUMENT_DESIGNER_ADOPT_NON_INTERACTIVE=true is required');
  const slug = env.DOCUMENT_DESIGNER_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('DOCUMENT_DESIGNER_SCHOOL_SLUG is invalid');
  if (env.DOCUMENT_DESIGNER_CONFIRM_SLUG !== slug) throw new Error('DOCUMENT_DESIGNER_CONFIRM_SLUG must exactly match the school slug');
  if (!/^[a-f0-9]{64}$/.test(env.DOCUMENT_DESIGNER_SOURCE_SHA256 || '')) throw new Error('DOCUMENT_DESIGNER_SOURCE_SHA256 must match the preflight source fingerprint');
  return { slug, sourceSha256: env.DOCUMENT_DESIGNER_SOURCE_SHA256 };
}

function verifyRecoveryBackup(directory, name, slug) {
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error('backup directory cannot be a filesystem root');
  if (!/^wattanam-\d{8}T\d{6}Z\.dump$/.test(name || '')) throw new Error('backup filename must be an exact wattanam pg_dump filename');
  const archive = path.join(resolved, name);
  const manifestPath = path.join(resolved, name.replace(/\.dump$/, '.manifest.json'));
  if (!fs.existsSync(archive) || !fs.existsSync(manifestPath)) throw new Error('backup archive and manifest are required');
  if (fs.lstatSync(archive).isSymbolicLink() || fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error('backup files must not be symlinks');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'pg_dump-custom-v1' || manifest.file !== name || manifest.installationSlug !== slug) throw new Error('backup manifest does not match this school');
  if (manifest.sizeBytes !== fs.statSync(archive).size || manifest.sha256 !== sha256(archive)) throw new Error('backup size or checksum mismatch');
  return { archive, sha256: manifest.sha256 };
}

function targetAsLegacy(row) {
  return {
    id: row.id, name: row.isActive ? '__active__' : row.name,
    cardType: row.documentType, design: row.design,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const report = await inspect(adapter);
  const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) blockers.push('source fingerprint changed after approval');
  const targetRows = report.target.exists ? await adapter.targetCount() : null;
  if (targetRows !== 0) blockers.push('target table must be empty for a fresh adoption');
  return {
    format: 'wattanam-document-designer-adoption-dry-run-v1',
    dryRun: true,
    zeroWriteGuarantee: true,
    ready: blockers.length === 0,
    blockers,
    schoolSlug: confirmation.slug,
    source: report.source,
    assets: report.assets,
    target: { ...report.target, rowCount: targetRows },
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    plannedSteps: [
      'create backup-bound adoption journal',
      'enter exclusive plugin adoption maintenance lock',
      'copy legacy CardTemplate rows idempotently in bounded chunks',
      'preserve and reconcile portable embedded legacy image bytes inside each design',
      'verify source remained unchanged during copy',
      'reconcile IDs, names, document types, canonical JSON designs, active markers and timestamps',
      'upsert the approved backward-compatible permission grants',
      'leave legacy source and route ownership unchanged',
    ],
  };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const before = await inspect(adapter);
  if (!before.ready || before.source.sha256 !== confirmation.sourceSha256) throw new Error('source preflight is blocked or fingerprint changed');
  const journalFile = path.join(path.resolve(directory), `document-designer-${confirmation.slug}.journal.json`);
  const maintenanceFile = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock');
  const identity = `document-designer:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  const resumed = fs.existsSync(journalFile);
  if (!resumed) {
    if (await adapter.targetCount() !== 0) throw new Error('target table must be empty for a fresh adoption');
    atomicJson(journalFile, { format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', cursor: null, processedRows: 0, chunks: [], backupSha256: backup.sha256 });
  } else {
    const existing = loadJournal(journalFile, identity);
    if (existing.backupSha256 !== backup.sha256) throw new Error('adoption journal backup mismatch');
  }
  const journal = await runBackfill({
    identity, journalFile, maintenanceFile, chunkSize,
    adapter: {
      readChunk: async ({ after, limit }) => {
        const rows = await adapter.readSourceChunk({ after, limit });
        return { rows, nextCursor: rows.at(-1)?.id || after };
      },
      writeChunk: (rows, metadata) => adapter.writeTargetChunk(rows, metadata),
    },
  });
  const after = await inspect(adapter);
  if (after.source.sha256 !== before.source.sha256) throw new Error('legacy source changed during copy; do not cut over');
  const target = await inspect({
    readSourceChunk: async ({ after: cursor, limit }) => (await adapter.readTargetChunk({ after: cursor, limit })).map(targetAsLegacy),
    targetExists: () => adapter.targetExists(),
  });
  if (!target.ready || target.source.rowCount !== before.source.rowCount || target.source.sha256 !== before.source.sha256) {
    throw new Error('target row, active-template, design or timestamp reconciliation failed; legacy remains authoritative');
  }
  await adapter.grantPermissions(PERMISSION_GRANTS);
  atomicJson(journalFile, { ...loadJournal(journalFile, identity), stage: 'reconciled', reconciledAt: new Date().toISOString(), grants: PERMISSION_GRANTS });
  return { stage: 'reconciled', sourceRows: before.source.rowCount, sourceSha256: before.source.sha256, targetSha256: target.source.sha256, journalFile, backupSha256: backup.sha256, journalStage: journal.stage };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const confirmation = parseConfirmation(process.env);
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const backupName = process.env.DOCUMENT_DESIGNER_BACKUP_FILE;
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const adapter = {
    readSourceChunk: ({ after, limit }) => prisma.cardTemplate.findMany({
      ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit,
      select: { id: true, name: true, cardType: true, design: true, createdAt: true, updatedAt: true },
    }),
    targetExists: async () => (await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS "exists"`))[0]?.exists === true,
    targetCount: async () => Number((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM ${TARGET_TABLE}`))[0]?.count || 0),
    readTargetChunk: ({ after, limit }) => prisma.$queryRawUnsafe(
      `SELECT "id", "name", "documentType", "design", "isActive", "createdAt", "updatedAt" FROM ${TARGET_TABLE} WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit,
    ),
    writeTargetChunk: async (rows) => {
      for (const row of rows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO ${TARGET_TABLE} ("id", "name", "documentType", "design", "isActive", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT ("id") DO NOTHING`,
          row.id, row.name, row.cardType, JSON.stringify(row.design), row.name === '__active__', row.createdAt, row.updatedAt,
        );
      }
    },
    grantPermissions: async (matrix) => {
      for (const [permissionId, roles] of Object.entries(matrix)) {
        for (const role of roles) {
          await prisma.pluginPermissionGrant.upsert({
            where: { pluginId_permissionId_role: { pluginId: 'wattanam.document-designer', permissionId, role } },
            create: { pluginId: 'wattanam.document-designer', permissionId, role }, update: {},
          });
        }
      }
    },
  };
  try {
    const result = process.argv.includes('--dry-run')
      ? await dryRun({ adapter, directory, backupName, confirmation })
      : await adopt({ adapter, directory, backupName, confirmation });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ready && result.dryRun) process.exitCode = 2;
  }
  finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Document Designer adoption failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { adopt, dryRun, parseConfirmation, targetAsLegacy, verifyRecoveryBackup, PERMISSION_GRANTS };
