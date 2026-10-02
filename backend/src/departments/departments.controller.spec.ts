import { academicDepartmentsRouteOwner, DepartmentsController } from './departments.controller';

describe('DepartmentsController compatibility ownership', () => {
  const original = process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER;
  afterEach(() => {
    if (original === undefined) delete process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER;
    else process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER = original;
  });

  const principal = { user: { userId: 'admin-1', role: 'ADMIN', email: 'admin@example.test' } };

  it('defaults to legacy and rejects ambiguous configuration', () => {
    delete process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER;
    expect(academicDepartmentsRouteOwner()).toBe('legacy');
    expect(() => academicDepartmentsRouteOwner('auto')).toThrow('must be legacy or plugin');
  });

  it('keeps legacy authoritative before cutover and after rollback', async () => {
    const legacy = { findAll: jest.fn().mockResolvedValue(['legacy']), create: jest.fn().mockResolvedValue({ id: 'd1' }), update: jest.fn().mockResolvedValue({ id: 'd1' }), delete: jest.fn().mockResolvedValue({ id: 'd1' }) } as any;
    const extensions = { dispatch: jest.fn() } as any;
    const controller = new DepartmentsController(legacy, extensions);
    for (const owner of ['legacy', 'plugin', 'legacy']) {
      process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER = owner;
      if (owner === 'legacy') await expect(controller.findAll(principal)).resolves.toEqual(['legacy']);
    }
    expect(legacy.findAll).toHaveBeenCalledTimes(2);
    expect(extensions.dispatch).not.toHaveBeenCalled();
  });

  it('routes reads and certified mutations exclusively to the plugin owner after cutover', async () => {
    process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER = 'plugin';
    const legacy = { findAll: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() } as any;
    const extensions = { dispatch: jest.fn().mockResolvedValue({ id: 'd1' }) } as any;
    const controller = new DepartmentsController(legacy, extensions);

    await controller.findAll(principal);
    await controller.create({ name: 'Science' }, principal);
    await controller.update('d1', { name: 'Languages' }, principal);
    await controller.delete('d1', principal);

    expect(extensions.dispatch.mock.calls.map((call: any[]) => [call[0], call[1].method, call[1].path]))
      .toEqual([
        ['wattanam.academic-management', 'GET', 'departments'],
        ['wattanam.academic-management', 'POST', 'departments'],
        ['wattanam.academic-management', 'PUT', 'departments/d1'],
        ['wattanam.academic-management', 'DELETE', 'departments/d1'],
      ]);
    expect(extensions.dispatch.mock.calls[0][1]).toMatchObject({ principal: { userId: 'admin-1', role: 'ADMIN', email: 'admin@example.test' } });
    expect(Object.values(legacy).some((fn: any) => fn.mock.calls.length)).toBe(false);
    expect(extensions.dispatch.mock.calls[3][1]).toMatchObject({
      params: { id: 'd1' }, body: { idempotencyKey: 'delete-department:d1' },
    });
  });
});
