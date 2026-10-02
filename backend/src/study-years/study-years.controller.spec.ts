import { attendanceStudyYearsRouteOwner, StudyYearsController } from './study-years.controller';

describe('StudyYearsController compatibility ownership', () => {
  const original = process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER;
  const legacyOriginal = process.env.ACADEMIC_STUDY_YEARS_ROUTE_OWNER;

  afterEach(() => {
    if (original === undefined) delete process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER;
    else process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER = original;
    if (legacyOriginal === undefined) delete process.env.ACADEMIC_STUDY_YEARS_ROUTE_OWNER;
    else process.env.ACADEMIC_STUDY_YEARS_ROUTE_OWNER = legacyOriginal;
  });

  const principal = { user: { userId: 'admin-1', role: 'ADMIN', email: 'admin@example.test' } };

  it('defaults to legacy and rejects ambiguous configuration', () => {
    delete process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER;
    delete process.env.ACADEMIC_STUDY_YEARS_ROUTE_OWNER;
    expect(attendanceStudyYearsRouteOwner()).toBe('legacy');
    expect(() => attendanceStudyYearsRouteOwner('auto')).toThrow('must be legacy or plugin');
  });

  it('keeps legacy authoritative before cutover and after rollback', async () => {
    const legacy = {
      getAll: jest.fn().mockResolvedValue(['legacy-all']),
      getCurrent: jest.fn().mockResolvedValue({ id: 'legacy-current' }),
      create: jest.fn().mockResolvedValue({ id: 'y1' }),
      update: jest.fn().mockResolvedValue({ id: 'y1' }),
      setCurrent: jest.fn().mockResolvedValue({ id: 'y1' }),
      delete: jest.fn().mockResolvedValue({ id: 'y1' }),
    } as any;
    const extensions = { dispatch: jest.fn() } as any;
    const controller = new StudyYearsController(legacy, extensions);

    for (const owner of ['legacy', 'plugin', 'legacy']) {
      process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER = owner;
      if (owner === 'legacy') {
        await expect(controller.getAll(principal)).resolves.toEqual(['legacy-all']);
        await expect(controller.getCurrent(principal)).resolves.toEqual({ id: 'legacy-current' });
      }
    }

    expect(legacy.getAll).toHaveBeenCalledTimes(2);
    expect(legacy.getCurrent).toHaveBeenCalledTimes(2);
    expect(extensions.dispatch).not.toHaveBeenCalled();
  });

  it('routes reads and writes through plugin in plugin mode', async () => {
    process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER = 'plugin';
    const legacy = {
      getAll: jest.fn(),
      getCurrent: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setCurrent: jest.fn(),
      delete: jest.fn(),
    } as any;
    const extensions = {
      dispatch: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
    const controller = new StudyYearsController(legacy, extensions);

    await expect(controller.getAll(principal)).resolves.toEqual({ ok: true });
    await expect(controller.getCurrent(principal)).resolves.toEqual({ ok: true });
    await expect(controller.create({ year: 2026 }, principal)).resolves.toEqual({ ok: true });
    await expect(controller.update('y1', { label: '2026-2027' }, principal)).resolves.toEqual({ ok: true });
    await expect(controller.setCurrent('y1', principal)).resolves.toEqual({ ok: true });
    await expect(controller.delete('y1', principal)).resolves.toEqual({ ok: true });

    expect(extensions.dispatch.mock.calls.map((call: any[]) => [call[0], call[1].method, call[1].path, call[1].params, call[1].body]))
      .toEqual([
        ['wattanam.attendance-manager', 'GET', 'study-years', {}, {}],
        ['wattanam.attendance-manager', 'GET', 'study-years/current', {}, {}],
        ['wattanam.attendance-manager', 'POST', 'study-years', {}, { year: 2026 }],
        ['wattanam.attendance-manager', 'PUT', 'study-years/y1', { id: 'y1' }, { label: '2026-2027' }],
        ['wattanam.attendance-manager', 'POST', 'study-years/y1/set-current', { id: 'y1' }, {}],
        ['wattanam.attendance-manager', 'DELETE', 'study-years/y1', { id: 'y1' }, {}],
      ]);
    expect(extensions.dispatch.mock.calls[0][1]).toMatchObject({ principal: { userId: 'admin-1', role: 'ADMIN', email: 'admin@example.test' } });
    expect(legacy.create).not.toHaveBeenCalled();
    expect(legacy.update).not.toHaveBeenCalled();
    expect(legacy.setCurrent).not.toHaveBeenCalled();
    expect(legacy.delete).not.toHaveBeenCalled();
  });
});
