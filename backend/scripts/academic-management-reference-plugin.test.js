'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const plugin = require('../../plugins/wattanam.academic-management/backend/index.js');

const DEPARTMENT = 'plugin_wattanam_academic_management_department';
const USER_DEPARTMENT = 'plugin_wattanam_academic_management_user_department';
const CLASS = 'plugin_wattanam_academic_management_class';
const REGISTRATION = 'plugin_wattanam_academic_management_class_registration';
const SETTINGS = 'plugin_wattanam_academic_management_class_registration_settings';
const FIELD = 'plugin_wattanam_academic_management_class_registration_field';
const STUDENT_PROFILE = 'plugin_wattanam_academic_management_student_profile';
const ENROLLMENT = 'plugin_wattanam_academic_management_enrollment_interval';
const STUDY_YEAR = 'plugin_wattanam_academic_management_study_year';

function json(relative) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', relative), 'utf8'));
}

async function activate(database = { query: async () => [], execute: async () => ({ count: 0 }) }, extras = {}) {
  const routes = [];
  const permissions = [];
  const navigation = [];
  await plugin.activate({
    logger: { log: () => undefined }, database,
    routes: { register: (value) => { routes.push(value); return () => undefined; } },
    permissions: { register: (value) => { permissions.push(...value); return () => undefined; } },
    navigation: { register: (value) => { navigation.push(...value); return () => undefined; } },
    events: { publish: (event, payload) => (extras.events || []).push({ event, payload }), subscribe: () => () => undefined },
    notifications: { notifyInApp: (to, message, type) => (extras.notifications || []).push({ to, message, type }), sendEmail: () => ({ sent: true }) },
    readModels: extras.readModels || { read: async () => [], publish: async () => undefined },
    directory: extras.directory || {
      resolveAudience: async () => [],
      lookupUsers: async (ids) => ids.map((id) => ({
        id,
        name: id === 't1' ? 'Teacher' : `User ${id}`,
        email: `${id}@example.test`,
        phone: null,
        role: id === 't1' ? 'TEACHER' : id.startsWith('parent') ? 'PARENT' : 'STUDENT',
      })),
      lookupClasses: async () => [],
      classesForUser: async () => [],
    },
    crypto: { hashBcrypt: async (plaintext) => `bcrypt:${plaintext}` },
    accounts: extras.accounts || {
      createStudent: async (input) => ({ id: `user-${input.commandKey}`, name: input.name, role: 'STUDENT', email: input.email || null, phone: input.phone || null }),
      updateStudent: async (input) => ({ id: input.userId, name: input.name, role: 'STUDENT', email: input.email || null, phone: input.phone || null }),
    },
  });
  return { routes, permissions, navigation };
}

test('registers the initial department routes, permissions, and navigation', async () => {
  const result = await activate();
  assert.deepEqual(result.routes.map((route) => `${route.method}:${route.path}`), [
    'GET:study-years',
    'GET:study-years/:id',
    'POST:study-years',
    'PUT:study-years/:id',
    'POST:study-years/:id/set-current',
    'DELETE:study-years/:id',
    'GET:departments',
    'GET:departments/:id',
    'POST:departments',
    'PUT:departments/:id',
    'DELETE:departments/:id',
    'GET:subjects',
    'GET:subjects/:id',
    'POST:subjects',
    'PUT:subjects/:id',
    'GET:contracts/subjects',
    'GET:teachers',
    'POST:classes',
    'PUT:classes/:id',
    'DELETE:classes/:id',
    'GET:classes/:id',
    'GET:classes',
    'GET:classes/:id/students',
    'POST:classes/:id/students/bulk-csv',
    'GET:classes/parents',
    'GET:classes/students/batch',
    'GET:classes/:id/available-students',
    'GET:classes/:id/students/:studentId',
    'GET:classes/:id/document-records',
    'GET:contracts/classes/:id/roster',
    'GET:contracts/students/:id/enrollment',
    'GET:contracts/classes/:id/audience',
    'GET:contracts/users/:id/classes',
    'GET:contracts/classes/lookup',
    'GET:contracts/subjects/lookup',
    'GET:contracts/users/:id/department',
    'PUT:commands/users/:id/department',
    'PUT:commands/students/by-user/:id/guardian',
    'DELETE:commands/users/:id/academic-identity',
    'POST:contracts/users/academic-profiles',
    'POST:classes/:id/students',
    'PATCH:classes/:classId/students/:studentId',
    'DELETE:classes/:id/students/:studentId',
    'POST:classes/cleanup-orphaned-students',
    'GET:admissions/public/classes',
    'GET:admissions/public/form-config',
    'GET:admissions/settings',
    'GET:admissions/fields',
    'PATCH:admissions/settings',
    'POST:admissions/fields',
    'PATCH:admissions/fields/:id',
    'POST:admissions/fields/reorder',
    'DELETE:admissions/fields/:id',
    'GET:admissions/registrations',
    'GET:admissions/registrations/:id',
    'PATCH:admissions/registrations/:id/resolve',
    'POST:admissions/public/submit',
  ]);
  assert.deepEqual(result.permissions.map((permission) => permission.id), [
    'wattanam.academic-management.view', 'wattanam.academic-management.manage',
  ]);
  assert.deepEqual(result.navigation.map((entry) => entry.href), [
    '/plugins/wattanam.academic-management/study-years',
    '/plugins/wattanam.academic-management/departments',
    '/plugins/wattanam.academic-management/subjects',
    '/plugins/wattanam.academic-management/classes',
    '/plugins/wattanam.academic-management/teachers',
    '/plugins/wattanam.academic-management/registrations',
    '/plugins/wattanam.academic-management/registration-settings',
  ]);
});

