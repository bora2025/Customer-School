import { AuthService } from './auth.service';

describe('AuthService academic read-model provider boundary', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...originalEnvironment, WATTANAM_DISTRIBUTION: 'legacy-full' };
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('delegates getUsers enrichment to academic provider with base user select', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ada' }]);
    const prisma = { user: { findMany } } as any;
    const provider = {
      attachAcademicProfiles: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ada', studentProfile: { id: 's1' } }]),
      assignStudentParent: jest.fn(),
      detachUserAcademicIdentity: jest.fn(),
    } as any;
    const auth = new AuthService({} as any, prisma, provider);

    const users = await auth.getUsers();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        photo: true,
      }),
    }));
    expect(provider.attachAcademicProfiles).toHaveBeenCalledWith([{ id: 'u1', name: 'Ada' }]);
    expect((users[0] as any).studentProfile).toEqual({ id: 's1' });
  });

  it('delegates getUserById enrichment to academic provider when configured', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'u1', name: 'Ada', role: 'STUDENT' });
    const prisma = { user: { findUnique } } as any;
    const provider = {
      attachAcademicProfiles: jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ada', role: 'STUDENT', departmentId: 'd1' }]),
      assignStudentParent: jest.fn(),
      detachUserAcademicIdentity: jest.fn(),
    } as any;
    const auth = new AuthService({} as any, prisma, provider);

    const user = await auth.getUserById('u1');

    expect(provider.attachAcademicProfiles).toHaveBeenCalledWith([{ id: 'u1', name: 'Ada', role: 'STUDENT' }]);
    expect(user).toEqual({ id: 'u1', name: 'Ada', role: 'STUDENT', departmentId: 'd1' });
  });

  it('delegates searchUsers enrichment to academic provider', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'u2', name: 'Bea', role: 'PARENT' }]);
    const prisma = { user: { findMany } } as any;
    const provider = {
      attachAcademicProfiles: jest.fn().mockResolvedValue([{ id: 'u2', name: 'Bea', role: 'PARENT', parentStudents: [{ id: 's2' }] }]),
      assignStudentParent: jest.fn(),
      detachUserAcademicIdentity: jest.fn(),
    } as any;
    const auth = new AuthService({} as any, prisma, provider);

    const users = await auth.searchUsers('bea');

    expect(provider.attachAcademicProfiles).toHaveBeenCalledWith([{ id: 'u2', name: 'Bea', role: 'PARENT' }]);
    expect((users[0] as any).parentStudents).toEqual([{ id: 's2' }]);
  });

  it('fails closed without a provider and never selects academic relations', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'u1', name: 'Ada' }]);
    const prisma = { user: { findMany } } as any;
    const auth = new AuthService({} as any, prisma);

    await expect(auth.getUsers()).rejects.toThrow('Academic identity provider is required');

    const select = findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('department');
    expect(select).not.toHaveProperty('studentProfile');
    expect(select).not.toHaveProperty('parentStudents');
  });
});
