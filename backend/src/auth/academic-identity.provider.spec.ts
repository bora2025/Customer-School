import { PrismaAcademicIdentityProvider } from './academic-identity.provider';

describe('PrismaAcademicIdentityProvider detach command', () => {
  const originalOwner = process.env.ACADEMIC_IDENTITY_DETACH_OWNER;
  afterEach(() => {
    if (originalOwner === undefined) delete process.env.ACADEMIC_IDENTITY_DETACH_OWNER;
    else process.env.ACADEMIC_IDENTITY_DETACH_OWNER = originalOwner;
  });
  it('owns the academic transaction and safely detaches all academic bindings', async () => {
    const tx = {
      student: {
        findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }),
        delete: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      class: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      attendance: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      feeRecord: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as any;
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<void>) => work(tx)),
    } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await provider.detachUserAcademicIdentity({
      userId: 'user-1',
      idempotencyKey: 'delete-user:user-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.class.updateMany).toHaveBeenCalledWith({ where: { teacherId: 'user-1' }, data: { teacherId: null } });
    expect(tx.attendance.deleteMany).toHaveBeenCalledWith({ where: { studentId: 'student-1' } });
    expect(tx.feeRecord.deleteMany).toHaveBeenCalledWith({ where: { studentId: 'student-1' } });
    expect(tx.student.delete).toHaveBeenCalledWith({ where: { id: 'student-1' } });
    expect(tx.student.updateMany).toHaveBeenCalledWith({ where: { parentId: 'user-1' }, data: { parentId: null } });
  });

  it('is repeat-safe when the student profile is already absent', async () => {
    const tx = {
      student: {
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      class: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      attendance: { deleteMany: jest.fn() },
      feeRecord: { deleteMany: jest.fn() },
    } as any;
    const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await provider.detachUserAcademicIdentity({
      userId: 'user-1',
      idempotencyKey: 'delete-user:user-1',
    });

    expect(tx.student.delete).not.toHaveBeenCalled();
    expect(tx.attendance.deleteMany).not.toHaveBeenCalled();
    expect(tx.feeRecord.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a mismatched idempotency key before starting a transaction', async () => {
    const prisma = { $transaction: jest.fn() } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await expect(provider.detachUserAcademicIdentity({
      userId: 'user-1',
      idempotencyKey: 'delete-user:another-user',
    })).rejects.toThrow('invalid idempotency key');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('dispatches plugin-owned detach without touching legacy Academic, Attendance, or Finance tables', async () => {
    process.env.ACADEMIC_IDENTITY_DETACH_OWNER = 'plugin';
    const prisma = { $transaction: jest.fn() } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);
    await expect(provider.detachUserAcademicIdentity({ userId: 'user-1', idempotencyKey: 'delete-user:user-1' }))
      .rejects.toThrow('plugin identity detach command is unavailable');
    const detachUserAcademicIdentity = jest.fn().mockResolvedValue({ success: true });
    const unbind = provider.bindAcademicPluginCommands({
      assignUserDepartment: jest.fn(), assignStudentParent: jest.fn(), detachUserAcademicIdentity,
      attachAcademicProfiles: jest.fn(),
    });
    await provider.detachUserAcademicIdentity({ userId: 'user-1', idempotencyKey: 'delete-user:user-1' });
    expect(detachUserAcademicIdentity).toHaveBeenCalledWith({ userId: 'user-1', idempotencyKey: 'delete-user:user-1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    unbind();

    process.env.ACADEMIC_IDENTITY_DETACH_OWNER = 'invalid';
    await expect(provider.detachUserAcademicIdentity({ userId: 'user-1', idempotencyKey: 'delete-user:user-1' }))
      .rejects.toThrow('ACADEMIC_IDENTITY_DETACH_OWNER must be legacy or plugin');
  });
});

describe('PrismaAcademicIdentityProvider academic profile membership reads', () => {
  const originalOwner = process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER;
  const originalProfileOwner = process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER;
  afterEach(() => {
    if (originalOwner === undefined) delete process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER;
    else process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER = originalOwner;
    if (originalProfileOwner === undefined) delete process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER;
    else process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER = originalProfileOwner;
  });

  it('defaults to legacy enrichment and keeps the existing profile shape', async () => {
    delete process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER;
    const prisma = { user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', departmentId: 'd1', department: { id: 'd1' } }]) }, $transaction: jest.fn() } as any;
    await expect(new PrismaAcademicIdentityProvider(prisma).attachAcademicProfiles([{ id: 'u1' }]))
      .resolves.toMatchObject([{ departmentId: 'd1', department: { id: 'd1' } }]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('checks batch membership parity before enriching profiles in plugin-read mode', async () => {
    process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER = 'plugin';
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ id: 'u1', departmentId: 'd1' }]).mockResolvedValueOnce([{ userId: 'u1', departmentId: 'd1' }]),
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', departmentId: 'd1', department: { id: 'd1' } }]) },
    };
    const prisma = { $transaction: jest.fn((work) => work(tx)), user: { findMany: jest.fn() } } as any;
    await expect(new PrismaAcademicIdentityProvider(prisma).attachAcademicProfiles([{ id: 'u1' }]))
      .resolves.toMatchObject([{ departmentId: 'd1' }]);
    expect(tx.$queryRawUnsafe.mock.calls[0][0]).toContain('FOR SHARE');
    expect(tx.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('rejects divergence before profile query', async () => {
    process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER = 'plugin';
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ id: 'u1', departmentId: 'd1' }]).mockResolvedValueOnce([]),
      user: { findMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((work) => work(tx)) } as any;
    await expect(new PrismaAcademicIdentityProvider(prisma).attachAcademicProfiles([{ id: 'u1' }]))
      .rejects.toThrow('mirror differs');
    expect(tx.user.findMany).not.toHaveBeenCalled();
  });

  it('reads Student profiles and parent children from plugin-owned tables in plugin mode', async () => {
    process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER = 'plugin';
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', departmentId: null, department: null }]) },
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ id: 's1', userId: 'u1', studentNumber: 'ST-1', parentId: 'p1', class: { id: 'c1', name: 'A' }, parent: { id: 'p1', name: 'Parent' } }])
        .mockResolvedValueOnce([]),
    };
    const prisma = { $transaction: jest.fn((work) => work(tx)), user: { findMany: jest.fn() } } as any;
    const result = await new PrismaAcademicIdentityProvider(prisma).attachAcademicProfiles([{ id: 'u1' }]);
    expect(result[0].studentProfile).toMatchObject({ id: 's1', studentNumber: 'ST-1', class: { id: 'c1' } });
    expect(result[0].studentProfile).not.toHaveProperty('userId');
    expect(tx.user.findMany.mock.calls[0][0].select).not.toHaveProperty('studentProfile');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid Student profile read owner', async () => {
    process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER = 'automatic';
    const prisma = { user: { findMany: jest.fn() }, $transaction: jest.fn() } as any;
    await expect(new PrismaAcademicIdentityProvider(prisma).attachAcademicProfiles([{ id: 'u1' }]))
      .rejects.toThrow('ACADEMIC_STUDENT_PROFILES_READ_OWNER must be legacy or plugin');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses the lifecycle-bound owner contract when both Academic profile domains are plugin-owned', async () => {
    process.env.ACADEMIC_DEPARTMENT_MEMBERSHIP_READ_OWNER = 'plugin';
    process.env.ACADEMIC_STUDENT_PROFILES_READ_OWNER = 'plugin';
    const prisma = { user: { findMany: jest.fn() }, $transaction: jest.fn() } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);
    await expect(provider.attachAcademicProfiles([{ id: 'u1', name: 'Student' }]))
      .rejects.toThrow('plugin profile contract is unavailable');

    const attachAcademicProfiles = jest.fn().mockResolvedValue({
      schemaVersion: 1,
      profiles: [{
        userId: 'u1', departmentId: 'd1', department: { id: 'd1', name: 'Science' },
        studentProfile: { id: 's1', studentNumber: '001' }, parentStudents: [],
      }],
    });
    provider.bindAcademicPluginCommands({
      assignUserDepartment: jest.fn(), assignStudentParent: jest.fn(), detachUserAcademicIdentity: jest.fn(), attachAcademicProfiles,
    });
    await expect(provider.attachAcademicProfiles([{ id: 'u1', name: 'Student' }])).resolves.toEqual([{
      id: 'u1', name: 'Student', departmentId: 'd1', department: { id: 'd1', name: 'Science' },
      studentProfile: { id: 's1', studentNumber: '001' }, parentStudents: [],
    }]);
    expect(attachAcademicProfiles).toHaveBeenCalledWith(['u1']);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    attachAcademicProfiles.mockResolvedValueOnce({ schemaVersion: 1, profiles: [] });
    await expect(provider.attachAcademicProfiles([{ id: 'u1' }])).rejects.toThrow('contract coverage is invalid');
  });
});

