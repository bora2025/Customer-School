import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

const jwt = { sign: jest.fn() } as any;
const CURRENT = 'current-password-value';
const NEXT = 'a-new-password-that-is-long';

// bcrypt at the production cost of 12 is deliberately slow, and the service hashes the new password
// at that cost on every passing run. Under the full suite's parallel load that overruns the default
// timeout, so allow for it rather than weakening the cost factor the real code uses.
jest.setTimeout(30_000);

/**
 * The stored hash is generated at a low cost factor on purpose. `bcrypt.compare` reads the cost
 * from the hash itself, so this exercises the same comparison the service performs while removing
 * work the test is not there to measure.
 */
const storedHash = bcrypt.hashSync(CURRENT, 4);

async function prismaWith(overrides: Record<string, any> = {}) {
  const password = storedHash;
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', password }),
      update: jest.fn().mockResolvedValue({}),
    },
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ...overrides,
  } as any;
}

describe('AuthService.changeOwnPassword', () => {
  it('stores a bcrypt hash of the new password, never the password itself', async () => {
    const prisma = await prismaWith();
    await new AuthService(jwt, prisma).changeOwnPassword('user-1', CURRENT, NEXT);

    const stored = prisma.user.update.mock.calls[0][0].data.password;
    expect(stored).not.toBe(NEXT);
    await expect(bcrypt.compare(NEXT, stored)).resolves.toBe(true);
  });

  /**
   * The difference from `resetUserPassword`, which an administrator uses on someone else and which
   * takes no current password. Without this check a stolen session would be enough to take the
   * account permanently rather than only until it expires.
   */
  it('refuses when the current password is wrong, and changes nothing', async () => {
    const prisma = await prismaWith();
    await expect(new AuthService(jwt, prisma).changeOwnPassword('user-1', 'not-the-password', NEXT))
      .rejects.toThrow('Current password is incorrect');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a new password shorter than the emailed-reset minimum', async () => {
    const prisma = await prismaWith();
    await expect(new AuthService(jwt, prisma).changeOwnPassword('user-1', CURRENT, 'short'))
      .rejects.toThrow('at least 12 characters');
    // Rejected before the current password is even looked up, so a weak choice costs no work.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses reusing the current password', async () => {
    const prisma = await prismaWith();
    await expect(new AuthService(jwt, prisma).changeOwnPassword('user-1', CURRENT, CURRENT))
      .rejects.toThrow('must differ');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('signs out other devices and consumes unspent reset links', async () => {
    const prisma = await prismaWith();
    const result = await new AuthService(jwt, prisma).changeOwnPassword('user-1', CURRENT, NEXT);

    expect(result).toMatchObject({ ok: true, revokedSessions: 3 });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    // A link issued before this point would otherwise let its holder set a password afterwards.
    expect(prisma.passwordResetToken.updateMany.mock.calls[0][0].where).toMatchObject({ userId: 'user-1', consumedAt: null });
  });

  it('does not reveal whether the account exists', async () => {
    const prisma = await prismaWith({ user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(new AuthService(jwt, prisma).changeOwnPassword('missing', CURRENT, NEXT))
      .rejects.toThrow('Invalid credentials');
  });
});
