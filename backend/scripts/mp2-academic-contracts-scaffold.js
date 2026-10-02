'use strict';

const CONTRACT_VERSION = '1.0.0';

const academicRosterContractV1 = {
  id: 'wattanam.academic-management.roster',
  version: CONTRACT_VERSION,
  methods: {
    getClassRoster: {
      request: ['classId', 'asOfIsoDate'],
      response: ['classId', 'className', 'students'],
    },
    getEnrollmentAtDate: {
      request: ['studentId', 'asOfIsoDate'],
      response: ['studentId', 'classId', 'className', 'enrolled', 'source'],
    },
    resolveAcademicAudience: {
      request: ['audience', 'targetRole', 'classId'],
      response: ['recipients'],
    },
  },
};

const academicLifecycleEventsV1 = {
  id: 'wattanam.academic-management.events',
  version: CONTRACT_VERSION,
  events: [
    'student.created.v1',
    'student.updated.v1',
    'student.archived.v1',
    'class.created.v1',
    'class.updated.v1',
    'enrollment.created.v1',
    'enrollment.ended.v1',
  ],
  delivery: {
    transport: 'transactional-outbox',
    idempotencyKey: 'eventId',
  },
};

function createAcademicContractFixture(seed = {}) {
  const classes = seed.classes || [
    { id: 'class-1', name: 'Grade 1A', teacherId: 'teacher-1' },
    { id: 'class-2', name: 'Grade 2B', teacherId: 'teacher-2' },
  ];
  const students = seed.students || [
    { id: 'student-1', userId: 'user-student-1', name: 'Dara', classId: 'class-1', parentId: 'parent-1' },
    { id: 'student-2', userId: 'user-student-2', name: 'Sokha', classId: 'class-1', parentId: null },
    { id: 'student-3', userId: 'user-student-3', name: 'Rina', classId: 'class-2', parentId: 'parent-2' },
  ];

  function getClassRoster({ classId }) {
    const cls = classes.find((item) => item.id === classId);
    if (!cls) return { classId, className: null, students: [] };
    const members = students
      .filter((item) => item.classId === classId)
      .map((item) => ({ id: item.id, userId: item.userId, name: item.name, parentId: item.parentId }));
    return { classId: cls.id, className: cls.name, students: members };
  }

  function getEnrollmentAtDate({ studentId }) {
    const student = students.find((item) => item.id === studentId);
    if (!student) return { studentId, classId: null, className: null, enrolled: false, source: 'academic-plugin' };
    const cls = classes.find((item) => item.id === student.classId);
    return {
      studentId,
      classId: student.classId,
      className: cls ? cls.name : null,
      enrolled: Boolean(student.classId),
      source: 'academic-plugin',
    };
  }

  function resolveAcademicAudience({ audience, targetRole, classId }) {
    if (audience === 'CLASS' && classId) {
      const roster = getClassRoster({ classId });
      const recipients = roster.students.map((student) => ({ userId: student.userId, role: 'STUDENT' }));
      if (targetRole === 'PARENT') {
        return {
          recipients: roster.students
            .filter((student) => student.parentId)
            .map((student) => ({ userId: student.parentId, role: 'PARENT' })),
        };
      }
      return { recipients };
    }
    if (audience === 'ROLE' && targetRole === 'TEACHER') {
      return { recipients: classes.map((cls) => ({ userId: cls.teacherId, role: 'TEACHER' })) };
    }
    return { recipients: [] };
  }

  return {
    contract: academicRosterContractV1,
    events: academicLifecycleEventsV1,
    getClassRoster,
    getEnrollmentAtDate,
    resolveAcademicAudience,
  };
}

module.exports = {
  CONTRACT_VERSION,
  academicRosterContractV1,
  academicLifecycleEventsV1,
  createAcademicContractFixture,
};
