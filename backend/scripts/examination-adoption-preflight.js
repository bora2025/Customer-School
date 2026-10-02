'use strict';

const crypto = require('node:crypto');
const DATASETS = Object.freeze([
  { name: 'scoreSheets', target: 'plugin_wattanam_examination_score_sheet' },
  { name: 'scoreSheetClasses', target: 'plugin_wattanam_examination_score_sheet_class' },
  { name: 'scoreSubjects', target: 'plugin_wattanam_examination_score_subject' },
  { name: 'scoreTabs', target: 'plugin_wattanam_examination_score_tab' },
  { name: 'scoreEntries', target: 'plugin_wattanam_examination_score_entry' },
  { name: 'exams', target: 'plugin_wattanam_examination_exam' },
  { name: 'questions', target: 'plugin_wattanam_examination_question' },
  { name: 'attempts', target: 'plugin_wattanam_examination_attempt' },
]);
const INVALID_DATE = '__INVALID_DATE__'; const INVALID_JSON = '__INVALID_JSON__';
function date(value) { if (value == null) return null; const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : INVALID_DATE; }
function json(value) { if (value == null || typeof value === 'object') return value ?? null; try { return JSON.parse(value); } catch { return INVALID_JSON; } }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value ?? null; }
function audit(row) { return { createdAt: date(row.createdAt), updatedAt: date(row.updatedAt) }; }
function normalize(dataset, row) {
  if (dataset === 'scoreSheets') return { id: row.id, name: row.name, degree: row.degree ?? null, logoUrl: row.logoUrl ?? null, studyYearId: row.studyYearId ?? null, createdByDirectoryUserId: null, ...audit(row) };
  if (dataset === 'scoreSheetClasses') return { id: row.id, scoreSheetId: row.scoreSheetId, academicClassId: row.academicClassId ?? row.classId, createdAt: date(row.createdAt) };
  if (dataset === 'scoreSubjects') return { id: row.id, scoreSheetId: row.scoreSheetId, name: row.name, maxScore: Number(row.maxScore), color: row.color, order: Number(row.order), academicSubjectId: null, ...audit(row) };
  if (dataset === 'scoreTabs') return { id: row.id, scoreSheetId: row.scoreSheetId, label: row.label, type: String(row.type || '').toUpperCase(), order: Number(row.order), ...audit(row) };
  if (dataset === 'scoreEntries') return { id: row.id, scoreTabId: row.scoreTabId ?? row.examTabId, subjectId: row.subjectId, academicStudentId: row.academicStudentId ?? row.studentId, score: row.score == null ? null : Number(row.score), formula: row.formula ?? null, ...audit(row) };
  if (dataset === 'exams') return { id: row.id, title: row.title, description: row.description ?? null, academicClassId: row.academicClassId ?? row.classId ?? null, createdByDirectoryUserId: row.createdByDirectoryUserId ?? row.createdById, startTime: date(row.startTime), endTime: date(row.endTime), duration: Number(row.duration), totalMarks: Number(row.totalMarks), passMark: Number(row.passMark), maxAttempts: Number(row.maxAttempts), status: String(row.status || '').toUpperCase(), ...audit(row) };
  if (dataset === 'questions') return { id: row.id, examId: row.examId, text: row.text, type: String(row.type || '').toUpperCase(), data: json(row.data), marks: Number(row.marks), order: Number(row.order), section: row.section ?? null, createdAt: date(row.createdAt) };
  if (dataset === 'attempts') return { id: row.id, examId: row.examId, academicStudentId: row.academicStudentId ?? row.studentId, directoryUserId: row.directoryUserId ?? row.student?.userId ?? null, answers: json(row.answers), manualMarks: json(row.manualMarks), feedback: row.feedback ?? null, score: row.score == null ? null : Number(row.score), grade: row.grade ?? null, status: String(row.status || '').toUpperCase(), attemptNumber: Number(row.attemptNumber), startedAt: date(row.startedAt), submittedAt: date(row.submittedAt), gradedAt: date(row.gradedAt), ...audit(row) };
  throw new Error(`unknown Examination adoption dataset: ${dataset}`);
}
function validate(dataset, row, blockers, refs) {
  const add = (message) => blockers.push(`${dataset}: ${message}`); if (!row.id) add('invalid id');
  for (const [key, value] of Object.entries(row)) { if (value === INVALID_DATE) add(`invalid ${key} timestamp`); if (value === INVALID_JSON) add(`malformed ${key} JSON`); }
  if (dataset === 'scoreSheets') { if (!row.name || !row.createdAt || !row.updatedAt) add('invalid required field or audit timestamp'); refs.scoreSheets.set(row.id, row.id); }
  if (dataset === 'scoreSheetClasses') { if (!refs.scoreSheets.has(row.scoreSheetId) || !row.academicClassId || !row.createdAt) add('invalid sheet/class relationship'); }
  if (dataset === 'scoreSubjects') { if (!refs.scoreSheets.has(row.scoreSheetId) || !row.name || !Number.isFinite(row.maxScore) || row.maxScore < 0 || !Number.isInteger(row.order)) add('invalid sheet relationship or subject value'); refs.scoreSubjects.set(row.id, row.scoreSheetId); }
  if (dataset === 'scoreTabs') { if (!refs.scoreSheets.has(row.scoreSheetId) || !row.label || !['MONTHLY','QUARTERLY','SEMESTER'].includes(row.type) || !Number.isInteger(row.order)) add('invalid sheet relationship or reporting period'); refs.scoreTabs.set(row.id, row.scoreSheetId); }
  if (dataset === 'scoreEntries') { const sheetId = refs.scoreTabs.get(row.scoreTabId); if (!sheetId || refs.scoreSubjects.get(row.subjectId) !== sheetId || !row.academicStudentId || (row.score != null && (!Number.isFinite(row.score) || row.score < 0))) add('invalid tab/subject/student relationship or score'); }
  if (dataset === 'exams') { if (!row.title || !row.createdByDirectoryUserId || !Number.isInteger(row.duration) || row.duration < 1 || !Number.isFinite(row.totalMarks) || row.totalMarks < 0 || !Number.isFinite(row.passMark) || row.passMark < 0 || !Number.isInteger(row.maxAttempts) || row.maxAttempts < 0 || !['DRAFT','PUBLISHED','ACTIVE','COMPLETED'].includes(row.status) || !row.createdAt || !row.updatedAt) add('invalid required field, bounds, status or audit timestamp'); if (row.startTime && row.endTime && row.endTime < row.startTime) add('exam end precedes start'); refs.exams.set(row.id, row.id); }
  if (dataset === 'questions') { if (!refs.exams.has(row.examId) || !row.text || !row.type || !Number.isFinite(row.marks) || row.marks < 0 || !Number.isInteger(row.order) || !row.createdAt) add('invalid exam relationship or question value'); }
  if (dataset === 'attempts') { if (!refs.exams.has(row.examId) || !row.academicStudentId || !['IN_PROGRESS','SUBMITTED','GRADED'].includes(row.status) || !Number.isInteger(row.attemptNumber) || row.attemptNumber < 0 || !row.startedAt || !row.createdAt || !row.updatedAt) add('invalid exam/student relationship, lifecycle or timestamp'); }
}
async function fingerprint(readChunk, { batchSize = 250 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('batchSize must be 1..1000');
  const blockers = []; const datasets = {}; const refs = { scoreSheets: new Map(), scoreSubjects: new Map(), scoreTabs: new Map(), exams: new Map() };
  for (const dataset of DATASETS) { const hash = crypto.createHash('sha256'); let count = 0; let cursor = null; let previous = null;
    while (true) { const rows = await readChunk(dataset.name, { after: cursor, limit: batchSize }); if (!Array.isArray(rows) || rows.length > batchSize) throw new Error(`${dataset.name} adapter returned an invalid chunk`); if (!rows.length) break;
      for (const source of rows) { if (previous !== null && String(source.id) <= previous) throw new Error(`${dataset.name} rows must have strictly increasing IDs`); const row = normalize(dataset.name, source); validate(dataset.name, row, blockers, refs); previous = String(source.id); count += 1; hash.update(`${JSON.stringify(canonical(row))}\n`); } cursor = String(rows.at(-1).id); }
    datasets[dataset.name] = { count, sha256: hash.digest('hex') };
  }
  return { blockers: [...new Set(blockers)], datasets, sha256: crypto.createHash('sha256').update(JSON.stringify(datasets)).digest('hex') };
}
async function inspect(adapter, options = {}) {
  const source = await fingerprint(adapter.readSourceChunk, options); const blockers = [...source.blockers]; const target = {};
  for (const dataset of DATASETS) { const state = await adapter.targetState(dataset.target); if (!state || state.table !== dataset.target || typeof state.exists !== 'boolean') throw new Error(`${dataset.name} target state is invalid`); target[dataset.name] = state; if (!state.exists) blockers.push(`${dataset.name}: target table is absent; install Examination 0.1.2 first`); if (state.exists && Number(state.rowCount) > 0) blockers.push(`${dataset.name}: target table is not empty`); }
  return { format: 'wattanam-examination-adoption-preflight-v1', readOnly: true, ready: blockers.length === 0, blockers: [...new Set(blockers)], source: { datasets: source.datasets, sha256: source.sha256 }, target, exclusions: ['question text and answer keys', 'student answers and feedback', 'student and teacher names'], nextStep: 'Create a verified school-bound recovery backup before running the guarded Examination adoption copier' };
}
function productionAdapter(prisma) {
  const readers = { scoreSheets: prisma.scoreSheet, scoreSheetClasses: prisma.scoreSheetClass, scoreSubjects: prisma.scoreSubject, scoreTabs: prisma.scoreExamTab, scoreEntries: prisma.scoreEntry, exams: prisma.exam, questions: prisma.examQuestion };
  return { readSourceChunk: (name, { after, limit }) => name === 'attempts' ? prisma.examAttempt.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), include: { student: { select: { userId: true } } }, orderBy: { id: 'asc' }, take: limit }) : readers[name].findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit }), targetState: async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const rows = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(rows[0]?.count || 0) : 0 }; } };
}
async function main() { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required'); const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); try { const report = await inspect(productionAdapter(prisma)); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ready) process.exitCode = 2; } finally { await prisma.$disconnect(); } }
if (require.main === module) main().catch((error) => { process.stderr.write(`Examination adoption preflight failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { DATASETS, canonical, fingerprint, inspect, normalize, productionAdapter };
