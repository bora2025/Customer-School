import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Renders the real Academic Management attendance dashboard (from PLUGIN_SOURCE_CATALOG) and checks
// that its declared `appearance` reaches the screen: a grid page whose metrics sit two per row on
// wide screens and stack on phones, with the brand accent bar beside the heading.
const pluginId = 'wattanam.academic-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const descriptorPath = catalog ? path.resolve(catalog, pluginId, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const dashboard = descriptor.pages.find((page: { id: string }) => page.id === 'attendance-dashboard');
const appearanceTest = dashboard?.appearance ? test : test.skip;
const pages = descriptor.pages.map((page: Record<string, unknown>) => ({ pluginId, schemaVersion: 2, kind: 'declarative-ui', ...page }));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    if (pathname.endsWith('/attendance/dashboard-authoritative')) {
      return route.fulfill({ json: { student: { expected: 480, present: 452, absent: 28 }, staff: { present: 37 } } });
    }
    return route.fulfill({ status: 200, json: [] });
  });
});

appearanceTest('attendance dashboard follows the plugin-declared appearance', async ({ page }, testInfo) => {
  await page.goto(`/plugins/${pluginId}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Attendance Dashboard', exact: true }).first()).toBeVisible();
  const region = page.getByRole('region', { name: dashboard.title });
  await expect(region).toHaveClass(/grid-cols-12/);
  await expect(region.locator('span.bg-teal-500')).toBeVisible();

  const metrics = ['Expected student sessions', 'Students present', 'Students absent', 'Staff present'];
  for (const title of metrics) await expect(region.getByText(title, { exact: true })).toBeVisible();
  await expect(region.getByText('452', { exact: true })).toBeVisible();
  await expect(region).not.toContainText('[object Object]');
  const boxes = await Promise.all(metrics.map((title) => region.locator('section', { hasText: title }).first().boundingBox()));
  const [first, second, third] = boxes.map((box) => box!);
  if (testInfo.project.name === 'desktop') {
    expect(Math.abs(first.y - second.y)).toBeLessThan(2);
    expect(third.y).toBeGreaterThan(first.y + first.height - 2);
    expect(first.width).toBeLessThan((await region.boundingBox())!.width * 0.6);
  } else if (testInfo.project.name === 'phone') {
    expect(second.y).toBeGreaterThan(first.y + first.height - 2);
  }
  if (process.env.APPEARANCE_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `dashboard-${testInfo.project.name}.png`), fullPage: true });
  }
});
