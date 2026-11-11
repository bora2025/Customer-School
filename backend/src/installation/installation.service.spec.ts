import { BadRequestException, ConflictException } from '@nestjs/common';
import { InstallationService } from './installation.service';

describe('InstallationService', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/wattanam_test',
      APP_VERSION: '1.0.0-test',
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  describe('recording the running core version', () => {
    const prismaWith = (coreVersion: string | null) => ({
      installation: {
        findUnique: jest.fn().mockResolvedValue(coreVersion ? { coreVersion } : null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any);

    it('moves the installation record to the running release after an upgrade or rollback', async () => {
      for (const [recorded, running] of [['0.1.3', '0.1.32'], ['0.1.32', '0.1.31']]) {
        process.env.APP_VERSION = running;
        const prisma = prismaWith(recorded);
        await expect(new InstallationService(prisma).recordRunningCoreVersion()).resolves.toEqual({ from: recorded, to: running });
        expect(prisma.installation.updateMany).toHaveBeenCalledWith({ where: { id: 'singleton', coreVersion: recorded }, data: { coreVersion: running } });
      }
    });

    it('leaves the record alone when it already matches, nothing is installed, or the build has no release version', async () => {
      process.env.APP_VERSION = '0.1.32';
      for (const prisma of [prismaWith('0.1.32'), prismaWith(null)]) {
        await expect(new InstallationService(prisma).recordRunningCoreVersion()).resolves.toBeNull();
        expect(prisma.installation.updateMany).not.toHaveBeenCalled();
      }
      for (const version of ['0.1.0-dev', '1.0.0-test', 'not-a-version']) {
        process.env.APP_VERSION = version;
        const prisma = prismaWith('0.1.3');
        await expect(new InstallationService(prisma).recordRunningCoreVersion()).resolves.toBeNull();
        expect(prisma.installation.findUnique).not.toHaveBeenCalled();
      }
    });

    it('never blocks startup when the record cannot be written', async () => {
      process.env.APP_VERSION = '0.1.32';
      const prisma = prismaWith('0.1.3');
      prisma.installation.updateMany.mockRejectedValue(new Error('permission denied for table Installation'));
      await expect(new InstallationService(prisma).onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });

  it('allows setup only when no installation or user exists', async () => {
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
    } as any;

    await expect(new InstallationService(prisma).status()).resolves.toEqual({
      state: 'ready',
      installation: null,
    });
  });

  it('locks public setup for a legacy database containing users', async () => {
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(4) },
    } as any;

    await expect(new InstallationService(prisma).status()).resolves.toEqual({
      state: 'legacy_unadopted',
      installation: null,
    });
  });

  it('reports an existing installation without querying users', async () => {
    const installation = { installationId: 'installation-1', schoolName: 'Test School' };
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue(installation) },
      user: { count: jest.fn() },
    } as any;

    await expect(new InstallationService(prisma).status()).resolves.toEqual({
      state: 'installed',
      installation,
    });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('rejects an invalid IANA timezone before starting a transaction', async () => {
    const prisma = { $transaction: jest.fn() } as any;
    const service = new InstallationService(prisma);

    await expect(service.install({
      schoolName: 'Test School',
      schoolSlug: 'test-school',
      locale: 'en',
      timezone: 'Invalid/Timezone',
      currency: 'USD',
      ownerName: 'Owner',
      ownerEmail: 'owner@example.com',
      ownerPassword: 'a-secure-password',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses installation when users already exist inside the transaction', async () => {
    const tx = {
      installation: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(1) },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    } as any;
    const service = new InstallationService(prisma);

    await expect(service.install({
      schoolName: 'Test School',
      schoolSlug: 'test-school',
      locale: 'en',
      timezone: 'UTC',
      currency: 'USD',
      ownerName: 'Owner',
      ownerEmail: 'owner@example.com',
      ownerPassword: 'a-secure-password',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
