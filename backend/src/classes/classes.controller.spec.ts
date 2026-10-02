import { academicClassesRouteOwner, ClassesController } from './classes.controller';

describe('ClassesController compatibility ownership', () => {
  const original = process.env.ACADEMIC_CLASSES_ROUTE_OWNER;

  afterEach(() => {
    if (original === undefined) delete process.env.ACADEMIC_CLASSES_ROUTE_OWNER;
    else process.env.ACADEMIC_CLASSES_ROUTE_OWNER = original;
  });

  it('defaults to legacy and rejects ambiguous configuration', () => {
    delete process.env.ACADEMIC_CLASSES_ROUTE_OWNER;
    expect(academicClassesRouteOwner()).toBe('legacy');
    expect(() => academicClassesRouteOwner('auto')).toThrow('must be legacy or plugin');
  });

  it('keeps legacy list ownership and class-admin filtering before cutover', async () => {
    process.env.ACADEMIC_CLASSES_ROUTE_OWNER = 'legacy';
    const service = {
      getClassesByAdmin: jest.fn().mockResolvedValue(['legacy-admin']),
      getClasses: jest.fn().mockResolvedValue(['legacy']),
      createClass: jest.fn(),
      updateClass: jest.fn(),
      updateStudent: jest.fn(),
      addStudentToClass: jest.fn(),
      bulkAddStudentsFromCsv: jest.fn(),
      deleteClass: jest.fn(),
      cleanupOrphanedStudents: jest.fn(),
      removeStudentFromClass: jest.fn(),
      getStudentsInClass: jest.fn(),
      getStudentsByClasses: jest.fn(),
      getAvailableStudents: jest.fn(),
      listParents: jest.fn(),
    } as any;
    const controller = new ClassesController(service, { dispatch: jest.fn() } as any);

    await expect(controller.getClasses({ user: { userId: 'a1', role: 'CLASS_ADMIN' } }, undefined, 'y1')).resolves.toEqual(['legacy-admin']);
    await expect(controller.getClasses({ user: { userId: 't1', role: 'TEACHER' } }, 'me', 'y2')).resolves.toEqual(['legacy']);

    expect(service.getClassesByAdmin).toHaveBeenCalledWith('a1', 'y1');
    expect(service.getClasses).toHaveBeenCalledWith('t1', 'y2');
  });

  it('routes reads and writes through plugin in plugin mode', async () => {
    process.env.ACADEMIC_CLASSES_ROUTE_OWNER = 'plugin';
    const service = {
      getClassesByAdmin: jest.fn(),
      getClasses: jest.fn(),
      createClass: jest.fn(),
      updateClass: jest.fn(),
      updateStudent: jest.fn(),
      addStudentToClass: jest.fn(),
      bulkAddStudentsFromCsv: jest.fn(),
      deleteClass: jest.fn(),
      cleanupOrphanedStudents: jest.fn(),
      removeStudentFromClass: jest.fn(),
      getStudentsInClass: jest.fn(),
      getStudentsByClasses: jest.fn(),
      getAvailableStudents: jest.fn(),
      listParents: jest.fn(),
    } as any;
    const extensions = { dispatch: jest.fn().mockResolvedValue({ ok: true }) } as any;
    const controller = new ClassesController(service, extensions);
    const req = { user: { userId: 'u1', role: 'ADMIN', email: 'admin@example.test' } };

    await expect(controller.getClasses({ user: { userId: 'a1', role: 'CLASS_ADMIN', email: 'a@example.test' } }, undefined, 'y1')).resolves.toEqual({ ok: true });
    await expect(controller.getClasses({ user: { userId: 't1', role: 'TEACHER', email: 't@example.test' } }, 'me', 'y2')).resolves.toEqual({ ok: true });
    await expect(controller.listParents(req)).resolves.toEqual({ ok: true });
    await expect(controller.getStudentsInClass(req, 'c1')).resolves.toEqual({ ok: true });
    await expect(controller.getStudentsByClasses(req, 'c1,c2')).resolves.toEqual({ ok: true });
    await expect(controller.getAvailableStudents(req, 'c1')).resolves.toEqual({ ok: true });

    await expect(controller.createClass(req, { name: 'G1', teacherId: 't1' })).resolves.toEqual({ ok: true });
    await expect(controller.updateClass(req, 'c1', { name: 'G1A' })).resolves.toEqual({ ok: true });
    await expect(controller.deleteClass(req, 'c1')).resolves.toEqual({ ok: true });
    await expect(controller.updateStudent(req, 'c1', 's1', { name: 'Bopha' })).resolves.toEqual({ ok: true });
    await expect(controller.addStudentToClass(req, 'c1', { studentId: 's1' })).resolves.toEqual({ ok: true });
    await expect(controller.removeStudentFromClass(req, 'c1', 's1')).resolves.toEqual({ ok: true });
    await expect(controller.cleanupOrphanedStudents(req)).resolves.toEqual({ ok: true });
    await expect(controller.bulkAddStudentsFromCsv(req, 'c1', { buffer: Buffer.from('Name\nStudent') } as any)).resolves.toEqual({ ok: true });

    expect(extensions.dispatch.mock.calls.map((call: any[]) => [call[0], call[1].method, call[1].path, call[1].params, call[1].query, call[1].body]))
      .toEqual([
        ['wattanam.academic-management', 'GET', 'classes', {}, { classAdminId: 'a1', studyYearId: 'y1' }, {}],
        ['wattanam.academic-management', 'GET', 'classes', {}, { teacherId: 't1', studyYearId: 'y2' }, {}],
        ['wattanam.academic-management', 'GET', 'classes/parents', {}, {}, {}],
        ['wattanam.academic-management', 'GET', 'classes/c1/students', { id: 'c1' }, {}, {}],
        ['wattanam.academic-management', 'GET', 'classes/students/batch', {}, { ids: 'c1,c2' }, {}],
        ['wattanam.academic-management', 'GET', 'classes/c1/available-students', { id: 'c1' }, {}, {}],
        ['wattanam.academic-management', 'POST', 'classes', {}, {}, { name: 'G1', teacherId: 't1' }],
        ['wattanam.academic-management', 'PUT', 'classes/c1', {}, { id: 'c1' }, { name: 'G1A' }],
        ['wattanam.academic-management', 'DELETE', 'classes/c1', {}, { id: 'c1' }, {}],
        ['wattanam.academic-management', 'PATCH', 'classes/c1/students/s1', { classId: 'c1', studentId: 's1' }, {}, { name: 'Bopha' }],
        ['wattanam.academic-management', 'POST', 'classes/c1/students', { id: 'c1' }, {}, { studentId: 's1' }],
        ['wattanam.academic-management', 'DELETE', 'classes/c1/students/s1', { id: 'c1', studentId: 's1' }, {}, {}],
        ['wattanam.academic-management', 'POST', 'classes/cleanup-orphaned-students', {}, {}, {}],
        ['wattanam.academic-management', 'POST', 'classes/c1/students/bulk-csv', { id: 'c1' }, {}, { csv: 'Name\nStudent' }],
      ]);
    expect(service.createClass).not.toHaveBeenCalled();
    expect(service.updateClass).not.toHaveBeenCalled();
    expect(service.deleteClass).not.toHaveBeenCalled();
  });
});
