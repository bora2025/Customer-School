'use strict';

// Backup-bound, additive and resumable adoption of the complete student school-day Attendance boundary.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATASETS, fingerprint, inspect, normalize } = require('./attendance-manager-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, enterMaintenance, leaveMaintenance, loadJournal } = require('./plugin-adoption-toolkit');

function parseConfirmation(env) {
  if (env.ATTENDANCE_ADOPTION_NON_INTERACTIVE !== 'true') throw new Error('ATTENDANCE_ADOPTION_NON_INTERACTIVE=true is required');
  const slug = env.ATTENDANCE_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('ATTENDANCE_SCHOOL_SLUG is invalid');
  if (env.ATTENDANCE_CONFIRM_SLUG !== slug) throw new Error('ATTENDANCE_CONFIRM_SLUG must exactly match the school slug');
  if (!/^[a-f0-9]{64}$/.test(env.ATTENDANCE_SOURCE_SHA256 || '')) throw new Error('ATTENDANCE_SOURCE_SHA256 must match the preflight fingerprint');
  return { slug, sourceSha256: env.ATTENDANCE_SOURCE_SHA256 };
}

function journalPath(directory, slug) { return path.join(path.resolve(directory), `attendance-${slug}.journal.json`); }

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug); const report = await inspect(adapter);
  const blockers = [...report.blockers]; if (report.source.sha256 !== confirmation.sourceSha256) blockers.push('source fingerprint changed after approval');
  return { format: 'wattanam-attendance-adoption-dry-run-v1', dryRun: true, zeroWriteGuarantee: true, ready: blockers.length === 0, blockers, schoolSlug: confirmation.slug, source: report.source, target: report.target, backup: { file: path.basename(backup.archive), sha256: backup.sha256 }, plannedSteps: ['create a backup-bound multi-dataset journal', 'copy six datasets in dependency order using idempotent bounded chunks', 'verify the source fingerprint remained unchanged', 'reconcile every dataset count and canonical SHA-256', 'leave all legacy tables untouched as the rollback source'] };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) throw new Error('chunkSize must be 1..1000');
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug); const before = await inspect(adapter);
  const file = journalPath(directory, confirmation.slug); const resumed = fs.existsSync(file);
  const activeBlockers = resumed ? before.blockers.filter((item) => !item.endsWith('target table is not empty')) : before.blockers;
  if (activeBlockers.length || before.source.sha256 !== confirmation.sourceSha256) throw new Error('Attendance preflight is blocked or source fingerprint changed');
  const identity = `attendance:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  if (!resumed) {
    const datasets = Object.fromEntries(DATASETS.map(({ name }) => [name, { stage: 'prepared', cursor: null, processedRows: 0, chunks: [] }]));
    atomicJson(file, { format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', datasets, backupSha256: backup.sha256 });
  }
  let journal = loadJournal(file, identity); if (journal.backupSha256 !== backup.sha256) throw new Error('Attendance adoption journal backup mismatch');
  const maintenance = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock'); enterMaintenance(maintenance, identity);
  try {
    for (const { name } of DATASETS) {
      let state = journal.datasets[name];
      while (state.stage !== 'backfilled') {
        const rows = await adapter.readSourceChunk(name, { after: state.cursor, limit: chunkSize });
        if (!Array.isArray(rows) || rows.length > chunkSize) throw new Error(`${name} adapter returned an invalid chunk`);
        if (!rows.length) { state = { ...state, stage: 'backfilled', completedAt: new Date().toISOString() }; }
        else {
          const normalized = rows.map((row) => normalize(name, row));
          const chunkKey = crypto.createHash('sha256').update(`${identity}:${name}:${JSON.stringify(normalized.map((row) => row.id))}`).digest('hex');
          await adapter.writeTargetChunk(name, normalized, { idempotencyKey: chunkKey });
          state = { ...state, stage: 'backfilling', cursor: String(rows.at(-1).id), processedRows: state.processedRows + rows.length, chunks: state.chunks.includes(chunkKey) ? state.chunks : [...state.chunks, chunkKey], updatedAt: new Date().toISOString() };
        }
        journal = { ...journal, stage: 'backfilling', datasets: { ...journal.datasets, [name]: state } }; atomicJson(file, journal);
      }
    }
  } finally { leaveMaintenance(maintenance, identity); }
  const unchanged = await fingerprint(adapter.readSourceChunk); if (unchanged.sha256 !== before.source.sha256) throw new Error('legacy Attendance source changed during copy; do not cut over');
  const target = await fingerprint(adapter.readTargetChunk);
  const mismatches = DATASETS.filter(({ name }) => target.datasets[name].count !== before.source.datasets[name].count || target.datasets[name].sha256 !== before.source.datasets[name].sha256).map(({ name }) => name);
  if (target.blockers.length || mismatches.length || target.sha256 !== before.source.sha256) throw new Error(`Attendance target reconciliation failed${mismatches.length ? `: ${mismatches.join(', ')}` : ''}; legacy remains authoritative`);
  journal = { ...loadJournal(file, identity), stage: 'reconciled', reconciledAt: new Date().toISOString(), sourceSha256: before.source.sha256, targetSha256: target.sha256 }; atomicJson(file, journal);
  return { stage: 'reconciled', source: before.source, target, backupSha256: backup.sha256, journalFile: file };
}

function productionAdapter(prisma) {
  const sourceReaders = {
    studyYears: ({ after, limit }) => prisma.studyYear.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    sessions: ({ after, limit }) => prisma.sessionConfig.findMany({ where: { scope: 'CLASS' }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    holidays: ({ after, limit }) => prisma.holiday.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    identifiers: ({ after, limit }) => prisma.cardAlias.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    formatRules: ({ after, limit }) => prisma.attendanceFormatRule.findMany({ where: { scope: 'CLASS' }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    records: ({ after, limit }) => prisma.attendance.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, include: { student: { include: { user: true } }, class: { include: { studyYear: true } } } }),
  };
  const tables = Object.fromEntries(DATASETS.map(({ name, target }) => [name, target]));
  return {
    readSourceChunk: (name, options) => sourceReaders[name](options),
    targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; },
    readTargetChunk: (name, { after, limit }) => prisma.$queryRawUnsafe(`SELECT * FROM "${tables[name]}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after ?? '', limit),
    writeTargetChunk: async (name, rows) => {
      for (const row of rows) {
        if (name === 'studyYears') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","year","label","startDate","endDate","isCurrent","schoolName","logoUrl","createdAt","updatedAt") VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9::timestamptz,$10::timestamptz) ON CONFLICT ("id") DO NOTHING`, row.id, row.year, row.label, row.startDate, row.endDate, row.isCurrent, row.schoolName, row.logoUrl, row.createdAt, row.updatedAt);
        if (name === 'sessions') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","scope","classId","session","type","startTime","endTime","createdAt","updatedAt") VALUES ($1,'STUDENT',$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz) ON CONFLICT ("id") DO NOTHING`, row.id, row.classId || '', row.session, row.type, row.startTime, row.endTime, row.createdAt, row.updatedAt);
        if (name === 'holidays') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","date","name","description","type","createdById","createdAt","updatedAt") VALUES ($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz) ON CONFLICT ("id") DO NOTHING`, row.id, row.date, row.name, row.description, row.type, row.createdById, row.createdAt, row.updatedAt);
        if (name === 'identifiers') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","code","personId","personType","active","createdById","createdAt","updatedAt") VALUES ($1,$2,$3,'STUDENT',$4,$5,$6::timestamptz,$7::timestamptz) ON CONFLICT ("id") DO NOTHING`, row.id, row.qrValue, row.studentId, row.active, row.createdById, row.createdAt, row.updatedAt);
        if (name === 'formatRules') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","organizationId","permissionsPerAbsent","latesPerAbsentHalf","absentSessionsForDayAbsent","caseStudyABEnabled","enabled","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz) ON CONFLICT ("id") DO NOTHING`, row.id, row.organizationId || '', row.permissionsPerAbsent, row.latesPerAbsentHalf, row.absentSessionsForDayAbsent, row.caseStudyABEnabled, row.enabled, row.createdAt, row.updatedAt);
        if (name === 'records') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","personId","personType","classId","studyYearId","date","session","status","permissionType","permissionStartDate","permissionEndDate","checkInTime","checkOutTime","markedById","scanMode","scanLatitude","scanLongitude","scanLocation","personNameSnapshot","personNumberSnapshot","classNameSnapshot","studyYearLabelSnapshot","createdAt","updatedAt") VALUES ($1,$2,'STUDENT',$3,$4,$5::date,$6,$7,$8,$9::date,$10::date,$11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::timestamptz,$23::timestamptz) ON CONFLICT ("id") DO NOTHING`, row.id, row.studentId, row.classId, row.studyYearId, row.date, row.session, row.status, row.permissionType, row.permissionStartDate, row.permissionEndDate, row.checkInTime, row.checkOutTime, row.markedById, row.scanMode, row.scanLatitude, row.scanLongitude, row.scanLocation, row.personNameSnapshot, row.personNumberSnapshot, row.classNameSnapshot, row.studyYearLabelSnapshot, row.createdAt, row.updatedAt);
      }
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required'); const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const confirmation = parseConfirmation(process.env); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
  try { const args = { adapter: productionAdapter(prisma), directory, backupName: process.env.ATTENDANCE_BACKUP_FILE, confirmation }; const result = process.argv.includes('--dry-run') ? await dryRun(args) : await adopt(args); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.dryRun && !result.ready) process.exitCode = 2; } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Attendance adoption failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { adopt, dryRun, journalPath, parseConfirmation, productionAdapter };
