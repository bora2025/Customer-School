import { ExamService } from './exam.service';

describe('ExamService directory-boundary student scoping', () => {
  it('uses DirectoryService class memberships to scope student exam list', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'exam-1' }]);
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      exam: { findMany },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-a', 'class-b']),
    } as any;
    const service = new ExamService(prisma, directory);

    const result = await service.getStudentExams('user-1');

    expect(directory.classesForUser).toHaveBeenCalledWith('user-1', 'STUDENT');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ classId: { in: ['class-a', 'class-b'] } }, { classId: null }],
      }),
    }));
    expect(result).toEqual([{ id: 'exam-1' }]);
  });

  it('falls back to global exams when student has no class memberships', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'exam-global' }]);
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      exam: { findMany },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new ExamService(prisma, directory);

    const result = await service.getStudentExams('user-2');

    expect(directory.classesForUser).toHaveBeenCalledWith('user-2', 'STUDENT');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ classId: null }],
      }),
    }));
    expect(result).toEqual([{ id: 'exam-global' }]);
  });
});
