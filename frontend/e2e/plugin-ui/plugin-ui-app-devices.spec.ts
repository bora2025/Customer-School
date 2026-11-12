import { expect, test, type Page } from '@playwright/test';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';

// Device services for a plugin-owned screen: the HOST page runs the camera scanner and location
// lookup, and the sandboxed screen receives only the decoded text or one position per request.
// A screen whose page did not declare a device gets nothing.
const pluginId = 'wattanam.demo';
const version = '1.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const CODE = 'wattanam:student:s1-7f3a';

const html = '<!doctype html><html><body><h1>Scan</h1><button id="start">Start</button><button id="stop">Stop</button><ul id="out"></ul><script src="app.js"></script></body></html>';
const app = `
const out = (key, value) => { let li = document.getElementById(key); if (!li) { li = document.createElement('li'); li.id = key; document.getElementById('out').appendChild(li); } li.textContent = key + '=' + value; };
const post = (message) => parent.postMessage(Object.assign({ protocol: 'wattanam.plugin-ui/1' }, message), '*');
let scans = 0;
window.addEventListener('message', (event) => {
  if (event.source !== parent || !event.data || event.data.protocol !== 'wattanam.plugin-ui/1') return;
  const data = event.data;
  if (data.type === 'init') { out('devices', (data.devices || []).join('+') || 'none'); post({ type: 'location', id: 'loc1' }); }
  if (data.type === 'response' && data.id === 'loc1') out('location', data.status + ':' + (data.body && data.body.latitude !== undefined ? data.body.latitude + ',' + data.body.longitude : data.body && data.body.message));
  if (data.type === 'scan-result') { scans += 1; out('scan', data.text); out('scans', scans); }
  if (data.type === 'scan-error') out('scan-error', data.message);
  if (data.type === 'scan-closed') out('scan-closed', 'yes');
});
document.getElementById('start').addEventListener('click', () => post({ type: 'scan-start' }));
document.getElementById('stop').addEventListener('click', () => post({ type: 'scan-stop' }));
// A screen has no camera or location API of its own inside the sandbox.
navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia({ video: true }).then(() => out('own-camera', 'allowed'), () => out('own-camera', 'blocked')) : out('own-camera', 'blocked');
navigator.geolocation ? navigator.geolocation.getCurrentPosition(() => out('own-location', 'allowed'), () => out('own-location', 'blocked')) : out('own-location', 'blocked');
post({ type: 'ready' });
`;

function pagesWith(devices?: string[]) {
  return [{
    pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', id: 'scan', title: 'Scan', routePath: 'scan',
    permission: 'wattanam.demo.view', parameters: [], dataSources: [],
    components: [{ id: 'scan-app', type: 'app', title: 'Scan', options: { entry: 'ui/index.html', minHeight: 300, ...(devices ? { devices } : {}) } }],
  }];
}

async function host(page: Page, devices?: string[]) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/plugin-ui/${pluginId}/${version}/ui/index.html`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: html });
    if (pathname === `/api/plugin-ui/${pluginId}/${version}/ui/app.js`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': CSP, 'cross-origin-resource-policy': 'cross-origin' }, body: app });
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages: pagesWith(devices) } });
    return route.fulfill({ status: 200, json: [] });
  });
}

// The school page's camera is replaced by a canvas showing a real QR code, so the whole path runs:
// getUserMedia on the host -> the host's decoder -> one bridge message to the screen.
async function fakeCamera(page: Page) {
  const matrix = new QRCodeWriter().encode(CODE, BarcodeFormat.QR_CODE, 33, 33, new Map());
  const cells: number[][] = [];
  for (let y = 0; y < matrix.getHeight(); y += 1) { const row: number[] = []; for (let x = 0; x < matrix.getWidth(); x += 1) row.push(matrix.get(x, y) ? 1 : 0); cells.push(row); }
  await page.addInitScript((qr) => {
    if (window.top !== window) return;
    (window as any).__cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__cameraRequests += 1;
      const scale = 10, margin = 4, size = (qr.length + margin * 2) * scale;
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        context.fillStyle = '#fff'; context.fillRect(0, 0, size, size); context.fillStyle = '#000';
        qr.forEach((row, y) => row.forEach((cell, x) => { if (cell) context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale); }));
      };
      draw();
      const timer = window.setInterval(draw, 100);
      const stream = (canvas as any).captureStream(10) as MediaStream;
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => window.clearInterval(timer)));
      return stream;
    };
  }, cells);
}

test('the host scans for a screen that declared the scanner and location', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser profile is enough for the device contract');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 11.5564, longitude: 104.9282 });
  await fakeCamera(page);
  await host(page, ['scanner', 'location']);
  await page.goto(`/plugins/${pluginId}/scan`);
  const frame = page.frameLocator('iframe[title="Scan"]');
  await expect(frame.locator('#devices')).toHaveText('devices=scanner+location', { timeout: 15_000 });
  // The screen's own device APIs stay blocked; the host answers the location request instead.
  await expect(frame.locator('#own-camera')).toHaveText('own-camera=blocked');
  await expect(frame.locator('#own-location')).toHaveText('own-location=blocked');
  await expect(frame.locator('#location')).toHaveText('location=200:11.5564,104.9282');

  // Nothing touches the camera until the screen asks.
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(0);
  await frame.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-plugin-scanner]')).toBeVisible();
  await expect(frame.locator('#scan')).toHaveText(`scan=${CODE}`, { timeout: 20_000 });
  // The same code staying in view is reported once per 1.5 s, not once per frame.
  await page.waitForTimeout(1000);
  expect(Number((await frame.locator('#scans').textContent())!.split('=')[1])).toBeLessThanOrEqual(2);

  // The person can always close the camera from the school page; the screen is told.
  await page.getByRole('button', { name: 'Close camera' }).click();
  await expect(page.locator('[data-plugin-scanner]')).toHaveCount(0);
  await expect(frame.locator('#scan-closed')).toHaveText('scan-closed=yes');
});

test('a screen that declared no devices gets no scanner and no location', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser profile is enough for the device contract');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 11.5564, longitude: 104.9282 });
  await fakeCamera(page);
  await host(page);
  await page.goto(`/plugins/${pluginId}/scan`);
  const frame = page.frameLocator('iframe[title="Scan"]');
  await expect(frame.locator('#devices')).toHaveText('devices=none', { timeout: 15_000 });
  await expect(frame.locator('#location')).toHaveText('location=403:This screen has not declared location.');
  await frame.getByRole('button', { name: 'Start' }).click();
  await expect(frame.locator('#scan-error')).toHaveText('scan-error=This screen has not declared the scanner.');
  await expect(page.locator('[data-plugin-scanner]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(0);
});
