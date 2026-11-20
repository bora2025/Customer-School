import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Partner screens: Smart Attendance (0.3+) screens moved from Academic / Organizing Management call those
// plugins' APIs (marked with X-Wattanam-Plugin-Screen), Academic's links open them, and a screen cannot
// call a plugin it did not declare. Runs against the real plugin files (PLUGIN_SOURCE_CATALOG).
const SMART = 'wattanam.smart-attendance', ACADEMIC = 'wattanam.academic-management', ORGANIZING = 'wattanam.organizing-management';
const catalog = path.resolve(process.env.PLUGIN_SOURCE_CATALOG || '');
const read = (id: string, file: string) => JSON.parse(fs.readFileSync(path.join(catalog, id, file), 'utf8'));
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
test.skip(!fs.existsSync(path.join(catalog, SMART, 'ui', 'take', 'index.html')), 'needs PLUGIN_SOURCE_CATALOG with Smart Attendance 0.3 or newer');
type Call = { plugin: string; method: string; path: string; screen: string | null; body: any; query: Record<string, string> };

async function serve(page: any, answer: (call: Call) => any) {
  const calls: Call[] = [];
  const pages = [SMART, ACADEMIC].flatMap((id) => {
    const version = read(id, 'plugin.json').version;
    return read(id, 'frontend/page.json').pages.map((entry: any) => ({ pluginId: id, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  });
  await page.route('**/api/**', async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    for (const id of [SMART, ACADEMIC]) {
      const prefix = `/api/plugin-ui/${id}/${read(id, 'plugin.json').version}/`;
      if (url.pathname.startsWith(prefix)) {
        const file = path.join(catalog, id, ...url.pathname.slice(prefix.length).split('/'));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, headers: { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP }, body: fs.readFileSync(file) });
      }
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 'teacher-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (url.pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    const match = url.pathname.match(/^\/api\/plugin-api\/([^/]+)\/(.+)$/);
    if (match) {
      const call: Call = { plugin: match[1], method: request.method(), path: match[2], screen: (await request.allHeaders())['x-wattanam-plugin-screen'] || null, body: request.method() === 'GET' ? null : request.postDataJSON(), query: Object.fromEntries(url.searchParams) };
      calls.push(call);
      const out = await answer(call);
      return route.fulfill({ status: 200, json: out === undefined ? [] : out });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  return calls;
}

const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const classes = [{ id: 'k7a', name: '7A', schedule: JSON.stringify({ week: WEEK }) }, { id: 'k8b', name: '8B', schedule: JSON.stringify({ week: WEEK }) }];
const students = [{ id: 's1', studentNumber: '0001', nameKh: 'សុខ ដារ៉ា', name: 'Sok Dara' }, { id: 's2', studentNumber: '0002', nameKh: 'ចាន់ ស្រី', name: 'Chan Srey' }];
const academicAnswer = (call: Call) => {
  if (call.plugin !== ACADEMIC) return undefined;
  if (call.path === 'my/classes') return classes;
  if (call.path === 'sessions') return [{ id: 'x', scope: 'STUDENT', session: 1, type: 'CHECK_IN', startTime: '00:00', endTime: '23:59' }];
  if (/^my\/classes\/[^/]+\/students$/.test(call.path)) return students;
  if (call.path === 'records' && call.method === 'GET') return [];
  if (call.path === 'records' && call.method === 'POST') return { id: 'r', status: call.body.status };
  if (call.path === 'attendance-windows') return [{ id: 'w1', classId: 'k7a', session: 1, sessionType: 'CHECK_IN', status: 'OPEN', startsAt: '2026-11-20T07:00:00Z', endsAt: '2026-11-20T07:15:00Z' }];
  return undefined;
};

test('Take Attendance (Smart Attendance) reads and saves through Academic Management', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const calls = await serve(page, academicAnswer);
  await page.goto(`/plugins/${SMART}/take?classId=k8b`);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#class')).toHaveValue('k8b', { timeout: 30_000 });
  await expect(frame.getByText('ចាន់ ស្រី')).toBeVisible();
  await frame.locator('#submit').click();
  await expect(frame.locator('#message')).toContainText('Attendance saved for 2 students');
  // every call went to Academic Management, marked as Smart Attendance's screen; none to Smart Attendance
  const data = calls.filter((c) => c.plugin !== 'my-extensions');
  expect(data.length).toBeGreaterThan(4);
  expect(data.every((c) => c.plugin === ACADEMIC && c.screen === SMART)).toBe(true);
  expect(data.filter((c) => c.method === 'POST' && c.path === 'records').map((c) => [c.body.classId, c.body.personId])).toEqual([['k8b', 's1'], ['k8b', 's2']]);
  await page.screenshot({ path: testInfo.outputPath('take.png'), fullPage: true });
});

test('declarative partner pages (self-attendance windows) load from Academic Management', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const calls = await serve(page, academicAnswer);
  await page.goto(`/plugins/${SMART}/self-attendance/windows`);
  await expect(page.getByText('OPEN').first()).toBeVisible({ timeout: 30_000 });
  const windows = calls.find((c) => c.path === 'attendance-windows');
  expect(windows).toMatchObject({ plugin: ACADEMIC, method: 'GET', screen: SMART });
  expect(calls.some((c) => c.plugin === SMART)).toBe(false);
});

test('Academic My Class opens Smart Attendance Take Attendance on the class', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await serve(page, (call) => {
    if (call.plugin === ACADEMIC && call.path === 'my/classes') return classes;
    if (call.plugin === ACADEMIC && /^my\/classes\/[^/]+\/overview$/.test(call.path)) return { class: classes[0], students: [], today: {}, permissions: [], summary: {} };
    return academicAnswer(call);
  });
  await page.goto(`/plugins/${ACADEMIC}/my-class?classId=k7a`);
  const frame = page.frameLocator('iframe');
  await frame.locator('[data-go="attendance"]').click({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/plugins/${SMART}/take\\?classId=k7a`));
});

test('a screen cannot call a plugin it did not declare', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const calls = await serve(page, academicAnswer);
  await page.goto(`/plugins/${SMART}/take`);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#class')).toHaveValue('k7a', { timeout: 30_000 });
  // the Take screen declares Academic Management only: the school page refuses Organizing Management
  const screen = page.frames().find((frame) => frame.url().includes('/ui/take/'))!;
  const refused = await screen.evaluate(() => (window as any).WattanamPluginUI.partner('wattanam.organizing-management').get('attendance/records').then(() => 'answered', (error: any) => error.status));
  expect(refused).toBe(403);
  const allowed = await screen.evaluate(() => (window as any).WattanamPluginUI.partner('wattanam.academic-management').get('sessions').then((rows: any[]) => rows.length));
  expect(allowed).toBe(1);
  expect(calls.some((c) => c.plugin === ORGANIZING)).toBe(false);
});
