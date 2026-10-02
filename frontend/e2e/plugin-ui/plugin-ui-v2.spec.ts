import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

const template = fs.readFileSync(path.resolve(process.cwd(), '../packages/plugin-cli/templates/default/frontend/page.json'), 'utf8');
const descriptor = JSON.parse(template.replaceAll('{{publisher}}', 'acme').replaceAll('{{name}}', 'widget').replaceAll('{{displayName}}', 'Acme Widget'));
const pages = descriptor.pages.map((page: Record<string, unknown>) => ({ pluginId: 'acme.widget', schemaVersion: 2, kind: 'declarative-ui', ...page }));
const records = [
  { id: 'record-1', name: 'First record', status: 'active', createdAt: '2026-09-14T08:00:00.000Z' },
  { id: 'record-2', name: 'Second record', status: 'draft', createdAt: '2026-09-14T09:00:00.000Z' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    if (pathname === '/api/plugin-api/acme.widget/records' && request.method() === 'GET') return route.fulfill({ json: records });
    if (pathname === '/api/plugin-api/acme.widget/records' && request.method() === 'POST') return route.fulfill({ json: { id: 'record-3', name: 'Created record', status: 'active' } });
    if (pathname === '/api/plugin-api/acme.widget/records/record-1' && request.method() === 'GET') return route.fulfill({ json: records[0] });
    if (pathname === '/api/plugin-api/acme.widget/records/record-1' && request.method() === 'PATCH') return route.fulfill({ json: { ...records[0], name: 'Updated record' } });
    return route.fulfill({ status: 200, json: {} });
  });
});

test('list/create/print workflow is keyboard accessible with no serious axe findings', async ({ page }, testInfo) => {
  await page.goto('/plugins/acme.widget/records');
  await expect(page.getByRole('heading', { name: 'Acme Widget records' })).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText('First record');
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await page.getByLabel('Name').fill('Created record');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Record created');
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  const results = await new AxeBuilder({ page }).include('.page-body').analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || '')),
    `${testInfo.project.name}: ${results.violations.map((item) => item.id).join(', ')}`).toEqual([]);
});

test('detail/edit workflow fits the viewport without document overflow', async ({ page }) => {
  await page.goto('/plugins/acme.widget/records/record-1');
  await expect(page.getByRole('heading', { name: 'Acme Widget record' })).toBeVisible();
  await expect(page.getByText('First record').first()).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await page.getByLabel('Name').fill('Updated record');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Record saved');
});
