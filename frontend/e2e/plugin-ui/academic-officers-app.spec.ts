import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Academic Management's own Manage Officers screen (ui/officers, plugin >= 0.4.0) rendered from the
// real plugin files inside the core's sandboxed frame, talking through the bridge.
const pluginId = 'wattanam.academic-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const root = catalog ? path.resolve(catalog, pluginId) : '';
const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const officersPage = descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === 'ui/officers/index.html'));
const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

(officersPage ? test : test.skip)('Academic Management officers run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const pages = descriptor.pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  const departments = [{ id: 'd1', name: 'Administration', nameKh: 'រដ្ឋបាល', description: 'Front office' }, { id: 'd2', name: 'Finance' }];
  const officers: any[] = [
    { id: 'o1', userId: 'u1', name: 'Chan Sophea', email: 'sophea@example.test', phone: '011 111 111', employeeNumber: 'EMP-0001', position: 'OFFICE_HEAD', departmentId: 'd1', department: departments[0], employmentStatus: 'ACTIVE' },
    { id: 'o2', userId: 'u2', name: 'Kim Vuthy', email: 'vuthy@example.test', employeeNumber: 'EMP-0002', position: 'TEACHER', departmentId: 'd2', department: departments[1], employmentStatus: 'ACTIVE' },
  ];
  const saved: Array<{ method: string; path: string; body: any }> = [];
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
      if (request.method() === 'GET' && apiPath === 'officers') return route.fulfill({ json: officers });
      if (request.method() === 'GET' && apiPath === 'departments') return route.fulfill({ json: departments });
      if (request.method() !== 'GET') {
        const body = request.method() === 'DELETE' ? null : request.postDataJSON();
        saved.push({ method: request.method(), path: apiPath, body });
        if (request.method() === 'POST' && apiPath === 'officers') officers.push({ id: 'o3', userId: 'u3', ...body, employmentStatus: 'ACTIVE' });
        if (request.method() === 'PATCH') Object.assign(officers.find((item) => `officers/${item.id}` === apiPath) || {}, body);
        return route.fulfill({ status: 200, json: { ok: true } });
      }
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.goto(`/plugins/${pluginId}/${officersPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Manage Officers"]');
  await expect(frame.getByRole('heading', { name: 'Manage Officers' })).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#summary')).toHaveText('2 Officers · 2 Departments');
  await expect(frame.getByRole('cell', { name: 'sophea@example.test' })).toBeVisible();

  // Search and the position filter narrow the table.
  await frame.getByLabel('Search officers').fill('vuthy');
  await expect(frame.locator('#rows tr')).toHaveCount(1);
  await frame.getByLabel('Search officers').fill('');
  await frame.getByRole('button', { name: 'Office Head (1)' }).click();
  await expect(frame.locator('#rows tr')).toHaveCount(1);
  await frame.getByRole('button', { name: 'All (2)' }).click();

  // Creating an officer validates first, then posts once with an idempotency key.
  await frame.getByRole('button', { name: '＋ Add Officer' }).click();
  await frame.getByRole('button', { name: 'Create Officer' }).click();
  await expect(frame.locator('#form-error')).toContainText('at least 8 characters');
  expect(saved).toHaveLength(0);
  await frame.locator('#f-name').fill('Ly Bopha');
  await frame.locator('#f-email').fill('bopha@example.test');
  await frame.locator('#f-password').fill('temporary-pass-1');
  await frame.locator('#f-position').selectOption('STAFF');
  await frame.locator('#f-departmentId').selectOption('d2');
  await frame.getByRole('button', { name: 'Create Officer' }).click();
  await expect(frame.getByRole('status')).toContainText('created successfully');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ method: 'POST', path: 'officers', body: { name: 'Ly Bopha', email: 'bopha@example.test', position: 'STAFF', departmentId: 'd2', employmentStatus: 'ACTIVE', phone: null } });
  expect(String(saved[0].body.commandKey)).toMatch(/^officer:/);
  await expect(frame.locator('#summary')).toHaveText('3 Officers · 2 Departments');

  // Deactivating asks first (a native dialog works inside the sandbox) and then patches.
  page.once('dialog', (dialog) => dialog.accept());
  await frame.getByRole('button', { name: 'Deactivate officer' }).first().click();
  await expect(frame.getByRole('status')).toHaveText('Officer deactivated.');
  expect(saved[1]).toMatchObject({ method: 'PATCH', path: 'officers/o1', body: { employmentStatus: 'INACTIVE' } });

  await frame.getByRole('tab', { name: /Departments/ }).click();
  await expect(frame.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`academic-officers-${testInfo.project.name}.png`), fullPage: true });
  await frame.getByRole('tab', { name: /Officers/ }).click();
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-officers-${testInfo.project.name}.png`), fullPage: true });

  // Edit opens the plugin's own edit page in the school window.
  await frame.getByRole('button', { name: 'Edit officer' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/plugins/${pluginId}/officers/edit/o1$`));
});
