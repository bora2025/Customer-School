'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATASETS, fingerprint, inspect, normalize } = require('./timetable-adoption-preflight');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { atomicJson, enterMaintenance, leaveMaintenance, loadJournal } = require('./plugin-adoption-toolkit');

function parseConfirmation(env) {
  if (env.TIMETABLE_ADOPTION_NON_INTERACTIVE !== 'true') throw new Error('TIMETABLE_ADOPTION_NON_INTERACTIVE=true is required');
  const slug = env.TIMETABLE_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('TIMETABLE_SCHOOL_SLUG is invalid');
  if (env.TIMETABLE_CONFIRM_SLUG !== slug) throw new Error('TIMETABLE_CONFIRM_SLUG must exactly match the school slug');
  if (!/^[a-f0-9]{64}$/.test(env.TIMETABLE_SOURCE_SHA256 || '')) throw new Error('TIMETABLE_SOURCE_SHA256 must match the preflight fingerprint');
  return { slug, sourceSha256: env.TIMETABLE_SOURCE_SHA256 };
}
function journalPath(directory, slug) { return path.join(path.resolve(directory), `timetable-${slug}.journal.json`); }

async function dryRun({ adapter, directory, backupName, confirmation }) {
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug); const report = await inspect(adapter); const blockers = [...report.blockers];
  if (report.source.sha256 !== confirmation.sourceSha256) blockers.push('source fingerprint changed after approval');
  return { format: 'wattanam-timetable-adoption-dry-run-v1', dryRun: true, zeroWriteGuarantee: true, ready: blockers.length === 0, blockers, schoolSlug: confirmation.slug, source: report.source, target: report.target, backup: { file: path.basename(backup.archive), sha256: backup.sha256 } };
}

async function adopt({ adapter, directory, backupName, confirmation, chunkSize = 250 }) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) throw new Error('chunkSize must be 1..1000');
  const backup = verifyRecoveryBackup(directory, backupName, confirmation.slug); const before = await inspect(adapter); const file = journalPath(directory, confirmation.slug); const resumed = fs.existsSync(file);
  const activeBlockers = resumed ? before.blockers.filter((item) => !item.endsWith('target table is not empty')) : before.blockers;
  if (activeBlockers.length || before.source.sha256 !== confirmation.sourceSha256) throw new Error('Timetable preflight is blocked or source fingerprint changed');
  const identity = `timetable:${confirmation.slug}:${before.source.sha256}:${backup.sha256}`;
  if (!resumed) atomicJson(file, { format: 'wattanam-plugin-adoption-v1', identity, stage: 'prepared', backupSha256: backup.sha256, datasets: Object.fromEntries(DATASETS.map(({ name }) => [name, { stage: 'prepared', cursor: null, processedRows: 0, chunks: [] }])) });
  let journal = loadJournal(file, identity); if (journal.backupSha256 !== backup.sha256) throw new Error('Timetable adoption journal backup mismatch');
  const maintenance = path.join(path.resolve(directory), 'plugin-adoption.maintenance.lock'); enterMaintenance(maintenance, identity);
  try {
    for (const { name } of DATASETS) {
      let state = journal.datasets[name];
      while (state.stage !== 'backfilled') {
        const rows = await adapter.readSourceChunk(name, { after: state.cursor, limit: chunkSize });
        if (!Array.isArray(rows) || rows.length > chunkSize) throw new Error(`${name} adapter returned an invalid chunk`);
        if (!rows.length) state = { ...state, stage: 'backfilled', completedAt: new Date().toISOString() };
        else {
          const normalized = rows.map((row) => normalize(name, row)); const key = crypto.createHash('sha256').update(`${identity}:${name}:${JSON.stringify(normalized.map((row) => row.id))}`).digest('hex');
          await adapter.writeTargetChunk(name, normalized, { idempotencyKey: key });
          state = { ...state, stage: 'backfilling', cursor: String(rows.at(-1).id), processedRows: state.processedRows + rows.length, chunks: state.chunks.includes(key) ? state.chunks : [...state.chunks, key], updatedAt: new Date().toISOString() };
        }
        journal = { ...journal, stage: 'backfilling', datasets: { ...journal.datasets, [name]: state } }; atomicJson(file, journal);
      }
    }
  } finally { leaveMaintenance(maintenance, identity); }
  const unchanged = await fingerprint(adapter.readSourceChunk); if (unchanged.sha256 !== before.source.sha256) throw new Error('legacy Timetable source changed during copy; do not cut over');
  const target = await fingerprint(adapter.readTargetChunk); const mismatches = DATASETS.filter(({ name }) => target.datasets[name].count !== before.source.datasets[name].count || target.datasets[name].sha256 !== before.source.datasets[name].sha256).map(({ name }) => name);
  if (target.blockers.length || mismatches.length || target.sha256 !== before.source.sha256) throw new Error(`Timetable target reconciliation failed${mismatches.length ? `: ${mismatches.join(', ')}` : ''}; legacy remains authoritative`);
  journal = { ...loadJournal(file, identity), stage: 'reconciled', reconciledAt: new Date().toISOString(), sourceSha256: before.source.sha256, targetSha256: target.sha256 }; atomicJson(file, journal);
  return { stage: 'reconciled', source: before.source, target, backupSha256: backup.sha256, journalFile: file };
}

