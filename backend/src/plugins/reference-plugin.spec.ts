const reference = require('../../../plugins/announcements/backend/index.js');

function buildContext(overrides: any = {}) {
  const routes: any[] = [];
  let job: any;
  let subscriber: any;
  const context: any = {
    pluginId: 'wattanam.announcements', logger: { log: jest.fn() },
    permissions: { register: jest.fn(() => jest.fn()) },
    navigation: { register: jest.fn(() => jest.fn()) },
    routes: { register: jest.fn((route: any) => { routes.push(route); return jest.fn(); }) },
    jobs: { register: jest.fn(async (definition: any) => { job = definition; return jest.fn(); }) },
    settings: { get: jest.fn(async (_key: string, fallback: unknown) => fallback), set: jest.fn(async () => undefined) },
    storage: { writeText: jest.fn(async () => undefined) },
    events: { subscribe: jest.fn((_event: string, handler: any) => { subscriber = handler; return jest.fn(); }) },
    database: { query: jest.fn().mockResolvedValue([]), execute: jest.fn().mockResolvedValue({ count: 0 }) },
    directory: {
      resolveAudience: jest.fn().mockResolvedValue([]),
      lookupUsers: jest.fn().mockResolvedValue([]),
      lookupClasses: jest.fn().mockResolvedValue([]),
      classesForUser: jest.fn().mockResolvedValue([]),
    },
    notifications: { sendEmail: jest.fn().mockResolvedValue({ sent: true }), sendSms: jest.fn().mockResolvedValue({ sent: true }), notifyInApp: jest.fn().mockResolvedValue({ id: 'n1' }) },
    realtime: { notifyUser: jest.fn() },
    ...overrides,
  };
  return { context, routes: () => routes, job: () => job, subscriber: () => subscriber };
}

async function activated(overrides?: any) {
  const built = buildContext(overrides);
  await reference.activate(built.context);
  const byKey = new Map(built.routes().map((route: any) => [`${route.method}:${route.path}`, route]));
  return { context: built.context, byKey };
}

