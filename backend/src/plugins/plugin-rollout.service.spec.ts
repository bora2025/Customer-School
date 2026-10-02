import { PluginRolloutService } from './plugin-rollout.service';

describe('PluginRolloutService', () => {
  const original = process.env;
  beforeEach(() => { process.env = { ...original, NODE_ENV: 'test', PROCESS_ROLE: 'api' }; });
  afterEach(() => { process.env = original; });

  it('stages split-role generations and promotes only after API and worker verify the same digest', async () => {
    const generation = { id: '00000000-0000-0000-0000-000000000001', pluginId: 'wattanam.test', generation: 2, version: '2.0.0', sha256: 'a'.repeat(64), installedPath: '/plugins/test/2', manifestJson: '{}', status: 'staging', requiredRolesJson: '["api","worker"]' };
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ generation: 2 }]).mockResolvedValueOnce([generation]),
    } as any;
    const prisma = { $executeRawUnsafe: jest.fn(), $transaction: jest.fn() } as any;
    const service = new PluginRolloutService(prisma);
    await expect(service.stage(tx, { id: generation.pluginId, version: generation.version, packageSha256: generation.sha256, installedPath: generation.installedPath, manifestJson: '{}' })).resolves.toEqual(generation);
    expect(tx.$queryRawUnsafe).toHaveBeenLastCalledWith(expect.stringContaining("'staging'"), generation.pluginId, 2, generation.version, generation.sha256, generation.installedPath, '{}', '["api","worker"]');
  });

  it('does not promote until every required role is ready with the exact digest', async () => {
    const generation = { id: '00000000-0000-0000-0000-000000000001', pluginId: 'wattanam.test', generation: 1, version: '1.0.0', sha256: 'a'.repeat(64), installedPath: '/plugins/test/1', manifestJson: '{}', status: 'staging', requiredRolesJson: '["api","worker"]' };
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValueOnce([generation]).mockResolvedValueOnce([{ role: 'api', sha256: generation.sha256, ready: true }]), $executeRawUnsafe: jest.fn(), pluginInstallation: { update: jest.fn() } };
    const prisma = { $transaction: jest.fn(async (work) => work(tx)) } as any;
    await expect(new PluginRolloutService(prisma).promoteIfReady(generation.id)).resolves.toEqual(generation);
    expect(tx.pluginInstallation.update).not.toHaveBeenCalled();
  });

  it('atomically restores the most recent previous healthy generation', async () => {
    const previous = { id: '00000000-0000-0000-0000-000000000002', pluginId: 'wattanam.test', generation: 1, version: '1.0.0', sha256: 'b'.repeat(64), installedPath: '/plugins/test/1', manifestJson: '{"version":"1.0.0"}', status: 'previous' };
    const restored = { id: previous.pluginId, version: previous.version, status: 'active' };
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([previous]), $executeRawUnsafe: jest.fn(), pluginInstallation: { update: jest.fn().mockResolvedValue(restored) } };
    const service = new PluginRolloutService({ $transaction: jest.fn(async (work) => work(tx)) } as any);
    await expect(service.reactivatePrevious(previous.pluginId)).resolves.toEqual(restored);
    expect(tx.pluginInstallation.update).toHaveBeenCalledWith({ where: { id: previous.pluginId }, data: expect.objectContaining({ version: '1.0.0', packageSha256: previous.sha256, status: 'active' }) });
  });
});
