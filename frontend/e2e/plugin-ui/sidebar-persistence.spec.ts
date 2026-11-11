import { expect, test } from '@playwright/test';

// Navigating between pages must not "refresh" the sidebar: plugin menu entries stay visible (no
// refetch-and-pop-in), the collapsed state and scroll position survive, and the menu data is
// fetched once per minute at most, not once per page.
test('the sidebar keeps its menu, state and scroll position across navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the persistent desktop sidebar is what this covers');
  let extensionCalls = 0;
  let versionCalls = 0;
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/version') { versionCalls += 1; return route.fulfill({ json: { distribution: 'core' } }); }
    if (pathname === '/api/plugin-api/my-extensions') {
      extensionCalls += 1;
      // Answer slowly: before this change, the plugin entry vanished for this long on every page.
      await new Promise((resolve) => setTimeout(resolve, 800));
      return route.fulfill({ json: {
        navigation: [{ pluginId: 'wattanam.demo', label: 'Demo Records', href: '/plugins/wattanam.demo/records', icon: 'clipboard', order: 50 }],
        pages: [{ pluginId: 'wattanam.demo', pluginVersion: '1.0.0', schemaVersion: 2, kind: 'declarative-ui', id: 'records', title: 'Demo Records', routePath: 'records', permission: 'wattanam.demo.view', parameters: [], dataSources: [], components: [{ id: 'h', type: 'heading', title: 'Demo Records' }] }],
      } });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.goto('/admin/users');
  const aside = page.locator('aside').first();
  const pluginEntry = aside.getByRole('link', { name: /Demo Records/ });
  await expect(pluginEntry).toBeVisible({ timeout: 15_000 });

  // Scroll the menu and remember where it was.
  const menu = aside.locator('nav').first();
  await menu.evaluate((element) => { element.scrollTop = 120; });
  const scrolled = await menu.evaluate((element) => element.scrollTop);

  // Navigate through the sidebar: the plugin entry must be present on the new page's first paint.
  await pluginEntry.click();
  await page.waitForURL('**/plugins/wattanam.demo/records');
  await expect(aside.getByRole('link', { name: /Demo Records/ })).toBeVisible({ timeout: 300 });
  await expect(page.getByRole('heading', { name: 'Demo Records' }).first()).toBeVisible({ timeout: 15_000 });
  expect(await aside.locator('nav').first().evaluate((element) => element.scrollTop)).toBe(scrolled);

  // Collapse, navigate back: it stays collapsed.
  await aside.getByTitle('Collapse sidebar').click();
  await expect(aside).toHaveClass(/w-14/);
  await page.goBack();
  await page.waitForURL('**/admin/users');
  await expect(page.locator('aside').first()).toHaveClass(/w-14/);

  // One load of the sidebar's menu data for the whole visit, not one per page. /api/version is
  // requested only by the sidebar (pages may fetch my-extensions themselves for their content).
  expect(versionCalls).toBe(1);
  expect(extensionCalls).toBeGreaterThan(0);
});

test('the desktop sidebar stays fixed while a long page scrolls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sticky sidebar is a desktop layout');
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages: [] } });
    return route.fulfill({ status: 200, json: [] });
  });
  await page.goto('/admin/users');
  const aside = page.locator('aside').first();
  await expect(aside).toBeVisible({ timeout: 15_000 });
  // Make the page much taller than the window, as long plugin forms and tables are.
  await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '4000px'; document.querySelector('.page-content')?.appendChild(spacer); });
  await page.mouse.wheel(0, 2500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const box = await aside.boundingBox();
  expect(box?.y).toBe(0);
  expect(Math.round(box?.height || 0)).toBe(page.viewportSize()!.height);
});
