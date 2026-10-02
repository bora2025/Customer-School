'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DATASETS, inspect } = require('./timetable-adoption-preflight');

const now = '2026-09-25T00:00:00.000Z';
function rows() { return {
  documents: [{ id: 't1', name: 'Main', academicYear: '2026-2027', periodsPerDay: 8, numberOfDays: 5, weekend: ['SATURDAY', 'SUNDAY'], status: 'DRAFT', createdAt: now, updatedAt: now }],
  subjects: [{ id: 's1', timetableId: 't1', name: 'Math', short: 'M', classroomCount: 1, createdAt: now, updatedAt: now }],
  classes: [{ id: 'c1', timetableId: 't1', name: '1A', short: '1A', createdAt: now, updatedAt: now }],
  classrooms: [{ id: 'r1', timetableId: 't1', name: 'Room 1', short: 'R1', createdAt: now, updatedAt: now }],
  teachers: [{ id: 'u1', timetableId: 't1', firstName: 'One', lastName: 'Teacher', short: 'T1', classTeacherId: 'c1', createdAt: now, updatedAt: now }],
  lessons: [{ id: 'l1', timetableId: 't1', teacherId: 'u1', subjectId: 's1', classId: 'c1', perWeek: 3, lessonType: 'SINGLE', createdAt: now, updatedAt: now }],
  entries: [{ id: 'e1', timetableId: 't1', lessonId: 'l1', classId: 'c1', teacherId: 'u1', subjectId: 's1', classroomId: 'r1', day: 1, period: 1, createdAt: now, updatedAt: now }],
  teacherAttendance: [{ id: 'a1', teacherId: 'u1', date: '2026-09-25', period: 1, status: 'PRESENT', checkIn: now, createdAt: now, updatedAt: now }],
}; }
function adapter(source = rows(), targetCount = 0) { return { readSourceChunk: async (name, { after, limit }) => source[name].filter((row) => !after || row.id > after).slice(0, limit), targetState: async (table) => ({ table, exists: true, rowCount: targetCount }) }; }

test('fingerprints all eight Timetable datasets without exposing scheduling rows', async () => {
  const report = await inspect(adapter(), { batchSize: 1 });
  assert.equal(report.ready, true, JSON.stringify(report.blockers)); assert.equal(Object.keys(report.source.datasets).length, DATASETS.length); assert.match(report.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes('Teacher'), false); assert.deepEqual(report.exclusions, ['staff employment attendance', 'student school-day attendance', 'course-session attendance']);
});

test('blocks malformed JSON, invalid bounds and cross-timetable relationships', async () => {
  const source = rows();
  source.documents[0].periodTimes = '{bad'; source.entries[0].day = 8; source.entries[0].teacherId = 'missing';
  const report = await inspect(adapter(source, 1));
  assert.equal(report.ready, false); assert.ok(report.blockers.includes('documents: malformed JSON configuration')); assert.ok(report.blockers.includes('entries: invalid day or period')); assert.ok(report.blockers.includes('entries: resource relationship crosses timetable or is missing')); assert.ok(report.blockers.some((item) => item.includes('target table is not empty')));
});

test('rejects unordered or oversized chunks', async () => {
  const source = rows(); source.entries.push({ ...source.entries[0], id: 'a' });
  await assert.rejects(() => inspect(adapter(source), { batchSize: 2 }), /strictly increasing/);
  await assert.rejects(() => inspect(adapter(), { batchSize: 1001 }), /1\.\.1000/);
});
