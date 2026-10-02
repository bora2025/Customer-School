'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATASETS, fingerprint, inspect, normalize } = require('./examination-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, enterMaintenance, leaveMaintenance, loadJournal } = require('./plugin-adoption-toolkit');

function parseConfirmation(env) {
  if (env.EXAMINATION_ADOPTION_NON_INTERACTIVE !== 'true') throw new Error('EXAMINATION_ADOPTION_NON_INTERACTIVE=true is required');
  const slug = env.EXAMINATION_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('EXAMINATION_SCHOOL_SLUG is invalid');
  if (env.EXAMINATION_CONFIRM_SLUG !== slug) throw new Error('EXAMINATION_CONFIRM_SLUG must exactly match the school slug');
  if (!/^[a-f0-9]{64}$/.test(env.EXAMINATION_SOURCE_SHA256 || '')) throw new Error('EXAMINATION_SOURCE_SHA256 must match the preflight fingerprint');
  return { slug, sourceSha256: env.EXAMINATION_SOURCE_SHA256 };
}

function journalPath(directory, slug) { return path.join(path.resolve(directory), `examination-${slug}.journal.json`); }

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const report = await inspect(adapter);
  const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) blockers.push('source fingerprint changed after approval');
  return { format: 'wattanam-examination-adoption-dry-run-v1', dryRun: true, zeroWriteGuarantee: true, ready: blockers.length === 0, blockers, schoolSlug: confirmation.slug, source: report.source, target: report.target, backup: { file: path.basename(backup.archive), sha256: backup.sha256 } };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) throw new Error('chunkSize must be 1..1000');
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const before = await inspect(adapter);
  const file = journalPath(directory, confirmation.slug);
  const resumed = fs.existsSync(file);
  const activeBlockers = resumed ? before.blockers.filter((item) => !item.endsWith('target table is not empty')) : before.blockers;
  if (activeBlockers.length || before.source.sha256 !== confirmation.sourceSha256) throw new Error('Examination preflight is blocked or source fingerprint changed');
  const identity = `examination:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  if (!resumed) atomicJson(file, { format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', backupSha256: backup.sha256, datasets: Object.fromEntries(DATASETS.map(({ name }) => [name, { stage: 'prepared', cursor: null, processedRows: 0, chunks: [] }])) });
  let journal = loadJournal(file, identity);
  if (journal.backupSha256 !== backup.sha256) throw new Error('Examination adoption journal backup mismatch');
  const maintenance = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock');
  enterMaintenance(maintenance, identity);
  try {
    for (const { name } of DATASETS) {
      let state = journal.datasets[name];
      while (state.stage !== 'backfilled') {
        const rows = await adapter.readSourceChunk(name, { after: state.cursor, limit: chunkSize });
        if (!Array.isArray(rows) || rows.length > chunkSize) throw new Error(`${name} adapter returned an invalid chunk`);
        if (!rows.length) state = { ...state, stage: 'backfilled', completedAt: new Date().toISOString() };
        else {
          const normalized = rows.map((row) => normalize(name, row));
          const key = crypto.createHash('sha256').update(`${identity}:${name}:${JSON.stringify(normalized.map((row) => row.id))}`).digest('hex');
          await adapter.writeTargetChunk(name, normalized, { idempotencyKey: key });
          state = { ...state, stage: 'backfilling', cursor: String(rows.at(-1).id), processedRows: state.processedRows + rows.length, chunks: state.chunks.includes(key) ? state.chunks : [...state.chunks, key], updatedAt: new Date().toISOString() };
        }
        journal = { ...journal, stage: 'backfilling', datasets: { ...journal.datasets, [name]: state } };
        atomicJson(file, journal);
      }
    }
  } finally { leaveMaintenance(maintenance, identity); }
  const unchanged = await fingerprint(adapter.readSourceChunk);
  if (unchanged.sha256 !== before.source.sha256) throw new Error('legacy Examination source changed during copy; do not cut over');
  const target = await fingerprint(adapter.readTargetChunk);
  const mismatches = DATASETS.filter(({ name }) => target.datasets[name].count !== before.source.datasets[name].count || target.datasets[name].sha256 !== before.source.datasets[name].sha256).map(({ name }) => name);
  if (target.blockers.length || mismatches.length || target.sha256 !== before.source.sha256) throw new Error(`Examination target reconciliation failed${mismatches.length ? `: ${mismatches.join(', ')}` : ''}; legacy remains authoritative`);
  journal = { ...loadJournal(file, identity), stage: 'reconciled', reconciledAt: new Date().toISOString(), sourceSha256: before.source.sha256, targetSha256: target.sha256 };
  atomicJson(file, journal);
  return { stage: 'reconciled', source: before.source, target, backupSha256: backup.sha256, journalFile: file };
}

function productionAdapter(prisma) {
  const source = { scoreSheets: prisma.scoreSheet, scoreSheetClasses: prisma.scoreSheetClass, scoreSubjects: prisma.scoreSubject, scoreTabs: prisma.scoreExamTab, scoreEntries: prisma.scoreEntry, exams: prisma.exam, questions: prisma.examQuestion };
  const tables = Object.fromEntries(DATASETS.map(({ name, target }) => [name, target]));
  const encoded = (value) => value == null ? null : JSON.stringify(value);
  return {
    readSourceChunk: (name, { after, limit }) => name === 'attempts'
      ? prisma.examAttempt.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), include: { student: { select: { userId: true } } }, orderBy: { id: 'asc' }, take: limit })
      : source[name].findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; },
    readTargetChunk: (name, { after, limit }) => prisma.$queryRawUnsafe(`SELECT * FROM "${tables[name]}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after ?? '', limit),
    writeTargetChunk: async (name, rows) => {
      for (const r of rows) {
        if (name === 'scoreSheets') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","name","degree","logoUrl","studyYearId","createdByDirectoryUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.name,r.degree,r.logoUrl,r.studyYearId,r.createdByDirectoryUserId,r.createdAt,r.updatedAt);
        if (name === 'scoreSheetClasses') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","scoreSheetId","academicClassId","createdAt") VALUES ($1,$2,$3,$4::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.scoreSheetId,r.academicClassId,r.createdAt);
        if (name === 'scoreSubjects') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","scoreSheetId","name","maxScore","color","order","academicSubjectId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.scoreSheetId,r.name,r.maxScore,r.color,r.order,r.academicSubjectId,r.createdAt,r.updatedAt);
        if (name === 'scoreTabs') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","scoreSheetId","label","type","order","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.scoreSheetId,r.label,r.type,r.order,r.createdAt,r.updatedAt);
        if (name === 'scoreEntries') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","scoreTabId","subjectId","academicStudentId","score","formula","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.scoreTabId,r.subjectId,r.academicStudentId,r.score,r.formula,r.createdAt,r.updatedAt);
        if (name === 'exams') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","title","description","academicClassId","createdByDirectoryUserId","startTime","endTime","duration","totalMarks","passMark","maxAttempts","status","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.title,r.description,r.academicClassId,r.createdByDirectoryUserId,r.startTime,r.endTime,r.duration,r.totalMarks,r.passMark,r.maxAttempts,r.status,r.createdAt,r.updatedAt);
        if (name === 'questions') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","examId","text","type","data","marks","order","section","createdAt") VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.examId,r.text,r.type,encoded(r.data),r.marks,r.order,r.section,r.createdAt);
        if (name === 'attempts') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","examId","academicStudentId","directoryUserId","answers","manualMarks","feedback","score","grade","status","attemptNumber","startedAt","submittedAt","gradedAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz,$14::timestamptz,$15::timestamptz,$16::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.examId,r.academicStudentId,r.directoryUserId,encoded(r.answers),encoded(r.manualMarks),r.feedback,r.score,r.grade,r.status,r.attemptNumber,r.startedAt,r.submittedAt,r.gradedAt,r.createdAt,r.updatedAt);
      }
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const confirmation = parseConfirmation(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try { const args = { adapter: productionAdapter(prisma), directory, backupName: process.env.EXAMINATION_BACKUP_FILE, confirmation }; const result = process.argv.includes('--dry-run') ? await dryRun(args) : await adopt(args); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.dryRun && !result.ready) process.exitCode = 2; } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { process.stderr.write(`Examination adoption failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { adopt, dryRun, journalPath, parseConfirmation, productionAdapter };
