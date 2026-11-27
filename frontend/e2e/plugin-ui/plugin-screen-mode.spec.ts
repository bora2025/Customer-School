import { expect, test, type Page } from '@playwright/test';

// Screen mode: a plugin page shown alone (?screen=1) for a customer or kitchen display, and "Show on a screen"
// on pages that declare appearance.screen = "kiosk" (the monitor is chosen in Chrome / Edge).
const pluginId = 'acme.display';
const page = (id: string, routePath: string, appearance?: Record<string, string>) => ({
  pluginId, pluginVersion: '1.0.0', schemaVersion: 2, kind: 'declarative-ui', id, title: id === 'screen' ? 'Customer Display' : 'Settings', routePath,
  permission: `${pluginId}.view`, parameters: [], dataSources: [], ...(appearance ? { appearance } : {}),
  components: [{ id: 'hello', type: 'heading', title: id === 'screen' ? 'Welcome to the café' : 'Settings page' }],
});

async function serve(p: Page) {
  await p.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (url.pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages: [page('screen', 'display', { screen: 'kiosk' }), page('settings', 'settings')] } });
    return route.fulfill({ status: 200, json: [] });
  });
}

test('pages that ask for it can be shown on another screen, chosen from the monitors', async ({ page: p }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough');
  await serve(p);
  // two monitors; window.open is recorded instead of opening
  await p.addInitScript(() => {
    (window as any).__opened = [];
    (window as any).getScreenDetails = async () => ({ screens: [
      { label: 'Built-in', isPrimary: true, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040, width: 1920, height: 1080 },
      { label: 'Customer screen', isPrimary: false, availLeft: 1920, availTop: 0, availWidth: 1280, availHeight: 800, width: 1280, height: 800 },
    ] });
    window.open = ((url: string, name: string, features: string) => { (window as any).__opened.push({ url, name, features }); return {} as Window; }) as typeof window.open;
  });
  await p.goto(`/plugins/${pluginId}/settings`);
  await expect(p.getByText('Settings page')).toBeVisible({ timeout: 30_000 });
  await expect(p.getByRole('button', { name: '🖥️ Show on a screen' })).toHaveCount(0); // not declared there

  await p.goto(`/plugins/${pluginId}/display`);
  await p.getByRole('button', { name: '🖥️ Show on a screen' }).click();
  await p.getByRole('button', { name: /Customer screen · 1280×800/ }).click();
  const opened = await p.evaluate(() => (window as any).__opened);
  expect(opened).toHaveLength(1);
  expect(opened[0].url).toBe(`/plugins/${pluginId}/display?screen=1&fs=1`);
  expect(opened[0].features).toBe('popup,left=1920,top=0,width=1280,height=800');
  await expect(p.getByText('Opened on that screen')).toBeVisible();
});

test('screen mode shows the page alone, with full screen on a tap and a way back', async ({ page: p }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover it');
  await serve(p);
  await p.goto(`/plugins/${pluginId}/display?screen=1&fs=1`);
  await expect(p.locator('[data-plugin-screen]')).toBeVisible({ timeout: 30_000 });
  await expect(p.locator('[data-plugin-screen]')).toContainText('Welcome to the café');
  // no sidebar, no page header
  await expect(p.getByText('Admin Panel')).toHaveCount(0);
  await expect(p.locator('.page-header')).toHaveCount(0);
  await expect(p.locator('[data-plugin-screen-tap]')).toContainText('Tap to show full screen');
  await p.locator('[data-plugin-screen-tap]').click();
  await expect(p.locator('[data-plugin-screen-tap]')).toHaveCount(0);
  await p.screenshot({ path: testInfo.outputPath('screen-mode.png') });
  // ✕ in a tab the screen was not opened in goes back to the normal page
  await p.getByRole('button', { name: 'Close the screen' }).click();
  await expect(p).toHaveURL(new RegExp(`/plugins/${pluginId}/display$`));
  await expect(p.locator('.page-header')).toContainText('Customer Display');
});
