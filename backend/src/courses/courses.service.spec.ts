import { CoursesService } from './courses.service';

describe('CoursesService directory-boundary student scoping', () => {
  it('uses DirectoryService memberships for published class course visibility', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'course-1' }]);
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      course: { findMany },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-a', 'class-b']),
    } as any;
    const service = new CoursesService(prisma, directory);

    const result = await service.getStudentCourses('user-1');

    expect(directory.classesForUser).toHaveBeenCalledWith('user-1', 'STUDENT');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          {
            classId: { in: ['class-a', 'class-b'] },
            status: { in: ['PUBLISHED', 'ENROLLMENT', 'ACTIVE', 'COMPLETED'] },
          },
          { enrollments: { some: { studentId: 'student-1' } } },
        ],
      },
    }));
    expect(result).toEqual([{ id: 'course-1' }]);
  });

  it('falls back to enrollment-only visibility when no class memberships are returned', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'course-enrolled' }]);
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-2' }) },
      course: { findMany },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new CoursesService(prisma, directory);

    const result = await service.getStudentCourses('user-2');

    expect(directory.classesForUser).toHaveBeenCalledWith('user-2', 'STUDENT');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [{ enrollments: { some: { studentId: 'student-2' } } }],
      },
    }));
    expect(result).toEqual([{ id: 'course-enrolled' }]);
  });

  it('returns empty result when no student profile exists', async () => {
    const findMany = jest.fn();
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue(null) },
      course: { findMany },
    } as any;
    const directory = {
      classesForUser: jest.fn(),
    } as any;
    const service = new CoursesService(prisma, directory);

    await expect(service.getStudentCourses('user-missing')).resolves.toEqual([]);
    expect(directory.classesForUser).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