function productionAdapter(prisma) {
  const source = { documents: prisma.timetable, subjects: prisma.timetableSubject, classes: prisma.timetableClass, classrooms: prisma.timetableClassroom, teachers: prisma.timetableTeacher, lessons: prisma.timetableLesson, entries: prisma.timetableEntry, teacherAttendance: prisma.timetableTeacherAttendance };
  const tables = Object.fromEntries(DATASETS.map(({ name, target }) => [name, target])); const encoded = (value) => value == null ? null : JSON.stringify(value);
  return {
    readSourceChunk: (name, { after, limit }) => source[name].findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; },
    readTargetChunk: (name, { after, limit }) => prisma.$queryRawUnsafe(`SELECT * FROM "${tables[name]}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after ?? '', limit),
    writeTargetChunk: async (name, rows) => {
      for (const r of rows) {
        if (name === 'documents') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","name","short","academicYear","periodsPerDay","numberOfDays","weekend","periodTimes","timeOffRules","distribution","homeworkPrep","maxOnDay","docNotes","status","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15::timestamptz,$16::timestamptz) ON CONFLICT ("id") DO NOTHING`, r.id,r.name,r.short,r.academicYear,r.periodsPerDay,r.numberOfDays,encoded(r.weekend),encoded(r.periodTimes),encoded(r.timeOffRules),encoded(r.distribution),encoded(r.homeworkPrep),r.maxOnDay,r.docNotes,r.status,r.createdAt,r.updatedAt);
        if (name === 'subjects') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","timetableId","name","short","color","picture","classroomCount","customFields","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz,$10::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.timetableId,r.name,r.short,r.color,r.picture,r.classroomCount,encoded(r.customFields),r.createdAt,r.updatedAt);
        if (name === 'classes') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","timetableId","name","short","color","picture","printSubjectPicture","customFields","academicClassId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz,$11::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.timetableId,r.name,r.short,r.color,r.picture,r.printSubjectPicture,encoded(r.customFields),r.academicClassId,r.createdAt,r.updatedAt);
        if (name === 'classrooms') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","timetableId","name","short","color","picture","customFields","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz,$9::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.timetableId,r.name,r.short,r.color,r.picture,encoded(r.customFields),r.createdAt,r.updatedAt);
        if (name === 'teachers') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","timetableId","firstName","lastName","khmerName","short","sex","email","phone","photo","color","classTeacherId","qrCode","directoryUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.timetableId,r.firstName,r.lastName,r.khmerName,r.short,r.sex,r.email,r.phone,r.photo,r.color,r.classTeacherId,r.qrCode,r.directoryUserId,r.createdAt,r.updatedAt);
        if (name === 'lessons') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","timetableId","teacherId","subjectId","classId","perWeek","lessonType","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.timetableId,r.teacherId,r.subjectId,r.classId,r.perWeek,r.lessonType,r.createdAt,r.updatedAt);
        if (name === 'entries') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","timetableId","lessonId","classId","teacherId","subjectId","classroomId","day","period","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.timetableId,r.lessonId,r.classId,r.teacherId,r.subjectId,r.classroomId,r.day,r.period,r.createdAt,r.updatedAt);
        if (name === 'teacherAttendance') await prisma.$executeRawUnsafe(`INSERT INTO "${tables[name]}" ("id","teacherId","date","period","status","checkIn","createdAt","updatedAt") VALUES ($1,$2,$3::date,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz) ON CONFLICT ("id") DO NOTHING`,r.id,r.teacherId,r.date,r.period,r.status,r.checkIn,r.createdAt,r.updatedAt);
      }
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required'); const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('an absolute BACKUP_DIR containing a verified backup is required');
  const confirmation = parseConfirmation(process.env); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
  try { const args = { adapter: productionAdapter(prisma), directory, backupName: process.env.TIMETABLE_BACKUP_FILE, confirmation }; const result = process.argv.includes('--dry-run') ? await dryRun(args) : await adopt(args); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.dryRun && !result.ready) process.exitCode = 2; } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { process.stderr.write(`Timetable adoption failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { adopt, dryRun, journalPath, parseConfirmation, productionAdapter };