test('exposes read-only routes without database writes', async () => {
  const calls = [];
  const result = await activate({
    query: async (sql, params) => {
      if (sql.includes(`FROM ${CLASS} c`)) return [{ id: params[0], name: 'Class A' }];
      if (sql.includes(`FROM ${REGISTRATION} r LEFT JOIN`)) return [{ id: params[0], nameEn: 'Student' }];
      return [];
    },
    execute: async (sql, params) => { calls.push({ sql, params }); return { count: 1 }; },
    transaction: async (fn) => fn({ query: async () => [], execute: async (sql, params) => { calls.push({ sql, params }); return { count: 1 }; }, publish: () => undefined }),
  });
  const route = (method, path) => result.routes.find((entry) => entry.method === method && entry.path === path);
  await route('GET', 'departments').handler();
  await route('GET', 'subjects').handler({ query: {} });
  await route('GET', 'contracts/subjects').handler();
  await route('GET', 'teachers').handler();
  await route('GET', 'classes/:id').handler({ params: { id: '00000000-0000-0000-0000-000000000000' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  await route('GET', 'classes').handler({ query: {}, principal: { userId: 'admin-1', role: 'ADMIN' } });
  await route('GET', 'classes/:id/students').handler({ params: { id: '00000000-0000-0000-0000-000000000000' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  await result.routes.find((route) => route.method === 'GET' && route.path === 'admissions/public/classes').handler();
  await result.routes.find((route) => route.method === 'GET' && route.path === 'admissions/public/form-config').handler();
  const adminPrincipal = { principal: { userId: 'admin-1', role: 'ADMIN' } };
  await result.routes.find((route) => route.method === 'GET' && route.path === 'admissions/settings').handler(adminPrincipal);
  await result.routes.find((route) => route.method === 'GET' && route.path === 'admissions/fields').handler(adminPrincipal);
  await result.routes.find((route) => route.method === 'GET' && route.path === 'admissions/registrations').handler({ ...adminPrincipal, query: {} });
  await result.routes.find((route) => route.method === 'GET' && route.path === 'admissions/registrations/:id').handler({ ...adminPrincipal, params: { id: '00000000-0000-0000-0000-000000000000' } });
  assert.equal(calls.length, 0);
});

test('class document records enforce originating-domain row scope and expose bounded fields', async () => {
  const db = {
    query: async (sql, params = []) => {
      if (sql.includes(`SELECT "teacherId", "classAdminId" FROM ${CLASS}`)) return [{ teacherId: 'teacher-1', classAdminId: 'class-admin-1' }];
      if (sql.includes(`SELECT "id", "name", "subject", "studyYearId" FROM ${CLASS}`)) return [{ id: 'class-1', name: 'Class A', subject: 'Math', studyYearId: 'year-1' }];
      if (sql.includes(`FROM ${STUDENT_PROFILE} s JOIN ${ENROLLMENT} e`) && sql.includes('LIMIT 500')) return [{ id: 'student-1', userId: 'user-1', studentNumber: 'S001', nameKh: 'សិស្ស', qrCode: 'QR-1', photo: 'photo', sex: 'F', dateOfBirth: '2015-01-01', generation: '2026' }];
      return [];
    },
    execute: async () => ({ count: 0 }),
  };
  const directory = {
    resolveAudience: async () => [], lookupClasses: async () => [], classesForUser: async () => [],
    lookupUsers: async (ids) => ids.map((id) => ({ id, name: id === 'user-1' ? 'Student One' : 'User', email: null, phone: null, role: id === 'teacher-1' ? 'TEACHER' : 'STUDENT' })),
  };
  const result = await activate(db, { directory });
  const route = result.routes.find((entry) => entry.method === 'GET' && entry.path === 'classes/:id/document-records');

  await assert.rejects(
    () => route.handler({ params: { id: 'class-1' }, principal: { userId: 'teacher-2', role: 'TEACHER' } }),
    /not assigned to this class/,
  );
  const payload = await route.handler({ params: { id: 'class-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } });
  assert.equal(payload.source.principalId, 'teacher-1');
  assert.equal(payload.records.length, 1);
  assert.deepEqual(payload.records[0].class, { id: 'class-1', name: 'Class A', subject: 'Math', studyYearId: 'year-1' });
  assert.equal(payload.records[0].name, 'Student One');
  assert.equal(Object.hasOwn(payload.records[0], 'address'), false);
  assert.equal(Object.hasOwn(payload.records[0], 'email'), false);
});

test('class list and roster mutations enforce assigned staff scope', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ kind: 'query', sql, params });
      if (sql.includes(`SELECT "teacherId", "classAdminId" FROM ${CLASS}`)) return [{ teacherId: 'teacher-1', classAdminId: 'class-admin-1' }];
      if (sql.includes(`FROM ${CLASS} c`)) return [];
      return [];
    },
    execute: async (sql, params = []) => { calls.push({ kind: 'execute', sql, params }); return { count: 1 }; },
    transaction: async (work) => work({ query: db.query, execute: db.execute, publish: async () => undefined }),
  };
  const result = await activate(db);
  const list = result.routes.find((entry) => entry.method === 'GET' && entry.path === 'classes');
  await list.handler({ query: {}, principal: { userId: 'teacher-1', role: 'TEACHER' } });
  const scopedList = calls.find((call) => call.sql.includes(`FROM ${CLASS} c`));
  assert.match(scopedList.sql, /c\."teacherId" = \$1/);
  assert.deepEqual(scopedList.params, ['teacher-1']);

  calls.length = 0;
  const add = result.routes.find((entry) => entry.method === 'POST' && entry.path === 'classes/:id/students');
  await assert.rejects(
    () => add.handler({ params: { id: 'class-1' }, body: { studentId: 'student-1' }, principal: { userId: 'teacher-2', role: 'TEACHER' } }),
    /not assigned to this class/,
  );
  assert.equal(calls.some((call) => call.kind === 'execute'), false);

  const cleanup = result.routes.find((entry) => entry.method === 'POST' && entry.path === 'classes/cleanup-orphaned-students');
  await assert.rejects(
    () => cleanup.handler({ principal: { userId: 'teacher-1', role: 'TEACHER' } }),
    /Administrator access is required/,
  );
});

test('class compatibility reads use plugin-owned rosters with bounded authorization', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes(`SELECT "teacherId", "classAdminId" FROM ${CLASS}`)) return [{ teacherId: 'teacher-1', classAdminId: 'class-admin-1' }];
      if (sql.includes(`SELECT "id" FROM ${CLASS}`)) return [{ id: 'class-1' }];
      if (sql.includes(`WHERE e."classId" = ANY`)) return [{ id: 'student-1', userId: 'user-1', studentNumber: 'S1', classId: 'class-1', className: 'Class A' }];
      if (sql.includes('WHERE e."studentId" IS NULL')) return [{ id: 'student-2', userId: 'user-2', studentNumber: 'S2' }];
      return [];
    },
    execute: async () => ({ count: 0 }),
  };
  const directory = {
    resolveAudience: async ({ targetRole }) => targetRole === 'PARENT' ? [{ id: 'parent-1', name: 'Parent One', email: 'p@example.test', phone: null, role: 'PARENT' }] : [],
    lookupUsers: async (ids) => ids.map((id) => ({ id, name: `User ${id}`, email: null, phone: null, role: 'STUDENT' })),
    lookupClasses: async () => [], classesForUser: async () => [],
  };
  const result = await activate(database, { directory });
  const route = (path) => result.routes.find((entry) => entry.method === 'GET' && entry.path === path);

  await assert.rejects(() => route('classes/parents').handler({ principal: { userId: 'teacher-1', role: 'TEACHER' } }), /Administrator access is required/);
  assert.deepEqual(await route('classes/parents').handler({ principal: { userId: 'admin-1', role: 'ADMIN' } }), [{ id: 'parent-1', name: 'Parent One', email: 'p@example.test', phone: null }]);
  const batch = await route('classes/students/batch').handler({ query: { ids: 'class-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } });
  assert.equal(batch['class-1'][0].className, 'Class A');
  await assert.rejects(() => route('classes/students/batch').handler({ query: { ids: Array.from({ length: 101 }, (_, i) => `c${i}`).join(',') }, principal: { userId: 'admin-1', role: 'ADMIN' } }), /at most 100/);
  const available = await route('classes/:id/available-students').handler({ params: { id: 'class-1' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  assert.equal(available[0].id, 'student-2');
  assert.equal(calls.some((call) => /FROM\s+"(?:Student|Class|User)"/.test(call.sql)), false);
});

test('Academic Management owns Study Year routes while class handlers publish lifecycle events', async () => {
  const events = [];
  const durableEvents = [];
  const timestamp = '2026-09-22T00:00:00.000Z';
  const db = {
    query: async (sql, params = []) => {
      if (sql.includes(`FROM ${CLASS} WHERE "id"`)) return [{ id: params[0] }];
      if (sql.includes(`FROM ${CLASS} c`)) {
        return [{
          id: params[0], name: 'Class A', subject: null, teacherId: 't1', classAdminId: null, studyYearId: null,
          schedule: null, registrationStatus: 'HIDDEN', thumbnail: null, description: null, price: null, showPrice: false,
          createdAt: timestamp, updatedAt: timestamp, teacher: { name: 'Teacher' }, classAdmin: null, studyYear: null,
        }];
      }
      if (sql.includes('FROM "User" WHERE "id"')) return [{ id: params[0], role: 'TEACHER' }];
      if (sql.includes('COUNT(*)::int AS "count"')) return [{ count: 0 }];
      return [];
    },
    execute: async () => ({ count: 1 }),
    transaction: async (fn) => fn({ query: db.query, execute: db.execute, publish: (event) => durableEvents.push(event) }),
  };
  const result = await activate(db, { events });
  const createClass = result.routes.find((r) => r.method === 'POST' && r.path === 'classes');
  const updateClass = result.routes.find((r) => r.method === 'PUT' && r.path === 'classes/:id');
  const deleteClass = result.routes.find((r) => r.method === 'DELETE' && r.path === 'classes/:id');

  assert.deepEqual(result.routes.filter((route) => route.path.startsWith('study-years')).map((route) => `${route.method}:${route.path}`), [
    'GET:study-years', 'GET:study-years/:id', 'POST:study-years', 'PUT:study-years/:id',
    'POST:study-years/:id/set-current', 'DELETE:study-years/:id',
  ]);
  assert.equal(events.some((event) => event.event.startsWith('academic.study-year.')), false);

  events.length = 0;
  await createClass.handler({ body: { name: 'G1', teacherId: 't1', registrationStatus: 'HIDDEN' }, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(events.some((e) => e.event === 'academic.class.created.v1'));

  events.length = 0;
  await updateClass.handler({ params: { id: 'c1' }, body: { name: 'G1A' }, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(events.some((e) => e.event === 'academic.class.updated.v1'));
  const firstUpdateKey = durableEvents.find((event) => event.event === 'wattanam.academic-management.class.updated').idempotencyKey;
  await updateClass.handler({ params: { id: 'c1' }, body: { name: 'G1A' }, principal: { userId: 'a1', role: 'ADMIN' } });
  const updateKeys = durableEvents.filter((event) => event.event === 'wattanam.academic-management.class.updated').map((event) => event.idempotencyKey);
  assert.equal(updateKeys[1], firstUpdateKey);
  assert.doesNotMatch(firstUpdateKey, /\d{13}$/);

  events.length = 0;
  await deleteClass.handler({ params: { id: 'c1' }, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(events.some((e) => e.event === 'academic.class.deleted.v1'));
  assert.ok(events.some((e) => e.event === 'academic.class.deleted.v1'));
});

test('class responses resolve the Academic-owned Study Year namespace', async () => {
  const db = {
    query: async (sql, params = []) => {
      if (sql.includes(`FROM ${CLASS} c`)) return [{ id: params[0] || 'c1', name: 'Class A', teacherId: 't1', classAdminId: null, studyYearId: 'year-1' }];
      if (sql.includes(`FROM ${STUDY_YEAR}`)) return [{ id: 'year-1', year: 2026, label: '2026-2027', isCurrent: true }];
      return [];
    },
    execute: async () => ({ count: 1 }),
    transaction: async (fn) => fn({ query: db.query, execute: db.execute, publish: () => undefined }),
  };
  const result = await activate(db);
  const getClass = result.routes.find((route) => route.method === 'GET' && route.path === 'classes/:id');
  const value = await getClass.handler({ params: { id: 'c1' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  assert.equal(value.studyYear.id, 'year-1');
  assert.equal(value.studyYear.year, 2026);
});

test('publishes historical roster and enrollment contracts with row scope and overlap checks', async () => {
  const db = {
    query: async (sql, params = []) => {
      if (sql.includes(`SELECT "teacherId", "classAdminId" FROM ${CLASS}`)) {
        return [{ teacherId: 'teacher-1', classAdminId: 'class-admin-1' }];
      }
      if (sql.includes(`SELECT "id", "name" FROM ${CLASS}`)) return [{ id: 'class-1', name: 'Grade 1' }];
      if (sql.includes(`SELECT "name" FROM ${CLASS}`)) return [{ name: 'Grade 1' }];
      if (sql.includes(`SELECT "studentId" FROM ${ENROLLMENT}`)) return [{ studentId: 'student-profile-1' }];
      if (sql.includes(`SELECT "classId" FROM ${ENROLLMENT}`)) return [{ classId: 'class-1' }];
      if (sql.includes(`SELECT e."classId" AS "id" FROM ${ENROLLMENT}`)) return [{ id: 'class-1' }];
      if (sql.includes(`SELECT "id", "name" FROM ${CLASS} WHERE "id" = ANY`)) return [{ id: 'class-1', name: 'Grade 1' }];
      if (sql.includes(`FROM ${STUDENT_PROFILE} WHERE "id" = ANY`)) {
        return [{ id: 'student-profile-1', userId: 'student-user-1', studentNumber: '0001', guardianUserId: 'parent-1' }];
      }
      if (sql.includes(`FROM ${STUDENT_PROFILE} WHERE "id" = $1`)) {
        return [{ id: params[0], userId: 'student-user-1', guardianUserId: 'parent-1' }];
      }
      if (sql.includes(`FROM ${STUDENT_PROFILE} WHERE "userId" = $1`)) return [{ id: 'student-profile-1' }];
      if (sql.includes(`FROM ${USER_DEPARTMENT} ud JOIN ${DEPARTMENT} d`)) {
        return sql.includes('AS "departmentId"')
          ? [{ userId: 'student-user-1', departmentId: 'department-1', departmentName: 'Science', departmentNameKh: null }]
          : [{ id: 'department-1', name: 'Science', nameKh: null }];
      }
      if (sql.includes(`FROM ${STUDENT_PROFILE} p LEFT JOIN ${ENROLLMENT}`)) {
        return [{ id: 'student-profile-1', userId: 'student-user-1', studentNumber: '0001', sex: null, photo: null, dateOfBirth: null, address: null, parentId: 'parent-1', classId: 'class-1', className: 'Grade 1' }];
      }
      if (sql.includes(`FROM ${STUDENT_PROFILE} p WHERE p."guardianUserId"`)) return [];
      if (sql.includes(`FROM ${DEPARTMENT} WHERE "id" = $1`)) return [{ id: params[0] }];
      return [];
    },
    execute: async () => ({ count: 0 }),
    transaction: async (fn) => fn({ query: db.query, execute: db.execute, publish: () => undefined }),
  };
  const directory = {
    resolveAudience: async () => [], lookupClasses: async () => [], classesForUser: async () => [],
    lookupUsers: async (ids) => ids.map((id) => ({
      id,
      name: id === 'student-user-1' ? 'Student One' : id,
      role: id === 'teacher-1' ? 'TEACHER' : id === 'parent-1' ? 'PARENT' : 'STUDENT',
    })),
  };
  const result = await activate(db, { directory });
  const rosterRoute = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/classes/:id/roster');
  const enrollmentRoute = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/students/:id/enrollment');
  const audienceRoute = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/classes/:id/audience');
  const classesForUserRoute = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/users/:id/classes');
  const classLookupRoute = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/classes/lookup');
  const departmentRoute = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/users/:id/department');
  const assignDepartmentRoute = result.routes.find((route) => route.method === 'PUT' && route.path === 'commands/users/:id/department');
  const assignGuardianRoute = result.routes.find((route) => route.method === 'PUT' && route.path === 'commands/students/by-user/:id/guardian');
  const detachIdentityRoute = result.routes.find((route) => route.method === 'DELETE' && route.path === 'commands/users/:id/academic-identity');
  const academicProfilesRoute = result.routes.find((route) => route.method === 'POST' && route.path === 'contracts/users/academic-profiles');

  const roster = await rosterRoute.handler({
    params: { id: 'class-1' }, query: { asOfIsoDate: '2026-09-25' },
    principal: { userId: 'teacher-1', role: 'TEACHER' },
  });
  assert.deepEqual(roster.contract, { id: 'wattanam.academic-management.roster', version: '1.0.0' });
  assert.equal(roster.source, 'plugin-enrollment-interval');
  assert.deepEqual(roster.students, [{ studentId: 'student-profile-1', userId: 'student-user-1', studentNumber: '0001', name: 'Student One', parentId: 'parent-1' }]);

  const enrollment = await enrollmentRoute.handler({
    params: { id: 'student-profile-1' }, query: { asOfIsoDate: '2026-09-25' },
    principal: { userId: 'student-user-1', role: 'STUDENT' },
  });
  assert.equal(enrollment.enrolled, true);
  assert.equal(enrollment.classId, 'class-1');
  assert.equal(enrollment.className, 'Grade 1');

  const audience = await audienceRoute.handler({
    params: { id: 'class-1' }, query: {}, principal: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.equal(audience.schemaVersion, 1);
  assert.deepEqual(audience.users.map((user) => user.id), ['teacher-1', 'class-admin-1']);

  const memberships = await classesForUserRoute.handler({
    params: { id: 'student-user-1' }, query: { role: 'STUDENT' }, principal: { userId: 'student-user-1', role: 'STUDENT' },
  });
  assert.deepEqual(memberships.classIds, ['class-1']);

  const lookup = await classLookupRoute.handler({
    params: {}, query: { ids: ['class-1'] }, principal: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.deepEqual(lookup.classes, [{ id: 'class-1', name: 'Grade 1' }]);

  const department = await departmentRoute.handler({
    params: { id: 'teacher-1' }, query: {}, principal: { userId: 'teacher-1', role: 'TEACHER' },
  });
  assert.deepEqual(department.department, { id: 'department-1', name: 'Science', nameKh: null });

  const assigned = await assignDepartmentRoute.handler({
    params: { id: 'teacher-1' }, query: {},
    body: { departmentId: 'department-1', idempotencyKey: 'assign-department:teacher-1:department-1' },
    principal: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.equal(assigned.success, true);
  await assert.rejects(assignDepartmentRoute.handler({
    params: { id: 'teacher-1' }, query: {}, body: { departmentId: null, idempotencyKey: 'wrong' },
    principal: { userId: 'admin-1', role: 'ADMIN' },
  }), /invalid idempotency key/);

  const guardian = await assignGuardianRoute.handler({
    params: { id: 'student-user-1' }, query: {},
    body: { parentId: 'parent-1', idempotencyKey: 'assign-parent:student-user-1:parent-1' },
    principal: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.equal(guardian.success, true);

  const detached = await detachIdentityRoute.handler({
    params: { id: 'student-user-1' }, query: {}, body: { idempotencyKey: 'delete-user:student-user-1' },
    principal: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.equal(detached.success, true);
  assert.equal(detached.studentProfileId, 'student-profile-1');

  const profileEnvelope = await academicProfilesRoute.handler({
    params: {}, query: {}, body: { userIds: ['student-user-1'] }, principal: { userId: 'admin-1', role: 'ADMIN' },
  });
  assert.equal(profileEnvelope.schemaVersion, 1);
  assert.deepEqual(profileEnvelope.profiles[0].department, { id: 'department-1', name: 'Science', nameKh: null });
  assert.deepEqual(profileEnvelope.profiles[0].studentProfile.class, { id: 'class-1', name: 'Grade 1' });

  await assert.rejects(
    rosterRoute.handler({ params: { id: 'class-1' }, query: { asOfIsoDate: '2026-02-30' }, principal: { userId: 'teacher-1', role: 'TEACHER' } }),
    /valid ISO date/,
  );
  await assert.rejects(
    enrollmentRoute.handler({ params: { id: 'student-profile-1' }, query: { asOfIsoDate: '2026-09-25' }, principal: { userId: 'student-user-2', role: 'STUDENT' } }),
    /not authorized/,
  );
});

test('structural class and private admissions routes require an administrator principal', async () => {
  let databaseCalls = 0;
  const db = {
    query: async () => { databaseCalls += 1; return []; },
    execute: async () => { databaseCalls += 1; return { count: 1 }; },
    transaction: async (fn) => {
      databaseCalls += 1;
      return fn({ query: db.query, execute: db.execute, publish: () => undefined });
    },
  };
  const result = await activate(db);
  const teacher = { principal: { userId: 'teacher-1', role: 'TEACHER' } };
  const guarded = [
    ['POST', 'classes', { body: { name: 'Forbidden', teacherId: 'teacher-1', registrationStatus: 'HIDDEN' } }],
    ['PUT', 'classes/:id', { params: { id: 'class-1' }, body: { name: 'Forbidden' } }],
    ['DELETE', 'classes/:id', { params: { id: 'class-1' } }],
    ['GET', 'admissions/settings', {}],
    ['GET', 'admissions/fields', {}],
    ['PATCH', 'admissions/settings', { body: { emailMode: 'REQUIRED' } }],
    ['POST', 'admissions/fields', { body: { label: 'Forbidden' } }],
    ['PATCH', 'admissions/fields/:id', { params: { id: 'field-1' }, body: { label: 'Forbidden' } }],
    ['POST', 'admissions/fields/reorder', { body: { ids: ['field-1'] } }],
    ['DELETE', 'admissions/fields/:id', { params: { id: 'field-1' } }],
    ['GET', 'admissions/registrations', { query: {} }],
    ['GET', 'admissions/registrations/:id', { params: { id: 'registration-1' } }],
    ['PATCH', 'admissions/registrations/:id/resolve', { params: { id: 'registration-1' }, body: { action: 'REJECT' } }],
  ];

  for (const [method, path, request] of guarded) {
    const route = result.routes.find((entry) => entry.method === method && entry.path === path);
    await assert.rejects(route.handler({ ...request, ...teacher }), /Administrator access is required/);
  }
  assert.equal(databaseCalls, 0, 'authorization must fail before any plugin database access');
});

test('admissions write handlers perform namespaced plugin writes', async () => {
  const calls = [];
  const events = [];
  const durableEvents = [];
  const accountCommands = [];
  const notifications = [];
  let classStatus = 'AVAILABLE';
  const registrations = new Map();
  const db = {
    query: async (sql, params = []) => {
      calls.push({ type: 'query', sql, params });
      const tableName = (sql.match(/FROM\s+([a-z0-9_]+)/i) || [])[1];
      if (tableName === REGISTRATION && sql.includes('WHERE "id" =')) {
        const reg = registrations.get(params[0]) || { id: params[0], classId: 'c1', nameEn: 'Student', status: 'PENDING', email: 's@t.test', passwordHash: 'hash' };
        return [reg];
      }
      if (tableName === STUDENT_PROFILE) return [{ id: 'student-profile-1' }];
      if (sql.includes('COUNT(*)')) return [{ count: 0 }];
      if (tableName === CLASS) return [{ id: 'c1', name: 'Class A', registrationStatus: classStatus }];
      if (tableName === SETTINGS) return [{ id: 'singleton', khmerNameMode: 'HIDDEN', phoneMode: 'REQUIRED', emailMode: 'HIDDEN', photoMode: 'HIDDEN', passwordMode: 'HIDDEN', sexMode: 'HIDDEN', dateOfBirthMode: 'HIDDEN', addressMode: 'HIDDEN', generationMode: 'HIDDEN' }];
      if (tableName === FIELD) return [];
      return [];
    },
    execute: async (sql, params = []) => {
      calls.push({ type: 'execute', sql, params });
      if (sql.includes(`INSERT INTO ${REGISTRATION}`)) {
        const id = params[0];
        registrations.set(id, {
          id,
          classId: params[1],
          nameKh: params[2],
          nameEn: params[3],
          email: params[4],
          phone: params[5],
          passwordHash: params[6],
          status: 'PENDING',
        });
      }
      if (sql.includes(`UPDATE ${REGISTRATION}`) && sql.includes("'APPROVED'")) {
        const id = params[3];
        const reg = registrations.get(id) || { id, classId: 'c1', nameEn: 'Student', status: 'PENDING' };
        reg.status = 'APPROVED';
        reg.studentId = params[0];
        registrations.set(id, reg);
      }
      return { count: 1 };
    },
  };
  db.transaction = async (fn) => fn({ ...db, publish: async (event) => durableEvents.push(event) });
  const result = await activate(db, {
    events, notifications,
    accounts: { createStudent: async (input) => { accountCommands.push(input); return { id: 'user-1', name: input.name, role: 'STUDENT', email: input.email, phone: input.phone }; } },
  });
  const submitRoute = result.routes.find((r) => r.method === 'POST' && r.path === 'admissions/public/submit');
  const resolveRoute = result.routes.find((r) => r.method === 'PATCH' && r.path === 'admissions/registrations/:id/resolve');

  const created = await submitRoute.handler({
    method: 'POST', path: 'admissions/public/submit', params: {}, query: {},
    body: { classId: 'c1', nameEn: 'Student', phone: '012345678', customFieldValues: {} },
    principal: { userId: 'system-public-route', role: 'SUPER_ADMIN' },
  });
  assert.equal(created.status, 'PENDING');
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`INSERT INTO ${REGISTRATION}`)));

  calls.length = 0;
  const resolved = await resolveRoute.handler({
    method: 'PATCH', path: 'admissions/registrations/r1/resolve', params: { id: 'r1' }, query: {},
    body: { action: 'APPROVE' },
    principal: { userId: 'a1', role: 'ADMIN' },
  });
  assert.equal(resolved.status, 'APPROVED');
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`UPDATE ${REGISTRATION}`) && c.sql.includes("'APPROVED'")));
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`INSERT INTO ${STUDENT_PROFILE}`)));
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`INSERT INTO ${ENROLLMENT}`)));
  assert.equal(events.length, 0);
  assert.equal(durableEvents[0].event, 'academic.registration.approved.v2');
  assert.deepEqual(accountCommands.map((command) => command.commandKey), ['registration:r1']);
});

test('class student-management writes plugin-owned profiles and enrollment while preserving core identity', async () => {
  const calls = [];
  const db = {
    query: async (sql, params = []) => {
      calls.push({ type: 'query', sql, params });
      if (sql.includes(`FROM ${CLASS} WHERE "id"`)) return [{ id: params[0] }];
      if (sql.includes('COUNT(*)::int AS "count"')) return [{ count: 0 }];
      if (sql.includes(`FROM ${STUDENT_PROFILE} WHERE "id" =`) || sql.includes(`FROM ${STUDENT_PROFILE} WHERE "userId" =`)) return [];
      if (sql.includes(`FROM ${STUDENT_PROFILE} s JOIN ${ENROLLMENT} e`) && sql.includes('WHERE s."id" = $1 AND e."classId" = $2')) {
        if (params[0] === 's1') return [{ id: 's1', userId: 'u1', studentNumber: '0001', classId: 'c1' }];
        return [];
      }
      if (sql.includes(`FROM ${STUDENT_PROFILE} s WHERE NOT EXISTS`)) return [{ id: 's2' }];
      if (sql.includes('FROM "User" WHERE "id"')) {
        if (params[0] === 'p1') return [{ id: 'p1', role: 'PARENT' }];
        return [{ id: params[0], role: 'STUDENT' }];
      }
      if (sql.includes(`FROM ${STUDENT_PROFILE} s JOIN ${ENROLLMENT} e`)) {
        return [{
          id: 's1', userId: 'u1', studentNumber: '0001', nameKh: 'បុប្ផា', qrCode: null, photo: null, sex: null,
          dateOfBirth: null, address: null, generation: null, customFieldValues: null, parentId: null,
          name: 'Bopha', email: 'b@t.test', phone: null, className: 'Class A',
        }];
      }
      return [];
    },
    execute: async (sql, params = []) => { calls.push({ type: 'execute', sql, params }); return { count: 1 }; },
    transaction: async (fn) => fn({ query: db.query, execute: db.execute, publish: () => undefined }),
  };
  const events = [];
  const result = await activate(db, { events });
  const addRoute = result.routes.find((r) => r.method === 'POST' && r.path === 'classes/:id/students');
  const updateRoute = result.routes.find((r) => r.method === 'PATCH' && r.path === 'classes/:classId/students/:studentId');
  const removeRoute = result.routes.find((r) => r.method === 'DELETE' && r.path === 'classes/:id/students/:studentId');
  const cleanupRoute = result.routes.find((r) => r.method === 'POST' && r.path === 'classes/cleanup-orphaned-students');

  await addRoute.handler({ params: { id: 'c1' }, body: { studentId: 'u1' }, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`INSERT INTO ${STUDENT_PROFILE}`)));
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`INSERT INTO ${ENROLLMENT}`)));
  assert.ok(events.some((e) => e.event === 'academic.student.added-to-class.v1' && e.payload.classId === 'c1'));

  calls.length = 0;
  events.length = 0;
  await updateRoute.handler({ params: { classId: 'c1', studentId: 's1' }, body: { nameKh: 'បុប្ផា' }, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(calls.some((c) => c.type === 'query' && c.sql.includes('e."classId" = $2') && c.params[1] === 'c1'));
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`UPDATE ${STUDENT_PROFILE}`)));
  assert.equal(calls.some((c) => c.type === 'execute' && c.sql.includes('UPDATE "User"')), false);
  assert.ok(events.some((e) => e.event === 'academic.student.updated.v1'));

  calls.length = 0;
  events.length = 0;
  await assert.rejects(updateRoute.handler({ params: { classId: 'c1', studentId: 's1' }, body: { parentId: 'u1' }, principal: { userId: 'a1', role: 'ADMIN' } }), /parentId must reference a user with role PARENT/);

  calls.length = 0;
  events.length = 0;
  await removeRoute.handler({ params: { id: 'c1', studentId: 's1' }, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(calls.some((c) => c.type === 'query' && c.sql.includes('e."classId" = $2') && c.params[1] === 'c1'));
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`DELETE FROM ${ENROLLMENT}`)));
  assert.equal(calls.some((c) => c.type === 'execute' && c.sql.includes('DELETE FROM "User"')), false);
  assert.equal(calls.some((c) => c.type === 'execute' && c.sql.includes('DELETE FROM "Student"')), false);
  assert.ok(events.some((e) => e.event === 'academic.student.removed-from-class.v1' && e.payload.studentId === 's1'));

  calls.length = 0;
  events.length = 0;
  await cleanupRoute.handler({ params: {}, body: {}, principal: { userId: 'a1', role: 'ADMIN' } });
  assert.ok(calls.some((c) => c.type === 'execute' && c.sql.includes(`DELETE FROM ${STUDENT_PROFILE}`)));
  assert.equal(calls.some((c) => c.type === 'execute' && c.sql.includes('DELETE FROM "User"')), false);
  assert.ok(events.some((e) => e.event === 'academic.students.cleaned-up.v1' && e.payload.deleted === 1));
});

test('CSV roster import uses controlled account commands and only plugin-owned academic storage', async () => {
  const calls = [];
  const accountCalls = [];
  const durableEvents = [];
  const query = async (sql, params = []) => {
    calls.push({ type: 'query', sql, params });
    if (sql.includes(`FROM ${CLASS}`)) return [{ id: 'class-1' }];
    if (sql.includes(`FROM ${STUDENT_PROFILE} s JOIN ${ENROLLMENT}`)) {
      return params[1] === '0002' ? [{ id: 'profile-existing', userId: 'user-existing' }] : [];
    }
    if (sql.includes(`FROM ${STUDENT_PROFILE} WHERE "userId"`)) return [{ id: 'profile-new' }];
    return [];
  };
  const execute = async (sql, params = []) => { calls.push({ type: 'execute', sql, params }); return { count: 1 }; };
  const database = {
    query, execute,
    transaction: async (fn) => fn({ query, execute, publish: async (event) => durableEvents.push(event) }),
  };
  const result = await activate(database, {
    accounts: {
      createStudent: async (input) => { accountCalls.push({ method: 'create', input }); return { id: 'user-new', name: input.name, role: 'STUDENT', email: input.email, phone: input.phone }; },
      updateStudent: async (input) => { accountCalls.push({ method: 'update', input }); return { id: input.userId, name: input.name, role: 'STUDENT', email: input.email, phone: input.phone }; },
    },
  });
  const route = result.routes.find((entry) => entry.method === 'POST' && entry.path === 'classes/:id/students/bulk-csv');
  const response = await route.handler({
    params: { id: 'class-1' }, principal: { userId: 'admin-1', role: 'ADMIN' },
    body: { csv: 'ID,Name,Email,Password,Sex\n0001,New Student,new@example.test,secret1,FEMALE\n0002,Existing Student,existing@example.test,,MALE' },
  });

  assert.deepEqual({ total: response.total, success: response.success, errors: response.errors, skipped: response.skipped }, { total: 2, success: 2, errors: 0, skipped: 0 });
  assert.deepEqual(accountCalls.map((entry) => entry.method), ['create', 'update']);
  assert.equal(accountCalls[0].input.commandKey, 'csv-create:class-1:0001');
  assert.match(accountCalls[1].input.commandKey, /^csv-update:class-1:0002:[a-f0-9]{20}$/);
  assert.ok(calls.some((call) => call.type === 'execute' && call.sql.includes(`INSERT INTO ${STUDENT_PROFILE}`)));
  assert.ok(calls.some((call) => call.type === 'execute' && call.sql.includes(`INSERT INTO ${ENROLLMENT}`)));
  assert.ok(calls.some((call) => call.type === 'execute' && call.sql.includes(`UPDATE ${STUDENT_PROFILE}`)));
  assert.equal(calls.some((call) => /\b(?:"User"|"Student"|"Class")\b/.test(call.sql || '')), false);
  assert.equal(durableEvents[0].event, 'wattanam.academic-management.student.imported');
});

test('manifest, UI, and additive namespaced migrations align with the preflight contract', () => {
  const manifest = json('plugins/wattanam.academic-management/plugin.json');
  const page = json('plugins/wattanam.academic-management/frontend/page.json');
  const backendSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/backend/index.js'), 'utf8');
  assert.ok(manifest.capabilities.includes('directory.read'));
  assert.doesNotMatch(backendSource, /\b(?:FROM|JOIN|UPDATE|INTO)\s+"(?:User|Department|Student|Class|StudyYear|ClassRegistration)"/);
  assert.equal(page.pages[0].permission, 'wattanam.academic-management.view');
  assert.equal(page.pages[0].dataSources.length, 2);
  assert.equal(page.pages[0].dataSources[0].method, 'GET');
  const pageIds = page.pages.map((p) => p.id);
  assert.ok(pageIds.includes('study-years'));
  assert.ok(pageIds.includes('study-year-edit'));
  assert.ok(pageIds.includes('classes'));
  assert.ok(pageIds.includes('subjects'));
  assert.ok(pageIds.includes('department-edit'));
  assert.ok(pageIds.includes('subject-edit'));
  assert.ok(pageIds.includes('class-detail'));
  assert.ok(pageIds.includes('class-edit'));
  assert.ok(pageIds.includes('class-students'));
  assert.ok(pageIds.includes('class-student-edit'));
  assert.ok(pageIds.includes('registrations'));
  assert.ok(pageIds.includes('registration-detail'));
  const departmentsPage = page.pages.find((p) => p.id === 'departments');
  assert.equal(departmentsPage.components.find((component) => component.id === 'departments-table').options.rowRoute, 'departments/edit/:id');
  assert.ok(departmentsPage.dataSources.some((source) => source.id === 'createDepartment' && source.method === 'POST'));
  const departmentEditPage = page.pages.find((p) => p.id === 'department-edit');
  assert.ok(departmentEditPage.dataSources.some((source) => source.id === 'department' && source.method === 'GET'));
  assert.ok(departmentEditPage.dataSources.some((source) => source.id === 'saveDepartment' && source.method === 'PUT'));
  const subjectsPage = page.pages.find((p) => p.id === 'subjects');
  const subjectsTable = subjectsPage.components.find((component) => component.id === 'subjects-table');
  assert.equal(subjectsTable.options.rowRoute, 'subjects/edit/:id');
  const subjectEditPage = page.pages.find((p) => p.id === 'subject-edit');
  assert.deepEqual(subjectEditPage.parameters, [{ name: 'id', type: 'string', maximumLength: 64 }]);
  assert.ok(subjectEditPage.dataSources.some((source) => source.id === 'subject' && source.method === 'GET'));
  assert.ok(subjectEditPage.dataSources.some((source) => source.id === 'saveSubject' && source.method === 'PUT'));
  assert.equal(subjectEditPage.components.find((component) => component.id === 'subject-edit-form').options.initialSource, 'subject');
  const studentPage = page.pages.find((p) => p.id === 'class-students');
  const studentTable = studentPage.components.find((component) => component.id === 'class-students-table');
  const studentActions = studentPage.components.find((component) => component.id === 'student-actions');
  assert.equal(studentTable.options.selectable, true);
  assert.equal(studentTable.options.rowRoute, 'classes/:id/students/:studentId');
  assert.ok(studentPage.dataSources.some((source) => source.id === 'removeStudent' && source.method === 'DELETE' && source.autoload === false));
  assert.ok(studentPage.dataSources.some((source) => source.id === 'cleanupOrphanedStudents' && source.method === 'POST'));
  assert.deepEqual(studentActions.options.actions.map((action) => action.id), ['remove-selected-students', 'cleanup-orphaned-students']);
  const studentEditPage = page.pages.find((p) => p.id === 'class-student-edit');
  assert.ok(studentEditPage.dataSources.some((source) => source.id === 'student' && source.method === 'GET'));
  assert.ok(studentEditPage.dataSources.some((source) => source.id === 'saveStudent' && source.method === 'PATCH'));
  const navIds = manifest.navigation.map((n) => n.id);
  assert.ok(navIds.includes('study-years'));
  assert.ok(navIds.includes('classes'));
  assert.ok(navIds.includes('subjects'));
  assert.ok(navIds.includes('registrations'));
  assert.equal(manifest.migrations.length, 10);
  for (const migration of manifest.migrations) {
    const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management', migration.path), 'utf8');
    assert.equal((sql.match(/;/g) || []).length, 1);
    assert.match(sql, /CREATE TABLE "plugin_wattanam_academic_management_/);
    assert.doesNotMatch(sql, /^\s*(?:DROP|ALTER|TRUNCATE|DELETE)\b/im);
  }
  const enrollmentSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/003_create_enrollment_interval.sql'), 'utf8');
  assert.match(enrollmentSql, /academic_enrollment_valid_range/);
  assert.match(enrollmentSql, /academic_enrollment_one_current/);
  const studyYearSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/004_create_study_year.sql'), 'utf8');
  assert.match(studyYearSql, /academic_study_year_unique_year/);
  assert.match(studyYearSql, /academic_study_year_one_current/);
  const classSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/005_create_class.sql'), 'utf8');
  assert.match(classSql, /registrationStatus/);
  assert.match(classSql, /showPrice/);
  const registrationSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/006_create_class_registration.sql'), 'utf8');
  assert.match(registrationSql, /customFieldValues/);
  assert.match(registrationSql, /passwordHash/);
  const registrationSettingsSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/007_create_class_registration_settings.sql'), 'utf8');
  assert.match(registrationSettingsSql, /passwordMode/);
  const registrationFieldSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/008_create_class_registration_field.sql'), 'utf8');
  assert.match(registrationFieldSql, /fieldType/);
  assert.match(registrationFieldSql, /options/);
  const studentProfileSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/009_create_student_profile.sql'), 'utf8');
  assert.match(studentProfileSql, /"userId" TEXT NOT NULL UNIQUE/);
  assert.match(studentProfileSql, /"customFieldValues" JSONB/);
  assert.doesNotMatch(studentProfileSql, /REFERENCES\s+"(?:User|Student|Class)"/);
  const subjectSql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'plugins/wattanam.academic-management/migrations/010_create_subject.sql'), 'utf8');
  assert.match(subjectSql, /academic_subject_code/);
  assert.match(subjectSql, /"code" TEXT NOT NULL UNIQUE/);
});

test('canonical teaching-subject contract is administrator-managed and uses only plugin-owned storage', async () => {
  const calls = [];
  const row = { id: 'subject-1', code: 'MATH', name: 'Mathematics', nameKh: null, description: null, active: true };
  const tx = {
    execute: async (sql, params) => { calls.push({ type: 'execute', sql, params }); return { count: 1 }; },
    query: async (sql, params) => { calls.push({ type: 'query', sql, params }); return [row]; },
    publish: (event) => calls.push({ type: 'publish', event }),
  };
  const database = {
    query: async (sql, params) => { calls.push({ type: 'query', sql, params }); return [row]; },
    execute: async () => ({ count: 0 }),
    transaction: async (fn) => fn(tx),
  };
  const result = await activate(database);
  const detail = result.routes.find((route) => route.method === 'GET' && route.path === 'subjects/:id');
  const create = result.routes.find((route) => route.method === 'POST' && route.path === 'subjects');
  const contract = result.routes.find((route) => route.method === 'GET' && route.path === 'contracts/subjects');

  await assert.rejects(
    () => create.handler({ body: { code: 'MATH', name: 'Mathematics' }, principal: { userId: 't1', role: 'TEACHER' } }),
    /Administrator access is required/,
  );
  assert.equal(calls.length, 0);

  const found = await detail.handler({ params: { id: 'legacy-subject-abcd' } });
  assert.deepEqual(found, row);
  assert.ok(calls.some((call) => call.type === 'query' && call.params[0] === 'legacy-subject-abcd'));

  const created = await create.handler({ body: { code: 'math', name: 'Mathematics' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  assert.equal(created.code, 'MATH');
  assert.ok(calls.some((call) => call.type === 'execute' && call.sql.includes('plugin_wattanam_academic_management_subject')));
  assert.ok(calls.some((call) => call.type === 'publish' && call.event.event === 'wattanam.academic-management.subject.created'));
  assert.equal(calls.some((call) => /\b(?:User|Class|TimetableSubject)\b/.test(call.sql || '')), false);

  const payload = await contract.handler();
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(payload.subjects, [row]);
});

test('department lifecycle is administrator-managed, namespaced, and clears memberships atomically', async () => {
  const calls = [];
  const row = { id: 'department-1', name: 'Science', nameKh: null, description: null };
  const tx = {
    execute: async (sql, params) => { calls.push({ type: 'execute', sql, params }); return { count: 1 }; },
    query: async (sql, params) => { calls.push({ type: 'query', sql, params }); return [row]; },
    publish: (event) => calls.push({ type: 'publish', event }),
  };
  const database = {
    query: async (sql, params) => { calls.push({ type: 'query', sql, params }); return [row]; },
    execute: async () => ({ count: 0 }),
    transaction: async (fn) => fn(tx),
  };
  const result = await activate(database);
  const create = result.routes.find((route) => route.method === 'POST' && route.path === 'departments');
  const update = result.routes.find((route) => route.method === 'PUT' && route.path === 'departments/:id');
  const remove = result.routes.find((route) => route.method === 'DELETE' && route.path === 'departments/:id');

  await assert.rejects(
    () => create.handler({ body: { name: 'Science' }, principal: { userId: 'teacher-1', role: 'TEACHER' } }),
    /Administrator access is required/,
  );
  assert.equal(calls.length, 0);

  await create.handler({ body: { name: 'Science' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  await update.handler({ params: { id: 'department-1' }, body: { name: 'Natural Sciences' }, principal: { userId: 'admin-1', role: 'ADMIN' } });
  await assert.rejects(
    () => remove.handler({ params: { id: 'department-1' }, body: { idempotencyKey: 'wrong' }, principal: { userId: 'admin-1', role: 'ADMIN' } }),
    /invalid idempotency key/,
  );
  await remove.handler({ params: { id: 'department-1' }, body: { idempotencyKey: 'delete-department:department-1' }, principal: { userId: 'admin-1', role: 'ADMIN' } });

  assert.ok(calls.some((call) => call.type === 'execute' && call.sql.includes('plugin_wattanam_academic_management_user_department') && call.sql.includes('DELETE')));
  assert.equal(calls.some((call) => /\b(?:User|Department)\b/.test(call.sql || '')), false);
  assert.deepEqual(calls.filter((call) => call.type === 'publish').map((call) => call.event.event), [
    'wattanam.academic-management.department.created',
    'wattanam.academic-management.department.updated',
    'wattanam.academic-management.department.deleted',
  ]);
});
