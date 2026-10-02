import { readFileSync } from 'fs';
import { PrismaAcademicDirectoryProvider } from './academic-directory.provider';

describe('PrismaAcademicDirectoryProvider department membership read ownership', () => {
  const originalOwner = process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER;
  afterEach(() => {
    if (originalOwner === undefined) delete process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER;
    else process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER = originalOwner;
  });

  it('defaults to the legacy membership without accessing the plugin table', async () => {
    delete process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER;
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ departmentId: 'd1' }) }, $transaction: jest.fn() } as any;
    await expect(new PrismaAcademicDirectoryProvider(prisma).departmentForUser('u1')).resolves.toBe('d1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('contains no cross-schema Academic department membership SQL', () => {
    const source = readFileSync(require.resolve('./academic-directory.provider'), 'utf8');
    expect(source).not.toContain('plugin_wattanam_academic_management_user_department');
  });
});

describe('PrismaAcademicDirectoryProvider roster contract v1', () => {
  const today = new Date().toISOString().slice(0, 10);
  const originalOwner = process.env.ACADEMIC_ROSTER_READ_OWNER;
  afterEach(() => {
    if (originalOwner === undefined) delete process.env.ACADEMIC_ROSTER_READ_OWNER;
    else process.env.ACADEMIC_ROSTER_READ_OWNER = originalOwner;
  });

  it('returns a stable versioned current roster projection', async () => {
    const prisma = { installation: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) }, class: { findUnique: jest.fn().mockResolvedValue({
      id: 'c1', name: 'Grade 1A', students: [
        { id: 's2', userId: 'u2', studentNumber: '002', parentId: null, user: { name: 'Sokha' } },
        { id: 's1', userId: 'u1', studentNumber: '001', parentId: 'p1', user: { name: 'Dara' } },
      ],
    }) } } as any;
    const result = await new PrismaAcademicDirectoryProvider(prisma).getClassRoster('c1', today);
    expect(result).toMatchObject({
      contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
      classId: 'c1', className: 'Grade 1A', asOfIsoDate: today,
    });
    expect(result.students).toHaveLength(2);
    expect(result.students[0]).toMatchObject({ studentId: 's2', userId: 'u2', name: 'Sokha' });
    expect(prisma.class.findUnique.mock.calls[0][0].select.students.orderBy).toEqual({ id: 'asc' });
  });

  it('returns current enrollment with an explicit legacy source', async () => {
    const prisma = { installation: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) }, student: { findUnique: jest.fn().mockResolvedValue({ id: 's1', classId: 'c1', class: { name: 'Grade 1A' } }) } } as any;
    await expect(new PrismaAcademicDirectoryProvider(prisma).getEnrollmentAtDate('s1', today)).resolves.toMatchObject({
      contract: { version: '1.0.0' }, studentId: 's1', classId: 'c1', className: 'Grade 1A',
      enrolled: true, asOfIsoDate: today, source: 'legacy-current-membership',
    });
  });

  it('fails closed for historical or malformed dates before querying current membership', async () => {
    const prisma = { installation: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) }, class: { findUnique: jest.fn() }, student: { findUnique: jest.fn() } } as any;
    const provider = new PrismaAcademicDirectoryProvider(prisma);
    await expect(provider.getClassRoster('c1', '2020-01-01')).rejects.toThrow('Historical enrollment lookup is unavailable');
    await expect(provider.getEnrollmentAtDate('s1', 'not-a-date')).rejects.toThrow('valid ISO date');
    expect(prisma.class.findUnique).not.toHaveBeenCalled();
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
  });

  it('contains no cross-schema SQL for Academic plugin-owned roster tables', () => {
    const source = readFileSync(require.resolve('./academic-directory.provider'), 'utf8');
    expect(source).not.toContain('plugin_wattanam_academic_management_class');
    expect(source).not.toContain('plugin_wattanam_academic_management_student_profile');
    expect(source).not.toContain('plugin_wattanam_academic_management_enrollment_interval');
  });
});
