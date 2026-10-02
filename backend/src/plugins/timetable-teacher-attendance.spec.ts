export {};
const plugin = require('../../../plugins/wattanam.timetable/backend');

describe('Timetable teacher lesson-attendance routes', () => {
  function fixture() {
    const routes = new Map<string, any>();
    const database = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('JOIN plugin_wattanam_timetable_document')) return [{ id: 'teacher-1', timetableId: 'tt-1', firstName: 'One', lastName: 'Teacher', timetableName: 'Main', periodTimes: ['07:00', '08:00'] }];
        if (sql.includes('FROM plugin_wattanam_timetable_entry e JOIN')) return [{ period: 1, subjectName: 'Math', className: '1A' }];
        if (sql.includes('FROM plugin_wattanam_timetable_teacher WHERE "qrCode"')) return [{ id: 'teacher-1' }];
        if (sql.includes('FROM plugin_wattanam_timetable_teacher WHERE "id"')) return [{ id: 'teacher-1' }];
        if (sql.includes('FROM plugin_wattanam_timetable_teacher WHERE "timetableId"')) return [{ id: 'teacher-1', firstName: 'One', lastName: 'Teacher', short: 'T1' }];
        if (sql.includes('JOIN plugin_wattanam_timetable_teacher')) return [{ id: 'attendance-1', teacherId: 'teacher-1', status: 'PRESENT', date: '2026-09-25', period: 1 }];
        if (sql.includes('FROM plugin_wattanam_timetable_teacher_attendance')) return [{ id: 'attendance-1', teacherId: 'teacher-1', status: 'PRESENT', date: params?.[1], period: params?.[2] }];
        if (sql.includes('FROM plugin_wattanam_timetable_document')) return [{ id: params?.[0], status: 'DRAFT' }];
        return [];
      }),
      execute: jest.fn(async () => ({ count: 1 })),
      transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => work(database)),
    };
    const context = {
      permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: jest.fn((route: any) => routes.set(`${route.method} ${route.path}`, route)) },
      directory: { lookupClasses: jest.fn(), lookupUsers: jest.fn() }, database,
      settings: { get: jest.fn(async (_key: string, fallback: unknown) => fallback) },
    };
    return { context, database, routes };
  }

  it('registers granular permissions and transactionally upserts a validated lesson-attendance mark', async () => {
    const { context, database, routes } = fixture(); await plugin.activate(context);
    expect(context.permissions.register).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'wattanam.timetable.attendance.view' }),
      expect.objectContaining({ id: 'wattanam.timetable.attendance.manage' }),
    ]));
    const route = routes.get('POST teacher-attendance/mark');
    expect(route.permission).toBe('wattanam.timetable.attendance.manage');
    await expect(route.handler({ body: { teacherId: 'teacher-1', date: '2026-09-25', period: 1, status: 'LATE' } })).resolves.toMatchObject({ teacherId: 'teacher-1' });
    expect(database.execute).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT ("teacherId","date","period")'), expect.arrayContaining(['teacher-1', '2026-09-25', 1, 'LATE']));
    await expect(route.handler({ body: { teacherId: 'teacher-1', date: '2026-09-25', period: 25 } })).rejects.toThrow('period');
  });

  it('resolves QR scans server-side and produces scoped range/monthly reports', async () => {
    const { context, database, routes } = fixture(); await plugin.activate(context);
    await expect(routes.get('POST teacher-attendance/scan').handler({ body: { qrCode: 'qr_1', period: 1 } })).resolves.toMatchObject({ teacherId: 'teacher-1' });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('"qrCode"=$1'), ['qr_1']);
    const request = { params: { id: 'tt-1' }, query: { startDate: '2026-09-01', endDate: '2026-09-30' } };
    await expect(routes.get('GET timetables/:id/teacher-attendance').handler(request)).resolves.toEqual([expect.objectContaining({ id: 'teacher-1', attendances: [expect.objectContaining({ status: 'PRESENT' })] })]);
    await expect(routes.get('GET timetables/:id/teacher-attendance/monthly').handler(request)).resolves.toEqual([expect.objectContaining({ present: 1, late: 0, absent: 0, total: 1 })]);
    await expect(routes.get('GET timetables/:id/teacher-attendance').handler({ ...request, query: { startDate: '2026-10-01', endDate: '2026-09-01' } })).rejects.toThrow('precede');
  });

  it('provides the scheduled-teacher contract and a duplicate-safe operator scan', async () => {
    const { context, database, routes } = fixture(); await plugin.activate(context);
    const scan = routes.get('POST teacher-attendance/wattaman-scan');
    expect(scan.permission).toBe('wattanam.timetable.attendance.manage');
    await expect(scan.handler({ body: { qrCode: 'qr_1' } })).resolves.toMatchObject({ action: 'ALREADY_RECORDED', teacherId: 'teacher-1', timetableName: 'Main', scheduledPeriods: [1] });
    expect(database.execute).not.toHaveBeenCalled();
    database.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT "id","name","status"')) return [{ id: 'tt-1', name: 'Main', status: 'PUBLISHED' }];
      if (sql.includes('FROM plugin_wattanam_timetable_teacher ORDER')) return [{ id: 'teacher-1', timetableId: 'tt-1', firstName: 'One', lastName: 'Teacher', short: 'T1' }];
      if (sql.includes('FROM plugin_wattanam_timetable_lesson l JOIN')) return [{ id: 'lesson-1', timetableId: 'tt-1', teacherId: 'teacher-1', perWeek: 3, subjectName: 'Math', className: '1A' }];
      if (sql.includes('FROM plugin_wattanam_timetable_entry LIMIT')) return [{ timetableId: 'tt-1', teacherId: 'teacher-1', day: new Date().getUTCDay() || 7, period: 1 }];
      return [];
    });
    await expect(routes.get('GET scheduled-teachers/all').handler()).resolves.toEqual([expect.objectContaining({ id: 'teacher-1', weeklyLessons: 3, totalEntries: 1 })]);
  });
});
