import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PasswordResetService } from './password-reset.service';

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

describe('PasswordResetService', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv, PUBLIC_APP_URL: 'https://school.example' }; });
  afterAll(() => { process.env = originalEnv; });

  it('returns the same response for an unknown email without creating a token', async () => {
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const service = new PasswordResetService(prisma, { sendEmail: jest.fn() } as any);
    await expect(service.request('unknown@example.com')).resolves.toEqual({ requested: true });
  });

  it('stores only a token digest, invalidates prior tokens and emails the public reset URL', async () => {
    const tx = { passwordResetToken: { updateMany: jest.fn(), create: jest.fn() } };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', email: 'owner@example.com', name: 'Owner' }) },
      $transaction: jest.fn((work: any) => work(tx)),
    } as any;
    const notifications = { sendEmail: jest.fn().mockResolvedValue({ sent: true }) } as any;
    await new PasswordResetService(prisma, notifications).request('OWNER@example.com');
    const stored = tx.passwordResetToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('reset-password?token');
    expect(notifications.sendEmail).toHaveBeenCalledWith('owner@example.com', expect.any(String), expect.stringContaining('https://school.example/reset-password?token='));
  });

  it('atomically consumes a valid token, changes the password and revokes sessions', async () => {
    const raw = 'a'.repeat(64);
    const tx = {
      passwordResetToken: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000) }),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      },
      user: { update: jest.fn() }, refreshToken: { deleteMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((work: any) => work(tx)) } as any;
    await expect(new PasswordResetService(prisma, {} as any).confirm(raw, 'a-secure-new-password')).resolves.toEqual({ reset: true });
    expect(tx.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: digest(raw) } });
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('rejects an expired, consumed or unknown token', async () => {
    const tx = { passwordResetToken: { findUnique: jest.fn().mockResolvedValue(null) } };
    const prisma = { $transaction: jest.fn((work: any) => work(tx)) } as any;
    await expect(new PasswordResetService(prisma, {} as any).confirm('b'.repeat(64), 'a-secure-new-password')).rejects.toBeInstanceOf(BadRequestException);
  });
});
