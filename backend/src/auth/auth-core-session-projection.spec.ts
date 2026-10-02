import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

function expectCoreOnly(select: Record<string, unknown>) {
  expect(select).toMatchObject({ id: true, email: true, password: true, role: true, mfaEnabled: true });
  expect(select).not.toHaveProperty('departmentId');
  expect(select).not.toHaveProperty('department');
  expect(select).not.toHaveProperty('studentProfile');
  expect(select).not.toHaveProperty('parentStudents');
}

describe('AuthService core-only session projections', () => {
  it('uses the core authentication projection for legacy-distribution password login', async () => {
    const password = 'correct horse battery staple';
    const findFirst = jest.fn().mockResolvedValue({
      id: 'user-1', email: 'owner@example.test', password: await bcrypt.hash(password, 4),
      name: 'Owner', role: 'SUPER_ADMIN', mfaEnabled: false,
    });
    const service = new AuthService({} as any, { user: { findFirst } } as any);

    await expect(service.validateUser('owner@example.test', password)).resolves.toMatchObject({ id: 'user-1' });

    expectCoreOnly(findFirst.mock.calls[0][0].select);
  });

  it('uses the core authentication projection when validating a refresh token', async () => {
    const user = { id: 'user-1', email: 'owner@example.test', role: 'SUPER_ADMIN' };
    const findFirst = jest.fn().mockResolvedValue({
      user, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new AuthService({} as any, { refreshToken: { findFirst } } as any);

    await expect(service.validateRefreshToken('refresh-token')).resolves.toBe(user);

    expectCoreOnly(findFirst.mock.calls[0][0].include.user.select);
  });
});
