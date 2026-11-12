import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import fs from 'node:fs';
import path from 'node:path';

// The plugins' own ID card screens (ui/id-cards: Academic Management >= 0.4.0, Organizing
// Management >= 0.27.0) rendered from the real plugin files inside the core's sandboxed frame.
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function plugin(pluginId: string) {
  const root = catalog ? path.resolve(catalog, pluginId) : '';
  const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
  const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
  const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
  const pageWithEntry = (entry: string) => descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === entry));
  return { pluginId, root, descriptor, version, pageWithEntry };
}

type Saved = { method: string; path: string; body: any };
async function host(page: Page, source: ReturnType<typeof plugin>, api: (method: string, apiPath: string, body: any) => unknown | undefined): Promise<Saved[]> {
  const { pluginId, root, descriptor, version } = source;
  const pages = descriptor.pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  const saved: Saved[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
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
      const body = request.method() === 'GET' ? null : request.postDataJSON();
      if (request.method() !== 'GET') saved.push({ method: request.method(), path: apiPath, body });
      const answer = api(request.method(), apiPath, body);
      if (answer !== undefined) return route.fulfill({ json: answer });
      if (request.method() !== 'GET') return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  return saved;
}

// Reads a rendered QR image back with an independent decoder (the scanner's library), so a card
// that looks right but encodes the wrong identifier fails here.
async function decodeQr(frame: FrameLocator, selector: string): Promise<string> {
  const image = await frame.locator(selector).first().evaluate((node) => {
    const img = node as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const luminance: number[] = [];
    for (let i = 0; i < data.length; i += 4) luminance.push(Math.round((data[i] + data[i + 1] + data[i + 2]) / 3));
    return { luminance, width, height };
  });
  const source = new RGBLuminanceSource(Uint8ClampedArray.from(image.luminance), image.width, image.height);
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
}

const academic = plugin('wattanam.academic-management');
const studentPage = academic.pageWithEntry('ui/id-cards/student.html');
const staffPage = academic.pageWithEntry('ui/id-cards/staff.html');

(studentPage ? test : test.skip)('Academic student ID cards run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const saved = await host(page, academic, (method, apiPath, body) => {
    if (method === 'GET' && apiPath === 'classes') return [{ id: 'c1', name: 'Grade 7A', studentCount: 2, studyYearId: 'y1', teacher: { name: 'Kim Vuthy' } }, { id: 'c2', name: 'Grade 6B', studentCount: 5, studyYearId: 'y0' }];
    if (method === 'GET' && apiPath === 'study-years') return [{ id: 'y0', label: '2025-2026' }, { id: 'y1', label: '2026-2027', isCurrent: true }];
    if (method === 'GET' && apiPath === 'id-cards/templates/student') return { schoolName: 'Angkor School', designPreset: 'royal-blue', primaryColor: '#1e3a8a', accentColor: '#2563eb' };
    if (method === 'GET' && apiPath === 'classes/c1/students') return [
      { id: 's1', name: 'Sok Dara', studentNumber: 'STU-0001', qrCode: 'wattanam:student:s1-7f3a', dateOfBirth: '2013-04-09T00:00:00.000Z', address: 'Siem Reap', user: { phone: '012 000 111' } },
      { id: 's2', name: 'Chea Lina', studentNumber: 'STU-0002', qrCode: '' },
    ];
    if (method === 'PUT' && apiPath === 'id-cards/templates/student') return body;
    return undefined;
  });

  await page.goto(`/plugins/${academic.pluginId}/${studentPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Student ID Cards"]');
  await expect(frame.getByRole('heading', { name: '🎓 Student ID Cards' })).toBeVisible({ timeout: 15_000 });
  // The current study year is preselected, so only its class is listed.
  await expect(frame.locator('#subtitle')).toHaveText('2026-2027 · 1 classes · 2 students');
  await expect(frame.locator('#t-schoolName')).toHaveValue('Angkor School');

  await frame.getByRole('button', { name: /Grade 7A/ }).click();
  await expect(frame.locator('.id-card-item')).toHaveCount(2);
  // Card identifiers are prepared before the students are listed.
  expect(saved[0]).toMatchObject({ method: 'POST', path: 'id-cards/classes/c1/ensure' });
  await expect(frame.locator('.id-card-details h2').first()).toHaveText('Sok Dara');
  await expect(frame.getByText('Date of birth: 2013-04-09')).toBeVisible();
  expect(await decodeQr(frame, 'img.id-card-qr')).toBe('wattanam:student:s1-7f3a');
  await expect(frame.locator('.id-card-qr-missing')).toHaveCount(1);

  // Design changes show on the cards at once and are saved as the shared template.
  await frame.locator('#t-footerText').fill('Valid for 2026-2027');
  await expect(frame.locator('.id-card-footer').first()).toHaveText('Valid for 2026-2027');
  await frame.getByRole('button', { name: /Heritage Red/ }).click();
  await expect(frame.locator('.id-card-item.is-landscape')).toHaveCount(2);
  await frame.getByRole('button', { name: 'Save Template' }).click();
  await expect(frame.getByRole('status')).toHaveText('Student card template saved.');
  expect(saved.at(-1)).toMatchObject({ method: 'PUT', path: 'id-cards/templates/student', body: { schoolName: 'Angkor School', designPreset: 'heritage-red', cardSize: 'cr80-landscape', footerText: 'Valid for 2026-2027' } });

  await frame.getByRole('button', { name: 'Preview 10 sample cards' }).click();
  await expect(frame.locator('.id-card-item')).toHaveCount(10);
  await page.screenshot({ path: testInfo.outputPath(`academic-student-id-cards-${testInfo.project.name}.png`), fullPage: true });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-student-id-cards-${testInfo.project.name}.png`), fullPage: true });
});

