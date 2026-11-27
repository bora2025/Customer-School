import { expect, test } from '@playwright/test';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';
import fs from 'node:fs';
import path from 'node:path';

// Smart Attendance's automatic station (0.4+): the device registers itself with nothing to type, a
// Wattaman's device starts at once, and one camera reads ID-card QR codes while faces are looked for;
// a USB reader typing a card number is caught too. Runs against the real plugin files.
const pluginId = 'wattanam.smart-attendance';
const catalog = process.env.PLUGIN_SOURCE_CATALOG || '';
const root = path.resolve(catalog, pluginId);
const has = fs.existsSync(path.join(root, 'ui', 'station', 'station.js')) && /startAuto/.test(fs.readFileSync(path.join(root, 'ui', 'station', 'station.js'), 'utf8'));
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CODE = 'wattanam:student:s7-41aa';

(has ? test : test.skip)('Wattaman station: no typing, opens automatically, records QR codes and USB cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough for the camera');
  test.setTimeout(120_000);
  // the school page's camera shows a student's ID-card QR code
  const matrix = new QRCodeWriter().encode(CODE, BarcodeFormat.QR_CODE, 33, 33, new Map());
  const cells: number[][] = [];
  for (let y = 0; y < matrix.getHeight(); y += 1) { const row: number[] = []; for (let x = 0; x < matrix.getWidth(); x += 1) row.push(matrix.get(x, y) ? 1 : 0); cells.push(row); }
  await page.addInitScript((qr) => {
    if (window.top !== window) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const scale = 8, margin = 4, size = (qr.length + margin * 2) * scale;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const draw = () => { const c = canvas.getContext('2d')!; c.fillStyle = '#fff'; c.fillRect(0, 0, 640, 480); c.fillStyle = '#000'; const ox = (640 - size) / 2, oy = (480 - size) / 2; qr.forEach((row, y) => row.forEach((cell, x) => { if (cell) c.fillRect(ox + (x + margin) * scale, oy + (y + margin) * scale, scale, scale); })); };
      draw(); window.setInterval(draw, 100);
      return (canvas as any).captureStream(10) as MediaStream;
    };
  }, cells);

  const version = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version;
  const pages = JSON.parse(fs.readFileSync(path.join(root, 'frontend/page.json'), 'utf8')).pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  let station: any = null;
  const captures: any[] = [];
  const registrations: any[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const prefix = `/api/plugin-ui/${pluginId}/${version}/`;
    if (url.pathname.startsWith(prefix)) {
      const file = path.join(root, ...url.pathname.slice(prefix.length).split('/'));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, headers: { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP }, body: fs.readFileSync(file) });
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 'guard-1', role: 'WATTAMAN', email: 'guard@example.test' } });
    if (url.pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    const api = `/api/plugin-api/${pluginId}/`;
    if (url.pathname.startsWith(api)) {
      const apiPath = url.pathname.slice(api.length);
      if (apiPath === 'stations/me') return route.fulfill({ json: { station } });
      if (apiPath === 'stations/register') {
        registrations.push(request.postDataJSON());
        station = { id: 'st1', name: `Wattaman · ${request.postDataJSON().device} · 2026-11-20`, place: '', status: 'ACTIVE', mode: 'AUTO', methods: ['QR', 'NFC', 'FACE'], classIds: [], kind: 'STATION' };
        return route.fulfill({ json: { station, autoApproved: true } });
      }
      if (apiPath === 'captures' && request.method() === 'POST') {
        const body = request.postDataJSON(); captures.push(body);
        return route.fulfill({ json: { id: `c${captures.length}`, result: 'MATCHED', status: 'RECORDED', attendanceStatus: 'PRESENT', capturedAt: body.capturedAt, person: { id: 's7', number: '0007', name: 'Keo Sophea', nameKh: 'កែវ សុភា', className: '9C' } } });
      }
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.goto(`/plugins/${pluginId}/station`);
  // nothing typed: the device registered itself and the automatic station opened by itself
  const overlay = page.locator('[data-plugin-face]');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  await expect(overlay).toContainText('Automatic: face, QR code and card readers');
  expect(registrations).toHaveLength(1);
  expect(registrations[0]).toEqual(expect.objectContaining({ device: expect.stringMatching(/ on /) }));
  expect(registrations[0].name).toBeUndefined();

  // the camera's QR code is recorded once (not every frame)
  await expect.poll(() => captures.filter((c) => c.code === CODE).length, { timeout: 60_000 }).toBe(1);
  expect(captures[0]).toMatchObject({ code: CODE, source: 'CAMERA', method: 'QR', deviceId: expect.any(String) });
  await expect(page.locator('[data-face-hint]')).toContainText('កែវ សុភា', { timeout: 10_000 });

  // a USB card reader types the card number and Enter
  await page.keyboard.type('04A1B2C3D4', { delay: 5 });
  await page.keyboard.press('Enter');
  await expect.poll(() => captures.filter((c) => c.source === 'USB').length, { timeout: 10_000 }).toBe(1);
  expect(captures.find((c) => c.source === 'USB')).toMatchObject({ code: '04A1B2C3D4', method: 'AUTO' });
  await page.screenshot({ path: testInfo.outputPath('auto-station.png') });
  expect(captures.filter((c) => c.code === CODE)).toHaveLength(1);
});
