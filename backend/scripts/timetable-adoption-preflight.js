'use strict';

// Read-only inventory for the legacy Timetable scheduling boundary. Teacher-attendance rows are
// deliberately excluded: ADR-0019 assigns those events to Attendance Manager.
const crypto = require('node:crypto');

const DATASETS = Object.freeze([
  { name: 'documents', target: 'plugin_wattanam_timetable_document' },
  { name: 'subjects', target: 'plugin_wattanam_timetable_subject' },
  { name: 'classes', target: 'plugin_wattanam_timetable_class' },
  { name: 'classrooms', target: 'plugin_wattanam_timetable_classroom' },
  { name: 'teachers', target: 'plugin_wattanam_timetable_teacher' },
  { name: 'lessons', target: 'plugin_wattanam_timetable_lesson' },
  { name: 'entries', target: 'plugin_wattanam_timetable_entry' },
  { name: 'teacherAttendance', target: 'plugin_wattanam_timetable_teacher_attendance' },
]);

const INVALID_DATE = '__INVALID_DATE__';
const INVALID_JSON = '__INVALID_JSON__';
function dateTime(value) {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : INVALID_DATE;
}
function dateOnly(value) { const parsed = dateTime(value); return parsed === INVALID_DATE || parsed == null ? parsed : parsed.slice(0, 10); }
function json(value) {
  if (value == null || typeof value === 'object') return value ?? null;
  try { return JSON.parse(value); } catch { return INVALID_JSON; }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value ?? null;
}
function common(row) { return { createdAt: dateTime(row.createdAt), updatedAt: dateTime(row.updatedAt) }; }
function normalize(dataset, row) {
  if (dataset === 'documents') return { id: row.id, name: row.name, short: row.short ?? null, academicYear: row.academicYear, periodsPerDay: Number(row.periodsPerDay), numberOfDays: Number(row.numberOfDays), weekend: json(row.weekend), periodTimes: json(row.periodTimes), timeOffRules: json(row.timeOffRules), distribution: json(row.distribution), homeworkPrep: json(row.homeworkPrep), maxOnDay: row.maxOnDay == null ? null : Number(row.maxOnDay), docNotes: row.docNotes ?? null, status: row.status, ...common(row) };
  if (dataset === 'subjects') return { id: row.id, timetableId: row.timetableId, name: row.name, short: row.short, color: row.color ?? null, picture: row.picture ?? null, classroomCount: Number(row.classroomCount), customFields: json(row.customFields), ...common(row) };
  if (dataset === 'classes') return { id: row.id, timetableId: row.timetableId, name: row.name, short: row.short, color: row.color ?? null, picture: row.picture ?? null, printSubjectPicture: Boolean(row.printSubjectPicture), customFields: json(row.customFields), academicClassId: row.academicClassId ?? null, ...common(row) };
  if (dataset === 'classrooms') return { id: row.id, timetableId: row.timetableId, name: row.name, short: row.short, color: row.color ?? null, picture: row.picture ?? null, customFields: json(row.customFields), ...common(row) };
  if (dataset === 'teachers') return { id: row.id, timetableId: row.timetableId, firstName: row.firstName, lastName: row.lastName, khmerName: row.khmerName ?? null, short: row.short, sex: row.sex ?? null, email: row.email ?? null, phone: row.phone ?? null, photo: row.photo ?? null, color: row.color ?? null, classTeacherId: row.classTeacherId ?? null, qrCode: row.qrCode ?? null, directoryUserId: row.directoryUserId ?? null, ...common(row) };
  if (dataset === 'lessons') return { id: row.id, timetableId: row.timetableId, teacherId: row.teacherId, subjectId: row.subjectId, classId: row.classId, perWeek: Number(row.perWeek), lessonType: row.lessonType, ...common(row) };
  if (dataset === 'entries') return { id: row.id, timetableId: row.timetableId, lessonId: row.lessonId ?? null, classId: row.classId, teacherId: row.teacherId, subjectId: row.subjectId, classroomId: row.classroomId ?? null, day: Number(row.day), period: Number(row.period), ...common(row) };
  if (dataset === 'teacherAttendance') return { id: row.id, teacherId: row.teacherId, date: dateOnly(row.date), period: Number(row.period), status: String(row.status || '').toUpperCase(), checkIn: dateTime(row.checkIn), ...common(row) };
  throw new Error(`unknown Timetable adoption dataset: ${dataset}`);
}

