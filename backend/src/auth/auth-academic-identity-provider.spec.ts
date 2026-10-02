import { AuthService } from './auth.service';

describe('AuthService academic identity provider boundary', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...originalEnvironment, WATTANAM_DISTRIBUTION: 'legacy-full' };
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('delegates parent assignment with an idempotency key and no Prisma fallback', async () => {
    const prisma = {
      student: { findUnique: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn() },
    } as any;
    const provider = {
      assignStudentParent: jest.fn().mockResolvedValue(undefined),
      assignUserDepartment: jest.fn(),
      detachUserAcademicIdentity: jest.fn(),
    } as any;
    const auth = new AuthService({} as any, prisma, provider);

    await expect(auth.setStudentParent('student-user-1', 'parent-1')).resolves.toEqual({ ok: true });

    expect(provider.assignStudentParent).toHaveBeenCalledWith({
      studentUserId: 'student-user-1',
      parentId: 'parent-1',
      idempotencyKey: 'assign-parent:student-user-1:parent-1',
    });
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('delegates academic detach before the core delete transaction with an idempotency key', async () => {
    const tx = {
      attendance: { deleteMany: jest.fn().mockResolvedValue({}) },
      staffAttendance: { deleteMany: jest.fn().mockResolvedValue({}) },
      message: { deleteMany: jest.fn().mockResolvedValue({}) },
      announcementRead: { deleteMany: jest.fn().mockResolvedValue({}) },
      announcement: { deleteMany: jest.fn().mockResolvedValue({}) },
      salary: { deleteMany: jest.fn().mockResolvedValue({}) },
      exam: { deleteMany: jest.fn().mockResolvedValue({}) },
      assignment: { deleteMany: jest.fn().mockResolvedValue({}) },
      notification: { deleteMany: jest.fn().mockResolvedValue({}) },
      notificationPreference: { deleteMany: jest.fn().mockResolvedValue({}) },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({}) },
      user: { delete: jest.fn().mockResolvedValue({}) },
      class: { updateMany: jest.fn().mockResolvedValue({}) },
      student: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      feeRecord: { deleteMany: jest.fn().mockResolvedValue({}) },
    } as any;

    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: any) => callback(tx)),
    } as any;
    const provider = {
      assignStudentParent: jest.fn(),
      assignUserDepartment: jest.fn(),
      detachUserAcademicIdentity: jest.fn().mockResolvedValue(undefined),
    } as any;
    const auth = new AuthService({} as any, prisma, provider);

    await expect(auth.deleteUser('user-1')).resolves.toEqual({ ok: true, id: 'user-1' });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(provider.detachUserAcademicIdentity).toHaveBeenCalledWith({
      userId: 'user-1',
      idempotencyKey: 'delete-user:user-1',
    });
    expect(tx.class.updateMany).not.toHaveBeenCalled();
    expect(tx.student.findUnique).not.toHaveBeenCalled();
    expect(tx.feeRecord.deleteMany).not.toHaveBeenCalled();
  });

  it('updates core account fields and delegates department assignment', async () => {
    const coreUser = { id: 'user-1', name: 'Ada', role: 'TEACHER', updatedAt: new Date(0) };
    const prisma = { user: { update: jest.fn().mockResolvedValue(coreUser) } } as any;
    const provider = {
      attachAcademicProfiles: jest.fn().mockResolvedValue([{ ...coreUser, departmentId: 'department-1' }]),
      assignStudentParent: jest.fn(),
      assignUserDepartment: jest.fn().mockResolvedValue(undefined),
      detachUserAcademicIdentity: jest.fn(),
    } as any;
    const auth = new AuthService({} as any, prisma, provider);

    await expect(auth.updateUser('user-1', { name: 'Ada', departmentId: 'department-1' }))
      .resolves.toMatchObject({ departmentId: 'department-1' });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Ada' });
    expect(prisma.user.update.mock.calls[0][0].select).not.toHaveProperty('department');
    expect(prisma.user.update.mock.calls[0][0].select).not.toHaveProperty('departmentId');
    expect(provider.assignUserDepartment).toHaveBeenCalledWith({
      userId: 'user-1',
      departmentId: 'department-1',
      idempotencyKey: 'assign-department:user-1:department-1',
    });
    expect(provider.attachAcademicProfiles).toHaveBeenCalledWith([coreUser]);
  });

  it('fails closed without an academic provider instead of running academic Prisma fallbacks', async () => {
    const prisma = { $transaction: jest.fn() } as any;
    const auth = new AuthService({} as any, prisma);

    await expect(auth.deleteUser('user-1')).rejects.toThrow('Academic identity provider is required');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
