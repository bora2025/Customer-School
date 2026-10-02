import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

const pluginId = 'wattanam.academic-management';
const pluginRoot = path.resolve(process.cwd(), '../plugins/wattanam.academic-management');
const descriptor = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'frontend/page.json'), 'utf8'));
const pages = descriptor.pages.map((page: Record<string, unknown>) => ({
  pluginId,
  schemaVersion: 2,
  kind: 'declarative-ui',
  ...page,
}));

const settings = {
  id: 'singleton',
  khmerNameMode: 'REQUIRED',
  phoneMode: 'REQUIRED',
  emailMode: 'REQUIRED',
  photoMode: 'OPTIONAL',
  passwordMode: 'REQUIRED',
  sexMode: 'HIDDEN',
  dateOfBirthMode: 'HIDDEN',
  addressMode: 'HIDDEN',
  generationMode: 'HIDDEN',
};

test.beforeEach(async ({ page }) => {
  const customFields = [{
    id: 'field-1', key: 'medical_note', label: 'Medical note', fieldType: 'TEXT',
    options: null, required: false, enabled: true, order: 0,
  }];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') {
      return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    }
    if (pathname === '/api/plugin-api/my-extensions') {
      return route.fulfill({ json: { navigation: [], pages } });
    }
    if (pathname === `/api/plugin-api/${pluginId}/admissions/settings` && request.method() === 'GET') {
      return route.fulfill({ json: settings });
    }
    if (pathname === `/api/plugin-api/${pluginId}/admissions/settings` && request.method() === 'PATCH') {
      Object.assign(settings, request.postDataJSON());
      return route.fulfill({ json: settings });
    }
    if (pathname === `/api/plugin-api/${pluginId}/admissions/fields` && request.method() === 'GET') {
      return route.fulfill({ json: customFields });
    }
    if (pathname === `/api/plugin-api/${pluginId}/admissions/fields` && request.method() === 'POST') {
      const body = request.postDataJSON();
      customFields.push({ id: 'field-2', key: 'learning_support', enabled: true, order: 1, ...body });
      return route.fulfill({ status: 201, json: customFields.at(-1) });
    }
    if (pathname === `/api/plugin-api/${pluginId}/admissions/fields/field-1` && request.method() === 'DELETE') {
      customFields.splice(customFields.findIndex((field) => field.id === 'field-1'), 1);
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
});

test('administrator manages registration settings and custom fields accessibly', async ({ page }, testInfo) => {
  await page.goto(`/plugins/${pluginId}/registration-settings`);
  await expect(page.getByRole('heading', { name: 'Registration Settings', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Medical note');

  await page.getByLabel('Khmer name').selectOption('OPTIONAL');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Registration settings saved', { exact: true })).toBeVisible();

  await page.getByLabel('Label').fill('Learning support');
  await page.getByLabel('Field type').selectOption('MULTI_SELECT');
  await page.getByLabel('Options (JSON array; at least two for select fields)').fill('["Reading", "Numeracy"]');
  await page.getByRole('button', { name: 'Create field' }).click();
  await expect(page.getByText('Custom registration field created', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Learning support');

  await page.getByLabel('Select row 1').check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected fields' }).click();
  await expect(page.getByText('1 action completed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).not.toContainText('Medical note');

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  const results = await new AxeBuilder({ page }).include('.page-body').analyze();
  expect(
    results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact || '')),
    `${testInfo.project.name}: ${results.violations.map((item) => item.id).join(', ')}`,
  ).toEqual([]);
});
