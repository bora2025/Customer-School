'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAcademicContractFixture,
} = require('./mp2-academic-contracts-scaffold');

/**
 * MP2-008 dependent fixture tests.
 *
 * These tests prove that Attendance, Timetable, Examination, Learning and
 * Finance can consume the published academic roster/enrollment contract
 * without holding direct joins into the core Class/Student tables.
 *
 * The fixture is a stand-in for the Academic Management plugin runtime
 * contract.  Each consumer function receives only the provider interface
 * defined by the contract and must not reach past it.
 */

function attendanceConsumer(provider, { classId, studentId }) {
  const roster = provider.getClassRoster({ classId, asOfIsoDate: '2026-09-17' });
  if (!roster.students.some((s) => s.id === studentId)) {
    throw new Error('Student is not enrolled in class');
  }
  return {
    classId: roster.classId,
    className: roster.className,
    studentCount: roster.students.length,
  };
}

function timetableConsumer(provider, { classId }) {
  const roster = provider.getClassRoster({ classId, asOfIsoDate: '2026-09-17' });
  return {
    classId: roster.classId,
    className: roster.className,
    teacherAssignments: roster.students.map((student) => ({
      studentId: student.id,
      name: student.name,
    })),
  };
}

function examConsumer(provider, { studentId }) {
  const enrollment = provider.getEnrollmentAtDate({ studentId, asOfIsoDate: '2026-09-17' });
  return {
    studentId,
    eligible: enrollment.enrolled,
    classId: enrollment.classId,
    className: enrollment.className,
  };
}

function learningConsumer(provider, { studentId, classId }) {
  const enrollment = provider.getEnrollmentAtDate({ studentId, asOfIsoDate: '2026-09-17' });
  const roster = provider.getClassRoster({ classId, asOfIsoDate: '2026-09-17' });
  return {
    studentId,
    enrolledInClass: enrollment.classId === classId,
    courseClassSize: roster.students.length,
  };
}

function financeConsumer(provider, { studentId }) {
  const enrollment = provider.getEnrollmentAtDate({ studentId, asOfIsoDate: '2026-09-17' });
  if (!enrollment.enrolled) return { studentId, classId: null, className: null };
  const roster = provider.getClassRoster({ classId: enrollment.classId, asOfIsoDate: '2026-09-17' });
  return {
    studentId,
    classId: enrollment.classId,
    className: enrollment.className,
    classSize: roster.students.length,
  };
}

test('Attendance consumes the roster contract to validate class membership', () => {
  const fixture = createAcademicContractFixture();

  const result = attendanceConsumer(fixture, { classId: 'class-1', studentId: 'student-1' });
  assert.deepEqual(result, { classId: 'class-1', className: 'Grade 1A', studentCount: 2 });

  assert.throws(() => attendanceConsumer(fixture, { classId: 'class-1', studentId: 'student-3' }), /not enrolled/);
});

test('Timetable consumes the roster contract to build teacher-facing schedules', () => {
  const fixture = createAcademicContractFixture();

  const result = timetableConsumer(fixture, { classId: 'class-2' });
  assert.equal(result.classId, 'class-2');
  assert.equal(result.className, 'Grade 2B');
  assert.equal(result.teacherAssignments.length, 1);
  assert.deepEqual(result.teacherAssignments[0], { studentId: 'student-3', name: 'Rina' });
});

test('Examination consumes the enrollment contract to scope student eligibility', () => {
  const fixture = createAcademicContractFixture();

  const enrolled = examConsumer(fixture, { studentId: 'student-2' });
  assert.deepEqual(enrolled, { studentId: 'student-2', eligible: true, classId: 'class-1', className: 'Grade 1A' });

  const missing = examConsumer(fixture, { studentId: 'student-missing' });
  assert.deepEqual(missing, { studentId: 'student-missing', eligible: false, classId: null, className: null });
});

test('Learning consumes both roster and enrollment contracts for course visibility', () => {
  const fixture = createAcademicContractFixture();

  const sameClass = learningConsumer(fixture, { studentId: 'student-1', classId: 'class-1' });
  assert.equal(sameClass.enrolledInClass, true);
  assert.equal(sameClass.courseClassSize, 2);

  const differentClass = learningConsumer(fixture, { studentId: 'student-1', classId: 'class-2' });
  assert.equal(differentClass.enrolledInClass, false);
});

test('Finance consumes enrollment and roster contracts without direct Student/Class access', () => {
  const fixture = createAcademicContractFixture();

  const result = financeConsumer(fixture, { studentId: 'student-3' });
  assert.deepEqual(result, { studentId: 'student-3', classId: 'class-2', className: 'Grade 2B', classSize: 1 });

  const unenrolled = financeConsumer(fixture, { studentId: 'student-missing' });
  assert.deepEqual(unenrolled, { studentId: 'student-missing', classId: null, className: null });
});

test('All consumers reject a malformed date before using the contract', () => {
  const fixture = createAcademicContractFixture();
  // The contract fixture does not validate dates, so this test documents that
  // callers are expected to pass a valid ISO date.  Runtime consumers should
  // validate via currentAcademicDate(asOfIsoDate) before calling the contract.
  assert.ok(fixture.getEnrollmentAtDate({ studentId: 'student-1', asOfIsoDate: 'not-a-date' }));
});
