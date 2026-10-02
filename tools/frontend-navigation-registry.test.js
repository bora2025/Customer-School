const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const fs = require('node:fs');

async function registry() {
  const url = pathToFileURL(path.resolve(__dirname, '..', 'frontend', 'lib', 'navigation-registry.ts'));
  return import(url.href);
}

async function routePolicy() {
  const url = pathToFileURL(path.resolve(__dirname, '..', 'frontend', 'lib', 'route-policy.ts'));
  return import(url.href);
}

async function dashboardExtensions() {
  const url = pathToFileURL(path.resolve(__dirname, '..', 'frontend', 'lib', 'dashboard-extensions.ts'));
  return import(url.href);
}

test('LC2-008: core navigation excludes legacy business registrations', async () => {
  const { composeNavigation } = await registry();
  const registrations = [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard', source: 'core' },
    { label: 'Attendance', href: '/admin/attendance', icon: 'camera', source: 'legacy-business' },
  ];

  assert.deepEqual(composeNavigation(registrations, 'core').map((item) => item.href), ['/admin']);
  assert.deepEqual(composeNavigation(registrations, 'legacy-full').map((item) => item.href), [
    '/admin',
    '/admin/attendance',
  ]);
});

test('LC2-008: plugin navigation requires an identified contribution', async () => {
  const { composeNavigation } = await registry();
  const contributions = [
    { label: 'Valid', href: '/plugins/valid', icon: 'plugin', source: 'plugin', pluginId: 'valid' },
    { label: 'Unidentified', href: '/plugins/bad', icon: 'plugin', source: 'plugin' },
    { label: 'Wrong source', href: '/legacy', icon: 'plugin', source: 'legacy-business', pluginId: 'bad' },
  ];

  assert.deepEqual(composeNavigation([], 'core', contributions).map((item) => item.href), ['/plugins/valid']);
});

test('LC2-008: frontend distribution validation is explicit and upgrade-safe', async () => {
  const { frontendDistribution } = await registry();
  assert.equal(frontendDistribution(undefined), 'legacy-full');
  assert.equal(frontendDistribution(' CORE '), 'core');
  assert.throws(
    () => frontendDistribution('lean'),
    /NEXT_PUBLIC_WATTANAM_DISTRIBUTION must be core or legacy-full \(got "lean"\)/,
  );
});

test('LC2-009: administrator core navigation is the exact approved surface set', async () => {
  const { isCoreNavigationHref } = await registry();
  const hrefs = [
    '/admin',
    '/admin/users',
    '/admin/plugins',
    '/admin/settings',
    '/admin/backup',
    '/admin/system',
    '/admin/platform-billing',
    '/admin/audit',
    '/admin/profile',
    '/admin/licensing',
    '/admin/appearance',
  ];
  assert.ok(hrefs.every(isCoreNavigationHref));
  assert.equal(isCoreNavigationHref('/admin/attendance'), false);
  assert.equal(isCoreNavigationHref('/admin/classes'), false);
});

test('LC2-009: Sidebar resolves distribution at runtime and fails closed before it loads', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'components', 'Sidebar.tsx'), 'utf8');
  assert.match(source, /useState<FrontendDistribution>\('core'\)/);
  assert.match(source, /api\/version/);
  assert.match(source, /version\?\.distribution === 'legacy-full'/);
  assert.match(source, /isCoreNavigationHref\(item\.href\)/);
});

test('LC2-010: core route policy admits core and plugin-host surfaces', async () => {
  const { isRouteAvailable } = await routePolicy();
  for (const pathname of [
    '/', '/login', '/admin', '/admin/users', '/admin/system', '/admin/profile',
    '/admin/licensing', '/admin/appearance', '/plugins/example/page', '/api/version', '/teacher', '/student',
  ]) assert.equal(isRouteAvailable(pathname, 'core'), true, pathname);
  assert.equal(isRouteAvailable('/marketplace', 'core'), false);
  assert.equal(isRouteAvailable('/marketplace/link/request-id', 'core'), false);
  assert.equal(isRouteAvailable('/marketplace/publisher', 'core'), false);
  assert.equal(isRouteAvailable('/marketplace/reviewer', 'core'), false);
  assert.equal(isRouteAvailable('/admin/appearance/about', 'core'), false);
});

