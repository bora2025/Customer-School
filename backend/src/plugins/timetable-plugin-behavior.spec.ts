const plugin = require('../../../plugins/wattanam.timetable/backend');

describe('Timetable plugin route behavior', () => {
  function fixture() {
    const routes = new Map<string, any>();
    const database = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM plugin_wattanam_timetable_document') && sql.includes('"status"')) return [{ status: 'DRAFT' }];
        if (sql.includes('FROM plugin_wattanam_timetable_document') && sql.includes('"id"=$1')) return [{ id: params?.[0], status: 'DRAFT' }];
        if (sql.includes('FROM plugin_wattanam_timetable_') && sql.includes('"timetableId"=$2')) return [{ id: params?.[0] }];
        return [{ id: params?.[0], timetableId: 'tt-1' }];
      }),
      execute: jest.fn(async () => ({ count: 1 })),
      transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => work(database)),
    };
    const context = {
      permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: jest.fn((route: any) => routes.set(`${route.method} ${route.path}`, route.handler)) },
      directory: {
        lookupClasses: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: `Class ${id}` }))),
        lookupUsers: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: `User ${id}`, role: 'TEACHER' }))),
      },
      database,
    };
    return { routes, database, context };
  }

  it('uses the write adapter for document creation and rejects invalid input', async () => {
    const { routes, database, context } = fixture();
    await plugin.activate(context);
    const create = routes.get('POST timetables');
    await create({ body: { name: 'School 2026', academicYear: '2026-2027' } });
    expect(database.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO plugin_wattanam_timetable_document'), expect.any(Array));
    await expect(create({ body: { name: '', academicYear: '2026-2027' } })).rejects.toThrow('name');
  });

  it('checks references belong to the same timetable before scheduling a lesson', async () => {
    const { routes, database, context } = fixture();
    await plugin.activate(context);
    await routes.get('POST lessons')({ body: { timetableId: 'tt-1', teacherId: 't-1', subjectId: 's-1', classId: 'c-1', perWeek: 3 } });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('"timetableId"=$2'), ['t-1', 'tt-1']);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('"timetableId"=$2'), ['s-1', 'tt-1']);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('"timetableId"=$2'), ['c-1', 'tt-1']);
  });

  it('validates stable Academic class and core teacher references through the directory capability', async () => {
    const { routes, context } = fixture();
    await plugin.activate(context);
    await routes.get('POST classes')({ body: { timetableId: 'tt-1', name: 'Grade 1', short: 'G1', academicClassId: 'academic-1' } });
    await routes.get('POST teachers')({ body: { timetableId: 'tt-1', firstName: 'One', lastName: 'Teacher', short: 'T1', directoryUserId: 'user-1' } });
    expect(context.directory.lookupClasses).toHaveBeenCalledWith(['academic-1']);
    expect(context.directory.lookupUsers).toHaveBeenCalledWith(['user-1']);
    context.directory.lookupClasses.mockResolvedValueOnce([]);
    await expect(routes.get('POST classes')({ body: { timetableId: 'tt-1', name: 'Grade 2', short: 'G2', academicClassId: 'missing' } }))
      .rejects.toThrow('Academic directory contract');
  });

  it('rejects a partial entry edit that conflicts with its existing lesson', async () => {
    const { routes, database, context } = fixture();
    await plugin.activate(context);
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM plugin_wattanam_timetable_entry') && sql.includes('"id"=$1')) {
        return [{ id: 'e-1', timetableId: 'tt-1', lessonId: 'l-1', teacherId: 't-1', subjectId: 's-1', classId: 'c-1' }];
      }
      if (sql.includes('FROM plugin_wattanam_timetable_lesson')) {
        return [{ teacherId: 't-1', subjectId: 's-1', classId: 'c-1' }];
      }
      if (sql.includes('FROM plugin_wattanam_timetable_document')) return [{ status: 'DRAFT' }];
      return [{ id: 't-2' }];
    });
    await expect(routes.get('PUT entries/:id')({ params: { id: 'e-1' }, body: { teacherId: 't-2' } }))
      .rejects.toThrow('Entry teacherId conflicts with its lesson');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('rejects changing only lessonId when the new lesson has different participants', async () => {
    const { routes, database, context } = fixture();
    await plugin.activate(context);
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM plugin_wattanam_timetable_entry') && sql.includes('"id"=$1')) {
        return [{ id: 'e-1', timetableId: 'tt-1', lessonId: 'l-1', teacherId: 't-1', subjectId: 's-1', classId: 'c-1' }];
      }
      if (sql.includes('FROM plugin_wattanam_timetable_lesson')) {
        return [{ teacherId: 't-2', subjectId: 's-1', classId: 'c-1' }];
      }
      if (sql.includes('FROM plugin_wattanam_timetable_document')) return [{ status: 'DRAFT' }];
      return [{ id: 'l-2' }];
    });
    await expect(routes.get('PUT entries/:id')({ params: { id: 'e-1' }, body: { lessonId: 'l-2' } }))
      .rejects.toThrow('Entry teacherId conflicts with its lesson');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('preserves wizard settings and hydrates the legacy editor response shape', async () => {
    const { routes, database, context } = fixture();
    await plugin.activate(context);
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM plugin_wattanam_timetable_document')) return [{
        id: 'tt-1', name: 'School', status: 'DRAFT', periodTimes: ['07:00'],
        timeOffRules: [{ from: '12:00', to: '13:00' }], distribution: 'Balanced',
      }];
      if (sql.includes('FROM plugin_wattanam_timetable_subject')) return [{ id: 's-1', timetableId: 'tt-1', short: 'MATH' }];
      if (sql.includes('FROM plugin_wattanam_timetable_classroom')) return [{ id: 'r-1', timetableId: 'tt-1', short: 'R1' }];
      if (sql.includes('FROM plugin_wattanam_timetable_class ')) return [{ id: 'c-1', timetableId: 'tt-1', short: 'C1' }];
      if (sql.includes('FROM plugin_wattanam_timetable_teacher')) return [{ id: 't-1', timetableId: 'tt-1', short: 'T1', classTeacherId: 'c-1' }];
      if (sql.includes('FROM plugin_wattanam_timetable_lesson')) return [{ id: 'l-1', timetableId: 'tt-1', teacherId: 't-1', subjectId: 's-1', classId: 'c-1' }];
      if (sql.includes('FROM plugin_wattanam_timetable_entry')) return [{ id: 'e-1', timetableId: 'tt-1', teacherId: 't-1', subjectId: 's-1', classId: 'c-1', classroomId: 'r-1' }];
      return [];
    });
    const create = await routes.get('POST timetables')({ body: {
      name: 'School', academicYear: '2026-2027', weekend: ['SATURDAY', 'SUNDAY'],
      periodTimes: ['07:00', '08:00'], timeOffRules: JSON.stringify([{ from: '12:00', to: '13:00' }]), distribution: 'Balanced',
    } });
    expect(database.execute).toHaveBeenCalledWith(expect.stringContaining('"weekend","periodTimes","timeOffRules","distribution"'), expect.arrayContaining([
      '["SATURDAY","SUNDAY"]', '["07:00","08:00"]', '[{"from":"12:00","to":"13:00"}]', '"Balanced"',
    ]));
    expect(create.timeOffRules).toBe('[{"from":"12:00","to":"13:00"}]');
    const detail = await routes.get('GET timetables/:id')({ params: { id: 'tt-1' } });
    expect(detail.lessons[0]).toMatchObject({ teacher: { id: 't-1' }, subject: { id: 's-1' }, class: { id: 'c-1' } });
    expect(detail.entries[0]).toMatchObject({ classroom: { id: 'r-1' }, teacher: { id: 't-1' } });
    expect(detail.classes[0].classTeachers).toHaveLength(1);
    expect(detail.periodTimes).toBe('["07:00"]');
  });
});
