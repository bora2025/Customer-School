const plugin = require('../../../plugins/wattanam.reporting/backend/index.js');
export {};

describe('Reporting plugin behavior', () => {
  function activate() {
    const routes = new Map<string, any>();
    const directory = {
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1', className: 'Grade 1',
        students: [
          { studentId: 'student-1', studentNumber: 'S001', name: 'One' },
          { studentId: 'student-2', studentNumber: 'S002', name: 'Two' },
        ],
      }),
      resolveAudience: jest.fn().mockResolvedValue([
        { id: 'staff-1', role: 'TEACHER', email: 'private@example.test', phone: 'private' },
        { id: 'staff-2', role: 'SCHOOL_ADMIN' },
        { id: 'student-user', role: 'STUDENT' },
        { id: 'admin-1', role: 'ADMIN' },
      ]),
      lookupUsers: jest.fn().mockResolvedValue([{ id: 'staff-1', name: 'Teacher One', role: 'TEACHER', email: 'private@example.test' }, { id: 'staff-2', name: 'School Owner', role: 'SCHOOL_ADMIN' }]),
    };
    const datasets: Record<string, any[]> = {
      'student-attendance-summary': [{ key: 'student-1', data: { counts: { PRESENT: 7, LATE: 1, ABSENT: 2 }, scannerCode: 'never-return' } }],
      'student-fee-balance': [{ key: 'student-1', data: { currencies: [{ currency: 'USD', balanceMinor: '1250' }], receiptDetails: 'never-return' } }],
      'student-grade-summary': [{ key: 'student-1', data: { gradebooks: [{ id: 'g1' }], attempts: [{ id: 'a1' }], answers: ['never-return'] } }],
      'student-transport-summary': [{ key: 'student-1', data: { assignments: [{ vehicle: { name: 'Bus A' } }], locationHistory: ['never-return'] } }],
      'student-communication-summary': [{ key: 'student-1', data: { unreadCount: 3, content: 'never-return' } }],
      'staff-attendance-summary': [{ key: 'staff-1', data: { recent: [{ date: '2026-09-25', session: 1, status: 'PRESENT' }, { date: '2026-09-25', session: 2, status: 'LATE' }, { date: '2026-09-24', session: 1, status: 'ABSENT' }], markedBy: 'never-return' } }],
    };
    const readModels = { read: jest.fn(async (_owner: string, model: string) => datasets[model] || []) };
    const context: any = { directory, readModels, permissions: { register: jest.fn() }, navigation: { register: jest.fn() }, routes: { register: (route: any) => routes.set(`${route.method} ${route.path}`, route) } };
    plugin.activate(context);
    return { routes, directory, readModels };
  }

  const request = { principal: { role: 'SCHOOL_ADMIN' }, query: { classId: 'class-1', asOfIsoDate: '2026-09-25' } };

  it('rejects non-administrators before reading any student data', async () => {
    const { routes, directory, readModels } = activate();
    await expect(routes.get('GET student-summaries').handler({ principal: { role: 'TEACHER' }, query: { classId: 'class-1' } })).rejects.toThrow('school administrator');
    expect(directory.getClassRoster).not.toHaveBeenCalled();
    expect(readModels.read).not.toHaveBeenCalled();
  });

  it('composes bounded student-keyed projections without leaking source details', async () => {
    const { routes, directory, readModels } = activate();
    const rows = await routes.get('GET student-summaries').handler(request);
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', '2026-09-25');
    expect(readModels.read).toHaveBeenCalledTimes(5);
    expect(readModels.read.mock.calls.every((call: any[]) => Array.isArray(call[3]) && call[3].length === 2)).toBe(true);
    expect(rows[0]).toEqual({ studentId: 'student-1', studentNumber: 'S001', studentName: 'One', attendancePresent: 7, attendanceLate: 1, attendanceAbsent: 2, feeBalance: 'USD 1250', gradeEntries: 2, transportVehicle: 'Bus A', unreadMessages: 3 });
    expect(JSON.stringify(rows)).not.toMatch(/scannerCode|receiptDetails|answers|locationHistory|never-return|content/);
  });

  it('degrades an unavailable optional projection to an empty section', async () => {
    const { routes, readModels } = activate();
    readModels.read.mockImplementation(async (_owner: string, model: string) => {
      if (model === 'student-fee-balance') throw new Error('plugin disabled');
      return [];
    });
    await expect(routes.get('GET student-summaries').handler(request)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ feeBalance: '', gradeEntries: 0 })]));
  });

  it('rejects oversized rosters and emits safely escaped UTF-8 CSV', async () => {
    const { routes, directory } = activate();
    directory.getClassRoster.mockResolvedValueOnce({ classId: 'class-1', students: Array.from({ length: 501 }, (_, index) => ({ studentId: `s-${index}`, name: 'Student' })) });
    await expect(routes.get('GET student-summaries').handler(request)).rejects.toThrow('exceeds the reporting limit');

    directory.getClassRoster.mockResolvedValueOnce({ classId: 'class-1', students: [{ studentId: 'student-1', studentNumber: 'S001', name: 'One, "Quoted"' }] });
    const csv = await routes.get('GET student-summaries/export.csv').handler(request);
    expect(csv.content.startsWith('\uFEFF')).toBe(true);
    expect(csv.content).toContain('"One, ""Quoted"""');
    expect(csv.filename).toBe('student-summary-class-1-2026-09-25.csv');

    directory.getClassRoster.mockResolvedValueOnce({ classId: 'class-1', students: [{ studentId: 'student-1', studentNumber: '+123', name: '=HYPERLINK("https://example.test")' }] });
    const safeCsv = await routes.get('GET student-summaries/export.csv').handler(request);
    expect(safeCsv.content).toContain("'+123");
    expect(safeCsv.content).toContain("'=HYPERLINK");
    expect(safeCsv.content).not.toContain('\r\n+123,=HYPERLINK');
  });

  it('builds a dated staff report through Directory and the HR projection only', async () => {
    const { routes, directory, readModels } = activate();
    const rows = await routes.get('GET staff-summaries').handler({ principal: { role: 'ADMIN' }, query: { date: '2026-09-25' } });
    expect(directory.resolveAudience).toHaveBeenCalledWith({ audience: 'SCHOOL' });
    expect(directory.lookupUsers).toHaveBeenCalledWith(['staff-1', 'staff-2']);
    expect(readModels.read).toHaveBeenCalledWith('wattanam.human-resources', 'staff-attendance-summary', [1], ['staff-1', 'staff-2']);
    expect(rows).toEqual([
      { staffId: 'staff-1', staffName: 'Teacher One', role: 'TEACHER', present: 1, late: 1, absent: 0, excused: 0, recordedSessions: 2 },
      { staffId: 'staff-2', staffName: 'School Owner', role: 'SCHOOL_ADMIN', present: 0, late: 0, absent: 1, excused: 0, recordedSessions: 0 },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/private@example|never-return|markedBy|phone/);
  });
});
