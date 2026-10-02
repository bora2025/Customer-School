import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

describe('AttendanceService class-admin directory boundary', () => {
  const gateway = { notifyAttendanceUpdate: jest.fn() } as any;
  const notificationService = { sendAbsenceNotification: jest.fn() } as any;
  const sessionConfigService = { getConfigs: jest.fn().mockResolvedValue([]) } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects recordAttendance when CLASS_ADMIN is not assigned to class via directory contract', async () => {
    const prisma = {
      student: { findFirst: jest.fn() },
      attendance: { findUnique: jest.fn(), upsert: jest.fn() },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-allowed']),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    await expect(
      service.recordAttendance('student-1', 'class-blocked', 'PRESENT', 'admin-1', 'CLASS_ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(directory.classesForUser).toHaveBeenCalledWith('admin-1', 'CLASS_ADMIN');
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it('allows recordAttendance for assigned CLASS_ADMIN and uses roster contract for membership', async () => {
    const prisma = {
      student: { findFirst: jest.fn() },
      attendance: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'att-1', timestamp: new Date('2026-01-01T00:00:00Z') }),
      },
      installation: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-1']),
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1',
        className: 'Grade 1A',
        students: [{ studentId: 'student-1', userId: 'user-1', name: 'Dara', studentNumber: '001', parentId: null }],
      }),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    await expect(
      service.recordAttendance('student-1', 'class-1', 'PRESENT', 'admin-1', 'CLASS_ADMIN'),
    ).resolves.toBeDefined();

    expect(directory.classesForUser).toHaveBeenCalledWith('admin-1', 'CLASS_ADMIN');
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', expect.any(String));
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
    expect(prisma.attendance.upsert).toHaveBeenCalled();
  });

  it('rejects recordAttendance when student is not on the class roster', async () => {
    const prisma = {
      student: { findFirst: jest.fn() },
      attendance: { findUnique: jest.fn(), upsert: jest.fn() },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-1']),
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1',
        className: 'Grade 1A',
        students: [],
      }),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    await expect(
      service.recordAttendance('student-1', 'class-1', 'PRESENT', 'admin-1', 'CLASS_ADMIN'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', expect.any(String));
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
    expect(prisma.attendance.upsert).not.toHaveBeenCalled();
  });

  it('rejects bulk attendance when CLASS_ADMIN is not assigned to class via directory contract', async () => {
    const prisma = {
      student: { findMany: jest.fn() },
      $transaction: jest.fn(),
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-allowed']),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    await expect(
      service.recordBulkAttendance([{ studentId: 'student-1', status: 'PRESENT' }], 'class-blocked', 'admin-1', 'CLASS_ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(directory.classesForUser).toHaveBeenCalledWith('admin-1', 'CLASS_ADMIN');
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it('uses roster contract for recordBulkAttendance membership', async () => {
    const prisma = {
      student: { findMany: jest.fn() },
      $transaction: jest.fn((cb: any) =>
        cb({ attendance: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) } }),
      ),
      attendance: { findUnique: jest.fn(), upsert: jest.fn() },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-1']),
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1',
        className: 'Grade 1A',
        students: [
          { studentId: 'student-1', userId: 'user-1', name: 'Dara', studentNumber: '001', parentId: null },
          { studentId: 'student-2', userId: 'user-2', name: 'Sophea', studentNumber: '002', parentId: null },
        ],
      }),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    const result = await service.recordBulkAttendance(
      [{ studentId: 'student-1', status: 'PRESENT' }],
      'class-1',
      'admin-1',
      'CLASS_ADMIN',
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(true);
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', expect.any(String));
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it('uses roster contract for getStudentAttendanceRecords', async () => {
    const prisma = {
      student: { findMany: jest.fn() },
      attendance: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', studentId: 'student-1', session: 1, status: 'PRESENT' },
        ]),
      },
    } as any;
    const directory = {
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1',
        className: 'Grade 1A',
        students: [
          { studentId: 'student-1', userId: 'user-1', name: 'Dara', studentNumber: '001', parentId: null },
          { studentId: 'student-2', userId: 'user-2', name: 'Sophea', studentNumber: '002', parentId: null },
        ],
      }),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    const result = await service.getStudentAttendanceRecords('class-1', '2026-09-01');

    expect(result).toHaveLength(2);
    expect(result[0].studentName).toBe('Dara');
    expect(result[0].sessions[0].status).toBe('PRESENT');
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', '2026-09-01');
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it('uses directory contract for getUserDailyAttendance when user is a student', async () => {
    const prisma = {
      student: { findUnique: jest.fn() },
      attendance: {
        findMany: jest.fn().mockResolvedValue([
          { session: 1, status: 'PRESENT', checkInTime: new Date('2026-09-01T08:00:00Z'), checkOutTime: null },
        ]),
      },
    } as any;
    const directory = {
      classesForUser: jest.fn().mockResolvedValue(['class-1']),
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1',
        className: 'Grade 1A',
        students: [{ studentId: 'student-1', userId: 'user-1', name: 'Dara', studentNumber: '001', parentId: null }],
      }),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    const result = await service.getUserDailyAttendance('user-1', '2026-09-01');

    expect(result.type).toBe('student');
    expect(result.className).toBe('Grade 1A');
    expect(result.sessions[0].status).toBe('PRESENT');
    expect(directory.classesForUser).toHaveBeenCalledWith('user-1', 'STUDENT');
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', '2026-09-01');
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
  });

  it('wattamanScan records attendance using directory enrollment and roster contracts', async () => {
    const scanSessionConfig = {
      getConfigs: jest.fn().mockResolvedValue([{ session: 1, type: 'CHECK_IN', startTime: '00:00', endTime: '23:59' }]),
      getGlobalDefaults: jest.fn(),
    } as any;

    const prisma = {
      cardAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', photo: null, classId: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ photo: 'photo.jpg' }) },
      attendance: {
        create: jest.fn().mockResolvedValue({ id: 'a1', status: 'PRESENT', timestamp: new Date('2026-09-17T00:00:00Z') }),
      },
    } as any;
    const directory = {
      getEnrollmentAtDate: jest.fn().mockResolvedValue({
        studentId: 'student-1', classId: 'class-1', className: 'Grade 1A', enrolled: true,
        asOfIsoDate: expect.any(String), source: 'legacy-current-membership',
      }),
      getClassRoster: jest.fn().mockResolvedValue({
        classId: 'class-1',
        className: 'Grade 1A',
        students: [{ studentId: 'student-1', userId: 'user-1', name: 'Dara', studentNumber: '001', parentId: null }],
      }),
      lookupClasses: jest.fn().mockResolvedValue([{ id: 'class-1', name: 'Grade 1A' }]),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, scanSessionConfig, directory);

    const result = await service.wattamanScan('student-1', 'scanner-1');

    expect(result.action).toBe('CHECK_IN');
    expect(result.studentId).toBe('student-1');
    expect(result.studentName).toBe('Dara');
    expect(result.studentPhoto).toBe('photo.jpg');
    expect(result.className).toBe('Grade 1A');
    expect(directory.getEnrollmentAtDate).toHaveBeenCalledWith('student-1', expect.any(String));
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1', expect.any(String));
    expect(prisma.attendance.create).toHaveBeenCalled();
  });

  it('wattamanScan rejects scan when student is not enrolled', async () => {
    const prisma = {
      cardAlias: { findUnique: jest.fn().mockResolvedValue(null) },
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', photo: null, classId: null }) },
    } as any;
    const directory = {
      getEnrollmentAtDate: jest.fn().mockResolvedValue({
        studentId: 'student-1', classId: null, className: null, enrolled: false,
        asOfIsoDate: expect.any(String), source: 'legacy-current-membership',
      }),
    } as any;
    const service = new AttendanceService(prisma, gateway, notificationService, sessionConfigService, directory);

    await expect(service.wattamanScan('student-1', 'scanner-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(directory.getEnrollmentAtDate).toHaveBeenCalledWith('student-1', expect.any(String));
  });
});
