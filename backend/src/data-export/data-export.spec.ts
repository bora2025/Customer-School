import { ROLES_KEY } from '../auth/roles.decorator';
import { DataExportController } from './data-export.controller';
import { DataExportService, csvCell, csvRow } from './data-export.service';

async function collect(lines: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Phnom Penh, Cambodia')).toBe('"Phnom Penh, Cambodia"');
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  // Names arrive through public self-registration; a registrant must not plant a formula in the school's Excel.
  it('defuses text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+855 12 345 678')).toBe("'+855 12 345 678");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('writes numbers as numbers, so a negative score is not mistaken for a formula', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(87.5)).toBe('87.5');
  });

  it('leaves missing values empty and keeps Khmer text as it is', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('សុខា')).toBe('សុខា');
    expect(csvRow(['a', null, 3])).toBe('a,,3\r\n');
  });
});

describe('DataExportService', () => {
  const student = (id: string) => ({
    id, studentNumber: id.toUpperCase(), nameKh: null, sex: 'FEMALE', dateOfBirth: new Date('2012-03-04T00:00:00.000Z'), generation: null,
    address: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), user: { name: `Student ${id}`, email: null, phone: null },
    class: { name: 'Grade 7A' }, parent: null,
  });

  // A big school must never sit in memory: a thousand rows per query, continuing after the last id.
  it('pages through the students a thousand at a time, header first', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => student(`s${String(index).padStart(4, '0')}`));
    const findMany = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([student('s9999')]);
    const lines = await collect(new DataExportService({ student: { findMany } } as any).lines('students'));

    expect(lines).toHaveLength(1 + 1001);
    expect(lines[0]).toMatch(/^student_id,student_number,name,/);
    expect(lines[1]).toBe('s0000,S0000,Student s0000,,FEMALE,2012-03-04,Grade 7A,,,,,,,,2026-01-01\r\n');
    expect(findMany.mock.calls[1][0]).toMatchObject({ skip: 1, cursor: { id: 's0999' } });
  });

  // ScoreEntry.studentId has no relation to Student, so a deleted student's grades must not vanish.
  it("keeps a grade whose student has been deleted, with the name left blank", async () => {
    const prisma = {
      scoreEntry: { findMany: jest.fn().mockResolvedValue([
        { id: 'g1', studentId: 's1', score: 88, examTab: { label: 'Semester 1', type: 'SEMESTER', scoreSheet: { name: '2026-2027' } }, subject: { name: 'Maths', maxScore: 100 } },
        { id: 'g2', studentId: 'gone', score: 71, examTab: { label: 'Semester 1', type: 'SEMESTER', scoreSheet: { name: '2026-2027' } }, subject: { name: 'Maths', maxScore: 100 } },
      ]) },
      student: { findMany: jest.fn().mockResolvedValue([{ id: 's1', studentNumber: '0001', user: { name: 'Sokha' } }]) },
    } as any;
    const lines = await collect(new DataExportService(prisma).lines('grades'));
    expect(lines.slice(1)).toEqual([
      '2026-2027,Semester 1,SEMESTER,Maths,100,s1,0001,Sokha,88\r\n',
      '2026-2027,Semester 1,SEMESTER,Maths,100,gone,,,71\r\n',
    ]);
  });

  it('orders attendance by date and writes days without a time', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 'a1', date: new Date('2026-09-01T00:00:00.000Z'), session: 1, status: 'PRESENT', permissionType: null, permissionStartDate: null,
      permissionEndDate: null, checkInTime: null, checkOutTime: null, timestamp: new Date('2026-09-01T07:02:00.000Z'), studentId: 's1',
      student: { studentNumber: '0001', user: { name: 'Sokha' } }, class: { name: 'Grade 7A' }, markedBy: { name: 'Teacher Dara' },
    }]);
    const lines = await collect(new DataExportService({ attendance: { findMany } } as any).lines('attendance'));
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ date: 'asc' }, { id: 'asc' }]);
    expect(lines[1]).toBe('2026-09-01,1,s1,0001,Sokha,Grade 7A,PRESENT,,,,,,Teacher Dara,2026-09-01T07:02:00.000Z\r\n');
  });
});

describe('DataExportController', () => {
  // The role hierarchy grants SUPER_ADMIN to no other role, so this admits nobody else -- not even ADMIN.
  it('admits the SUPER_ADMIN and nobody else', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DataExportController)).toEqual(['SUPER_ADMIN']);
  });

  function response() {
    const written: string[] = [];
    return {
      written,
      setHeader: jest.fn(), write: jest.fn((chunk: string) => { written.push(chunk); return true; }), end: jest.fn(),
      destroy: jest.fn(), destroyed: false, once: jest.fn(), off: jest.fn(),
    } as any;
  }
  const request = { user: { userId: 'owner-1', role: 'SUPER_ADMIN', email: 'owner@school.test' }, originalUrl: '/admin/data-export/students.csv', ip: '10.0.0.1', headers: { 'user-agent': 'jest' } } as any;

  it('streams the file for Excel and records who downloaded how many rows', async () => {
    const exports = { lines: jest.fn(async function* () { yield 'student_id\r\n'; yield 's1\r\n'; yield 's2\r\n'; }) } as any;
    const audit = { log: jest.fn() } as any;
    const res = response();
    await new DataExportController(exports, audit).students(request, res);

    expect(res.written[0]).toBe('﻿');
    expect(res.written.slice(1)).toEqual(['student_id\r\n', 's1\r\n', 's2\r\n']);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/^attachment; filename="students-\d{4}-\d{2}-\d{2}\.csv"$/));
    expect(res.end).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'owner-1', actorRole: 'SUPER_ADMIN', action: 'EXPORT', resource: 'school_records', metadata: { export: 'students', rows: 2 }, success: true,
    }));
  });

  // A partial file must never be mistaken for the whole school's records.
  it('cuts the download short and records the failure when the database fails midway', async () => {
    const exports = { lines: jest.fn(async function* () { yield 'student_id\r\n'; throw new Error('connection lost'); }) } as any;
    const audit = { log: jest.fn() } as any;
    const res = response();
    await new DataExportController(exports, audit).grades(request, res);

    expect(res.end).not.toHaveBeenCalled();
    expect(res.destroy).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorMessage: 'connection lost' }));
  });
});
