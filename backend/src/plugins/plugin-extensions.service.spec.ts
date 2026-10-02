import { PluginExtensionsService } from './plugin-extensions.service';
import { PluginContractError } from './plugin-sdk';

function deps(granted = true) {
  const grants = { isGranted: jest.fn().mockResolvedValue(granted) } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
  return { grants, audit };
}

describe('PluginExtensionsService', () => {
  const permissions = new Set(['wattanam.test.read', 'wattanam.test.manage']);
  let service: PluginExtensionsService;
  let deps_: ReturnType<typeof deps>;
  beforeEach(() => { deps_ = deps(); service = new PluginExtensionsService(deps_.grants, deps_.audit); });

  it('registers and dispatches a namespaced route without exposing the application container', async () => {
    service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'settings', permission: 'wattanam.test.read', handler: ({ principal }) => ({ owner: principal.userId }) });
    await expect(service.dispatch('wattanam.test', { method: 'GET', path: 'settings', params: {}, query: {}, body: null, principal: { userId: 'owner', role: 'SUPER_ADMIN' } })).resolves.toEqual({ owner: 'owner' });
    expect(deps_.grants.isGranted).toHaveBeenCalledWith('wattanam.test', 'wattanam.test.read', 'SUPER_ADMIN');
    expect(deps_.audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: true, actorId: 'owner', resourceId: 'wattanam.test' }));
  });

  it('denies dispatch and audits the denial when the caller has no granted permission', async () => {
    const denied = deps(false);
    const denyingService = new PluginExtensionsService(denied.grants, denied.audit);
    denyingService.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'settings', permission: 'wattanam.test.read', handler: () => ({}) });
    await expect(denyingService.dispatch('wattanam.test', { method: 'GET', path: 'settings', params: {}, query: {}, body: null, principal: { userId: 'teacher-1', role: 'CLASS_ADMIN' } }))
      .rejects.toThrow('Missing plugin permission');
    expect(denied.audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: false, actorId: 'teacher-1', errorMessage: expect.stringContaining('wattanam.test.read') }));
  });

  it('audits a failed handler without swallowing the original error', async () => {
    service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'settings', permission: 'wattanam.test.read', handler: () => { throw new Error('handler exploded'); } });
    await expect(service.dispatch('wattanam.test', { method: 'GET', path: 'settings', params: {}, query: {}, body: null, principal: { userId: 'owner', role: 'SUPER_ADMIN' } }))
      .rejects.toThrow('handler exploded');
    expect(deps_.audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorMessage: 'handler exploded' }));
  });

  it('keeps read routes available but blocks and audits writes when the plugin licence is read-only', async () => {
    const entitlements = {
      assertRouteAllowed: jest.fn(async (_pluginId: string, method: string) => {
        if (method === 'POST') throw Object.assign(new Error('licence read-only'), { status: 402 });
      }),
    } as any;
    const guarded = new PluginExtensionsService(deps_.grants, deps_.audit, undefined, entitlements);
    guarded.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'records', permission: 'wattanam.test.read', handler: () => ['visible'] });
    guarded.registerRoute('wattanam.test', permissions, { method: 'POST', path: 'records', permission: 'wattanam.test.manage', handler: jest.fn() });
    const request = (method: 'GET' | 'POST') => ({ method, path: 'records', params: {}, query: {}, body: null, principal: { userId: 'owner', role: 'SUPER_ADMIN' } });
    await expect(guarded.dispatch('wattanam.test', request('GET'))).resolves.toEqual(['visible']);
    await expect(guarded.dispatch('wattanam.test', request('POST'))).rejects.toMatchObject({ status: 402 });
    expect(entitlements.assertRouteAllowed).toHaveBeenCalledTimes(2);
    expect(deps_.audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorMessage: 'licence read-only' }));
  });

  it('rejects traversal, undeclared permissions, and duplicate routes', () => {
    const handler = () => ({});
    expect(() => service.registerRoute('wattanam.test', permissions, { method: 'GET', path: '../core', permission: 'wattanam.test.read', handler })).toThrow('invalid');
    expect(() => service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'users', permission: 'core.users.manage', handler })).toThrow('not declared');
    service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'settings', permission: 'wattanam.test.read', handler });
    expect(() => service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'settings', permission: 'wattanam.test.read', handler })).toThrow('already');
  });

  it('dispatches parameterized routes with validated, decoded path parameters', async () => {
    service.registerRoute('wattanam.test', permissions, {
      method: 'GET', path: 'records/:recordId', permission: 'wattanam.test.read',
      handler: ({ params }) => ({ id: params.recordId }),
    });
    await expect(service.dispatch('wattanam.test', {
      method: 'GET', path: 'records/record-123', params: {}, query: {}, body: null,
      principal: { userId: 'owner', role: 'SUPER_ADMIN' },
    })).resolves.toEqual({ id: 'record-123' });
  });

  it('enforces versioned request, response, and declared error contracts', async () => {
    const parseParams = jest.fn((value: any) => {
      if (!/^record-/.test(value.recordId || '')) throw new Error('invalid');
      return value;
    });
    service.registerRoute('wattanam.test', permissions, {
      method: 'GET', path: 'contract/:recordId', permission: 'wattanam.test.read',
      contract: {
        version: '1.0', request: { params: { parse: parseParams } },
        response: { parse: (value: any) => { if (typeof value?.id !== 'string') throw new Error('invalid'); return value; } },
        errors: { RECORD_MISSING: { status: 404, message: 'Record was not found' } },
      },
      handler: ({ params }) => params.recordId === 'record-missing' ? Promise.reject(new PluginContractError('RECORD_MISSING')) : ({ id: params.recordId }),
    });
    const request = (path: string) => ({ method: 'GET' as const, path, params: {}, query: {}, body: null, principal: { userId: 'owner', role: 'SUPER_ADMIN' } });
    await expect(service.dispatch('wattanam.test', request('contract/record-1'))).resolves.toEqual({ id: 'record-1' });
    await expect(service.dispatch('wattanam.test', request('contract/bad'))).rejects.toThrow('declared contract');
    await expect(service.dispatch('wattanam.test', request('contract/record-missing'))).rejects.toMatchObject({ response: { code: 'RECORD_MISSING', message: 'Record was not found' }, status: 404 });
  });

  it('rejects invalid parameter values and ambiguous route shapes', async () => {
    const handler = () => ({});
    service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'records/:id', permission: 'wattanam.test.read', handler });
    expect(() => service.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'records/:recordId', permission: 'wattanam.test.read', handler })).toThrow('conflicts');
    await expect(service.dispatch('wattanam.test', {
      method: 'GET', path: 'records/%2Fadmin', params: {}, query: {}, body: null,
      principal: { userId: 'owner', role: 'SUPER_ADMIN' },
    })).rejects.toThrow('not found');
  });

  it('listForPrincipal filters navigation to what the role is granted, always keeps unpermissioned entries, and leaves pages unfiltered', async () => {
    service.registerNavigation('wattanam.test', permissions, [
      { pluginId: 'wattanam.test', id: 'settings', label: 'Settings', href: '/plugins/wattanam.test/settings', permission: 'wattanam.test.manage' },
      { pluginId: 'wattanam.test', id: 'open', label: 'Open', href: '/plugins/wattanam.test/open' },
    ]);
    service.registerPage('wattanam.test', { schemaVersion: 1, id: 'settings', title: 'Settings', routePath: 'settings', kind: 'json-settings' });

    const granted = await service.listForPrincipal('TEACHER');
    expect(granted.navigation.map((entry) => entry.id).sort()).toEqual(['open', 'settings']);
    expect(deps_.grants.isGranted).toHaveBeenCalledWith('wattanam.test', 'wattanam.test.manage', 'TEACHER');
    expect(granted.pages).toHaveLength(1);

    const deniedDeps = deps(false);
    const deniedService = new PluginExtensionsService(deniedDeps.grants, deniedDeps.audit);
    deniedService.registerNavigation('wattanam.test', permissions, [
      { pluginId: 'wattanam.test', id: 'settings', label: 'Settings', href: '/plugins/wattanam.test/settings', permission: 'wattanam.test.manage' },
      { pluginId: 'wattanam.test', id: 'open', label: 'Open', href: '/plugins/wattanam.test/open' },
    ]);
    const filtered = await deniedService.listForPrincipal('STUDENT');
    expect(filtered.navigation.map((entry) => entry.id)).toEqual(['open']);
  });

  it('publishes bounded dashboard metadata with permission-filtered navigation', async () => {
    service.registerNavigation('wattanam.test', permissions, [{
      pluginId: 'wattanam.test', id: 'records', label: 'Records', href: '/plugins/wattanam.test/records',
      permission: 'wattanam.test.read', dashboard: { title: 'Recent records', description: 'Review records supplied by this plugin.', priority: 20 },
    }]);
    await expect(service.listForPrincipal('TEACHER')).resolves.toMatchObject({ navigation: [{
      id: 'records', dashboard: { title: 'Recent records', description: 'Review records supplied by this plugin.', priority: 20 },
    }] });
    expect(() => service.registerNavigation('wattanam.test', permissions, [{
      pluginId: 'wattanam.test', id: 'bad', label: 'Bad', href: '/plugins/wattanam.test/bad', dashboard: { description: '', priority: 1001 },
    }])).toThrow('dashboard contribution');
  });

  it('cleans permissions and navigation when a plugin unloads', () => {
    service.registerPermissions('wattanam.test', permissions, [{ pluginId: 'wattanam.test', id: 'wattanam.test.read', label: 'Read' }]);
    service.registerNavigation('wattanam.test', permissions, [{ pluginId: 'wattanam.test', id: 'settings', label: 'Settings', href: '/plugins/wattanam.test/settings', permission: 'wattanam.test.manage' }]);
    service.registerPage('wattanam.test', { schemaVersion: 1, id: 'settings', title: 'Settings', routePath: 'settings', kind: 'json-settings' });
    expect(service.list().navigation).toHaveLength(1);
    service.clear('wattanam.test');
    expect(service.list()).toMatchObject({ navigation: [], permissions: [], pages: [] });
  });

  it('searches only active permission-granted providers and validates their namespace', async () => {
    const service = new PluginExtensionsService(
      { isGranted: jest.fn(async (pluginId: string) => pluginId === 'allowed') } as any,
      { log: jest.fn() } as any,
    );
    const definition = (pluginId: string) => ({
      method: 'GET' as const,
      path: 'search',
      permission: `${pluginId}.read`,
      handler: jest.fn(async () => [
        { id: 'one', title: 'Valid result', description: 'Found', href: `/plugins/${pluginId}/records/one` },
        { id: 'escape', title: 'Invalid result', href: '/admin/users' },
      ]),
    });
    service.registerRoute('allowed', new Set(['allowed.read']), definition('allowed'));
    service.registerRoute('denied', new Set(['denied.read']), definition('denied'));

    await expect(service.searchForPrincipal('student', { userId: 'u1', role: 'TEACHER' }))
      .resolves.toEqual([{ pluginId: 'allowed', id: 'one', title: 'Valid result', description: 'Found', href: '/plugins/allowed/records/one' }]);
  });

  it('requires a bounded plugin search query', async () => {
    const service = new PluginExtensionsService({} as any, {} as any);
    await expect(service.searchForPrincipal(' ', { userId: 'u1', role: 'ADMIN' })).rejects.toThrow('between 2 and 100');
    await expect(service.searchForPrincipal('x'.repeat(101), { userId: 'u1', role: 'ADMIN' })).rejects.toThrow('between 2 and 100');
  });

  it('registers every page in a declarative UI v2 bundle and removes them together', () => {
    const dispose = service.registerPage('wattanam.test', {
      schemaVersion: 2, kind: 'declarative-ui', pages: [
        { id: 'list', title: 'List', routePath: 'records', permission: 'wattanam.test.read', parameters: [], dataSources: [{ id: 'records', method: 'GET', path: 'records', permission: 'wattanam.test.read' }], components: [{ id: 'table', type: 'table', source: 'records', fields: [{ id: 'name', label: 'Name' }] }] },
        { id: 'create', title: 'Create', routePath: 'records/create', permission: 'wattanam.test.manage', parameters: [], dataSources: [{ id: 'create', method: 'POST', path: 'records', permission: 'wattanam.test.manage' }], components: [{ id: 'form', type: 'form', source: 'create', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }] }] },
      ],
    }, permissions);
    expect(service.list().pages).toHaveLength(2);
    dispose();
    expect(service.list().pages).toHaveLength(0);
  });

  it('uses the same grant to hide v2 navigation/pages and deny API dispatch', async () => {
    const denied = deps(false); const deniedService = new PluginExtensionsService(denied.grants, denied.audit);
    deniedService.registerNavigation('wattanam.test', permissions, [{ pluginId: 'wattanam.test', id: 'records', label: 'Records', href: '/plugins/wattanam.test/records', permission: 'wattanam.test.read' }]);
    deniedService.registerPage('wattanam.test', { schemaVersion: 2, kind: 'declarative-ui', pages: [{ id: 'records', title: 'Records', routePath: 'records', permission: 'wattanam.test.read', parameters: [], dataSources: [{ id: 'records', method: 'GET', path: 'records', permission: 'wattanam.test.read' }], components: [{ id: 'title', type: 'heading', title: 'Records' }] }] }, permissions);
    deniedService.registerRoute('wattanam.test', permissions, { method: 'GET', path: 'records', permission: 'wattanam.test.read', handler: () => [] });
    await expect(deniedService.listForPrincipal('STUDENT')).resolves.toEqual({ navigation: [], pages: [] });
    await expect(deniedService.dispatch('wattanam.test', { method: 'GET', path: 'records', params: {}, query: {}, body: null, principal: { userId: 'u1', role: 'STUDENT' } })).rejects.toThrow('Missing plugin permission');
  });
});
