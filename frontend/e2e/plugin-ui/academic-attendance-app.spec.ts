import { expect, test } from '@playwright/test';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';
import fs from 'node:fs';
import path from 'node:path';

// Academic Management's own Take Attendance screen (ui/attendance, plugin >= 0.5.0) rendered from
// the real plugin files inside the core's sandboxed frame. The camera is run by the school page;
// the screen receives decoded codes through the bridge.
const pluginId = 'wattanam.academic-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const root = catalog ? path.resolve(catalog, pluginId) : '';
const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const attendancePage = descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === 'ui/attendance/index.html'));
const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CODE = 'wattanam:student:s2-91bc';

(attendancePage ? test : test.skip)('Academic Management take attendance runs as the plugin\'s own sandboxed screen', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 11.5564, longitude: 104.9282 });

  // The school page's camera shows a real QR code for student s2.
  const matrix = new QRCodeWriter().encode(CODE, BarcodeFormat.QR_CODE, 33, 33, new Map());
  const cells: number[][] = [];
  for (let y = 0; y < matrix.getHeight(); y += 1) { const row: number[] = []; for (let x = 0; x < matrix.getWidth(); x += 1) row.push(matrix.get(x, y) ? 1 : 0); cells.push(row); }
  await page.addInitScript((qr) => {
    if (window.top !== window) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const scale = 10, margin = 4, size = (qr.length + margin * 2) * scale;
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const draw = () => { const c = canvas.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, size, size); c.fillStyle = '#000'; qr.forEach((row, y) => row.forEach((cell, x) => { if (cell) c.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale); })); };
      draw(); window.setInterval(draw, 100);
      return (canvas as any).captureStream(10) as MediaStream;
    };
  }, cells);

  const pages = descriptor.pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  const everyDay = JSON.stringify({ week: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] });
  const classes = [{ id: 'c1', name: 'Grade 6B', schedule: everyDay }, { id: 'c2', name: 'Grade 7A', subject: 'Science', schedule: everyDay }];
  // One session open all day, so the test does not depend on the clock.
  const sessions = [{ scope: 'STUDENT', session: 1, type: 'CHECK_IN', startTime: '00:00', endTime: '23:59' }, { scope: 'STAFF', session: 1, type: 'CHECK_IN', startTime: '00:00', endTime: '23:59' }];
  const students = [{ id: 's1', name: 'Sok Dara', studentNumber: 'STU-0001' }, { id: 's2', name: 'Chea Lina', studentNumber: 'STU-0002' }, { id: 's3', name: 'Ly Bopha', studentNumber: 'STU-0003' }];
  const records: any[] = [{ id: 'r1', personId: 's1', status: 'LATE', session: 1 }];
  const saved: Array<{ method: string; path: string; body: any }> = [];
  const gets: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const prefix = `/api/plugin-ui/${pluginId}/${version}/`;
    if (pathname.startsWith(prefix)) {
      const file = path.join(root, ...pathname.slice(prefix.length).split('/'));
      if (!file.startsWith(path.join(root, 'ui')) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, headers: { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cross-origin-resource-policy': 'cross-origin' }, body: fs.readFileSync(file) });
    }
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    const apiPrefix = `/api/plugin-api/${pluginId}/`;
    if (pathname.startsWith(apiPrefix)) {
      const apiPath = pathname.slice(apiPrefix.length);
      if (request.method() === 'GET') {
        gets.push(apiPath + url.search);
        if (apiPath === 'classes') return route.fulfill({ json: classes });
        if (apiPath === 'sessions') return route.fulfill({ json: sessions });
        if (apiPath === 'records') return route.fulfill({ json: url.searchParams.get('classId') === 'c2' ? records : [] });
        if (apiPath === 'classes/c2/students') return route.fulfill({ json: students });
        return route.fulfill({ json: [] });
      }
      const body = request.postDataJSON();
      saved.push({ method: request.method(), path: apiPath, body });
      if (apiPath === 'scan') {
        if (body.code !== CODE) return route.fulfill({ status: 400, json: { message: 'Attendance code not found' } });
        const record = { id: 'r2', personId: 's2', status: 'PRESENT', session: 1, scanMode: body.mode };
        records.push(record);
        return route.fulfill({ status: 201, json: record });
      }
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  // Opened for a specific class, as the Class Manager does.
  await page.goto(`/plugins/${pluginId}/${attendancePage.routePath}?classId=c2`);
  const frame = page.frameLocator('iframe[title="Take Student Attendance"]');
  await expect(frame.getByRole('heading', { name: 'Take Attendance' })).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#class')).toHaveValue('c2');
  await expect(frame.locator('.student')).toHaveCount(3);
  await expect(frame.locator('#recorded')).toHaveText('1/3 recorded');
  await expect(frame.getByLabel('Status for Sok Dara')).toHaveValue('LATE');
  await expect(frame.locator('#location')).toContainText('Location active (11.5564, 104.9282)');
  expect(gets.some((entry) => /^records\?classId=c2&date=\d{4}-\d{2}-\d{2}$/.test(entry))).toBe(true);

  // Camera: the school page opens its scanner, decodes the QR and the screen records the scan.
  await frame.getByRole('button', { name: '📷 Open Camera' }).click();
  await expect(page.locator('[data-plugin-scanner]')).toBeVisible();
  await expect(frame.getByRole('status')).toHaveText('Chea Lina marked present.', { timeout: 20_000 });
  const scan = saved.find((entry) => entry.path === 'scan')!;
  expect(scan.body).toMatchObject({ code: CODE, classId: 'c2', session: 1, mode: 'CAMERA', latitude: 11.5564, longitude: 104.9282 });
  expect(String(scan.body.idempotencyKey).length).toBeGreaterThan(10);
  await expect(frame.getByLabel('Status for Chea Lina')).toHaveValue('PRESENT');
  await expect(frame.locator('#activity article')).toHaveCount(1);
  // The code staying in front of the camera does not record a second scan.
  await page.waitForTimeout(2500);
  expect(saved.filter((entry) => entry.path === 'scan')).toHaveLength(1);
  await frame.getByRole('button', { name: 'Close camera' }).click();
  await expect(page.locator('[data-plugin-scanner]')).toHaveCount(0);

  // USB keyboard-mode scanner: Test mode shows the code without recording; a wrong code is reported.
  await frame.getByRole('button', { name: '🖱️ USB Scanner' }).click();
  await frame.getByRole('button', { name: 'Test' }).click();
  await frame.locator('#usb-input').click();
  await page.keyboard.type('card-123');
  await page.keyboard.press('Enter');
  await expect(frame.locator('#usb-test-result')).toHaveText('Received: card-123');
  expect(saved.filter((entry) => entry.path === 'scan')).toHaveLength(1);
  await frame.getByRole('button', { name: 'Testing' }).click();
  await page.keyboard.type('unknown-card');
  await page.keyboard.press('Enter');
  await expect(frame.getByRole('alert')).toHaveText('Attendance code not found');
  expect(saved.filter((entry) => entry.path === 'scan').at(-1)!.body).toMatchObject({ code: 'unknown-card', mode: 'USB' });
  await expect(frame.locator('#activity article')).toHaveCount(2);
  await frame.getByRole('button', { name: '‹ Back' }).click();

  // Manual marking and Submit save one record per student.
  await frame.getByLabel('Status for Ly Bopha').selectOption('PERMISSION');
  await frame.getByRole('button', { name: /Submit/ }).click();
  await expect(frame.getByRole('status')).toHaveText('Attendance saved for 3 students.');
  const submitted = saved.filter((entry) => entry.path === 'records');
  expect(submitted).toHaveLength(3);
  expect(submitted.map((entry) => `${entry.body.personId}:${entry.body.status}`)).toEqual(['s1:LATE', 's2:PRESENT', 's3:PERMISSION']);
  expect(submitted[0].body).toMatchObject({ personType: 'STUDENT', classId: 'c2', session: 1 });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-attendance-${testInfo.project.name}.png`), fullPage: true });
});
