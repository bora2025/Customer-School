/**
 * A-010 old-client compatibility fixture.
 *
 * apps/mobile is a distinct, independently-versioned client (Expo/React Native) that calls a
 * fixed, hand-audited subset of the backend REST surface (see docs/architecture/contract-catalog.md
 * §6 for the full consumer map — the list below is that exact set, mirrored intentionally rather
 * than imported, since the point is to catch drift between what mobile *actually calls* and what
 * the server *actually still serves*). Unlike workflow.e2e-spec.ts, this file does not assert
 * response bodies or business behavior — those are covered elsewhere. It asserts one thing only:
 * every (method, path) pair the mobile client depends on still resolves to a real, registered
 * route, not a 404. That is the single most common shape a REST breaking change takes (a route
 * renamed, moved, or removed). The stable v1 compatibility header is also asserted so an
 * independently released client can detect which public contract the school serves.
 *
 * A 401/403/400 is a PASS here (the route exists and rejected this particular call — normal for a
 * generic probe without real domain data). Only a 404 is a FAIL: that specifically means Nest could
 * not match the path to any registered handler, i.e. the mobile client's contract was broken.
 */
import * as supertest from 'supertest';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const api = supertest.default(API_BASE);

jest.setTimeout(60_000);

let adminToken = '';

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const res = await api
    .post('/auth/login')
    .send({ email: 'admin@test.com', password: 'password' })
    .expect(201);
  adminToken = res.body.access_token;
});

/**
 * Every (method, path) pair apps/mobile calls today, per the A-010 consumer-map audit.
 * `path` uses a syntactically valid but not-necessarily-existent ID/query where the mobile
 * client would substitute a real one — the point is route resolution, not the specific record.
 */
const MOBILE_ROUTES: Array<{ method: 'get' | 'post' | 'patch'; path: string; note: string }> = [
  { method: 'get', path: '/installation/status', note: 'apps/mobile/src/config.ts: discovery' },
  { method: 'post', path: '/auth/login', note: 'apps/mobile/src/api.ts:9' },
  { method: 'post', path: '/auth/logout', note: 'apps/mobile/src/api.ts:44' },
  { method: 'post', path: '/auth/refresh', note: 'apps/mobile/src/api.ts:66' },
  { method: 'post', path: '/auth/forgot-password', note: 'ForgotPasswordScreen.tsx' },
  { method: 'get', path: '/auth/users', note: 'UsersScreen.tsx:36' },
  { method: 'get', path: '/auth/users/search?q=test', note: 'SearchScreen.tsx:21' },
  { method: 'get', path: '/auth/users?roles=TEACHER,ADMIN', note: 'StaffAttendanceScreen.tsx:180' },
  { method: 'get', path: '/classes', note: 'ClassesScreen.tsx:26' },
  { method: 'get', path: '/classes?teacherId=x', note: 'ClassesScreen.tsx:34' },
  { method: 'get', path: '/classes/x/students', note: 'ClassesScreen.tsx:35' },
  { method: 'get', path: '/attendance/records?classId=x&date=2026-01-01', note: 'EditAttendanceScreen.tsx:44' },
  { method: 'get', path: '/attendance/staff/records?date=2026-01-01', note: 'EditAttendanceScreen.tsx:52' },
  { method: 'patch', path: '/attendance/update', note: 'EditAttendanceScreen.tsx:78' },
  { method: 'patch', path: '/attendance/staff/update', note: 'EditAttendanceScreen.tsx:84' },
  { method: 'post', path: '/attendance/employee/self-scan', note: 'ScannerScreen.tsx:172' },
  { method: 'post', path: '/attendance/check-out', note: 'ScannerScreen.tsx:242' },
  { method: 'post', path: '/attendance/record', note: 'ScannerScreen.tsx:263' },
  { method: 'post', path: '/attendance/staff/auto-scan', note: 'StaffAttendanceScreen.tsx:312' },
  { method: 'get', path: '/reports/system-status', note: 'DashboardScreen.tsx:146' },
  { method: 'get', path: '/reports/attendance-grid?classId=x&date=2026-01-01', note: 'ReportsScreen.tsx:38' },
  { method: 'get', path: '/reports/attendance-totals?classId=x&date=2026-01-01', note: 'ReportsScreen.tsx:39' },
  { method: 'get', path: '/reports/employee/my-daily-grid?date=2026-01-01', note: 'MyReportsScreen.tsx:25' },
  { method: 'get', path: '/reports/employee/my-totals?date=2026-01-01', note: 'MyReportsScreen.tsx:26' },
  { method: 'get', path: '/reports/staff-attendance-grid?date=2026-01-01', note: 'StaffReportsScreen.tsx:22' },
  { method: 'get', path: '/reports/staff-attendance-totals?date=2026-01-01', note: 'StaffReportsScreen.tsx:23' },
  { method: 'get', path: '/holidays?year=2026', note: 'HolidaysScreen.tsx:20' },
  { method: 'get', path: '/session-config/global', note: 'SessionSettingsScreen.tsx:24' },
  { method: 'get', path: '/session-config/staff', note: 'SessionSettingsScreen.tsx:25' },
];

describe('A-010: mobile client route-existence contract', () => {
  it.each(MOBILE_ROUTES)('$method $path ($note) still resolves to a real route', async ({ method, path }) => {
    const res = await api[method](path).set(authHeader(adminToken)).send({});
    expect(res.status).not.toBe(404);
    expect(res.headers['x-wattanam-api-version']).toBe('1');
  });
});