(staffPage ? test : test.skip)('Academic staff ID cards run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  await host(page, academic, (method, apiPath) => {
    if (method === 'GET' && apiPath === 'id-cards/staff') return [{ id: 'o1', name: 'Chan Sophea', employeeNumber: 'EMP-0001', position: 'Office Head', qrCode: 'wattanam:staff:o1-91bc', email: 'sophea@example.test', department: { name: 'Administration' } }];
    if (method === 'GET' && apiPath === 'id-cards/templates/staff') return {};
    return undefined;
  });
  await page.goto(`/plugins/${academic.pluginId}/${staffPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Staff ID Cards"]');
  await expect(frame.locator('#subtitle')).toHaveText('1 staff members', { timeout: 15_000 });
  await expect(frame.locator('.id-card-role')).toHaveText('Office Head');
  expect(await decodeQr(frame, 'img.id-card-qr')).toBe('wattanam:staff:o1-91bc');
  // The two-sided design prints a back face that carries the QR.
  await frame.getByRole('button', { name: /Cream Front & Back/ }).click();
  await expect(frame.locator('.id-card-back')).toHaveCount(1);
  expect(await decodeQr(frame, '.id-card-back-qr img')).toBe('wattanam:staff:o1-91bc');
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-staff-id-cards-${testInfo.project.name}.png`), fullPage: true });
});

const organizing = plugin('wattanam.organizing-management');
const workforcePage = organizing.pageWithEntry('ui/id-cards/staff.html');

(workforcePage ? test : test.skip)('Organizing workforce ID cards run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const saved = await host(page, organizing, (method, apiPath, body) => {
    if (method === 'GET' && apiPath === 'id-cards') return [{ id: 'e1', name: 'Ly Bopha', employeeNumber: 'EMP-014', position: 'Cashier', qrCode: 'wattanam:workforce:e1-55aa', phone: '099 111 222' }];
    if (method === 'GET' && apiPath === 'id-card-template/staff') return {};
    if (method === 'PUT' && apiPath === 'id-card-template/staff') return body;
    return undefined;
  });
  await page.goto(`/plugins/${organizing.pluginId}/${workforcePage.routePath}`);
  const frame = page.frameLocator('iframe[title="Workforce ID Cards"]');
  await expect(frame.locator('#subtitle')).toHaveText('1 staff members', { timeout: 15_000 });
  // Organization wording by default.
  await expect(frame.locator('#t-cardTitle')).toHaveValue('Workforce Identification Card');
  expect(await decodeQr(frame, 'img.id-card-qr')).toBe('wattanam:workforce:e1-55aa');
  await frame.getByRole('button', { name: 'Save Template' }).click();
  await expect(frame.getByRole('status')).toHaveText('Staff card template saved.');
  expect(saved.at(-1)).toMatchObject({ method: 'PUT', path: 'id-card-template/staff', body: { schoolName: 'Organization' } });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `organizing-id-cards-${testInfo.project.name}.png`), fullPage: true });
});
