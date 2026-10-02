import { PrismaAcademicDepartmentsProvider } from './academic-departments.provider';

describe('PrismaAcademicDepartmentsProvider', () => {
  it('atomically unassigns users and deletes the department', async () => {
    const deleted = { id: 'department-1' };
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      department: { delete: jest.fn().mockResolvedValue(deleted) },
    } as any;
    const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;
    const provider = new PrismaAcademicDepartmentsProvider(prisma);

    await expect(provider.delete({
      id: 'department-1', idempotencyKey: 'delete-department:department-1',
    })).resolves.toBe(deleted);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { departmentId: 'department-1' }, data: { departmentId: null },
    });
    expect(tx.department.delete).toHaveBeenCalledWith({ where: { id: 'department-1' } });
  });

  it('rejects a mismatched command key before opening a transaction', async () => {
    const prisma = { $transaction: jest.fn() } as any;
    const provider = new PrismaAcademicDepartmentsProvider(prisma);

    await expect(provider.delete({ id: 'department-1', idempotencyKey: 'wrong' }))
      .rejects.toThrow('invalid idempotency key');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
