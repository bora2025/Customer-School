import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Organizing Management's own screens (ui/attendance-settings and ui/profile, plugin >= 0.26.0)
// rendered from the real plugin files inside the core's sandboxed frame, talking through the bridge.
const pluginId = 'wattanam.organizing-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const root = catalog ? path.resolve(catalog, pluginId) : '';
const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const pageWithEntry = (entry: string) => descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === entry));
const settingsPage = pageWithEntry('ui/attendance-settings/index.html');
const profilePage = pageWithEntry('ui/profile/index.html');
const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const employeeId = '7b0c2f0e-2a53-4a51-9d55-0d3a5d2b8a11';

type Saved = { method: string; path: string; body: any };

async function host(page: Page, api: (method: string, apiPath: string) => unknown | undefined): Promise<Saved[]> {
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
      if (request.method() !== 'GET') {
        saved.push({ method: request.method(), path: apiPath, body: request.postDataJSON() });
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      const answer = api(request.method(), apiPath);
      if (answer !== undefined) return route.fulfill({ json: answer });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  return saved;
}

(settingsPage ? test : test.skip)('Organizing Management attendance settings run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const saved = await host(page, (_method, apiPath) => {
    if (apiPath === 'attendance/sessions') return [{ scope: 'STAFF', session: 1, type: 'CHECK_IN', startTime: '06:45', endTime: '07:10' }];
    if (apiPath === 'attendance/session-settings') return { classFormat: 'CUSTOM', classFormatRules: false, staffFormatRules: true, staffWorkingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] };
    return undefined;
  });

  await page.goto(`/plugins/${pluginId}/${settingsPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Workforce Session Settings"]');
  await expect(frame.getByRole('heading', { name: 'Workforce Attendance Settings' })).toBeVisible({ timeout: 15_000 });
  // Values loaded through the bridge from the plugin's own API.
  await expect(frame.getByLabel('Morning 1 start time')).toHaveValue('06:45');
  await expect(frame.locator('#format-rules')).toBeChecked();
  await expect(frame.getByRole('button', { name: /Sat ⊘ Off/ })).toBeVisible();

  // A session that ends before it starts is refused before anything is sent.
  await frame.getByLabel('Morning 1 end time').fill('06:00');
  await frame.getByRole('button', { name: /Save Workforce Settings/ }).click();
  await expect(frame.getByRole('alert')).toContainText('end time must be after the start time');
  expect(saved).toHaveLength(0);

  await frame.getByLabel('Morning 1 end time').fill('07:15');
  await frame.getByRole('button', { name: 'Mon–Sat' }).click();
  await frame.getByRole('button', { name: /Save Workforce Settings/ }).click();
  await expect(frame.getByRole('status')).toHaveText('Workforce session settings saved.');
  const sessions = saved.filter((entry) => entry.path === 'attendance/sessions');
  expect(sessions).toHaveLength(4);
  expect(sessions[0]).toMatchObject({ method: 'POST', body: { scope: 'STAFF', session: 1, type: 'CHECK_IN', startTime: '06:45', endTime: '07:15' } });
  expect(saved.find((entry) => entry.path === 'attendance/session-settings')).toMatchObject({ method: 'PUT', body: { staffFormatRules: true, staffWorkingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] } });
  await page.screenshot({ path: testInfo.outputPath(`organizing-attendance-settings-${testInfo.project.name}.png`), fullPage: true });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `organizing-attendance-settings-${testInfo.project.name}.png`), fullPage: true });
});

(profilePage ? test : test.skip)('Organizing Management employee profile runs as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const saved = await host(page, (_method, apiPath) => {
    if (apiPath === `employees/${employeeId}`) return { id: employeeId, employeeNumber: 'EMP-0042', fullName: 'Sok Dara', email: 'dara@example.test', phone: '012 345 678', position: 'Cashier', department: 'Front Store', employmentType: 'EMPLOYEE', employmentStatus: 'ACTIVE', photoUrl: '', startDate: '2026-02-01T00:00:00.000Z', notes: '' };
    if (apiPath === `employees/${employeeId}/relations`) return { employee: { baseSalaryMinor: 45000, salaryCurrency: 'USD', salaryBasis: 'MONTHLY' }, idCard: { name: 'Sok Dara', employeeNumber: 'EMP-0042', position: 'Cashier' }, rewards: [{ id: 'r1', adjustmentType: 'BONUS', reason: 'Year-end bonus' }], deductions: [], permissions: [{ id: 'p1', permissionType: 'SICK', reason: 'Clinic visit' }, { id: 'p2', permissionType: 'ANNUAL', reason: 'Family trip' }], disciplinaryActions: [], promotions: [], payroll: [] };
    return undefined;
  });

  await page.goto(`/plugins/${pluginId}/${profilePage.routePath.replace(':id', employeeId)}`);
  const frame = page.frameLocator('iframe[title="Employee / Employer Profile"]');
  await expect(frame.getByRole('heading', { name: 'Sok Dara' })).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('#salary')).toContainText('450');
  await expect(frame.locator('#fact-number')).toHaveText('EMP-0042');
  await expect(frame.getByText('Year-end bonus')).toBeVisible();
  await frame.getByRole('button', { name: /Permissions & leave/ }).click();
  await expect(frame.getByText('Clinic visit')).toBeVisible();

  // Read-only until Edit profile; Cancel discards the edit.
  const phone = frame.locator('[data-field="phone"]');
  await expect(phone).toBeDisabled();
  await frame.getByRole('button', { name: 'Edit profile' }).click();
  await phone.fill('099 000 111');
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await expect(phone).toHaveValue('012 345 678');
  expect(saved).toHaveLength(0);

  await frame.getByRole('button', { name: 'Edit profile' }).click();
  await phone.fill('099 000 111');
  await frame.locator('[data-field="employmentStatus"]').selectOption('ON_LEAVE');
  await frame.getByRole('button', { name: 'Save changes' }).click();
  await expect(frame.getByRole('status')).toHaveText('Profile updated successfully.');
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ method: 'PUT', path: `employees/${employeeId}`, body: { fullName: 'Sok Dara', phone: '099 000 111', employmentStatus: 'ON_LEAVE', employeeNumber: 'EMP-0042' } });
  await page.screenshot({ path: testInfo.outputPath(`organizing-profile-${testInfo.project.name}.png`), fullPage: true });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `organizing-profile-${testInfo.project.name}.png`), fullPage: true });
});
