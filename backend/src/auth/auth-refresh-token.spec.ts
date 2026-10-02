import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }

describe('AuthService refresh-token custody', () => {
  const jwt = { sign: jest.fn().mockReturnValue('access-token') } as any;

  it('stores only a digest for newly issued refresh tokens', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuthService(jwt, { refreshToken: { create } } as any);
    const raw = await service.createRefreshToken('user-1');
    expect(raw).toHaveLength(80);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'user-1', tokenHash: hash(raw) }) });
    expect(create.mock.calls[0][0].data.token).toBeUndefined();
  });

  it('atomically consumes a legacy plaintext token and replaces it with a hashed token', async () => {
    const oldToken = 'legacy-raw-token';
    const tx = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'old', token: oldToken, tokenHash: null, userId: 'user-1', user: { id: 'user-1', email: 'a@b.c', role: 'SUPER_ADMIN' }, expiresAt: new Date(Date.now() + 60_000), revokedAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = { $transaction: jest.fn((work: any) => work(tx)) } as any;
    const result = await new AuthService(jwt, prisma).rotateRefreshToken(oldToken);
    expect(result.accessToken).toBe('access-token');
    const userSelect = tx.refreshToken.findFirst.mock.calls[0][0].include.user.select;
    expect(userSelect).not.toHaveProperty('department');
    expect(userSelect).not.toHaveProperty('studentProfile');
    expect(userSelect).not.toHaveProperty('parentStudents');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old', revokedAt: null }, data: expect.objectContaining({ token: null, tokenHash: hash(oldToken) }),
    }));
    expect(tx.refreshToken.create.mock.calls[0][0].data.token).toBeUndefined();
  });

  it('revokes every active session when a consumed token is reused', async () => {
    const now = new Date();
    const tx = {
      refreshToken: {
        findFirst: jest.fn().mockResolvedValue({ id: 'old', userId: 'user-1', user: { id: 'user-1' }, expiresAt: new Date(now.getTime() + 60_000), revokedAt: now }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const service = new AuthService(jwt, { $transaction: jest.fn((work: any) => work(tx)) } as any);
    await expect(service.rotateRefreshToken('reused-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });
});
