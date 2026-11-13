import { expect, test } from '@playwright/test';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';
import fs from 'node:fs';
import path from 'node:path';

// Academic Management's own student Scan Attendance screen (ui/student-attendance, plugin >= 0.6.0)
// rendered from the real plugin files in the core's sandboxed frame. The school page runs the
// camera, location and device identifier; the screen receives results only.
const pluginId = 'wattanam.academic-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const root = catalog ? path.resolve(catalog, pluginId) : '';
const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const studentPage = descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === 'ui/student-attendance/index.html'));
const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const TOKEN = 'v1.' + 'a'.repeat(30) + '.' + 'b'.repeat(40);
const SECOND_TOKEN = 'v1.' + 'c'.repeat(30) + '.' + 'd'.repeat(40);

(studentPage ? test : test.skip)('students scan attendance on the plugin\'s own sandboxed screen', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  test.setTimeout(90_000);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 11.5564, longitude: 104.9282, accuracy: 12 });

  const matrix = new QRCodeWriter().encode(TOKEN, BarcodeFormat.QR_CODE, 45, 45, new Map());
  const cells: number[][] = [];
  for (let y = 0; y < matrix.getHeight(); y += 1) { const row: number[] = []; for (let x = 0; x < matrix.getWidth(); x += 1) row.push(matrix.get(x, y) ? 1 : 0); cells.push(row); }
  await page.addInitScript((qr) => {
    if (window.top !== window) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const scale = 8, margin = 4, size = (qr.length + margin * 2) * scale;
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const draw = () => { const c = canvas.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, size, size); c.fillStyle = '#000'; qr.forEach((row, y) => row.forEach((cell, x) => { if (cell) c.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale); })); };
      draw(); window.setInterval(draw, 100);
      return (canvas as any).captureStream(10) as MediaStream;
    };
  }, cells);

  const pages = descriptor.pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  const scans: any[] = [];
  const devices: any[] = [];
  let registeredDeviceId = '';
  // Playwright still answers mocked requests in offline mode, so the outage is simulated here too.
  let networkDown = false;
  const history = [
    { id: 'h1', date: '2026-11-12', session: 1, status: 'PRESENT', classNameSnapshot: 'Grade 7A', checkInTime: '2026-11-12T00:05:00.000Z', reviewStatus: 'NOT_REQUIRED' },
    { id: 'h2', date: '2026-11-11', session: 1, status: 'LATE', classNameSnapshot: 'Grade 7A', checkInTime: '2026-11-11T00:25:00.000Z', reviewStatus: 'NOT_REQUIRED' },
  ];
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
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'student-1', role: 'STUDENT', email: 'dara@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    const apiPrefix = `/api/plugin-api/${pluginId}/`;
    if (!pathname.startsWith(apiPrefix)) return route.fulfill({ status: 200, json: [] });
    const apiPath = pathname.slice(apiPrefix.length);
    if (apiPath === 'student/attendance-history') return route.fulfill({ json: history });
    if (apiPath === 'student/attendance-devices' && request.method() === 'GET') {
      const own = url.searchParams.get('deviceId');
      return route.fulfill({ json: devices.map((item) => ({ ...item, thisDevice: Boolean(own) && own === registeredDeviceId })) });
    }
    if (apiPath === 'student/attendance-devices' && request.method() === 'POST') {
      const body = request.postDataJSON();
      registeredDeviceId = body.deviceId;
      devices.splice(0, devices.length, { id: 'd1', label: body.label, active: true, registeredAt: '2026-11-13T02:00:00.000Z', lastUsedAt: null });
      return route.fulfill({ status: 201, json: devices[0] });
    }
    if (apiPath === 'student/self-scan') {
      if (networkDown) return route.abort('internetdisconnected');
      const body = request.postDataJSON();
      scans.push(body);
      const result = body.attendanceToken === TOKEN ? 'RECORDED' : 'LATE';
      return route.fulfill({ status: 201, json: { result, recordId: 'r' + scans.length, reviewStatus: 'NOT_REQUIRED', rejectionReason: null, idempotentReplay: false } });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.goto(`/plugins/${pluginId}/${studentPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Scan Attendance"]');
  await expect(frame.getByRole('heading', { name: 'Scan Attendance' })).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#chip-location')).toHaveText('📍 Location: on (±12 m)');
  await expect(frame.locator('#chip-device')).toHaveText('📱 Device: not registered');

  // Register this device in one tap; the screen recognises it afterwards.
  await frame.getByRole('tab', { name: /This device/ }).click();
  await frame.locator('#device-label').fill('My phone');
  await frame.getByRole('button', { name: 'Register this device' }).click();
  await expect(frame.locator('#device-state')).toHaveText('✅ This device is registered.');
  expect(registeredDeviceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await page.evaluate(() => localStorage.getItem('wattanam-plugin-device:wattanam.academic-management'))).toBe(registeredDeviceId);
  await expect(frame.locator('#devices')).toContainText('My phone (this device)');

  // Camera scan: recorded once, with location, device and an idempotency id; the camera closes.
  await frame.getByRole('tab', { name: /Scan/ }).click();
  await frame.getByRole('button', { name: '📷 Start camera' }).click();
  await expect(page.locator('[data-plugin-scanner]')).toBeVisible();
  await expect(frame.locator('#result-title')).toHaveText('Attendance recorded', { timeout: 20_000 });
  await expect(page.locator('[data-plugin-scanner]')).toHaveCount(0);
  expect(scans).toHaveLength(1);
  expect(scans[0]).toMatchObject({ attendanceToken: TOKEN, deviceId: registeredDeviceId, latitude: 11.5564, longitude: 104.9282, accuracyMeters: 12, networkQuality: 'ONLINE' });
  expect(String(scans[0].clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);
  await expect(frame.locator('#chip-device')).toHaveText('📱 Device: registered');

  // A code that is not an attendance code is refused on the screen, without a request.
  await frame.getByText('Camera not working? Enter the code instead').click();
  await frame.locator('#manual').fill('https://example.test/not-attendance');
  await frame.getByRole('button', { name: 'Submit code' }).click();
  await expect(frame.locator('#result-title')).toHaveText('Not an attendance code');
  expect(scans).toHaveLength(1);

  // Without a connection the scan is kept and sent later with its original time and id.
  networkDown = true;
  await context.setOffline(true);
  await expect(frame.locator('#chip-network')).toContainText('Offline');
  await frame.locator('#manual').fill(SECOND_TOKEN);
  await frame.getByRole('button', { name: 'Submit code' }).click();
  await expect(frame.locator('#result-title')).toHaveText('Saved — waiting for connection');
  await expect(frame.locator('#pending')).toContainText('1 scan is waiting');
  const savedAt = Date.now();
  expect(scans).toHaveLength(1);
  networkDown = false;
  await context.setOffline(false);
  await expect(frame.locator('#result-title')).toHaveText('Recorded as late', { timeout: 25_000 });
  await expect(frame.locator('#pending')).toBeHidden();
  expect(scans).toHaveLength(2);
  expect(scans[1].attendanceToken).toBe(SECOND_TOKEN);
  expect(Math.abs(new Date(scans[1].scannedAt).getTime() - savedAt)).toBeLessThan(5_000);
  await expect(frame.locator('#today .item')).toHaveCount(2);

  // History with a summary.
  await frame.getByRole('tab', { name: /My attendance/ }).click();
  await expect(frame.locator('#summary')).toContainText('1PRESENT');
  await expect(frame.locator('#history .item')).toHaveCount(2);
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-student-attendance-${testInfo.project.name}.png`), fullPage: true });
});
