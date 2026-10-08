import bcrypt from 'bcryptjs';
import { PluginAccountService } from './plugin-account.service';

describe('PluginAccountService', () => {
  const passwordHash = bcrypt.hashSync('temporary-password', 10);

  function setup(command: any = null, user: any = null) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      pluginAccountCommand: {
        findUnique: jest.fn().mockResolvedValue(command),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => where.id ? Promise.resolve(user) : Promise.resolve(null)),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: data.id, name: data.name, role: data.role, email: data.email ?? null, phone: data.phone ?? null })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: user?.id, name: data.name, role: 'STUDENT', email: data.email ?? user?.email ?? null, phone: data.phone ?? user?.phone ?? null })),
      },
    };
    const prisma = { $transaction: jest.fn((work: any) => work(tx)) } as any;
    return { service: new PluginAccountService(prisma), tx };
  }

  it('creates only a STUDENT account and journals the command atomically', async () => {
    const { service, tx } = setup();
    const result = await service.createStudent('wattanam.academic-management', {
      commandKey: 'registration:registration-1', name: 'Student One', email: 'STUDENT@EXAMPLE.TEST', passwordHash,
    });
    expect(result).toMatchObject({ name: 'Student One', role: 'STUDENT', email: 'student@example.test' });
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'STUDENT', email: 'student@example.test', password: passwordHash }),
      select: expect.not.objectContaining({ password: true }),
    }));
    expect(tx.pluginAccountCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      pluginId: 'wattanam.academic-management', commandKey: 'registration:registration-1', userId: expect.any(String), requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) });
  });

  it('creates a restricted staff login with an optional photo and journals it', async () => {
    const { service, tx } = setup();
    const result = await service.createStaff('wattanam.academic-management', {
      commandKey: 'officer:request-1', name: 'Teacher One', email: 'TEACHER@EXAMPLE.TEST', phone: '+855 12 345 678',
      photo: 'https://example.test/teacher.jpg', passwordHash, role: 'TEACHER',
    });
    expect(result).toMatchObject({ name: 'Teacher One', role: 'TEACHER', email: 'teacher@example.test' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'TEACHER', photo: 'https://example.test/teacher.jpg', password: passwordHash }) }));
    expect(tx.pluginAccountCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ commandKey: 'officer:request-1' }) });
  });

  it('rejects privileged staff roles and non-HTTPS staff photos', async () => {
    const { service } = setup();
    await expect(service.createStaff('wattanam.academic-management', { commandKey: 'officer:request-2', name: 'Admin', email: 'admin@example.test', passwordHash, role: 'ADMIN' as any })).rejects.toThrow('STAFF or TEACHER');
    await expect(service.createStaff('wattanam.academic-management', { commandKey: 'officer:request-3', name: 'Staff', email: 'staff@example.test', photo: 'javascript:alert(1)', passwordHash, role: 'STAFF' })).rejects.toThrow('HTTPS URL');
  });

  it('returns the original account for an exact retry and does not create another user', async () => {
    const input = { commandKey: 'registration:registration-1', name: 'Student One', email: 'student@example.test', phone: null, passwordHash };
    const first = setup();
    await first.service.createStudent('wattanam.academic-management', input);
    const journal = first.tx.pluginAccountCommand.create.mock.calls[0][0].data;
    const existing = { id: journal.userId, name: input.name, role: 'STUDENT', email: input.email, phone: null };
    const retry = setup(journal, existing);
    await expect(retry.service.createStudent('wattanam.academic-management', input)).resolves.toEqual(existing);
    expect(retry.tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects changed retry payloads, duplicate identities, and plaintext passwords', async () => {
    const existingCommand = { requestHash: '0'.repeat(64), userId: 'user-1' };
    const changed = setup(existingCommand, { id: 'user-1', role: 'STUDENT' });
    await expect(changed.service.createStudent('wattanam.academic-management', {
      commandKey: 'registration:registration-1', name: 'Changed', email: 'student@example.test', passwordHash,
    })).rejects.toThrow('does not match');

    const duplicate = setup();
    duplicate.tx.user.findUnique.mockResolvedValueOnce({ id: 'other-user' });
    await expect(duplicate.service.createStudent('wattanam.academic-management', {
      commandKey: 'registration:registration-2', name: 'Student', email: 'used@example.test', passwordHash,
    })).rejects.toThrow('Email is already used');

    await expect(duplicate.service.createStudent('wattanam.academic-management', {
      commandKey: 'registration:registration-3', name: 'Student', passwordHash: 'plaintext',
    })).rejects.toThrow('bcrypt hash');
  });

  it('updates only an existing STUDENT account and journals each immutable update command', async () => {
    const existing = { id: 'student-1', name: 'Old', role: 'STUDENT', email: 'old@example.test', phone: null };
    const { service, tx } = setup(null, existing);
    const updated = await service.updateStudent('wattanam.academic-management', {
      commandKey: 'csv-update:class-1:0001:abc', userId: 'student-1', name: 'New', email: 'new@example.test', phone: null,
    });
    expect(updated).toMatchObject({ id: 'student-1', name: 'New', email: 'new@example.test', role: 'STUDENT' });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'student-1' }, data: expect.objectContaining({ name: 'New', email: 'new@example.test' }) }));
    expect(tx.pluginAccountCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'student-1', commandKey: 'csv-update:class-1:0001:abc' }) });
  });

  it('rejects update commands targeting a non-student account', async () => {
    const { service, tx } = setup(null, { id: 'admin-1', name: 'Admin', role: 'ADMIN', email: 'admin@example.test', phone: null });
    await expect(service.updateStudent('wattanam.academic-management', {
      commandKey: 'csv-update:class-1:0001:abc', userId: 'admin-1', name: 'Changed', email: null, phone: null,
    })).rejects.toThrow('not a STUDENT');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('resolves an existing PARENT idempotently without changing credentials', async () => {
    const parent = { id: 'parent-1', name: 'Parent', role: 'PARENT', email: 'parent@example.test', phone: null };
    const { service, tx } = setup(null, parent);
    tx.user.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.email ? parent : null));
    const result = await service.resolveParent('wattanam.parent-portal', {
      commandKey: 'request:req-1', name: 'Ignored', email: 'PARENT@EXAMPLE.TEST', passwordHash,
    });
    expect(result).toEqual({ ...parent, created: false });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.pluginAccountCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'parent-1' }) });
  });

  it('creates only a PARENT with an opaque bcrypt password and journals it', async () => {
    const { service, tx } = setup();
    const result = await service.resolveParent('wattanam.parent-portal', {
      commandKey: 'request:req-2', name: 'New Parent', email: 'new-parent@example.test', phone: '+855 12 345 678', passwordHash,
    });
    expect(result).toMatchObject({ role: 'PARENT', email: 'new-parent@example.test', created: true });
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'PARENT', password: passwordHash }) }));
    expect(tx.pluginAccountCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pluginId: 'wattanam.parent-portal', commandKey: 'request:req-2' }) });
  });

  it('refuses to repurpose a non-parent account or reuse another account phone', async () => {
    const nonParent = setup();
    nonParent.tx.user.findUnique.mockResolvedValueOnce({ id: 'teacher-1', role: 'TEACHER' });
    await expect(nonParent.service.resolveParent('wattanam.parent-portal', {
      commandKey: 'request:req-3', name: 'Teacher', email: 'teacher@example.test', passwordHash,
    })).rejects.toThrow('not a PARENT');

    const duplicatePhone = setup();
    duplicatePhone.tx.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'other-1' });
    await expect(duplicatePhone.service.resolveParent('wattanam.parent-portal', {
      commandKey: 'request:req-4', name: 'Parent', email: 'parent@example.test', phone: '+85512345678', passwordHash,
    })).rejects.toThrow('Phone number is already used');
  });
});
