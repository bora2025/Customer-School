import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const descriptorPath = path.resolve(process.cwd(), '../plugins/wattanam.document-designer/frontend/page.json');
const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
const pages = descriptor.pages.map((page: Record<string, unknown>) => ({
  pluginId: 'wattanam.document-designer',
  schemaVersion: 2,
  kind: 'declarative-ui',
  ...page,
}));

const template = {
  id: 'template-1',
  name: 'Student Card',
  documentType: 'student',
  isActive: true,
  updatedAt: '2026-09-15T09:00:00.000Z',
  createdAt: '2026-09-15T08:00:00.000Z',
  design: { page: { width: 400, height: 240, background: '#ffffff' }, elements: [{ id: 'name', type: 'text', x: 20, y: 20, width: 180, height: 40, rotation: 0, text: 'Student name', color: '#111827', fontSize: 18, fontWeight: 'normal', textAlign: 'left' }] },
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') {
      return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    }
    if (pathname === '/api/plugin-api/my-extensions') {
      return route.fulfill({ json: { navigation: [{ pluginId: 'wattanam.document-designer', id: 'templates', label: 'Document Designer', href: '/plugins/wattanam.document-designer/templates', permission: 'wattanam.document-designer.view' }], pages } });
    }
    if (pathname === '/api/plugin-api/wattanam.document-designer/templates' && request.method() === 'GET') {
      return route.fulfill({ json: [template] });
    }
    if (pathname === '/api/plugin-api/wattanam.document-designer/templates' && request.method() === 'POST') {
      return route.fulfill({ json: { ...template, id: 'template-2', name: 'Created Template' } });
    }
    if (pathname === '/api/plugin-api/wattanam.document-designer/templates/template-1' && request.method() === 'GET') {
      return route.fulfill({ json: template });
    }
    if (pathname === '/api/plugin-api/wattanam.document-designer/templates/template-1' && request.method() === 'PATCH') {
      return route.fulfill({ json: { ...template, ...request.postDataJSON() } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
});

test('renders document-designer list page from plugin descriptor and supports create flow', async ({ page }) => {
  await page.goto('/plugins/wattanam.document-designer/templates');

  await expect(page.getByRole('heading', { name: 'Document Designer' })).toBeVisible();
  await expect(page.getByText('wattanam.document-designer').first()).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText('Student Card');

  await page.getByLabel('Name').fill('Created Template');
  await page.getByLabel('Document type').fill('student');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Template created');
});

test('renders document-designer detail page route via plugin host', async ({ page }) => {
  await page.goto('/plugins/wattanam.document-designer/templates/template-1');

  await expect(page.getByRole('heading', { name: 'Document template' })).toBeVisible();
  await expect(page.getByText('Student Card').first()).toBeVisible();
  await expect(page.getByText('student').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save design' })).toHaveCount(0);
});

test('moves and resizes a bounded design element through the host visual editor', async ({ page }) => {
  await page.goto('/plugins/wattanam.document-designer/templates/edit/template-1');
  await expect(page.getByRole('heading', { name: 'Edit document template' })).toBeVisible();
  const element = page.getByRole('button', { name: 'text name' });
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 40, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 80, box!.y + 50);
  await page.mouse.up();
  await expect(page.getByLabel('x', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('y', { exact: true })).toHaveValue('50');

  const resize = page.getByRole('separator', { name: 'Resize name' });
  const handle = await resize.boundingBox();
  await page.mouse.move(handle!.x + 4, handle!.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 34, handle!.y + 24);
  await page.mouse.up();
  await expect(page.getByLabel('width', { exact: true })).toHaveValue('210');
  await expect(page.getByLabel('height', { exact: true })).toHaveValue('60');

  const request = page.waitForRequest((candidate) => candidate.method() === 'PATCH' && candidate.url().endsWith('/templates/template-1'));
  await page.getByRole('button', { name: 'Save design' }).click();
  const payload = (await request).postDataJSON();
  expect(payload.name).toBe('Student Card');
  expect(payload.design.elements[0]).toMatchObject({ id: 'name', x: 60, y: 50, width: 210, height: 60 });
  await expect(page.getByRole('status')).toContainText('Design saved');
});

test('adds and saves a host-rendered shape without plugin HTML or script', async ({ page }) => {
  await page.goto('/plugins/wattanam.document-designer/templates/edit/template-1');
  await page.getByRole('button', { name: 'Add shape' }).click();
  const shape = page.getByRole('button', { name: /^shape shape-/ });
  await expect(shape).toBeVisible();
  await page.getByRole('combobox', { name: 'Shape' }).selectOption('circle');
  await page.getByRole('spinbutton', { name: 'Border width' }).fill('4');
  await page.getByRole('button', { name: 'Add photo' }).click();
  await page.getByRole('textbox', { name: 'Record binding' }).fill('profile.photo');

  const request = page.waitForRequest((candidate) => candidate.method() === 'PATCH' && candidate.url().endsWith('/templates/template-1'));
  await page.getByRole('button', { name: 'Save design' }).click();
  const payload = (await request).postDataJSON();
  expect(payload.design.elements[1]).toMatchObject({ type: 'shape', shapeType: 'circle', borderWidth: 4 });
  expect(payload.design.elements[2]).toMatchObject({ type: 'photo', binding: 'profile.photo' });
  await expect(page.getByRole('status')).toContainText('Design saved');
});
