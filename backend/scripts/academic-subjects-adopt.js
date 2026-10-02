'use strict';

// Backup-bound additive adoption. Legacy Class.subject remains unchanged for rollback.
const fs = require('node:fs');
const path = require('node:path');
const { inspect, TARGET_TABLE } = require('./academic-subjects-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, loadJournal } = require('./plugin-adoption-toolkit');

function parseConfirmation(env) {
  if (env.ACADEMIC_SUBJECTS_NON_INTERACTIVE !== 'true') throw new Error('ACADEMIC_SUBJECTS_NON_INTERACTIVE=true is required');
  const slug = env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  if (env.ACADEMIC_CONFIRM_SLUG !== slug) throw new Error('ACADEMIC_CONFIRM_SLUG must exactly match the school slug');
  if (!/^[a-f0-9]{64}$/.test(env.ACADEMIC_SUBJECTS_SOURCE_SHA256 || '')) throw new Error('ACADEMIC_SUBJECTS_SOURCE_SHA256 must match the preflight fingerprint');
  return { slug, sourceSha256: env.ACADEMIC_SUBJECTS_SOURCE_SHA256 };
}

function journalPath(directory, slug) {
  return path.join(path.resolve(directory), `academic-${slug}-subjects.journal.json`);
}

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const report = await inspect(adapter);
  const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) blockers.push('source fingerprint changed after approval');
  return {
    format: 'wattanam-academic-subjects-adoption-dry-run-v1', dryRun: true, zeroWriteGuarantee: true,
    ready: blockers.length === 0, blockers, schoolSlug: confirmation.slug, source: report.source, target: report.target,
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    plannedSteps: ['create backup-bound adoption journal', 'insert deterministic canonical subjects', 're-read source fingerprint', 'reconcile exact target identities', 'leave legacy Class.subject unchanged'],
  };
}

async function adopt({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug);
  const before = await inspect(adapter);
  const file = journalPath(directory, confirmation.slug);
  const identity = `academic-subjects:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  if (before.source.sha256 !== confirmation.sourceSha256) throw new Error('subject preflight is blocked or fingerprint changed');
  if (fs.existsSync(file)) {
    const prior = loadJournal(file, identity);
    if (prior.stage === 'reconciled') return { ...prior.result, resumed: true, journalFile: file };
  }
  if (before.blockers.length) throw new Error('subject preflight is blocked or fingerprint changed');
  if (!fs.existsSync(file)) {
    atomicJson(file, { format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', backupSha256: backup.sha256 });
  }
  await adapter.writeSubjects(before.subjects);
  const afterSource = await inspect({ ...adapter, targetState: async () => ({ table: TARGET_TABLE, exists: true, rowCount: 0 }) });
  if (afterSource.source.sha256 !== before.source.sha256) throw new Error('legacy subject source changed during copy; do not cut over');
  const target = await adapter.readTargetSubjects();
  const expected = before.subjects.map(({ id, code, name }) => ({ id, code, name }));
  const actual = target.map(({ id, code, name }) => ({ id, code, name })).sort((a, b) => a.id.localeCompare(b.id));
  const sortedExpected = expected.sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) throw new Error('subject target reconciliation failed; legacy remains authoritative');
  const result = { stage: 'reconciled', subjectCount: expected.length, sourceSha256: before.source.sha256, backupSha256: backup.sha256 };
  atomicJson(file, { ...loadJournal(file, identity), stage: 'reconciled', reconciledAt: new Date().toISOString(), result });
  return { ...result, resumed: false, journalFile: file };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const confirmation = parseConfirmation(process.env);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const adapter = {
    readClassSubjectChunk: ({ after, limit }) => prisma.class.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, subject: true } }),
    targetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 };
    },
    writeSubjects: (subjects) => prisma.$transaction(subjects.map((subject) => prisma.$executeRawUnsafe(
      `INSERT INTO "${TARGET_TABLE}" ("id","code","name","active","createdAt","updatedAt") VALUES ($1,$2,$3,TRUE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`, subject.id, subject.code, subject.name,
    ))),
    readTargetSubjects: () => prisma.$queryRawUnsafe(`SELECT "id","code","name" FROM "${TARGET_TABLE}" ORDER BY "id" ASC`),
  };
  try {
    const result = process.argv.includes('--dry-run') ? await dryRun({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation }) : await adopt({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, confirmation });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.dryRun && !result.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Academic subject adoption failed: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { adopt, dryRun, journalPath, parseConfirmation };
