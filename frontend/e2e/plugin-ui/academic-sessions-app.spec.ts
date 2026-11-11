import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Academic Management's own Session Time Settings screen (ui/sessions, plugin >= 0.3.7) rendered
// from the real plugin files inside the core's sandboxed frame, talking through the bridge.
const pluginId = 'wattanam.academic-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const root = catalog ? path.resolve(catalog, pluginId) : '';
const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const settingsPage = descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === 'ui/sessions/index.html'));
const appTest = settingsPage ? test : test.skip;
const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

appTest('Academic Management session settings run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const pages = descriptor.pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
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
    if (pathname === `${apiPrefix}sessions` && request.method() === 'GET') return route.fulfill({ json: [{ id: 's1', scope: 'STUDENT', classId: '', session: 1, type: 'CHECK_IN', startTime: '06:45:00', endTime: '07:05:00' }] });
    if (pathname === `${apiPrefix}session-settings` && request.method() === 'GET') return route.fulfill({ json: { classFormat: 'CUSTOM', classFormatRules: true, staffFormatRules: false, staffWorkingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'] } });
    if (pathname.startsWith(apiPrefix) && request.method() !== 'GET') {
      saved.push({ method: request.method(), path: pathname.slice(apiPrefix.length), body: request.postDataJSON() });
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.goto(`/plugins/${pluginId}/${settingsPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Session Time Settings"]');
  await expect(frame.getByRole('heading', { name: 'Session Time Settings' })).toBeVisible({ timeout: 15_000 });
  // Values loaded through the bridge from the plugin's own API.
  await expect(frame.getByLabel('Morning 1 start time')).toHaveValue('06:45');
  await expect(frame.locator('#format-rules')).toBeChecked();

  await frame.getByRole('button', { name: /Full Day/ }).click();
  await expect(frame.getByLabel('Morning 1 start time')).toHaveValue('07:00');
  await frame.getByRole('button', { name: /Save Class Settings/ }).click();
  await expect(frame.getByRole('status')).toHaveText('Class session settings saved.');
  expect(saved.filter((entry) => entry.path === 'sessions')).toHaveLength(4);
  expect(saved.find((entry) => entry.path === 'session-settings')).toMatchObject({ method: 'PUT', body: { classFormat: 'FULL', classFormatRules: true } });

  await frame.getByRole('tab', { name: 'Staff Sessions' }).click();
  await expect(frame.getByRole('button', { name: /Sat ⊘ Off/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`academic-sessions-${testInfo.project.name}.png`), fullPage: true });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-sessions-${testInfo.project.name}.png`), fullPage: true });
});
