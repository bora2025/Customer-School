import { Test, TestingModule } from '@nestjs/testing';
import { FeesService } from './fees.service';
import { PrismaService } from '../database/prisma.service';
import { DirectoryService } from '../directory/directory.service';

describe('FeesService academic contract boundary', () => {
  let service: FeesService;
  let prisma: any;
  let directory: any;

  beforeEach(async () => {
    prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      feeRecord: { findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1' }, { studentId: 'student-2' }]) },
    };
    directory = {
      getEnrollmentAtDate: jest.fn()
        .mockResolvedValueOnce({ studentId: 'student-1', enrolled: true, classId: 'class-1', className: 'Grade 1A' })
        .mockResolvedValueOnce({ studentId: 'student-2', enrolled: false, classId: null, className: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: DirectoryService, useValue: directory },
      ],
    }).compile();

    service = module.get<FeesService>(FeesService);
  });

  it('resolves the students dropdown through DirectoryService enrollment contract, not direct Student/Class joins', async () => {
    const result = await service.getStudents();

    expect(directory.getEnrollmentAtDate).toHaveBeenCalledTimes(2);
    expect(prisma.feeRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ distinct: ['studentId'] }));
    expect(result).toEqual([
      { id: 'student-1', studentNumber: '', name: 'Student', class: 'Grade 1A' },
    ]);
  });

  it('returns empty list when no fee records exist', async () => {
    prisma.feeRecord.findMany = jest.fn().mockResolvedValue([]);
    const result = await service.getStudents();
    expect(result).toEqual([]);
    expect(directory.getEnrollmentAtDate).not.toHaveBeenCalled();
  });
});
