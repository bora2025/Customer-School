import { createTestContext } from './harness';
import type { RuntimePluginModule } from './types';

describe('createTestContext', () => {
  it('lets a plugin register a route, then the test finds and calls it directly', async () => {
    const plugin: RuntimePluginModule = {
      id: 'acme.widget',
      activate(context) {
        context.permissions.register([{ id: 'acme.widget.read', label: 'Read' }]);
        context.routes.register({
          method: 'GET', path: 'status', permission: 'acme.widget.read',
          async handler() { return { ok: true }; },
        });
      },
    };
    const harness = createTestContext();
    await plugin.activate(harness.context);

    expect(harness.permissions).toEqual([{ id: 'acme.widget.read', label: 'Read' }]);
    const route = harness.routes.find((r) => r.method === 'GET' && r.path === 'status');
    expect(route).toBeDefined();
    await expect(route!.handler({ method: 'GET', path: 'status', params: {}, query: {}, body: null, principal: { userId: 'u1', role: 'ADMIN' } })).resolves.toEqual({ ok: true });
  });

  it('records settings/storage round-trips in memory with no backend', async () => {
    const harness = createTestContext();
    await harness.context.settings.set('preferences', { enabled: true });
    await expect(harness.context.settings.get('preferences', { enabled: false })).resolves.toEqual({ enabled: true });
    await expect(harness.context.settings.get('missing', 'fallback')).resolves.toBe('fallback');

    await harness.context.storage.writeText('notes/a.txt', 'hello');
    await expect(harness.context.storage.readText('notes/a.txt')).resolves.toBe('hello');
    await expect(harness.context.storage.list('notes/')).resolves.toEqual(['notes/a.txt']);
  });

  it('records notification sends and realtime emits for later assertions', async () => {
    const harness = createTestContext();
    await harness.context.notifications.sendEmail('a@example.com', 'Hi', 'Body');
    harness.context.realtime.notifyUser('user-1', 'note:new', { id: 'n1' });

    expect(harness.notifications.sent).toEqual([{ channel: 'email', args: ['a@example.com', 'Hi', 'Body'] }]);
    expect(harness.realtime.emitted).toEqual([{ userId: 'user-1', event: 'note:new', payload: { id: 'n1' } }]);
  });

  it('lets a test override database/directory behavior with its own fixture data', async () => {
    const harness = createTestContext({
      database: { query: async <T>() => [{ id: 'row-1' }] as T[], execute: async () => ({ count: 1 }) },
      directory: {
        resolveAudience: async () => [{ id: 'u1', email: 'u1@example.com', phone: null, role: 'PARENT', channels: { inApp: true, email: true, sms: false } }],
        lookupUsers: async () => [], lookupClasses: async () => [], classesForUser: async () => [],
        getClassRoster: async (classId, asOfIsoDate) => ({
          contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
          classId, className: 'Grade 1A', asOfIsoDate, source: 'plugin-enrollment-interval', students: [],
        }),
        getEnrollmentAtDate: async (studentId, asOfIsoDate) => ({
          contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
          studentId, classId: 'class-1', className: 'Grade 1A', enrolled: true, asOfIsoDate,
          source: 'plugin-enrollment-interval',
        }),
      },
    });
    await expect(harness.context.database.query('SELECT * FROM plugin_acme_widget_rows', [])).resolves.toEqual([{ id: 'row-1' }]);
    await expect(harness.context.directory.resolveAudience({ audience: 'SCHOOL' })).resolves.toHaveLength(1);
  });

  it('provides deterministic SDK 1.1 account command fixtures', async () => {
    const harness = createTestContext();
    await expect(harness.context.accounts.resolveParent({
      commandKey: 'request-1', name: 'Parent', email: 'parent@example.com', passwordHash: 'hash',
    })).resolves.toEqual({
      id: 'parent-request-1', name: 'Parent', role: 'PARENT', email: 'parent@example.com', phone: null, created: true,
    });
    await expect(harness.context.accounts.assignGuardian({
      studentUserId: 'student-1', parentId: 'parent-request-1', idempotencyKey: 'link-1',
    })).resolves.toBeUndefined();
  });
});
