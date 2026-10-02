import { academicClassRegistrationsRouteOwner, ClassRegistrationsController } from './class-registrations.controller';

describe('ClassRegistrationsController compatibility ownership', () => {
  const original = process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER;

  afterEach(() => {
    if (original === undefined) delete process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER;
    else process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER = original;
  });

  it('defaults to legacy and rejects ambiguous configuration', () => {
    delete process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER;
    expect(academicClassRegistrationsRouteOwner()).toBe('legacy');
    expect(() => academicClassRegistrationsRouteOwner('auto')).toThrow('must be legacy or plugin');
  });

  it('uses legacy public classes when owner is legacy', async () => {
    process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER = 'legacy';
    const svc = {
      listPublicClasses: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      getFormConfig: jest.fn().mockResolvedValue({ settings: { id: 'singleton' }, fields: [] }),
    } as any;
    const extensions = { dispatch: jest.fn() } as any;
    const controller = new ClassRegistrationsController(svc, extensions);

    await expect(controller.listPublicClasses()).resolves.toEqual([{ id: 'c1' }]);
    await expect(controller.getFormConfig()).resolves.toEqual({ settings: { id: 'singleton' }, fields: [] });
    expect(svc.listPublicClasses).toHaveBeenCalledTimes(1);
    expect(svc.getFormConfig).toHaveBeenCalledTimes(1);
    expect(extensions.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches public classes read to plugin when owner is plugin', async () => {
    process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER = 'plugin';
    const svc = { listPublicClasses: jest.fn(), getFormConfig: jest.fn() } as any;
    const extensions = {
      dispatch: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'c2' }])
        .mockResolvedValueOnce({ settings: { id: 'singleton' }, fields: [{ id: 'f1' }] }),
    } as any;
    const controller = new ClassRegistrationsController(svc, extensions);

    await expect(controller.listPublicClasses()).resolves.toEqual([{ id: 'c2' }]);
    await expect(controller.getFormConfig()).resolves.toEqual({ settings: { id: 'singleton' }, fields: [{ id: 'f1' }] });
    expect(svc.listPublicClasses).not.toHaveBeenCalled();
    expect(svc.getFormConfig).not.toHaveBeenCalled();
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'GET',
      path: 'admissions/public/classes',
      principal: { userId: 'system-public-route', role: 'SUPER_ADMIN', email: undefined },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'GET',
      path: 'admissions/public/form-config',
      principal: { userId: 'system-public-route', role: 'SUPER_ADMIN', email: undefined },
    }));
  });

  it('routes admin settings and fields reads to plugin when owner is plugin', async () => {
    process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER = 'plugin';
    const svc = { getSettings: jest.fn(), listFields: jest.fn() } as any;
    const extensions = {
      dispatch: jest
        .fn()
        .mockResolvedValueOnce({ id: 'singleton' })
        .mockResolvedValueOnce([{ id: 'f1' }]),
    } as any;
    const controller = new ClassRegistrationsController(svc, extensions);
    const req = { user: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' } };

    await expect(controller.getSettings(req)).resolves.toEqual({ id: 'singleton' });
    await expect(controller.listFields(req)).resolves.toEqual([{ id: 'f1' }]);

    expect(svc.getSettings).not.toHaveBeenCalled();
    expect(svc.listFields).not.toHaveBeenCalled();
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'GET',
      path: 'admissions/settings',
      principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'GET',
      path: 'admissions/fields',
      principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
  });

  it('dispatches settings and fields mutations to plugin when owner is plugin', async () => {
    process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER = 'plugin';
    const req = { user: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' } };
    const extensions = {
      dispatch: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const controller = new ClassRegistrationsController({} as any, extensions);

    await expect(controller.updateSettings(req, { phoneMode: 'OPTIONAL' })).resolves.toEqual({ ok: true });
    await expect(controller.createField(req, { label: 'Parent Occupation' })).resolves.toEqual({ ok: true });
    await expect(controller.reorderFields(req, { ids: ['f1'] })).resolves.toEqual({ ok: true });
    await expect(controller.updateField(req, 'f1', { label: 'Guardian Job' })).resolves.toEqual({ ok: true });
    await expect(controller.deleteField(req, 'f1')).resolves.toEqual({ ok: true });

    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'PATCH', path: 'admissions/settings', body: { phoneMode: 'OPTIONAL' }, principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'POST', path: 'admissions/fields', body: { label: 'Parent Occupation' }, principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'POST', path: 'admissions/fields/reorder', body: { ids: ['f1'] }, principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'PATCH', path: 'admissions/fields/f1', body: { label: 'Guardian Job' }, principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'DELETE', path: 'admissions/fields/f1', principal: { userId: 'u1', role: 'ADMIN', email: 'a@school.test' },
    }));
  });

  it('dispatches submit and resolve through plugin contracts when owner is plugin', async () => {
    process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER = 'plugin';
    const svc = { createRegistration: jest.fn(), resolveRegistration: jest.fn() } as any;
    const extensions = {
      dispatch: jest
        .fn()
        .mockResolvedValueOnce({ queued: true })
        .mockResolvedValueOnce({ status: 'PENDING' }),
    } as any;
    const controller = new ClassRegistrationsController(svc, extensions);

    await expect(controller.submit({ classId: 'c1', nameEn: 'Student One' })).resolves.toEqual({ queued: true });
    await expect(controller.resolve({ user: { userId: 'a1', role: 'ADMIN', email: 'admin@school.test' } }, 'r1', { action: 'APPROVE' })).resolves.toEqual({ status: 'PENDING' });

    expect(svc.createRegistration).not.toHaveBeenCalled();
    expect(svc.resolveRegistration).not.toHaveBeenCalled();
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'POST',
      path: 'admissions/public/submit',
      body: { classId: 'c1', nameEn: 'Student One' },
      principal: { userId: 'system-public-route', role: 'SUPER_ADMIN', email: undefined },
    }));
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.academic-management', expect.objectContaining({
      method: 'PATCH',
      path: 'admissions/registrations/r1/resolve',
      body: { action: 'APPROVE' },
      principal: { userId: 'a1', role: 'ADMIN', email: 'admin@school.test' },
    }));
  });
});