test('LC2-010: core route policy rejects legacy business pages while legacy-full preserves them', async () => {
  const { isRouteAvailable } = await routePolicy();
  for (const pathname of [
    '/admin/attendance', '/admin/classes', '/admin/fees', '/admin/bus', '/admin/reports',
    '/teacher/attendance', '/student/courses', '/parent', '/employee', '/accounter', '/wattaman',
  ]) {
    assert.equal(isRouteAvailable(pathname, 'core'), false, pathname);
    assert.equal(isRouteAvailable(pathname, 'legacy-full'), true, pathname);
  }
});

test('LC2-010: trailing slashes cannot evade the route boundary', async () => {
  const { isRouteAvailable } = await routePolicy();
  assert.equal(isRouteAvailable('/admin/system/', 'core'), true);
  assert.equal(isRouteAvailable('/admin/classes/', 'core'), false);
});

test('LC2-011: dashboard cards accept only namespaced active plugin contributions', async () => {
  const { pluginDashboardCards } = await dashboardExtensions();
  const cards = pluginDashboardCards([
    { pluginId: 'wattanam.attendance', id: 'later', label: 'Later', href: '/plugins/wattanam.attendance/later' },
    { pluginId: 'wattanam.attendance', id: 'home', label: 'Attendance', href: '/plugins/wattanam.attendance/home', dashboard: { title: 'Attendance today', description: 'Scan and review attendance.', priority: 10 } },
    { pluginId: 'wattanam.attendance', id: 'hidden', label: 'Hidden', href: '/plugins/wattanam.attendance/hidden', dashboard: false },
    { pluginId: 'wattanam.finance', id: 'escape', label: 'Bad', href: '/plugins/wattanam.finance/../admin' },
    { id: 'anonymous', label: 'Bad', href: '/plugins/anonymous/home' },
  ]);
  assert.deepEqual(cards.map((card) => card.href), ['/plugins/wattanam.attendance/home', '/plugins/wattanam.attendance/later']);
  assert.deepEqual(cards[0], {
    pluginId: 'wattanam.attendance', id: 'home', label: 'Attendance today',
    href: '/plugins/wattanam.attendance/home', description: 'Scan and review attendance.', priority: 10,
  });
});

test('LC2-011: core dashboard does not mount the legacy business dashboard', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'app', 'admin', 'page.tsx'), 'utf8');
  assert.match(source, /core \? <CoreAdminDashboard \/> : <DashboardContent\/>/);
  const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'components', 'CoreAdminDashboard.tsx'), 'utf8');
  assert.doesNotMatch(coreSource, /dashboard-summary|class-attendance-progress|monthly-trend|socket\.io/);
  assert.match(coreSource, /plugin-api\/my-extensions/);
});

test('LC2-012: core search mounts only the plugin-provider search surface', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'app', 'admin', 'search', 'page.tsx'), 'utf8');
  assert.match(page, /frontendDistribution\(\) === 'core' \? <CorePluginSearch \/> : <LegacySearchPage \/>/);
  const core = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'components', 'CorePluginSearch.tsx'), 'utf8');
  assert.match(core, /plugin-api\/search/);
  assert.doesNotMatch(core, /auth\/users\/search|full-profile|dashboard-summary|feeRecords|scoreEntries/);
});

test('LC2-013: empty core onboarding uses only admitted core destinations and real progress', async () => {
  const { marketplaceOnboarding } = await dashboardExtensions();
  const { isRouteAvailable } = await routePolicy();
  const fresh = marketplaceOnboarding(false, 0);
  assert.deepEqual(fresh.map((step) => step.complete), [false, false, false]);
  assert.ok(fresh.every((step) => isRouteAvailable(step.href, 'core')));
  assert.deepEqual(marketplaceOnboarding(true, 1).map((step) => step.complete), [true, true, true]);

  const source = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'components', 'CoreAdminDashboard.tsx'), 'utf8');
  assert.match(source, /marketplace\/link\/status/);
  assert.match(source, /Build your school with plugins/);
  assert.match(source, /starts without attendance, classes, finance, transport/);
});