function validate(dataset, row, blockers, refs) {
  const add = (message) => blockers.push(`${dataset}: ${message}`);
  if (!row.id) add('invalid id');
  if (!row.createdAt || !row.updatedAt || row.createdAt === INVALID_DATE || row.updatedAt === INVALID_DATE) add('invalid audit timestamps');
  if (Object.values(row).includes(INVALID_JSON)) add('malformed JSON configuration');
  if (dataset === 'documents') {
    if (!row.name || !row.academicYear || !Number.isInteger(row.periodsPerDay) || row.periodsPerDay < 1 || row.periodsPerDay > 24 || !Number.isInteger(row.numberOfDays) || row.numberOfDays < 1 || row.numberOfDays > 7) add('invalid required field or schedule bounds');
    if (!Array.isArray(row.weekend) || !['DRAFT', 'PUBLISHED'].includes(row.status)) add('invalid weekend or status');
    refs.documents.set(row.id, row.id);
  } else if (dataset !== 'teacherAttendance') {
    if (!refs.documents.has(row.timetableId)) add('unknown timetable relationship');
  }
  if (dataset === 'subjects') { if (!row.name || !row.short || !Number.isInteger(row.classroomCount) || row.classroomCount < 1) add('invalid required field'); refs.subjects.set(row.id, row.timetableId); }
  if (dataset === 'classes') { if (!row.name || !row.short) add('invalid required field'); refs.classes.set(row.id, row.timetableId); }
  if (dataset === 'classrooms') { if (!row.name || !row.short) add('invalid required field'); refs.classrooms.set(row.id, row.timetableId); }
  if (dataset === 'teachers') {
    if (!row.firstName || !row.lastName || !row.short) add('invalid required field');
    if (row.classTeacherId && refs.classes.get(row.classTeacherId) !== row.timetableId) add('class-teacher relationship crosses timetable or is missing');
    refs.teachers.set(row.id, row.timetableId);
  }
  if (dataset === 'lessons') {
    if (refs.teachers.get(row.teacherId) !== row.timetableId || refs.subjects.get(row.subjectId) !== row.timetableId || refs.classes.get(row.classId) !== row.timetableId) add('resource relationship crosses timetable or is missing');
    if (!Number.isInteger(row.perWeek) || row.perWeek < 1 || row.perWeek > 168 || !['SINGLE', 'DOUBLE', 'TRIPLE'].includes(row.lessonType)) add('invalid frequency or lesson type');
    refs.lessons.set(row.id, row.timetableId);
  }
  if (dataset === 'entries') {
    if (row.lessonId && refs.lessons.get(row.lessonId) !== row.timetableId) add('lesson relationship crosses timetable or is missing');
    if (refs.teachers.get(row.teacherId) !== row.timetableId || refs.subjects.get(row.subjectId) !== row.timetableId || refs.classes.get(row.classId) !== row.timetableId || (row.classroomId && refs.classrooms.get(row.classroomId) !== row.timetableId)) add('resource relationship crosses timetable or is missing');
    if (!Number.isInteger(row.day) || row.day < 1 || row.day > 7 || !Number.isInteger(row.period) || row.period < 1 || row.period > 24) add('invalid day or period');
  }
  if (dataset === 'teacherAttendance') {
    if (!refs.teachers.has(row.teacherId)) add('unknown teacher relationship');
    if (!row.date || row.date === INVALID_DATE || !Number.isInteger(row.period) || row.period < 1 || row.period > 24 || !['PRESENT', 'ABSENT', 'LATE'].includes(row.status)) add('invalid date, period or status');
    if (row.checkIn === INVALID_DATE) add('invalid check-in timestamp');
  }
}

async function fingerprint(readChunk, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be 1..1000');
  const blockers = []; const datasets = {}; const refs = Object.fromEntries(['documents', 'subjects', 'classes', 'classrooms', 'teachers', 'lessons'].map((name) => [name, new Map()]));
  for (const dataset of DATASETS) {
    const hash = crypto.createHash('sha256'); let count = 0; let cursor = null; let previous = null;
    while (true) {
      const rows = await readChunk(dataset.name, { after: cursor, limit: batchSize });
      if (!Array.isArray(rows) || rows.length > batchSize) throw new Error(`${dataset.name} adapter returned an invalid chunk`);
      if (!rows.length) break;
      for (const source of rows) {
        if (previous !== null && String(source.id) <= previous) throw new Error(`${dataset.name} rows must have strictly increasing IDs`);
        const row = normalize(dataset.name, source); validate(dataset.name, row, blockers, refs); previous = String(source.id); count += 1; hash.update(`${JSON.stringify(canonical(row))}\n`);
      }
      cursor = String(rows.at(-1).id);
    }
    datasets[dataset.name] = { count, sha256: hash.digest('hex') };
  }
  return { blockers: [...new Set(blockers)], datasets, sha256: crypto.createHash('sha256').update(JSON.stringify(datasets)).digest('hex') };
}

async function inspect(adapter, options = {}) {
  const source = await fingerprint(adapter.readSourceChunk, options); const blockers = [...source.blockers]; const target = {};
  for (const dataset of DATASETS) {
    const state = await adapter.targetState(dataset.target);
    if (!state || state.table !== dataset.target || typeof state.exists !== 'boolean') throw new Error(`${dataset.name} target state is invalid`);
    target[dataset.name] = state;
    if (!state.exists) blockers.push(`${dataset.name}: target table is absent; install Timetable 0.1.1 first`);
    if (state.exists && Number(state.rowCount) > 0) blockers.push(`${dataset.name}: target table is not empty`);
  }
  return { format: 'wattanam-timetable-adoption-preflight-v1', readOnly: true, ready: blockers.length === 0, blockers: [...new Set(blockers)], source: { datasets: source.datasets, sha256: source.sha256 }, target, exclusions: ['staff employment attendance', 'student school-day attendance', 'course-session attendance'], nextStep: 'Create a school-bound recovery backup before running the guarded Timetable adoption copier' };
}

function productionAdapter(prisma) {
  const readers = { documents: prisma.timetable, subjects: prisma.timetableSubject, classes: prisma.timetableClass, classrooms: prisma.timetableClassroom, teachers: prisma.timetableTeacher, lessons: prisma.timetableLesson, entries: prisma.timetableEntry, teacherAttendance: prisma.timetableTeacherAttendance };
  return {
    readSourceChunk: (name, { after, limit }) => readers[name].findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }),
    targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
  try { const report = await inspect(productionAdapter(prisma)); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ready) process.exitCode = 2; } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { process.stderr.write(`Timetable adoption preflight failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { DATASETS, canonical, fingerprint, inspect, normalize, productionAdapter };