describe('announcements reference plugin SDK contract', () => {
  it('registers permissions, navigation, the full route set, job, storage, settings, events, and health', async () => {
    const built = buildContext();
    const cleanup = await reference.activate(built.context);
    expect(built.context.permissions.register).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'wattanam.announcements.manage' })]));
    expect(built.context.navigation.register).toHaveBeenCalledWith([expect.objectContaining({ href: '/plugins/wattanam.announcements/settings' })]);
    expect(built.routes().map((route: any) => `${route.method}:${route.path}`)).toEqual([
      'GET:settings', 'PATCH:settings', 'GET:all', 'GET:feed', 'GET:unread-count', 'PATCH:read', 'POST:create', 'DELETE:remove',
    ]);
    await built.job().handler();
    await built.subscriber()();
    expect(built.context.storage.writeText).toHaveBeenCalledTimes(2);
    expect(reference.health()).toEqual({ status: 'ready' });
    expect(typeof cleanup).toBe('function');
  });

  it('settings routes still read/write through the settings capability, unchanged', async () => {
    const { byKey, context } = await activated();
    await expect(byKey.get('GET:settings').handler()).resolves.toMatchObject({ digestEnabled: true });
    await expect(byKey.get('PATCH:settings').handler({ body: { digestEnabled: false, audience: 'staff' } })).resolves.toEqual({ digestEnabled: false, audience: 'staff' });
    expect(context.settings.set).toHaveBeenCalledWith('preferences', { digestEnabled: false, audience: 'staff' });
  });

  it('GET all enriches every row with author/class display data and a read count', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('GROUP BY')) return Promise.resolve([{ id: 'a1', count: 3 }]);
      return Promise.resolve([{ id: 'a1', authorId: 'u1', classId: 'c1', title: 'Hi', body: 'There', audience: 'CLASS', pinned: false }]);
    });
    const { byKey, context } = await activated({
      database: { query, execute: jest.fn() },
      directory: { lookupUsers: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ada', role: 'TEACHER' }]), lookupClasses: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Grade 1' }]), resolveAudience: jest.fn(), classesForUser: jest.fn() },
    });
    const result = await byKey.get('GET:all').handler();
    expect(result).toEqual([expect.objectContaining({
      id: 'a1', author: { id: 'u1', name: 'Ada', role: 'TEACHER' }, class: { id: 'c1', name: 'Grade 1' }, _count: { reads: 3 },
    })]);
    expect(context.directory.lookupUsers).toHaveBeenCalledWith(['u1']);
    expect(context.directory.lookupClasses).toHaveBeenCalledWith(['c1']);
  });

  it('GET feed resolves the caller\'s classes and merges their own read state', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT "announcementId" as id, "readAt"')) return Promise.resolve([{ id: 'a1', readAt: '2026-08-28T00:00:00Z' }]);
      return Promise.resolve([{ id: 'a1', authorId: 'u1', classId: null, title: 'Hi', body: 'There', audience: 'SCHOOL', pinned: false }]);
    });
    const classesForUser = jest.fn().mockResolvedValue(['c1']);
    const { byKey } = await activated({ database: { query, execute: jest.fn() }, directory: { classesForUser, lookupUsers: jest.fn().mockResolvedValue([]), lookupClasses: jest.fn().mockResolvedValue([]), resolveAudience: jest.fn() } });
    const result = await byKey.get('GET:feed').handler({ query: {}, principal: { userId: 'me', role: 'STUDENT' } });
    expect(classesForUser).toHaveBeenCalledWith('me', 'STUDENT');
    expect(result).toEqual([expect.objectContaining({ id: 'a1', read: true, readAt: '2026-08-28T00:00:00Z' })]);
  });

  it('PATCH read inserts a read receipt for the caller and DELETE remove deletes the announcement', async () => {
    const execute = jest.fn().mockResolvedValue({ count: 1 });
    const { byKey } = await activated({ database: { query: jest.fn(), execute } });
    await expect(byKey.get('PATCH:read').handler({ body: { id: 'a1' }, principal: { userId: 'me', role: 'STUDENT' } })).resolves.toEqual({ ok: true });
    expect(execute.mock.calls[0][0]).toMatch(/INSERT INTO plugin_wattanam_announcements_announcement_read/);
    expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['a1', 'me']));

    await expect(byKey.get('DELETE:remove').handler({ body: { id: 'a1' } })).resolves.toEqual({ ok: true });
    expect(execute.mock.calls[1][0]).toMatch(/DELETE FROM plugin_wattanam_announcements_announcement/);
    expect(execute.mock.calls[1][1]).toEqual(['a1']);
  });

  it('POST create validates input and forces a teacher\'s audience to CLASS', async () => {
    const execute = jest.fn().mockResolvedValue({ count: 1 });
    const { byKey } = await activated({ database: { query: jest.fn(), execute }, directory: { resolveAudience: jest.fn().mockResolvedValue([]), lookupUsers: jest.fn(), lookupClasses: jest.fn(), classesForUser: jest.fn() } });
    const handler = byKey.get('POST:create').handler;

    await expect(handler({ body: {}, principal: { userId: 'me', role: 'ADMIN' } })).rejects.toThrow('Title and body required');
    await expect(handler({ body: { title: 't', body: 'b', audience: 'ROLE' }, principal: { userId: 'me', role: 'ADMIN' } })).rejects.toThrow('targetRole required');
    await expect(handler({ body: { title: 't', body: 'b', audience: 'CLASS' }, principal: { userId: 'me', role: 'ADMIN' } })).rejects.toThrow('classId required');

    // A teacher posting SCHOOL gets forced to CLASS -- and since that then requires a classId, omitting it still throws.
    await expect(handler({ body: { title: 't', body: 'b', audience: 'SCHOOL' }, principal: { userId: 'teacher-1', role: 'TEACHER' } })).rejects.toThrow('classId required');

    const result: any = await handler({ body: { title: 't', body: 'b', audience: 'SCHOOL', classId: 'c1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } });
    expect(result.audience).toBe('CLASS');
    expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['CLASS', 'c1']));
  });

  it('POST create dispatches IN_APP/EMAIL/SMS fan-out respecting each recipient\'s channel eligibility', async () => {
    const execute = jest.fn().mockResolvedValue({ count: 1 });
    const resolveAudience = jest.fn().mockResolvedValue([
      { id: 'r1', email: 'r1@example.com', phone: '855', channels: { inApp: true, email: true, sms: false } },
      { id: 'r2', email: null, phone: null, channels: { inApp: false, email: false, sms: false } },
    ]);
    const notifyInApp = jest.fn().mockResolvedValue({ id: 'n1' });
    const notifyUser = jest.fn();
    const sendEmail = jest.fn().mockResolvedValue({ sent: true });
    const sendSms = jest.fn().mockResolvedValue({ sent: true });
    const { byKey } = await activated({
      database: { query: jest.fn(), execute },
      directory: { resolveAudience, lookupUsers: jest.fn(), lookupClasses: jest.fn(), classesForUser: jest.fn() },
      notifications: { sendEmail, sendSms, notifyInApp },
      realtime: { notifyUser },
    });

    const result: any = await byKey.get('POST:create').handler({
      body: { title: 'Hi', body: 'There', audience: 'SCHOOL', channels: ['IN_APP', 'EMAIL', 'SMS'] },
      principal: { userId: 'admin-1', role: 'ADMIN' },
    });
    expect(result.sentAt).toBeInstanceOf(Date);
    // fan-out is fire-and-forget: flush microtasks before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(resolveAudience).toHaveBeenCalledWith({ audience: 'SCHOOL', targetRole: undefined, classId: undefined });
    expect(notifyInApp).toHaveBeenCalledWith('r1', 'Hi: There', 'announcement');
    expect(notifyUser).toHaveBeenCalledWith('r1', 'announcement:new', { id: expect.any(String), title: 'Hi' });
    expect(sendEmail).toHaveBeenCalledWith('r1@example.com', 'Hi', 'There');
    expect(sendSms).not.toHaveBeenCalled(); // r1.channels.sms is false
    expect(notifyInApp).not.toHaveBeenCalledWith('r2', expect.anything(), expect.anything()); // r2 opted out of everything
  });

  it('a scheduled-future announcement does not dispatch immediately', async () => {
    const execute = jest.fn().mockResolvedValue({ count: 1 });
    const resolveAudience = jest.fn().mockResolvedValue([]);
    const { byKey } = await activated({ database: { query: jest.fn(), execute }, directory: { resolveAudience, lookupUsers: jest.fn(), lookupClasses: jest.fn(), classesForUser: jest.fn() } });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result: any = await byKey.get('POST:create').handler({ body: { title: 't', body: 'b', audience: 'SCHOOL', scheduledAt: future }, principal: { userId: 'admin-1', role: 'ADMIN' } });
    expect(result.sentAt).toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    expect(resolveAudience).not.toHaveBeenCalled();
  });
});
