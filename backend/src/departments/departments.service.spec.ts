import { DepartmentsService } from './departments.service';

describe('DepartmentsService academic boundary', () => {
  it('delegates CRUD and supplies a deterministic delete command key', async () => {
    const provider = {
      findAll: jest.fn().mockResolvedValue([{ id: 'department-1' }]),
      create: jest.fn().mockResolvedValue({ id: 'department-2' }),
      update: jest.fn().mockResolvedValue({ id: 'department-1', name: 'Updated' }),
      delete: jest.fn().mockResolvedValue({ id: 'department-1' }),
    } as any;
    const service = new DepartmentsService(provider);

    await service.findAll();
    await service.create({ name: 'Science' });
    await service.update('department-1', { name: 'Updated' });
    await service.delete('department-1');

    expect(provider.findAll).toHaveBeenCalled();
    expect(provider.create).toHaveBeenCalledWith({ name: 'Science' });
    expect(provider.update).toHaveBeenCalledWith('department-1', { name: 'Updated' });
    expect(provider.delete).toHaveBeenCalledWith({
      id: 'department-1', idempotencyKey: 'delete-department:department-1',
    });
  });
});
