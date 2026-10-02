'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTRACT_VERSION,
  academicRosterContractV1,
  academicLifecycleEventsV1,
  createAcademicContractFixture,
} = require('./mp2-academic-contracts-scaffold');

function attendanceConsumer(provider, classId) {
  const roster = provider.getClassRoster({ classId, asOfIsoDate: '2026-09-15' });
  return { classId: roster.classId, count: roster.students.length };
}

function timetableConsumer(provider, teacherRole) {
  const audience = provider.resolveAcademicAudience({ audience: 'ROLE', targetRole: teacherRole });
  return audience.recipients.length;
}

function financeConsumer(provider, studentId) {
  const enrollment = provider.getEnrollmentAtDate({ studentId, asOfIsoDate: '2026-09-15' });
  return { enrolled: enrollment.enrolled, classId: enrollment.classId };
}

test('declares MP-2 roster contract and lifecycle events with versioned IDs', () => {
  assert.equal(academicRosterContractV1.id, 'wattanam.academic-management.roster');
  assert.equal(academicRosterContractV1.version, CONTRACT_VERSION);
  assert.ok(academicRosterContractV1.methods.getClassRoster);
  assert.ok(academicRosterContractV1.methods.getEnrollmentAtDate);
  assert.ok(academicRosterContractV1.methods.resolveAcademicAudience);

  assert.equal(academicLifecycleEventsV1.id, 'wattanam.academic-management.events');
  assert.equal(academicLifecycleEventsV1.version, CONTRACT_VERSION);
  assert.ok(academicLifecycleEventsV1.events.includes('enrollment.created.v1'));
  assert.equal(academicLifecycleEventsV1.delivery.transport, 'transactional-outbox');
});

test('fixture returns stable class roster and enrollment snapshots', () => {
  const fixture = createAcademicContractFixture();
  const roster = fixture.getClassRoster({ classId: 'class-1', asOfIsoDate: '2026-09-15' });

  assert.equal(roster.className, 'Grade 1A');
  assert.equal(roster.students.length, 2);
  assert.equal(roster.students[0].name, 'Dara');

  const enrollment = fixture.getEnrollmentAtDate({ studentId: 'student-1', asOfIsoDate: '2026-09-15' });
  assert.deepEqual(enrollment, {
    studentId: 'student-1',
    classId: 'class-1',
    className: 'Grade 1A',
    enrolled: true,
    source: 'academic-plugin',
  });
});

test('dependent fixtures consume contract provider without direct table access', () => {
  const fixture = createAcademicContractFixture();

  const attendance = attendanceConsumer(fixture, 'class-1');
  assert.deepEqual(attendance, { classId: 'class-1', count: 2 });

  const timetableAudienceCount = timetableConsumer(fixture, 'TEACHER');
  assert.equal(timetableAudienceCount, 2);

  const finance = financeConsumer(fixture, 'student-3');
  assert.deepEqual(finance, { enrolled: true, classId: 'class-2' });
});