describe('PrismaAcademicIdentityProvider department assignment command', () => {
  const originalShadowSetting = process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE;
  const originalWriteOwner = process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER;
  afterEach(() => {
    if (originalShadowSetting === undefined) delete process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE;
    else process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = originalShadowSetting;
    if (originalWriteOwner === undefined) delete process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER;
    else process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER = originalWriteOwner;
  });
  it('validates the department and applies a repeat-safe assignment', async () => {
    const prisma = {
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'department-1' }) },
      user: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await provider.assignUserDepartment({
      userId: 'user-1',
      departmentId: 'department-1',
      idempotencyKey: 'assign-department:user-1:department-1',
    });

    expect(prisma.department.findUnique).toHaveBeenCalledWith({ where: { id: 'department-1' }, select: { id: true } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { departmentId: 'department-1' } });
  });

  it('clears an assignment without querying a department', async () => {
    const prisma = {
      department: { findUnique: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await provider.assignUserDepartment({
      userId: 'user-1', departmentId: null, idempotencyKey: 'assign-department:user-1:none',
    });

    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { departmentId: null } });
  });

  it('rejects missing departments and mismatched idempotency keys before assignment', async () => {
    const prisma = {
      department: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { update: jest.fn() },
    } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await expect(provider.assignUserDepartment({
      userId: 'user-1', departmentId: 'department-1', idempotencyKey: 'wrong',
    })).rejects.toThrow('invalid idempotency key');
    await expect(provider.assignUserDepartment({
      userId: 'user-1', departmentId: 'department-1', idempotencyKey: 'assign-department:user-1:department-1',
    })).rejects.toThrow('Department not found');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('atomically updates both memberships only when their prior values match', async () => {
    process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = 'true';
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ departmentId: 'old-department' }])
        .mockResolvedValueOnce([{ departmentId: 'old-department' }])
        .mockResolvedValueOnce([{ id: 'new-department' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      department: { findUnique: jest.fn().mockResolvedValue({ id: 'new-department' }) },
      user: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;
    await new PrismaAcademicIdentityProvider(prisma).assignUserDepartment({
      userId: 'user-1', departmentId: 'new-department',
      idempotencyKey: 'assign-department:user-1:new-department',
    });

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { departmentId: 'new-department' } });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), 'user-1', 'new-department');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('fails before either shadow write when memberships differ', async () => {
    process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = 'true';
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ departmentId: 'old-department' }]).mockResolvedValueOnce([{ departmentId: 'different-department' }]),
      $executeRawUnsafe: jest.fn(),
      department: { findUnique: jest.fn() },
      user: { update: jest.fn() },
    } as any;
    const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;

    await expect(new PrismaAcademicIdentityProvider(prisma).assignUserDepartment({
      userId: 'user-1', departmentId: 'new-department',
      idempotencyKey: 'assign-department:user-1:new-department',
    })).rejects.toThrow('mirror differs from legacy');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('atomically clears both stores and rejects invalid shadow configuration', async () => {
    process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = 'true';
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValueOnce([{ departmentId: 'department-1' }]).mockResolvedValueOnce([{ departmentId: 'department-1' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      department: { findUnique: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);
    await provider.assignUserDepartment({ userId: 'user-1', departmentId: null, idempotencyKey: 'assign-department:user-1:none' });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { departmentId: null } });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'), 'user-1');
    expect(tx.department.findUnique).not.toHaveBeenCalled();

    process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = 'enabled';
    await expect(provider.assignUserDepartment({ userId: 'user-1', departmentId: null, idempotencyKey: 'assign-department:user-1:none' }))
      .rejects.toThrow('must be true or false');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('dispatches plugin-owned Department commands and fails closed across lifecycle/configuration errors', async () => {
    process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER = 'plugin';
    const prisma = { department: { findUnique: jest.fn() }, user: { update: jest.fn() } } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);
    await expect(provider.assignUserDepartment({
      userId: 'user-1', departmentId: 'department-1', idempotencyKey: 'assign-department:user-1:department-1',
    })).rejects.toThrow('plugin Department command is unavailable');

    const assignUserDepartment = jest.fn().mockResolvedValue({ success: true });
    const unbind = provider.bindAcademicPluginCommands({ assignUserDepartment, assignStudentParent: jest.fn(), detachUserAcademicIdentity: jest.fn(), attachAcademicProfiles: jest.fn() });
    await provider.assignUserDepartment({
      userId: 'user-1', departmentId: 'department-1', idempotencyKey: 'assign-department:user-1:department-1',
    });
    expect(assignUserDepartment).toHaveBeenCalledWith({
      userId: 'user-1', departmentId: 'department-1', idempotencyKey: 'assign-department:user-1:department-1',
    });
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();

    unbind();
    await expect(provider.assignUserDepartment({
      userId: 'user-1', departmentId: null, idempotencyKey: 'assign-department:user-1:none',
    })).rejects.toThrow('plugin Department command is unavailable');

    process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER = 'invalid';
    await expect(provider.assignUserDepartment({
      userId: 'user-1', departmentId: null, idempotencyKey: 'assign-department:user-1:none',
    })).rejects.toThrow('ACADEMIC_DEPARTMENT_WRITE_OWNER must be legacy or plugin');
  });

  it('rejects simultaneous plugin ownership and legacy shadow writes', async () => {
    process.env.ACADEMIC_DEPARTMENT_WRITE_OWNER = 'plugin';
    process.env.ACADEMIC_DEPARTMENT_SHADOW_WRITE = 'true';
    const provider = new PrismaAcademicIdentityProvider({} as any);
    provider.bindAcademicPluginCommands({ assignUserDepartment: jest.fn(), assignStudentParent: jest.fn(), detachUserAcademicIdentity: jest.fn(), attachAcademicProfiles: jest.fn() });
    await expect(provider.assignUserDepartment({
      userId: 'user-1', departmentId: null, idempotencyKey: 'assign-department:user-1:none',
    })).rejects.toThrow('cannot be enabled when the plugin owns Department writes');
  });
});

