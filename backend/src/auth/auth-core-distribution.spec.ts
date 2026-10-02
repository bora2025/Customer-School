import { AuthService } from './auth.service';
import * as bcrypt from 'bcryptjs';

describe('AuthService core distribution', () => {
  const originalEnvironment = process.env;
  beforeEach(() => { process.env = { ...originalEnvironment, WATTANAM_DISTRIBUTION: 'core' }; });
  afterEach(() => { process.env = originalEnvironment; });

  function service(prisma: any) { return new AuthService({} as any, prisma); }

  it('reads a user without selecting removed business relations', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'owner-1' });
    await service({ user: { findUnique } }).getUserById('owner-1');
    const select = findUnique.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('department');
    expect(select).not.toHaveProperty('studentProfile');
  });

  it('lists and updates users using only core User fields', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockResolvedValue({ id: 'admin-1' });
    const auth = service({ user: { findMany, update } });
    await auth.getUsers();
    await auth.updateUser('admin-1', { name: 'Admin', departmentId: 'legacy-department' });
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('department');
    expect(update.mock.calls[0][0].data).not.toHaveProperty('departmentId');
    expect(update.mock.calls[0][0].select).not.toHaveProperty('department');
  });

  it('deletes only core-owned dependent records', async () => {
    const operation = () => Promise.resolve({});
    const prisma = {
      notification: { deleteMany: jest.fn(operation) }, notificationPreference: { deleteMany: jest.fn(operation) },
      passwordResetToken: { deleteMany: jest.fn(operation) }, refreshToken: { deleteMany: jest.fn(operation) },
      user: { delete: jest.fn(operation) }, $transaction: jest.fn().mockResolvedValue([]),
    };
    await service(prisma).deleteUser('admin-1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(Object.keys(prisma).sort()).toEqual(expect.arrayContaining(['notification', 'notificationPreference', 'passwordResetToken', 'refreshToken', 'user']));
  });

  it('fails closed before querying legacy schedules', async () => {
    await expect(service({}).getStudentSchedule('owner-1')).rejects.toThrow('requires a business plugin');
  });

  it('does not create a business-domain role before its plugin exists', async () => {
    await expect(service({}).register('teacher@example.com', 'password-1234', 'Teacher', 'TEACHER')).rejects.toThrow('install the owning business plugin');
  });

  it('runs the complete core account administration path with Academic Management absent', async () => {
    const password = 'core-owner-password';
    const passwordHash = await bcrypt.hash(password, 4);
    const owner = {
      id: 'owner-1', email: 'owner@example.test', password: passwordHash, name: 'Owner', phone: null,
      phoneNormalized: null, role: 'ADMIN', photo: null, mfaEnabled: false,
      createdAt: new Date('2026-09-25T00:00:00.000Z'), updatedAt: new Date('2026-09-25T00:00:00.000Z'),
    };
    const created = { ...owner, id: 'admin-2', email: 'admin2@example.test' };
    const operation = () => Promise.resolve({ count: 1 });
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(owner),
        findUnique: jest.fn().mockResolvedValue(owner),
        findMany: jest.fn().mockResolvedValue([owner]),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn().mockResolvedValue({ ...owner, name: 'Updated Owner' }),
        delete: jest.fn(operation),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn(operation) },
      notification: { deleteMany: jest.fn(operation) },
      notificationPreference: { deleteMany: jest.fn(operation) },
      passwordResetToken: { deleteMany: jest.fn(operation) },
      $transaction: jest.fn(async (value: any) => Array.isArray(value) ? Promise.all(value) : value(prisma)),
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed-access-token') };
    const auth = new AuthService(jwt as any, prisma as any); // no ACADEMIC_IDENTITY_PROVIDER

    await expect(auth.validateUser('owner@example.test', password)).resolves.toMatchObject({ id: 'owner-1', role: 'ADMIN' });
    await expect(auth.register('admin2@example.test', password, 'Second Admin', 'ADMIN')).resolves.toMatchObject({
      access_token: 'signed-access-token', user: { id: 'admin-2', role: 'ADMIN' },
    });
    await expect(auth.getUserById('owner-1')).resolves.toMatchObject({ id: 'owner-1' });
    await expect(auth.getUsers()).resolves.toHaveLength(1);
    await expect(auth.searchUsers('Owner')).resolves.toHaveLength(1);
    await expect(auth.updateUser('owner-1', { name: 'Updated Owner', departmentId: 'ignored-in-core' })).resolves.toMatchObject({ name: 'Updated Owner' });
    await expect(auth.deleteUser('owner-1')).resolves.toEqual({ ok: true, id: 'owner-1' });

    expect(prisma.user.create.mock.calls[0][0].data).not.toHaveProperty('departmentId');
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('departmentId');
    for (const call of [...prisma.user.findUnique.mock.calls, ...prisma.user.findMany.mock.calls]) {
      expect(call[0].select).not.toHaveProperty('studentProfile');
      expect(call[0].select).not.toHaveProperty('department');
      expect(call[0].select).not.toHaveProperty('parentStudents');
    }
    expect(prisma).not.toHaveProperty('student');
    expect(prisma).not.toHaveProperty('class');
    expect(prisma).not.toHaveProperty('department');
    expect(prisma).not.toHaveProperty('attendance');
    expect(prisma).not.toHaveProperty('feeRecord');
  });
});
