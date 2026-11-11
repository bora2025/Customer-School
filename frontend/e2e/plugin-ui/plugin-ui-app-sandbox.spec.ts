import { expect, test } from '@playwright/test';

// A plugin-owned screen (`app` component) in the real browser sandbox. The fixture document below is
// served with the same headers the core sends (backend/src/plugins/plugin-ui-assets.ts) and tries to
// escape: direct network calls, the school's cookies and DOM, and path tricks through the bridge.
const pluginId = 'wattanam.demo';
const version = '1.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; media-src 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";

const html = '<!doctype html><html><body><h1>Sessions</h1><ul id="out"></ul><script src="app.js"></script></body></html>';
const app = `
const out = (key, value) => { const li = document.createElement('li'); li.id = key; li.textContent = key + '=' + value; document.getElementById('out').appendChild(li); };
const pending = new Map(); let next = 0;
const call = (method, path, body) => new Promise((resolve) => {
  const id = 'r' + (next++); pending.set(id, resolve);
  parent.postMessage({ protocol: 'wattanam.plugin-ui/1', type: 'request', id, method, path, body }, '*');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ status: 'no-response' }); } }, 1500);
});
window.addEventListener('message', async (event) => {
  if (event.source !== parent || !event.data || event.data.protocol !== 'wattanam.plugin-ui/1') return;
  if (event.data.type === 'response' && pending.has(event.data.id)) { pending.get(event.data.id)(event.data); pending.delete(event.data.id); }
  if (event.data.type === 'init') {
    out('init', event.data.pluginId + '@' + event.data.pluginVersion);
    const records = await call('GET', 'sessions');
    out('records', records.status + ':' + (Array.isArray(records.body) ? records.body.length : 'x'));
    const created = await call('POST', 'sessions', { name: 'Morning' });
    out('created', created.status + ':' + (created.body && created.body.name));
    out('traversal', (await call('GET', '../auth/me')).status);
    out('encoded', (await call('GET', '%2e%2e/auth/me')).status);
    try { await fetch('/api/auth/me'); out('direct-fetch', 'allowed'); } catch (error) { out('direct-fetch', 'blocked'); }
    try { out('cookie', document.cookie === '' ? 'empty' : 'readable'); } catch (error) { out('cookie', 'blocked'); }
    try { out('parent-dom', parent.document.title); } catch (error) { out('parent-dom', 'blocked'); }
    try { localStorage.setItem('x', '1'); out('storage', 'allowed'); } catch (error) { out('storage', 'blocked'); }
    parent.postMessage({ protocol: 'wattanam.plugin-ui/1', type: 'resize', height: 777 }, '*');
    out('done', 'yes');
  }
});
parent.postMessage({ protocol: 'wattanam.plugin-ui/1', type: 'ready' }, '*');
`;

const pages = [{
  pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', id: 'sessions', title: 'Sessions', routePath: 'sessions',
  permission: 'wattanam.demo.view', parameters: [], dataSources: [],
  components: [{ id: 'sessions-app', type: 'app', title: 'Sessions', options: { entry: 'ui/index.html', minHeight: 300 } }],
}];

test('a plugin-owned screen works through the bridge and cannot escape its sandbox', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser profile is enough for the sandbox contract');
  await context.addCookies([{ name: 'access_token', value: 'school-session', url: 'http://localhost:4141', httpOnly: false }]);
  const apiCalls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === `/api/plugin-ui/${pluginId}/${version}/ui/index.html`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: html });
    if (pathname === `/api/plugin-ui/${pluginId}/${version}/ui/app.js`) return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8', 'content-security-policy': CSP, 'cross-origin-resource-policy': 'cross-origin' }, body: app });
    if (pathname.startsWith('/api/plugin-api/') && pathname !== '/api/plugin-api/my-extensions') apiCalls.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    if (pathname === `/api/plugin-api/${pluginId}/sessions` && request.method() === 'GET') return route.fulfill({ json: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    if (pathname === `/api/plugin-api/${pluginId}/sessions` && request.method() === 'POST') return route.fulfill({ status: 201, json: { id: 4, ...request.postDataJSON() } });
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto(`/plugins/${pluginId}/sessions`);
  const frame = page.frameLocator('iframe[title="Sessions"]');
  await expect(frame.locator('#done')).toHaveText('done=yes', { timeout: 15_000 });

  await expect(frame.locator('#init')).toHaveText(`init=${pluginId}@${version}`);
  await expect(frame.locator('#records')).toHaveText('records=200:3');
  await expect(frame.locator('#created')).toHaveText('created=201:Morning');
  // Path tricks never reach the API: the host ignores them.
  await expect(frame.locator('#traversal')).toHaveText('traversal=no-response');
  await expect(frame.locator('#encoded')).toHaveText('encoded=no-response');
  // Sandbox + CSP: no network, no school cookies, DOM or storage.
  await expect(frame.locator('#direct-fetch')).toHaveText('direct-fetch=blocked');
  await expect(frame.locator('#cookie')).toHaveText('cookie=blocked');
  await expect(frame.locator('#parent-dom')).toHaveText('parent-dom=blocked');
  await expect(frame.locator('#storage')).toHaveText('storage=blocked');
  // Only the plugin's own API was called, exactly as requested.
  expect(apiCalls).toEqual([`GET /api/plugin-api/${pluginId}/sessions`, `POST /api/plugin-api/${pluginId}/sessions`]);
  // The frame resized itself through the bridge.
  await expect(page.locator('iframe[title="Sessions"]')).toHaveCSS('height', '777px');
  await expect(page.locator('iframe[title="Sessions"]')).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-downloads');
});
