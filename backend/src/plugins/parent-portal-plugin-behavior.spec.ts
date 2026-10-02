const plugin = require('../../../plugins/wattanam.parent-portal/backend/index.js');
export {};

describe('Parent Portal plugin behavior', () => {
  function activate() {
    const routes = new Map<string, any>();
    const database: any = { query: jest.fn(), execute: jest.fn().mockResolvedValue({ count: 1 }) };
    database.transaction = jest.fn(async (work: any) => work(database));
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-1']),
      getClassRoster: jest.fn().mockResolvedValue({ classId: 'class-1', className: 'Grade 1', students: [{ studentId: 'student-1', userId: 'student-user-1', studentNumber: 'S001', name: 'Student', parentId: 'parent-1' }] }),
    };
    const accounts = { resolveParent: jest.fn().mockResolvedValue({ id: 'parent-1', role: 'PARENT', created: true }), assignGuardian: jest.fn().mockResolvedValue(undefined) };
    const context: any = { database, directory, accounts, crypto: { hashBcrypt: jest.fn().mockResolvedValue('$2b$12$opaque') }, readModels: { read: jest.fn().mockResolvedValue([]) }, realtime: { notifyUser: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() }, routes: { register: (route: any) => routes.set(`${route.method} ${route.path}`, route) } };
    plugin.activate(context); return { routes, database, directory, accounts, context };
  }

  it('returns only roster-linked children for the authenticated parent', async () => {
    const { routes } = activate();
    await expect(routes.get('GET children').handler({ principal: { userId: 'parent-1' } })).resolves.toEqual([expect.objectContaining({ studentId: 'student-1', className: 'Grade 1' })]);
  });

  it('degrades each absent optional read model without exposing another child', async () => {
    const { routes, context } = activate();
    const result = await routes.get('GET children/:studentId/overview').handler({ principal: { userId: 'parent-1' }, params: { studentId: 'student-1' } });
    expect(Object.values(result.sections)).toEqual(expect.arrayContaining([expect.objectContaining({ available: false })]));
    await expect(routes.get('GET children/:studentId/overview').handler({ principal: { userId: 'parent-1' }, params: { studentId: 'other' } })).rejects.toThrow('not linked');
    expect(context.readModels.read).toHaveBeenCalledTimes(5);
    expect(context.readModels.read).toHaveBeenCalledWith('wattanam.finance', 'student-fee-balance', [1], 'student-1');
  });

  it('creates at most one pending request for an active student', async () => {
    const { routes, database } = activate(); database.query.mockResolvedValueOnce([]);
    const result = await routes.get('POST link/request').handler({ principal: { userId: 'student-user-1' }, body: { parentEmail: ' PARENT@EXAMPLE.TEST ' } });
    expect(result).toMatchObject({ parentEmail: 'parent@example.test', status: 'PENDING' });
    expect(database.execute.mock.calls[0][0]).toContain('plugin_wattanam_parent_portal_link_request');
  });

  it('approves through idempotent core parent and guardian commands', async () => {
    const { routes, database, accounts, context, directory } = activate();
    directory.getClassRoster.mockResolvedValueOnce({ classId: 'class-1', className: 'Grade 1', students: [{ studentId: 'student-1', userId: 'student-user-1', parentId: null }] });
    database.query.mockResolvedValueOnce([{ id: 'request-1', studentDirectoryUserId: 'student-user-1', parentEmail: 'parent@example.test', parentName: 'Parent', parentPhone: null, status: 'PENDING' }]);
    const result = await routes.get('PATCH requests/:id').handler({ principal: { userId: 'admin-1' }, params: { id: 'request-1' }, body: { action: 'APPROVE' } });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(result).toMatchObject({ status: 'APPROVED', parentId: 'parent-1', resetPasswordRequired: true });
    expect(accounts.resolveParent).toHaveBeenCalledWith(expect.objectContaining({ commandKey: 'parent-link:request-1', email: 'parent@example.test', passwordHash: '$2b$12$opaque' }));
    expect(accounts.assignGuardian).toHaveBeenCalledWith({ studentUserId: 'student-user-1', parentId: 'parent-1', idempotencyKey: 'assign-parent:student-user-1:parent-1' });
    expect(context.realtime.notifyUser).toHaveBeenCalledTimes(2);
  });

  it('requires compare-and-set confirmation before replacing an existing guardian', async () => {
    const { routes, database, accounts } = activate();
    accounts.resolveParent.mockResolvedValueOnce({ id: 'parent-2', role: 'PARENT', created: false });
    database.query.mockResolvedValueOnce([{ id: 'request-2', studentDirectoryUserId: 'student-user-1', parentEmail: 'new@example.test', parentName: 'New Parent', parentPhone: null, status: 'PENDING' }]);
    await expect(routes.get('PATCH requests/:id').handler({ principal: { userId: 'admin-1' }, params: { id: 'request-2' }, body: { action: 'APPROVE' } }))
      .rejects.toThrow('explicit replacement approval');
    expect(accounts.resolveParent).not.toHaveBeenCalled();
    expect(accounts.assignGuardian).not.toHaveBeenCalled();
  });

  it('restores the previous guardian when request resolution loses a race', async () => {
    const { routes, database, accounts } = activate();
    accounts.resolveParent.mockResolvedValueOnce({ id: 'parent-2', role: 'PARENT', created: false });
    database.query.mockResolvedValueOnce([{ id: 'request-2', studentDirectoryUserId: 'student-user-1', parentEmail: 'new@example.test', parentName: 'New Parent', parentPhone: null, status: 'PENDING' }]);
    database.execute.mockResolvedValueOnce({ count: 0 });
    await expect(routes.get('PATCH requests/:id').handler({ principal: { userId: 'admin-1' }, params: { id: 'request-2' }, body: { action: 'APPROVE', replaceExistingGuardian: true, expectedCurrentParentId: 'parent-1' } }))
      .rejects.toThrow('guardian assignment was restored');
    expect(accounts.assignGuardian.mock.calls).toEqual([
      [{ studentUserId: 'student-user-1', parentId: 'parent-2', idempotencyKey: 'assign-parent:student-user-1:parent-2' }],
      [{ studentUserId: 'student-user-1', parentId: 'parent-1', idempotencyKey: 'assign-parent:student-user-1:parent-1' }],
    ]);
  });

  it('detaches only when the expected guardian still matches', async () => {
    const { routes, accounts, context } = activate();
    await expect(routes.get('POST guardians/by-student-user/:id/detach').handler({ params: { id: 'student-user-1' }, body: { expectedParentId: 'parent-2' } }))
      .rejects.toThrow('Current guardian changed');
    await expect(routes.get('POST guardians/by-student-user/:id/detach').handler({ params: { id: 'student-user-1' }, body: { expectedParentId: 'parent-1' } }))
      .resolves.toEqual({ studentUserId: 'student-user-1', detachedParentId: 'parent-1' });
    expect(accounts.assignGuardian).toHaveBeenCalledWith({ studentUserId: 'student-user-1', parentId: null, idempotencyKey: 'assign-parent:student-user-1:none' });
    expect(context.realtime.notifyUser).toHaveBeenCalledTimes(2);
  });
});
