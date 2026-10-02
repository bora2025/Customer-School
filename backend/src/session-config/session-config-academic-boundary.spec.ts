import { SessionConfigService } from './session-config.service';

describe('SessionConfigService academic directory boundary', () => {
  it('resolves organization membership without reading User.departmentId directly', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as any;
    const directory = { departmentForUser: jest.fn().mockResolvedValue('department-1') } as any;
    const service = new SessionConfigService(prisma, directory);

    await expect(service.getUserOrganizationId('user-1')).resolves.toBe('department-1');
    expect(directory.departmentForUser).toHaveBeenCalledWith('user-1');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
