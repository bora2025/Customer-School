import { HealthService } from './health.service';

describe('HealthService', () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('reports process liveness without checking dependencies', () => {
    const prisma = { $queryRaw: jest.fn() } as any;
    const service = new HealthService(prisma, {} as any);

    expect(service.liveness()).toEqual(expect.objectContaining({
      status: 'ok',
      service: 'wattanam-api',
    }));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness after the database responds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as any;
    const service = new HealthService(prisma, {} as any);

    await expect(service.readiness()).resolves.toEqual(expect.objectContaining({
      status: 'ready',
      checks: { database: expect.objectContaining({ status: 'up' }) },
    }));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails readiness when the database is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('database unavailable')) } as any;
    const service = new HealthService(prisma, {} as any);

    await expect(service.readiness()).rejects.toThrow('database unavailable');
  });

  it('returns stable build metadata without hosting-provider details', () => {
    process.env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/wattanam_test',
      APP_VERSION: '1.2.3',
      GIT_COMMIT: '1234567890abcdef',
    };
    const service = new HealthService({} as any, {} as any);

    expect(service.version()).toEqual({
      service: 'wattanam-api',
      version: '1.2.3',
      commit: '1234567890ab',
      environment: 'test',
      distribution: 'legacy-full',
    });
  });

  it('reports the core distribution when an installation runs it', () => {
    process.env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/wattanam_test',
      WATTANAM_DISTRIBUTION: 'core',
    };

    expect(new HealthService({} as any, {} as any).version().distribution).toBe('core');
  });

  it('combines migration, installation, and backup state for administrators', async () => {
    process.env = {
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test', APP_VERSION: '1.0.0',
    };
    const prisma = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([
          { migration_name: 'baseline', finished_at: new Date(), rolled_back_at: null },
          { migration_name: 'pending_failure', finished_at: null, rolled_back_at: null },
        ]),
      installation: { findUnique: jest.fn().mockResolvedValue({ schoolSlug: 'test-school' }) },
    } as any;
    const backup = { status: jest.fn().mockResolvedValue({ backupCount: 1 }) } as any;
    const result = await new HealthService(prisma, backup).diagnostics();

    expect(result).toEqual(expect.objectContaining({
      installation: { schoolSlug: 'test-school' },
      migrations: { appliedCount: 1, latestApplied: 'baseline', failed: ['pending_failure'] },
      backup: { backupCount: 1 },
    }));
  });
});
