/**
 * ============================================================================
 * WATTAMAN - Full Workflow E2E Test Suite
 * ============================================================================
 * Tests the complete attendance system workflow:
 *
 * 1. AUTH & USERS:     Login as admin, create users with various roles
 * 2. STUDY YEARS:      Create study year, set as current
 * 3. CLASSES:          Create class, assign teacher, add students (manual + CSV)
 * 4. SESSION CONFIG:   Set check-in/out times, attendance format rules
 * 5. ATTENDANCE:       Teacher login → scan students → permission → submit
 * 6. REPORTS:          Verify reports, dashboard, print/export
 * ============================================================================
 */

import * as supertest from 'supertest';

// ─── Configuration ──────────────────────────────────────────────────────────
const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const api = supertest.default(API_BASE);

// ─── Shared State (populated during test execution) ─────────────────────────
const state: {
  adminToken: string;
  teacherToken: string;
  studentToken: string;
  adminUser: any;
  teacherUser: any;
  studentUsers: any[];
  parentUser: any;
  studyYearId: string;
  classId: string;
  studentIds: string[];       // student profile IDs
  studentUserIds: string[];   // user IDs
  departmentId: string;
  attendanceIds: string[];
} = {
  adminToken: '',
  teacherToken: '',
  studentToken: '',
  adminUser: null,
  teacherUser: null,
  studentUsers: [],
  parentUser: null,
  studyYearId: '',
  classId: '',
  studentIds: [],
  studentUserIds: [],
  departmentId: '',
  attendanceIds: [],
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function todayStr(): string {
  // Format as YYYY-MM-DD in local time
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayTime(hours: number, minutes: number): string {
  // Return ISO datetime for today at specified HH:mm UTC
  return `${todayStr()}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`;
}

const TEST_PREFIX = `e2etest_${Date.now()}`;
const TEACHER_EMAIL = `${TEST_PREFIX}_teacher@test.com`;
const TEACHER_PASSWORD = 'TestPass123!';
const STUDENT_EMAILS = [
  `${TEST_PREFIX}_student1@test.com`,
  `${TEST_PREFIX}_student2@test.com`,
  `${TEST_PREFIX}_student3@test.com`,
];
const PARENT_EMAIL = `${TEST_PREFIX}_parent@test.com`;

// ─── Increase timeout for E2E tests ────────────────────────────────────────
jest.setTimeout(120_000);

// ============================================================================
// PHASE 1: AUTH & USER MANAGEMENT
// ============================================================================
describe('Phase 1: Auth & User Management', () => {

  it('1.1 - Should login as admin', async () => {
    const res = await api
      .post('/auth/login')
      .send({ email: 'admin@test.com', password: 'password' })
      .expect(201);

    expect(res.body).toHaveProperty('access_token');
    expect(res.body.user).toHaveProperty('role', 'ADMIN');
    state.adminToken = res.body.access_token;
    state.adminUser = res.body.user;
    console.log('  ✓ Admin login successful, role:', res.body.user.role);
  });

  it('1.2 - Should get current user info (GET /auth/me)', async () => {
    const res = await api
      .get('/auth/me')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('email');
    expect(res.body).toHaveProperty('role', 'ADMIN');
    console.log('  ✓ /me returned:', res.body.email, res.body.role);
  });

  it('1.3 - Should create a department', async () => {
    const res = await api
      .post('/departments')
      .set(authHeader(state.adminToken))
      .send({ name: `${TEST_PREFIX}_TestDept`, nameKh: 'ផ្នែកតេស្ត', description: 'Test department' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    state.departmentId = res.body.id;
    console.log('  ✓ Department created:', res.body.id);
  });

  it('1.4 - Should register a TEACHER user', async () => {
    const res = await api
      .post('/auth/register')
      .set(authHeader(state.adminToken))
      .send({
        email: TEACHER_EMAIL,
        password: TEACHER_PASSWORD,
        name: 'E2E Test Teacher',
        role: 'TEACHER',
        departmentId: state.departmentId,
      })
      .expect(201);

    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('role', 'TEACHER');
    state.teacherUser = res.body.user;
    console.log('  ✓ Teacher created:', res.body.user.id, res.body.user.email);
  });

  it('1.5 - Should register a PARENT user', async () => {
    const res = await api
      .post('/auth/register')
      .set(authHeader(state.adminToken))
      .send({
        email: PARENT_EMAIL,
        password: 'ParentPass123!',
        name: 'E2E Test Parent',
        role: 'PARENT',
      })
      .expect(201);

    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    state.parentUser = res.body.user;
    console.log('  ✓ Parent created:', res.body.user.id);
  });

  it('1.6 - Should register STUDENT users (3 students)', async () => {
    for (let i = 0; i < STUDENT_EMAILS.length; i++) {
      const res = await api
        .post('/auth/register')
        .set(authHeader(state.adminToken))
        .send({
          email: STUDENT_EMAILS[i],
          password: 'StudentPass123!',
          name: `E2E Student ${i + 1}`,
          role: 'STUDENT',
        })
        .expect(201);

      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('id');
      state.studentUsers.push(res.body.user);
      state.studentUserIds.push(res.body.user.id);
      console.log(`  ✓ Student ${i + 1} created:`, res.body.user.id);
    }
    expect(state.studentUsers).toHaveLength(3);
  });

  it('1.7 - Should register users with various roles (bulk)', async () => {
    const bulkUsers = [
      { email: `${TEST_PREFIX}_officer@test.com`, password: 'Pass123!', name: 'E2E Officer', role: 'OFFICER' },
      { email: `${TEST_PREFIX}_staff@test.com`, password: 'Pass123!', name: 'E2E Staff', role: 'STAFF' },
      { email: `${TEST_PREFIX}_hr@test.com`, password: 'Pass123!', name: 'E2E HR Manager', role: 'HR_MANAGER' },
    ];

    const res = await api
      .post('/auth/users/bulk')
      .set(authHeader(state.adminToken))
      .send({ users: bulkUsers })
      .expect(201);

    // API returns { count: N }
    expect(res.body).toHaveProperty('count');
    expect(res.body.count).toBeGreaterThanOrEqual(3);
    console.log('  ✓ Bulk users created:', res.body.count);
  });

  it('1.8 - Should list users by role', async () => {
    const res = await api
      .get('/auth/users?role=TEACHER')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((u: any) => u.email === TEACHER_EMAIL);
    expect(found).toBeDefined();
    console.log('  ✓ Listed TEACHER users, found our test teacher');
  });

  it('1.9 - Should search users by name', async () => {
    const res = await api
      .get('/auth/users/search?q=E2E')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    console.log('  ✓ Search returned', res.body.length, 'results for "E2E"');
  });

  it('1.10 - Teacher should login successfully', async () => {
    const res = await api
      .post('/auth/login')
      .send({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD })
      .expect(201);

    expect(res.body).toHaveProperty('access_token');
    expect(res.body.user.role).toBe('TEACHER');
    state.teacherToken = res.body.access_token;
    console.log('  ✓ Teacher login successful');
  });

  it('1.11 - Should reject login with wrong password', async () => {
    await api
      .post('/auth/login')
      .send({ email: TEACHER_EMAIL, password: 'WrongPassword' })
      .expect(401);
    console.log('  ✓ Wrong password correctly rejected');
  });

  it('1.12 - Should update a user', async () => {
    const res = await api
      .put(`/auth/users/${state.teacherUser.id}`)
      .set(authHeader(state.adminToken))
      .send({ name: 'E2E Test Teacher Updated', phone: '012345678' })
      .expect(200);

    expect(res.body.name).toBe('E2E Test Teacher Updated');
    console.log('  ✓ Teacher updated:', res.body.name);
  });
});

// ============================================================================
// PHASE 2: STUDY YEARS
// ============================================================================
describe('Phase 2: Study Year Management', () => {

  it('2.1 - Should create a study year', async () => {
    const res = await api
      .post('/study-years')
      .set(authHeader(state.adminToken))
      .send({
        year: 9999,
        label: 'E2E Test Year 9999-10000',
        startDate: '2026-09-01',
        endDate: '2027-06-30',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.year).toBe(9999);
    state.studyYearId = res.body.id;
    console.log('  ✓ Study year created:', res.body.id, res.body.label);
  });

  it('2.2 - Should set study year as current', async () => {
    const res = await api
      .post(`/study-years/${state.studyYearId}/set-current`)
      .set(authHeader(state.adminToken))
      .expect(201);

    expect(res.body.isCurrent).toBe(true);
    console.log('  ✓ Study year set as current');
  });

  it('2.3 - Should get current study year', async () => {
    const res = await api
      .get('/study-years/current')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body.id).toBe(state.studyYearId);
    console.log('  ✓ Current study year confirmed:', res.body.label);
  });

  it('2.4 - Should list all study years', async () => {
    const res = await api
      .get('/study-years')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    console.log('  ✓ Study years listed:', res.body.length);
  });
});

// ============================================================================
// PHASE 3: CLASS MANAGEMENT
// ============================================================================
describe('Phase 3: Class Creation & Student Management', () => {

  it('3.1 - Should create a class', async () => {
    const res = await api
      .post('/classes')
      .set(authHeader(state.adminToken))
      .send({
        name: `${TEST_PREFIX}_Class_A`,
        subject: 'Mathematics',
        teacherId: state.teacherUser.id,
        studyYearId: state.studyYearId,
        schedule: JSON.stringify({
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: false,
          sunday: false,
        }),
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toContain('Class_A');
    state.classId = res.body.id;
    console.log('  ✓ Class created:', res.body.id, res.body.name);
  });

  it('3.2 - Should add students to class manually (one by one)', async () => {
    for (const studentUser of state.studentUsers) {
      const res = await api
        .post(`/classes/${state.classId}/students`)
        .set(authHeader(state.adminToken))
        .send({ studentId: studentUser.id })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      state.studentIds.push(res.body.id);
      console.log(`  ✓ Student added to class: user=${studentUser.id} → student=${res.body.id}`);
    }
    expect(state.studentIds).toHaveLength(3);
  });

  it('3.3 - Should get students in class', async () => {
    const res = await api
      .get(`/classes/${state.classId}/students`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);
    console.log('  ✓ Class has', res.body.length, 'students');

    // Store QR codes for later use
    for (const s of res.body) {
      console.log(`    Student: ${s.studentNumber} - ${s.user?.name} (QR: ${s.qrCode})`);
    }
  });

  it('3.4 - Should bulk-add students via CSV', async () => {
    const csvContent = [
      'id,name,sex,email,password',
      `4,CSV Student One,MALE,${TEST_PREFIX}_csv1@test.com,Pass123!`,
      `5,CSV Student Two,FEMALE,${TEST_PREFIX}_csv2@test.com,Pass123!`,
      `6,CSV Student Three,MALE,${TEST_PREFIX}_csv3@test.com,Pass123!`,
    ].join('\n');

    const res = await api
      .post(`/classes/${state.classId}/students/bulk-csv`)
      .set(authHeader(state.adminToken))
      .attach('file', Buffer.from(csvContent), 'students.csv')
      .expect(201);

    expect(res.body).toHaveProperty('success');
    expect(res.body.success).toBeGreaterThanOrEqual(3);
    console.log('  ✓ Bulk CSV import:', res.body.success, 'students added, total:', res.body.total);
  });

  it('3.5 - Should verify total students after bulk add', async () => {
    const res = await api
      .get(`/classes/${state.classId}/students`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(6);
    console.log('  ✓ Total students in class after bulk:', res.body.length);

    // Update studentIds to include all
    state.studentIds = res.body.map((s: any) => s.id);
  });

  it('3.6 - Should update a student', async () => {
    const res = await api
      .patch(`/classes/${state.classId}/students/${state.studentIds[0]}`)
      .set(authHeader(state.adminToken))
      .send({ name: 'E2E Student 1 Updated', sex: 'MALE' })
      .expect(200);

    console.log('  ✓ Student updated');
  });

  it('3.7 - Should list classes (with filter)', async () => {
    const res = await api
      .get(`/classes?teacherId=${state.teacherUser.id}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const found = res.body.find((c: any) => c.id === state.classId);
    expect(found).toBeDefined();
    console.log('  ✓ Teacher classes listed:', res.body.length);
  });
});

// ============================================================================
// PHASE 4: SESSION CONFIG & ATTENDANCE FORMAT RULES
// ============================================================================
describe('Phase 4: Session Config & Format Rules', () => {

  it('4.1 - Should set global session config (4 sessions)', async () => {
    const configs = [
      { session: 1, type: 'CHECK_IN',  startTime: '07:00', endTime: '07:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:15' },
      { session: 3, type: 'CHECK_IN',  startTime: '13:00', endTime: '13:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:15' },
    ];

    const res = await api
      .post('/session-config')
      .set(authHeader(state.adminToken))
      .send({ configs })
      .expect(201);

    // API returns an array of saved configs
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
    console.log('  ✓ Global session config saved:', res.body.length, 'sessions');
  });

  it('4.2 - Should get global session config', async () => {
    const res = await api
      .get('/session-config/global')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    console.log('  ✓ Global configs retrieved:', res.body.length, 'items');
    for (const c of res.body) {
      console.log(`    Session ${c.session}: ${c.type} ${c.startTime}-${c.endTime}`);
    }
  });

  it('4.3 - Should set class-specific session config', async () => {
    const configs = [
      { session: 1, type: 'CHECK_IN',  startTime: '07:30', endTime: '07:45' },
      { session: 2, type: 'CHECK_OUT', startTime: '11:30', endTime: '11:45' },
      { session: 3, type: 'CHECK_IN',  startTime: '13:30', endTime: '13:45' },
      { session: 4, type: 'CHECK_OUT', startTime: '16:30', endTime: '16:45' },
    ];

    const res = await api
      .post('/session-config')
      .set(authHeader(state.adminToken))
      .send({ classId: state.classId, configs })
      .expect(201);

    // API returns an array of saved configs
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
    console.log('  ✓ Class-specific session config saved');
  });

  it('4.4 - Should get class-specific session config', async () => {
    const res = await api
      .get(`/session-config?classId=${state.classId}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    for (const c of res.body) {
      // Should reflect custom times, not global defaults
      if (c.session === 1) {
        expect(c.startTime).toBe('07:30');
      }
    }
    console.log('  ✓ Class config verified with custom times');
  });

  it('4.5 - Should set staff session config', async () => {
    const configs = [
      { session: 1, type: 'CHECK_IN',  startTime: '07:00', endTime: '07:30' },
      { session: 2, type: 'CHECK_OUT', startTime: '11:30', endTime: '12:00' },
      { session: 3, type: 'CHECK_IN',  startTime: '13:00', endTime: '13:30' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:30' },
    ];

    const res = await api
      .post('/session-config')
      .set(authHeader(state.adminToken))
      .send({ scope: 'STAFF', configs })
      .expect(201);

    console.log('  ✓ Staff session config saved');
  });

  it('4.6 - Should get staff session config', async () => {
    const res = await api
      .get('/session-config/staff')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    console.log('  ✓ Staff configs retrieved:', res.body.length, 'items');
  });

  it('4.7 - Should set attendance format rules (CLASS scope)', async () => {
    const res = await api
      .post('/session-config/format-rules')
      .set(authHeader(state.adminToken))
      .send({
        scope: 'CLASS',
        permissionsPerAbsent: 3,
        latesPerAbsentHalf: 3,
        enabled: true,
      })
      .expect(201);

    console.log('  ✓ Class format rules saved:', JSON.stringify(res.body));
  });

  it('4.8 - Should get attendance format rules', async () => {
    const res = await api
      .get('/session-config/format-rules?scope=CLASS')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('permissionsPerAbsent', 3);
    expect(res.body).toHaveProperty('latesPerAbsentHalf', 3);
    expect(res.body).toHaveProperty('enabled', true);
    console.log('  ✓ Format rules verified:', res.body);
  });

  it('4.9 - Should set attendance format rules (STAFF scope)', async () => {
    const res = await api
      .post('/session-config/format-rules')
      .set(authHeader(state.adminToken))
      .send({
        scope: 'STAFF',
        permissionsPerAbsent: 2,
        latesPerAbsentHalf: 4,
        enabled: true,
      })
      .expect(201);

    console.log('  ✓ Staff format rules saved');
  });
});

// ============================================================================
// PHASE 5: TAKE ATTENDANCE
// ============================================================================
describe('Phase 5: Teacher Takes Attendance', () => {

  it('5.1 - Teacher login', async () => {
    const res = await api
      .post('/auth/login')
      .send({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD })
      .expect(201);

    state.teacherToken = res.body.access_token;
    console.log('  ✓ Teacher logged in for attendance');
  });

  it('5.2 - Teacher views their classes', async () => {
    const res = await api
      .get(`/classes?teacherId=${state.teacherUser.id}`)
      .set(authHeader(state.teacherToken))
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(1);
    console.log('  ✓ Teacher sees', res.body.length, 'classes');
  });

  it('5.3 - Teacher gets student list for attendance', async () => {
    const res = await api
      .get(`/classes/${state.classId}/students`)
      .set(authHeader(state.teacherToken))
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(3);
    console.log('  ✓ Students loaded for scanning:', res.body.length);
  });

  it('5.4 - Record attendance: Student 1 = PRESENT (scan QR)', async () => {
    const res = await api
      .post('/attendance/record')
      .set(authHeader(state.teacherToken))
      .send({
        studentId: state.studentIds[0],
        classId: state.classId,
        status: 'PRESENT',
        session: 1,
        date: todayStr(),
        checkInTime: todayTime(0, 30),
        latitude: 11.5564,
        longitude: 104.9282,
        location: 'Phnom Penh, Cambodia',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    state.attendanceIds.push(res.body.id);
    console.log('  ✓ Student 1 marked PRESENT:', res.body.id);
  });

  it('5.5 - Record attendance: Student 2 = LATE (arrived late)', async () => {
    const res = await api
      .post('/attendance/record')
      .set(authHeader(state.teacherToken))
      .send({
        studentId: state.studentIds[1],
        classId: state.classId,
        status: 'LATE',
        session: 1,
        date: todayStr(),
        checkInTime: todayTime(0, 50),
        latitude: 11.5564,
        longitude: 104.9282,
        location: 'Phnom Penh',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    state.attendanceIds.push(res.body.id);
    console.log('  ✓ Student 2 marked LATE:', res.body.id);
  });

  it('5.6 - Record attendance: Student 3 = DAY_OFF (permission)', async () => {
    const res = await api
      .post('/attendance/record')
      .set(authHeader(state.teacherToken))
      .send({
        studentId: state.studentIds[2],
        classId: state.classId,
        status: 'DAY_OFF',
        session: 1,
        date: todayStr(),
        checkInTime: todayTime(0, 30),
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    state.attendanceIds.push(res.body.id);
    console.log('  ✓ Student 3 marked DAY_OFF (permission):', res.body.id);
  });

  it('5.7 - Bulk attendance for remaining students (session 1)', async () => {
    // Get remaining students that haven't been marked
    const remainingStudentIds = state.studentIds.slice(3);
    if (remainingStudentIds.length === 0) {
      console.log('  ⏭ No remaining students for bulk');
      return;
    }

    const records = remainingStudentIds.map((sid) => ({
      studentId: sid,
      status: 'PRESENT',
      checkInTime: todayTime(0, 35),
    }));

    const res = await api
      .post('/attendance/bulk')
      .set(authHeader(state.teacherToken))
      .send({
        classId: state.classId,
        session: 1,
        date: todayStr(),
        records,
        latitude: 11.5564,
        longitude: 104.9282,
        location: 'Phnom Penh',
      })
      .expect(201);

    console.log('  ✓ Bulk attendance recorded for', remainingStudentIds.length, 'students');
  });

  it('5.8 - Verify attendance records for today', async () => {
    const res = await api
      .get(`/attendance/records?classId=${state.classId}&date=${todayStr()}`)
      .set(authHeader(state.teacherToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);

    // Records are { studentId, studentName, sessions: [{session, status, ...}] }
    const session1Statuses = res.body.map((r: any) => r.sessions?.[0]?.status).filter(Boolean);
    expect(session1Statuses).toContain('PRESENT');
    expect(session1Statuses).toContain('LATE');
    expect(session1Statuses).toContain('DAY_OFF');
    console.log('  ✓ Attendance records verified:', res.body.length, 'records');
    console.log('    Status distribution:', JSON.stringify(
      session1Statuses.reduce((acc: any, s: string) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {})
    ));
  });

  it('5.9 - Record session 2 CHECK_OUT', async () => {
    const res = await api
      .post('/attendance/check-out')
      .set(authHeader(state.teacherToken))
      .send({
        studentId: state.studentIds[0],
        classId: state.classId,
        session: 2,
        date: todayStr(),
      })
      .expect(201);

    console.log('  ✓ Student 1 checked out (session 2)');
  });

  it('5.10 - Record afternoon session (session 3 CHECK_IN)', async () => {
    const records = state.studentIds.slice(0, 3).map((sid) => ({
      studentId: sid,
      status: 'PRESENT',
      checkInTime: todayTime(6, 30),
    }));

    const res = await api
      .post('/attendance/bulk')
      .set(authHeader(state.teacherToken))
      .send({
        classId: state.classId,
        session: 3,
        date: todayStr(),
        records,
      })
      .expect(201);

    console.log('  ✓ Afternoon session 3 attendance recorded');
  });

  it('5.11 - Admin edits attendance record (change status)', async () => {
    if (!state.attendanceIds[0]) {
      console.log('  ⏭ No attendance ID to edit');
      return;
    }

    const res = await api
      .patch('/attendance/update')
      .set(authHeader(state.adminToken))
      .send({
        attendanceId: state.attendanceIds[0],
        status: 'LATE',
      })
      .expect(200);

    console.log('  ✓ Admin edited attendance to LATE:', state.attendanceIds[0]);
  });

  it('5.12 - Admin manually creates attendance record', async () => {
    const res = await api
      .post('/attendance/create-record')
      .set(authHeader(state.adminToken))
      .send({
        studentId: state.studentIds[0],
        classId: state.classId,
        session: 4,
        status: 'PRESENT',
        date: todayStr(),
      })
      .expect(201);

    console.log('  ✓ Admin manually created attendance record for session 4');
  });
});

// ============================================================================
// PHASE 6: STAFF ATTENDANCE
// ============================================================================
describe('Phase 6: Staff/Employee Attendance', () => {

  it('6.1 - Record staff attendance for teacher', async () => {
    const res = await api
      .post('/attendance/staff/record')
      .set(authHeader(state.adminToken))
      .send({
        userId: state.teacherUser.id,
        status: 'PRESENT',
        session: 1,
        date: todayStr(),
        checkInTime: todayTime(0, 5),
        latitude: 11.5564,
        longitude: 104.9282,
        location: 'School Campus',
      })
      .expect(201);

    console.log('  ✓ Staff attendance recorded for teacher');
  });

  it('6.2 - Staff checkout', async () => {
    const res = await api
      .post('/attendance/staff/check-out')
      .set(authHeader(state.adminToken))
      .send({
        userId: state.teacherUser.id,
        session: 2,
        date: todayStr(),
      })
      .expect(201);

    console.log('  ✓ Staff checkout recorded');
  });

  it('6.3 - Get staff attendance records', async () => {
    const res = await api
      .get(`/attendance/staff/records?date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    console.log('  ✓ Staff records for today:', res.body.length);
  });

  it('6.4 - Employee self-scan check-in', async () => {
    const res = await api
      .post('/attendance/employee/self-scan')
      .set(authHeader(state.teacherToken))
      .send({
        latitude: 11.5564,
        longitude: 104.9282,
        location: 'School Campus',
      });

    // May return 201 or 200 depending on whether already recorded
    expect([200, 201]).toContain(res.status);
    console.log('  ✓ Employee self-scan result:', res.status);
  });

  it('6.5 - Employee views own attendance records', async () => {
    const res = await api
      .get(`/attendance/employee/my-records?date=${todayStr()}`)
      .set(authHeader(state.teacherToken))
      .expect(200);

    // Response may be array or object with records
    const records = Array.isArray(res.body) ? res.body : (res.body.records || res.body.data || []);
    console.log('  ✓ Employee own records:', records.length, 'shape:', typeof res.body, Array.isArray(res.body) ? 'array' : Object.keys(res.body));
  });
});

// ============================================================================
// PHASE 7: REPORTS & DASHBOARD
// ============================================================================
describe('Phase 7: Reports & Dashboard', () => {

  it('7.1 - System status report', async () => {
    const res = await api
      .get('/reports/system-status')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('totalStudents');
    expect(res.body).toHaveProperty('totalClasses');
    expect(res.body).toHaveProperty('totalUsers');
    console.log('  ✓ System status:', JSON.stringify(res.body));
  });

  it('7.2 - Dashboard summary (today)', async () => {
    const res = await api
      .get(`/reports/dashboard-summary?date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('students');
    expect(res.body).toHaveProperty('staff');
    console.log('  ✓ Dashboard summary:');
    console.log('    Students - Present:', res.body.students?.present,
      'Absent:', res.body.students?.absent,
      'Late:', res.body.students?.late,
      'Permission:', res.body.students?.permission);
    console.log('    Staff - Present:', res.body.staff?.present,
      'Absent:', res.body.staff?.absent,
      'Late:', res.body.staff?.late);
  });

  it('7.3 - Monthly trend report', async () => {
    const now = new Date();
    const res = await api
      .get(`/reports/monthly-trend?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toBeDefined();
    console.log('  ✓ Monthly trend data received');
  });

  it('7.4 - Attendance summary for class', async () => {
    const res = await api
      .get(`/reports/attendance-summary?classId=${state.classId}&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('present');
    expect(res.body).toHaveProperty('absent');
    expect(res.body).toHaveProperty('late');
    console.log('  ✓ Class attendance summary:', JSON.stringify(res.body));
  });

  it('7.5 - Student individual attendance history', async () => {
    const res = await api
      .get(`/reports/student-attendance?studentId=${state.studentIds[0]}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    console.log('  ✓ Student attendance history:', res.body.length, 'records');
  });

  it('7.6 - Daily summary (all classes)', async () => {
    const res = await api
      .get(`/reports/daily-summary?date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    console.log('  ✓ Daily summary received');
  });

  it('7.7 - Teacher class summaries', async () => {
    const res = await api
      .get(`/reports/class-summaries?teacherId=${state.teacherUser.id}&date=${todayStr()}&session=1`)
      .set(authHeader(state.teacherToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    console.log('  ✓ Teacher class summaries:', res.body.length, 'classes');
  });

  it('7.8 - Attendance grid (students × sessions)', async () => {
    const res = await api
      .get(`/reports/attendance-grid?classId=${state.classId}&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toBeDefined();
    console.log('  ✓ Attendance grid received');
    if (Array.isArray(res.body.rows)) {
      console.log('    Grid rows:', res.body.rows.length);
    } else if (Array.isArray(res.body)) {
      console.log('    Grid rows:', res.body.length);
    }
  });

  it('7.9 - Attendance totals (week/month/year aggregates)', async () => {
    const res = await api
      .get(`/reports/attendance-totals?classId=${state.classId}&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toBeDefined();
    console.log('  ✓ Attendance totals received');
  });

  it('7.10 - Class student detail (date range)', async () => {
    const res = await api
      .get(`/reports/class-student-detail?classId=${state.classId}&startDate=${todayStr()}&endDate=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    console.log('  ✓ Class student detail received');
  });

  it('7.11 - Audit logs', async () => {
    const res = await api
      .get('/reports/audit-logs')
      .set(authHeader(state.adminToken))
      .expect(200);

    console.log('  ✓ Audit logs received');
  });

  it('7.12 - Staff attendance grid', async () => {
    const res = await api
      .get(`/reports/staff-attendance-grid?date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    console.log('  ✓ Staff attendance grid received');
  });

  it('7.13 - Staff attendance totals', async () => {
    const res = await api
      .get(`/reports/staff-attendance-totals?date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    console.log('  ✓ Staff attendance totals received');
  });
});

// ============================================================================
// PHASE 8: EXPORT REPORTS
// ============================================================================
describe('Phase 8: Export Reports (CSV / XLSX)', () => {

  it('8.1 - Export attendance grid as CSV', async () => {
    const res = await api
      .get(`/reports/export-grid?classId=${state.classId}&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    // Should return CSV content
    const contentType = res.headers['content-type'] || '';
    expect(contentType).toMatch(/csv|text|octet/i);
    expect(res.text.length).toBeGreaterThan(0);
    console.log('  ✓ CSV grid export:', res.text.length, 'bytes');
    console.log('    First 200 chars:', res.text.substring(0, 200));
  });

  it('8.2 - Export attendance as CSV (daily period)', async () => {
    const res = await api
      .get(`/reports/export?classId=${state.classId}&period=daily&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.text.length).toBeGreaterThan(0);
    console.log('  ✓ CSV daily export:', res.text.length, 'bytes');
  });

  it('8.3 - Export attendance as CSV (weekly period)', async () => {
    const res = await api
      .get(`/reports/export?classId=${state.classId}&period=weekly&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.text.length).toBeGreaterThan(0);
    console.log('  ✓ CSV weekly export:', res.text.length, 'bytes');
  });

  it('8.4 - Export attendance as CSV (monthly period)', async () => {
    const res = await api
      .get(`/reports/export?classId=${state.classId}&period=monthly&date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.text.length).toBeGreaterThan(0);
    console.log('  ✓ CSV monthly export:', res.text.length, 'bytes');
  });

  it('8.5 - Export attendance as XLSX', async () => {
    const res = await api
      .get(`/reports/export-xlsx?classId=${state.classId}&date=${todayStr()}&period=daily`)
      .set(authHeader(state.adminToken))
      .expect(200)
      .buffer(true);

    const contentType = res.headers['content-type'] || '';
    expect(contentType).toMatch(/spreadsheet|xlsx|octet|openxmlformats/i);
    // XLSX may be empty if no attendance data, just verify content-type
    console.log('  ✓ XLSX export: content-type =', contentType, ', size =', (res.body?.length || 0), 'bytes');
  });

  it('8.6 - Export staff attendance grid as CSV', async () => {
    const res = await api
      .get(`/reports/export-staff-grid?date=${todayStr()}`)
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.text.length).toBeGreaterThan(0);
    console.log('  ✓ Staff CSV grid export:', res.text.length, 'bytes');
  });
});

// ============================================================================
// PHASE 9: HOLIDAYS
// ============================================================================
describe('Phase 9: Holiday Management', () => {

  let holidayId: string;

  it('9.1 - Should create a holiday', async () => {
    const res = await api
      .post('/holidays')
      .set(authHeader(state.adminToken))
      .send({
        date: '2026-12-25',
        name: 'E2E Test Holiday',
        description: 'Christmas Day (test)',
        type: 'HOLIDAY',
        createdById: state.adminUser.id,
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    holidayId = res.body.id;
    console.log('  ✓ Holiday created:', res.body.id);
  });

  it('9.2 - Should check if date is holiday', async () => {
    const res = await api
      .get('/holidays/check?date=2026-12-25')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('isHoliday', true);
    console.log('  ✓ Holiday check: 2026-12-25 isHoliday =', res.body.isHoliday);
  });

  it('9.3 - Should check non-holiday date', async () => {
    const res = await api
      .get('/holidays/check?date=2026-12-26')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(res.body).toHaveProperty('isHoliday', false);
    console.log('  ✓ Non-holiday check: 2026-12-26 isHoliday =', res.body.isHoliday);
  });

  it('9.4 - Should list holidays by year', async () => {
    const res = await api
      .get('/holidays?year=2026')
      .set(authHeader(state.adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    console.log('  ✓ Holidays in 2026:', res.body.length);
  });

  it('9.5 - Should delete the test holiday', async () => {
    if (!holidayId) return;
    await api
      .delete(`/holidays/${holidayId}`)
      .set(authHeader(state.adminToken))
      .expect(200);
    console.log('  ✓ Holiday deleted');
  });
});

// ============================================================================
// PHASE 10: CLEANUP (delete test data)
// ============================================================================
describe('Phase 10: Cleanup Test Data', () => {

  it('10.1 - Should delete the test class (cascades students & attendance)', async () => {
    if (!state.classId) return;
    const res = await api
      .delete(`/classes/${state.classId}`)
      .set(authHeader(state.adminToken))
      .expect(200);
    console.log('  ✓ Class deleted (cascaded)');
  });

  it('10.2 - Should delete test users', async () => {
    const usersToDelete = [
      state.teacherUser?.id,
      state.parentUser?.id,
      ...state.studentUserIds,
    ].filter(Boolean);

    for (const userId of usersToDelete) {
      try {
        await api
          .delete(`/auth/users/${userId}`)
          .set(authHeader(state.adminToken))
          .expect(200);
        console.log(`  ✓ Deleted user: ${userId}`);
      } catch (e) {
        console.log(`  ⚠ Failed to delete user ${userId}:`, (e as Error).message);
      }
    }

    // Also clean up bulk-created users
    const searchRes = await api
      .get(`/auth/users/search?q=${TEST_PREFIX}`)
      .set(authHeader(state.adminToken));

    if (searchRes.body && Array.isArray(searchRes.body)) {
      for (const u of searchRes.body) {
        try {
          await api
            .delete(`/auth/users/${u.id}`)
            .set(authHeader(state.adminToken));
          console.log(`  ✓ Cleaned up user: ${u.email}`);
        } catch (e) {
          // ignore
        }
      }
    }
  });

  it('10.3 - Should delete test study year', async () => {
    if (!state.studyYearId) return;
    try {
      await api
        .delete(`/study-years/${state.studyYearId}`)
        .set(authHeader(state.adminToken))
        .expect(200);
      console.log('  ✓ Study year deleted');
    } catch (e) {
      console.log('  ⚠ Study year cleanup:', (e as Error).message);
    }
  });

  it('10.4 - Should delete test department', async () => {
    if (!state.departmentId) return;
    try {
      await api
        .delete(`/departments/${state.departmentId}`)
        .set(authHeader(state.adminToken))
        .expect(200);
      console.log('  ✓ Department deleted');
    } catch (e) {
      console.log('  ⚠ Department cleanup:', (e as Error).message);
    }
  });
});
