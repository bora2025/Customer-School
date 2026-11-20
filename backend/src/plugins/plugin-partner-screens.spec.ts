import { NotFoundException } from '@nestjs/common';
import { PluginApiController } from './plugin-api.controller';
import { PluginExtensionsService } from './plugin-extensions.service';
import { parsePluginUiBundle } from './plugin-ui-schema';

// Partner screens: a plugin's screen (Smart Attendance) calling a partner plugin's API (Academic
// Management). The partner opens each route to named callers; the page must declare the partner as a
// dependency; the user's grants still apply.
describe('plugin partner screens', () => {
  const SMART = 'wattanam.smart-attendance';
  const ACADEMIC = 'wattanam.academic-management';
  const smartPermissions = new Set([`${SMART}.take`]);

  function page(overrides: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
    return {
      schemaVersion: 2,
      kind: 'declarative-ui',
      pages: [{
        id: 'take', title: 'Take Attendance', routePath: 'take', permission: `${SMART}.take`, parameters: [],
        dataSources: [{ id: 'sessions', method: 'GET', path: 'sessions', permission: `${ACADEMIC}.attendance.view`, plugin: ACADEMIC, ...source }],
        components: [{ id: 'list', type: 'table', title: 'Sessions', source: 'sessions', fields: [{ id: 'session', label: 'Session' }] }],
        ...overrides,
      }],
    };
  }

  it('accepts a data source that calls a declared partner with the partner’s permission', () => {
    const bundle = parsePluginUiBundle(page(), SMART, smartPermissions, new Set([ACADEMIC]));
    expect(bundle.pages[0].dataSources[0]).toEqual(expect.objectContaining({ plugin: ACADEMIC, permission: `${ACADEMIC}.attendance.view` }));
  });

  it('refuses partners that are not dependencies, the plugin itself, and foreign permissions', () => {
    expect(() => parsePluginUiBundle(page(), SMART, smartPermissions, new Set())).toThrow('dependency');
    expect(() => parsePluginUiBundle(page({}, { plugin: SMART }), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('dependency');
    expect(() => parsePluginUiBundle(page({}, { permission: 'wattanam.other.read' }), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('permission');
    // without "plugin", the source must still use the plugin's own declared permission
    expect(() => parsePluginUiBundle(page({}, { plugin: undefined }), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('permission');
  });

  it('keeps partner data sources away from components that send their own requests', () => {
    const components = [{ id: 'take', type: 'take-attendance', title: 'Take', options: {} }];
    expect(() => parsePluginUiBundle(page({ components }), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('partner data sources');
  });

  it('lets an app screen declare partner APIs (dependencies only)', () => {
    const app = (apis: unknown) => ({ dataSources: [], components: [{ id: 'screen', type: 'app', title: 'Take', options: { entry: 'ui/take/index.html', apis } }] });
    expect(parsePluginUiBundle(page(app([ACADEMIC])), SMART, smartPermissions, new Set([ACADEMIC])).pages[0].components[0].options).toEqual(expect.objectContaining({ apis: [ACADEMIC] }));
    expect(() => parsePluginUiBundle(page(app(['wattanam.payroll'])), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('dependency');
    expect(() => parsePluginUiBundle(page(app([ACADEMIC, ACADEMIC])), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('duplicated');
    expect(() => parsePluginUiBundle(page(app('x')), SMART, smartPermissions, new Set([ACADEMIC]))).toThrow('apis');
  });

  function service() {
    const grants = { isGranted: jest.fn(async (_plugin: string, permission: string, role: string) => role === 'TEACHER' && permission === `${ACADEMIC}.attendance.view`) } as any;
    const audit = { log: jest.fn() } as any;
    const extensions = new PluginExtensionsService(grants, audit);
    const declared = new Set([`${ACADEMIC}.attendance.view`]);
    extensions.registerRoute(ACADEMIC, declared, { method: 'GET', path: 'sessions', permission: `${ACADEMIC}.attendance.view`, callers: [SMART], handler: () => 'sessions' });
    extensions.registerRoute(ACADEMIC, declared, { method: 'GET', path: 'records', permission: `${ACADEMIC}.attendance.view`, handler: () => 'records' });
    return extensions;
  }
  const call = (path: string, role = 'TEACHER') => ({ method: 'GET' as const, path, params: {}, query: {}, body: null, principal: { userId: 'u1', role } });

  it('answers a partner screen only on routes that list it as a caller, with the user’s grants', async () => {
    const extensions = service();
    await expect(extensions.dispatch(ACADEMIC, call('sessions'), SMART)).resolves.toBe('sessions');
    await expect(extensions.dispatch(ACADEMIC, call('records'), SMART)).rejects.toBeInstanceOf(NotFoundException);
    await expect(extensions.dispatch(ACADEMIC, call('sessions'), 'wattanam.other')).rejects.toBeInstanceOf(NotFoundException);
    await expect(extensions.dispatch(ACADEMIC, call('sessions', 'STUDENT'), SMART)).rejects.toThrow('Missing plugin permission');
    // the plugin's own screens, and calls without a screen, are unchanged
    await expect(extensions.dispatch(ACADEMIC, call('records'), ACADEMIC)).resolves.toBe('records');
    await expect(extensions.dispatch(ACADEMIC, call('records'))).resolves.toBe('records');
  });

  it('refuses invalid callers lists', () => {
    const extensions = service();
    const declared = new Set([`${ACADEMIC}.attendance.view`]);
    const route = (callers: unknown) => ({ method: 'GET' as const, path: `x${Math.random().toString(36).slice(2, 8)}`, permission: `${ACADEMIC}.attendance.view`, callers: callers as string[], handler: () => null });
    expect(() => extensions.registerRoute(ACADEMIC, declared, route('wattanam.smart-attendance'))).toThrow('callers');
    expect(() => extensions.registerRoute(ACADEMIC, declared, route([ACADEMIC]))).toThrow('callers');
    expect(() => extensions.registerRoute(ACADEMIC, declared, route(['Not An Id']))).toThrow('callers');
  });

  it('the API passes the screen header on; a malformed one reaches no partner route', async () => {
    const dispatch = jest.fn(async () => 'ok');
    const controller = new PluginApiController({ dispatch } as any);
    const request = (headers: Record<string, string>) => ({ method: 'GET', params: { splat: ['sessions'] }, headers, query: {}, body: undefined, user: { userId: 'u1', role: 'TEACHER' } }) as any;
    await controller.dispatch(ACADEMIC, request({ 'x-wattanam-plugin-screen': SMART }));
    expect(dispatch).toHaveBeenLastCalledWith(ACADEMIC, expect.objectContaining({ path: 'sessions' }), SMART);
    await controller.dispatch(ACADEMIC, request({}));
    expect(dispatch).toHaveBeenLastCalledWith(ACADEMIC, expect.anything(), undefined);
    await controller.dispatch(ACADEMIC, request({ 'x-wattanam-plugin-screen': '../admin' }));
    expect(dispatch).toHaveBeenLastCalledWith(ACADEMIC, expect.anything(), 'invalid.screen');
  });
});