describe('PrismaAcademicIdentityProvider parent assignment command', () => {
  const originalShadowSetting = process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE;
  const originalWriteOwner = process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER;
  afterEach(() => {
    if (originalShadowSetting === undefined) delete process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE;
    else process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE = originalShadowSetting;
    if (originalWriteOwner === undefined) delete process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER;
    else process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER = originalWriteOwner;
  });

  it('dispatches plugin-owned guardian commands and rejects unavailable or conflicting ownership', async () => {
    process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER = 'plugin';
    const prisma = { student: { findUnique: jest.fn(), update: jest.fn() }, user: { findUnique: jest.fn() } } as any;
    const provider = new PrismaAcademicIdentityProvider(prisma);
    await expect(provider.assignStudentParent({ studentUserId: 'u1', parentId: 'p1', idempotencyKey: 'assign-parent:u1:p1' }))
      .rejects.toThrow('plugin guardian command is unavailable');

    const assignStudentParent = jest.fn().mockResolvedValue({ success: true });
    const unbind = provider.bindAcademicPluginCommands({ assignUserDepartment: jest.fn(), assignStudentParent, detachUserAcademicIdentity: jest.fn(), attachAcademicProfiles: jest.fn() });
    await provider.assignStudentParent({ studentUserId: 'u1', parentId: 'p1', idempotencyKey: 'assign-parent:u1:p1' });
    expect(assignStudentParent).toHaveBeenCalledWith({ studentUserId: 'u1', parentId: 'p1', idempotencyKey: 'assign-parent:u1:p1' });
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
    expect(prisma.student.update).not.toHaveBeenCalled();
    unbind();

    process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER = 'invalid';
    await expect(provider.assignStudentParent({ studentUserId: 'u1', parentId: null, idempotencyKey: 'assign-parent:u1:none' }))
      .rejects.toThrow('ACADEMIC_STUDENT_PROFILE_WRITE_OWNER must be legacy or plugin');

    process.env.ACADEMIC_STUDENT_PROFILE_WRITE_OWNER = 'plugin';
    process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE = 'true';
    const conflict = new PrismaAcademicIdentityProvider({} as any);
    conflict.bindAcademicPluginCommands({ assignUserDepartment: jest.fn(), assignStudentParent: jest.fn(), detachUserAcademicIdentity: jest.fn(), attachAcademicProfiles: jest.fn() });
    await expect(conflict.assignStudentParent({ studentUserId: 'u1', parentId: null, idempotencyKey: 'assign-parent:u1:none' }))
      .rejects.toThrow('cannot be enabled when the plugin owns Student Profile writes');
  });
  function prismaFixture(parent: any = { id: 'parent-1', role: 'PARENT' }) {
    return {
      student: {
        findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue(parent) },
    } as any;
  }

  it('validates and assigns a parent with a deterministic command key', async () => {
    const prisma = prismaFixture();
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await provider.assignStudentParent({
      studentUserId: 'student-user-1',
      parentId: 'parent-1',
      idempotencyKey: 'assign-parent:student-user-1:parent-1',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'parent-1' }, select: { id: true, role: true } });
    expect(prisma.student.update).toHaveBeenCalledWith({ where: { id: 'student-1' }, data: { parentId: 'parent-1' } });
  });

  it('clears the parent without querying a replacement parent', async () => {
    const prisma = prismaFixture();
    const provider = new PrismaAcademicIdentityProvider(prisma);

    await provider.assignStudentParent({
      studentUserId: 'student-user-1', parentId: null,
      idempotencyKey: 'assign-parent:student-user-1:none',
    });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.student.update).toHaveBeenCalledWith({ where: { id: 'student-1' }, data: { parentId: null } });
  });

  it('rejects a bad key, a missing student, and a non-parent account before mutation', async () => {
    const badKeyPrisma = prismaFixture();
    const badKeyProvider = new PrismaAcademicIdentityProvider(badKeyPrisma);
    await expect(badKeyProvider.assignStudentParent({
      studentUserId: 'student-user-1', parentId: 'parent-1', idempotencyKey: 'wrong',
    })).rejects.toThrow('invalid idempotency key');
    expect(badKeyPrisma.student.findUnique).not.toHaveBeenCalled();

    const missingStudentPrisma = prismaFixture();
    missingStudentPrisma.student.findUnique.mockResolvedValue(null);
    await expect(new PrismaAcademicIdentityProvider(missingStudentPrisma).assignStudentParent({
      studentUserId: 'student-user-1', parentId: 'parent-1',
      idempotencyKey: 'assign-parent:student-user-1:parent-1',
    })).rejects.toThrow('Student profile not found');

    const wrongRolePrisma = prismaFixture({ id: 'teacher-1', role: 'TEACHER' });
    await expect(new PrismaAcademicIdentityProvider(wrongRolePrisma).assignStudentParent({
      studentUserId: 'student-user-1', parentId: 'teacher-1',
      idempotencyKey: 'assign-parent:student-user-1:teacher-1',
    })).rejects.toThrow('role PARENT');
    expect(wrongRolePrisma.student.update).not.toHaveBeenCalled();
  });

  it('atomically shadow-writes parent assignment only when Student profile stores agree', async () => {
    process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE = 'true';
    const tx = {
      student: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', parentId: 'p0' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', role: 'PARENT' }) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 's1', guardianUserId: 'p0' }]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    const prisma = { $transaction: jest.fn((work) => work(tx)), student: { findUnique: jest.fn(), update: jest.fn() } } as any;
    await new PrismaAcademicIdentityProvider(prisma).assignStudentParent({ studentUserId: 'u1', parentId: 'p1', idempotencyKey: 'assign-parent:u1:p1' });
    expect(tx.student.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { parentId: 'p1' } });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('guardianUserId'), 'p1', 's1');
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('rejects Student profile shadow drift before either parent write', async () => {
    process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE = 'true';
    const tx = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 's1', parentId: 'p0' }), update: jest.fn() },
      user: { findUnique: jest.fn() },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 's1', guardianUserId: 'different' }]),
      $executeRawUnsafe: jest.fn(),
    };
    const prisma = { $transaction: jest.fn((work) => work(tx)) } as any;
    await expect(new PrismaAcademicIdentityProvider(prisma).assignStudentParent({ studentUserId: 'u1', parentId: 'p1', idempotencyKey: 'assign-parent:u1:p1' }))
      .rejects.toThrow('mirror differs');
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid Student profile shadow-write setting', async () => {
    process.env.ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE = 'sometimes';
    const prisma = { student: { findUnique: jest.fn() }, $transaction: jest.fn() } as any;
    await expect(new PrismaAcademicIdentityProvider(prisma).assignStudentParent({ studentUserId: 'u1', parentId: null, idempotencyKey: 'assign-parent:u1:none' }))
      .rejects.toThrow('ACADEMIC_STUDENT_PROFILES_SHADOW_WRITE must be true or false');
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
