import { PluginJobsService } from './plugin-jobs.service';

describe('PluginJobsService', () => {
  const original = process.env;
  const open = { isSuspended: jest.fn().mockResolvedValue(false) } as any;
  beforeEach(() => { process.env = { ...original, NODE_ENV: 'test' }; });
  afterEach(() => { process.env = original; });

  it('persists definition and successful run state without overlapping', async () => {
    const tx = {
      pluginJobDefinition: { upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      pluginJobRun: { create: jest.fn().mockResolvedValue({ id: 'run-1' }), update: jest.fn() },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ acquired: true }]),
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (work) => work(tx)),
    } as any;
    const service = new PluginJobsService(prisma, open);
    const handler = jest.fn(async () => undefined);
    const dispose = await service.register('wattanam.test', { id: 'digest', intervalSeconds: 60, handler });
    await service.run('wattanam.test', 'digest', handler);
    expect(prisma.pluginJobRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pluginId: 'wattanam.test', jobId: 'digest', status: 'running' }) });
    expect(prisma.pluginJobRun.update).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: expect.objectContaining({ status: 'completed' }) });
    dispose();
    await service.clear('wattanam.test');
  });

  it('isolates and records handler failures', async () => {
    const tx = {
      pluginJobDefinition: { update: jest.fn() },
      pluginJobRun: { create: jest.fn().mockResolvedValue({ id: 'run-2' }), update: jest.fn() },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ acquired: true }]),
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (work) => work(tx)),
    } as any;
    const service = new PluginJobsService(prisma, open);
    await service.run('wattanam.test', 'broken', async () => { throw new Error('expected failure'); });
    expect(prisma.pluginJobRun.update).toHaveBeenCalledWith({ where: { id: 'run-2' }, data: expect.objectContaining({ status: 'failed', error: 'expected failure' }) });
  });

  it('uses a transaction-scoped advisory lock so another worker skips the same job', async () => {
    const handler = jest.fn();
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ acquired: false }]) };
    const prisma = { $transaction: jest.fn(async (work) => work(tx)) } as any;
    const service = new PluginJobsService(prisma, open);
    await service.run('wattanam.test', 'singleton', handler);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_xact_lock'), 'wattanam.test', 'singleton');
    expect(handler).not.toHaveBeenCalled();
  });

  it('persists plugin job definitions but starts no timer in an API-only process', async () => {
    process.env.PROCESS_ROLE = 'api';
    const interval = jest.spyOn(global, 'setInterval');
    const prisma = { pluginJobDefinition: { upsert: jest.fn(), updateMany: jest.fn() } } as any;
    const service = new PluginJobsService(prisma, open);
    const dispose = await service.register('wattanam.test', { id: 'api-disabled-job', intervalSeconds: 60, handler: jest.fn() });
    expect(prisma.pluginJobDefinition.upsert).toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    await expect(service.register('wattanam.test', { id: 'api-disabled-job', intervalSeconds: 60, handler: jest.fn() })).rejects.toThrow('already registered');
    dispose();
    interval.mockRestore();
  });

  // A plugin is part of the service a locked school has stopped paying for; its jobs resume with it.
  it('runs no plugin job while the school is locked for an unpaid platform bill', async () => {
    const handler = jest.fn();
    const prisma = { $transaction: jest.fn() } as any;
    const service = new PluginJobsService(prisma, { isSuspended: jest.fn().mockResolvedValue(true) } as any);
    await service.run('wattanam.test', 'digest', handler);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    // Nor is the job left marked as running, which would keep it from ever running again.
    const unlocked = new PluginJobsService(prisma, open);
    (unlocked as any).running = (service as any).running;
    expect((service as any).running.size).toBe(0);
  });

  it('runs no plugin job when its individual paid-plugin entitlement is read-only', async () => {
    const handler = jest.fn();
    const prisma = { $transaction: jest.fn() } as any;
    const entitlements = { jobsAllowed: jest.fn().mockResolvedValue(false) } as any;
    const service = new PluginJobsService(prisma, open, undefined, entitlements);
    await service.run('wattanam.paid', 'digest', handler);
    expect(entitlements.jobsAllowed).toHaveBeenCalledWith('wattanam.paid');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  // It is called from a timer: a database hiccup reading the lock must not become an unhandled rejection.
  it('still runs the job when the lock cannot be read', async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ acquired: false }]) };
    const prisma = { $transaction: jest.fn(async (work) => work(tx)) } as any;
    const service = new PluginJobsService(prisma, { isSuspended: jest.fn().mockRejectedValue(new Error('database unavailable')) } as any);
    await expect(service.run('wattanam.test', 'digest', jest.fn())).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects new leases while disable drains an in-flight job', async () => {
    const tx = {
      pluginJobDefinition: { update: jest.fn() },
      pluginJobRun: { create: jest.fn().mockResolvedValue({ id: 'run-drain' }), update: jest.fn() },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ acquired: true }]),
    };
    const prisma = {
      pluginJobDefinition: { updateMany: jest.fn() },
      $transaction: jest.fn(async (work) => work(tx)),
    } as any;
    const service = new PluginJobsService(prisma, open);
    let finish!: () => void;
    const first = service.run('wattanam.test', 'slow', () => new Promise<void>((resolve) => { finish = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));
    const draining = service.clear('wattanam.test');
    await service.run('wattanam.test', 'new', jest.fn());
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    finish();
    await expect(Promise.all([first, draining])).resolves.toBeDefined();
  });
});
