'use strict';
const assert = require('node:assert/strict'); const test = require('node:test'); const { DATASETS, inspect } = require('./examination-adoption-preflight');
const now = '2026-09-25T00:00:00.000Z';
function rows() { return {
  scoreSheets: [{ id: 'ss1', name: 'Gradebook', createdAt: now, updatedAt: now }],
  scoreSheetClasses: [{ id: 'sc1', scoreSheetId: 'ss1', classId: 'class1', createdAt: now }],
  scoreSubjects: [{ id: 'sub1', scoreSheetId: 'ss1', name: 'Math', maxScore: 100, color: '#000', order: 0, createdAt: now, updatedAt: now }],
  scoreTabs: [{ id: 'tab1', scoreSheetId: 'ss1', label: 'Semester 1', type: 'SEMESTER', order: 0, createdAt: now, updatedAt: now }],
  scoreEntries: [{ id: 'se1', examTabId: 'tab1', subjectId: 'sub1', studentId: 'student1', score: 90, createdAt: now, updatedAt: now }],
  exams: [{ id: 'e1', title: 'Final', createdById: 'teacher1', duration: 60, totalMarks: 100, passMark: 50, maxAttempts: 1, status: 'DRAFT', createdAt: now, updatedAt: now }],
  questions: [{ id: 'q1', examId: 'e1', text: 'Secret question', type: 'MCQ', data: { choices: [{ id: 'a', isCorrect: true }] }, marks: 1, order: 0, createdAt: now }],
  attempts: [{ id: 'a1', examId: 'e1', studentId: 'student1', student: { userId: 'user1' }, answers: { q1: 'a' }, status: 'GRADED', attemptNumber: 1, startedAt: now, createdAt: now, updatedAt: now }],
}; }
function adapter(source = rows(), targetCount = 0) { return { readSourceChunk: async (name, { after, limit }) => source[name].filter((row) => !after || row.id > after).slice(0, limit), targetState: async (table) => ({ table, exists: true, rowCount: targetCount }) }; }
test('fingerprints all eight datasets without exposing exam, answer or identity content', async () => { const report = await inspect(adapter(), { batchSize: 1 }); assert.equal(report.ready, true, JSON.stringify(report.blockers)); assert.equal(Object.keys(report.source.datasets).length, DATASETS.length); assert.match(report.source.sha256, /^[a-f0-9]{64}$/); const output = JSON.stringify(report); for (const secret of ['Secret question', 'teacher1', 'student1', 'user1']) assert.equal(output.includes(secret), false); });
test('blocks malformed JSON, broken relationships and non-empty targets', async () => { const source = rows(); source.questions[0].data = '{bad'; source.scoreEntries[0].subjectId = 'missing'; source.attempts[0].status = 'INVALID'; const report = await inspect(adapter(source, 1)); assert.equal(report.ready, false); assert.ok(report.blockers.some((item) => item.includes('malformed data JSON'))); assert.ok(report.blockers.includes('scoreEntries: invalid tab/subject/student relationship or score')); assert.ok(report.blockers.includes('attempts: invalid exam/student relationship, lifecycle or timestamp')); assert.ok(report.blockers.some((item) => item.includes('target table is not empty'))); });
test('rejects unordered rows and oversized chunks', async () => { const source = rows(); source.questions.push({ ...source.questions[0], id: 'a' }); await assert.rejects(() => inspect(adapter(source), { batchSize: 2 }), /strictly increasing/); await assert.rejects(() => inspect(adapter(), { batchSize: 1001 }), /1\.\.1000/); });
