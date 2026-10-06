import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ConflictException } from '@nestjs/common';
import { PluginsService } from './plugins.service';

function manifest(overrides: Partial<{ id: string; version: string; migrations: any[]; dependencies: Record<string, string>; backendEntry: string }> = {}) {
  const base: Record<string, unknown> = {
    id: overrides.id ?? 'wattanam.test', name: 'Test', description: 'Test plugin', version: overrides.version ?? '1.0.0',
    requiresCore: '>=1.0.0', publisher: 'wattanam', license: 'MIT',
    capabilities: [], permissions: [], dependencies: overrides.dependencies ?? {}, migrations: overrides.migrations ?? [],
    navigation: [], supportedLanguages: [],
  };
  if (overrides.backendEntry) base.backendEntry = overrides.backendEntry;
  return base;
}

function verifiedPackage(overrides: Parameters<typeof manifest>[0] = {}) {
  return {
    manifest: manifest(overrides),
    packageSha256: 'a'.repeat(64),
    files: new Map<string, Buffer>([['plugin.json', Buffer.from('{}')]]),
  } as any;
}

function harness() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    pluginInstallation: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
  const prisma = {
    pluginInstallation: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn((work: (tx: any) => unknown, _options?: unknown) => work(tx)),
  } as any;
  const verifier = { verify: jest.fn() } as any;
  const runtime = { load: jest.fn().mockResolvedValue(undefined), unload: jest.fn().mockResolvedValue(undefined), status: jest.fn().mockReturnValue({ safeMode: false, loaded: [] }) } as any;
  const migrations = { apply: jest.fn().mockResolvedValue(undefined), createRecoveryPoint: jest.fn().mockResolvedValue(undefined) } as any;
  const entitlements = { assertCanActivate: jest.fn().mockResolvedValue({ mode: 'active' }) } as any;
  const service = new PluginsService(prisma, verifier, runtime, migrations, undefined, undefined, undefined, entitlements);
  return { service, prisma, tx, verifier, runtime, migrations, entitlements };
}

describe('PluginsService lifecycle locking, timeout, progress, and crash recovery', () => {
  const originalEnv = process.env;
  let pluginDir: string;

  beforeEach(async () => {
    pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-plugins-service-'));
    process.env = { ...originalEnv, NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test', APP_VERSION: '0.1.0', PLUGIN_DIR: pluginDir, PLUGIN_TRUSTED_KEYS: '{}' };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(pluginDir, { recursive: true, force: true });
  });

  describe('diagnostics', () => {
    it('reports missing artifacts, runtime drift, licence state and failed jobs in one health result', async () => {
      const { service, prisma, runtime, entitlements } = harness();
      prisma.pluginInstallation.findMany.mockResolvedValue([{
        id: 'wattanam.test', name: 'Test', version: '1.0.0', status: 'active', installedPath: path.join(pluginDir, 'missing'), lastError: null,
      }]);
      prisma.pluginJobDefinition = { findMany: jest.fn().mockResolvedValue([{ pluginId: 'wattanam.test', jobId: 'digest', enabled: true, lastStatus: 'failed', lastError: 'boom' }]) };
      runtime.status.mockReturnValue({ safeMode: false, loaded: [] });
      entitlements.decision = jest.fn().mockResolvedValue({ mode: 'read_only', reason: 'Licence expired' });
      await expect(service.diagnostics()).resolves.toMatchObject({
        status: 'failed', safeMode: false,
        plugins: [{ id: 'wattanam.test', status: 'failed', artifact: 'missing', runtimeLoaded: false, entitlement: { mode: 'read_only' }, jobs: [{ id: 'digest', lastStatus: 'failed' }] }],
      });
    });
  });

  describe('withPluginLock (used by every lifecycle mutation)', () => {
    it('takes a transaction-scoped advisory lock keyed by the plugin id before running the work, with an explicit timeout', async () => {
      const { service, prisma, tx } = harness();
      tx.pluginInstallation.update.mockResolvedValue({ id: 'wattanam.test' });
      await (service as any).withPluginLock('wattanam.test', (t: any) => t.pluginInstallation.update({ where: { id: 'wattanam.test' }, data: {} }));
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000, maxWait: 10_000 });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = tx.$executeRaw.mock.calls[0][0];
      expect(sql.strings.join('')).toContain('pg_advisory_xact_lock(hashtext(');
      expect(sql.values).toEqual(['wattanam.test']);
    });
  });

  describe('reconcileOrphanDestination (deterministic restart recovery)', () => {
    it('does nothing when no destination directory exists yet', async () => {
      const { service, prisma } = harness();
      const destination = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await expect((service as any).reconcileOrphanDestination(destination, verifiedPackage())).resolves.toBeUndefined();
      expect(prisma.pluginInstallation.findUnique).not.toHaveBeenCalled();
    });

    it('rejects as a genuine duplicate when the registry already committed this exact id/version/package', async () => {
      const { service, prisma } = harness();
      const destination = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await fs.mkdir(destination, { recursive: true });
      prisma.pluginInstallation.findUnique.mockResolvedValue({ version: '1.0.0', packageSha256: 'a'.repeat(64) });
      await expect((service as any).reconcileOrphanDestination(destination, verifiedPackage())).rejects.toThrow(ConflictException);
      await expect(fs.access(destination)).resolves.toBeUndefined();
    });

    it('silently removes an orphaned destination left by a crash between the file move and the DB commit', async () => {
      const { service, prisma } = harness();
      const destination = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'leftover.txt'), 'orphan');
      prisma.pluginInstallation.findUnique.mockResolvedValue(null); // no committed row at all — this is the crash case
      await expect((service as any).reconcileOrphanDestination(destination, verifiedPackage())).resolves.toBeUndefined();
      await expect(fs.access(destination)).rejects.toThrow();
    });

    it('removes an orphan even when a registry row exists for a different version (e.g. a crashed upgrade attempt)', async () => {
      const { service, prisma } = harness();
      const destination = path.join(pluginDir, 'wattanam.test', '2.0.0');
      await fs.mkdir(destination, { recursive: true });
      prisma.pluginInstallation.findUnique.mockResolvedValue({ version: '1.0.0', packageSha256: 'b'.repeat(64) });
      await expect((service as any).reconcileOrphanDestination(destination, verifiedPackage({ version: '2.0.0' }))).resolves.toBeUndefined();
      await expect(fs.access(destination)).rejects.toThrow();
    });
  });

  describe('install', () => {
    it('stages, locks, migrates, and registers a new plugin', async () => {
      const { service, verifier, tx, prisma } = harness();
      const verified = verifiedPackage();
      verifier.verify.mockResolvedValue(verified);
      prisma.pluginInstallation.findUnique.mockResolvedValue(null);
      tx.pluginInstallation.upsert.mockResolvedValue({ id: 'wattanam.test', name: 'Test', manifestJson: JSON.stringify(verified.manifest), version: '1.0.0', publisher: 'wattanam', status: 'installed', packageSha256: verified.packageSha256, installedAt: new Date(), activatedAt: null, deactivatedAt: null, lastError: null });

      const result = await service.install(Buffer.from('package'));
      expect(result).toMatchObject({ id: 'wattanam.test', status: 'installed' });
      const destination = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await expect(fs.access(path.join(destination, 'plugin.json'))).resolves.toBeUndefined();
      expect(tx.pluginInstallation.upsert).toHaveBeenCalled();
    });

    it('upgrades an active plugin and restores its active state without deactivating dependents', async () => {
      const { service, verifier, prisma, tx, runtime } = harness();
      const verified = verifiedPackage({ version: '1.1.0' });
      verifier.verify.mockResolvedValue(verified);
      prisma.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.test', status: 'active', version: '1.0.0' });
      tx.pluginInstallation.upsert.mockResolvedValue({ id: 'wattanam.test', status: 'installed' });
      const activate = jest.spyOn(service, 'activate').mockResolvedValue({ id: 'wattanam.test', version: '1.1.0', status: 'active' } as any);

      await expect(service.install(Buffer.from('package'))).resolves.toMatchObject({ version: '1.1.0', status: 'active' });
      expect(runtime.unload).toHaveBeenCalledWith('wattanam.test');
      expect(activate).toHaveBeenCalledWith('wattanam.test');
    });

    it('rejects replacing an active plugin with the same or an older version', async () => {
      const { service, verifier, prisma, runtime } = harness();
      verifier.verify.mockResolvedValue(verifiedPackage({ version: '1.0.0' }));
      prisma.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.test', status: 'active', version: '1.0.0' });
      await expect(service.install(Buffer.from('package'))).rejects.toThrow('must increase the version');
      expect(runtime.unload).not.toHaveBeenCalled();
    });

    it('marks the registry failed and removes both staged and destination directories when migration application fails', async () => {
      const { service, verifier, prisma, migrations } = harness();
      const verified = verifiedPackage({ migrations: [{ id: '001', path: 'migrations/001.sql', checksum: 'x', destructive: false }] });
      verifier.verify.mockResolvedValue(verified);
      prisma.pluginInstallation.findUnique.mockResolvedValue(null);
      migrations.apply.mockRejectedValue(new Error('migration exploded'));

      await expect(service.install(Buffer.from('package'))).rejects.toThrow('migration exploded');
      const destination = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await expect(fs.access(destination)).rejects.toThrow();
      await expect(fs.readdir(path.join(pluginDir, '.staging')).catch(() => [])).resolves.toEqual([]);
      expect(prisma.pluginInstallation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wattanam.test' }, data: expect.objectContaining({ status: 'failed', lastError: 'migration exploded' }) }));
    });

    it('self-heals a crash orphan left at the destination from a previous failed attempt, then installs cleanly', async () => {
      const { service, verifier, prisma, tx } = harness();
      const verified = verifiedPackage();
      verifier.verify.mockResolvedValue(verified);
      prisma.pluginInstallation.findUnique.mockResolvedValue(null); // no committed row — the destination below is a pure orphan
      const destination = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'stale.txt'), 'from a crashed attempt');
      tx.pluginInstallation.upsert.mockResolvedValue({ id: 'wattanam.test', status: 'installed' });

      const result = await service.install(Buffer.from('package'));
      expect(result).toMatchObject({ status: 'installed' });
      await expect(fs.access(path.join(destination, 'stale.txt'))).rejects.toThrow();
      await expect(fs.access(path.join(destination, 'plugin.json'))).resolves.toBeUndefined();
    });

    it('sets a visible "migrating" progress status before running an update with migrations', async () => {
      const { service, verifier, prisma, tx } = harness();
      const verified = verifiedPackage({ migrations: [{ id: '001', path: 'migrations/001.sql', checksum: 'x', destructive: false }] });
      verifier.verify.mockResolvedValue(verified);
      prisma.pluginInstallation.findUnique.mockResolvedValue({ status: 'installed', version: '0.9.0' });
      tx.pluginInstallation.upsert.mockResolvedValue({ id: 'wattanam.test', status: 'installed' });

      await service.install(Buffer.from('package'));
      expect(prisma.pluginInstallation.update).toHaveBeenCalledWith({ where: { id: 'wattanam.test' }, data: { status: 'migrating' } });
    });
  });

  describe('activate', () => {
    it('locks, verifies entry files exist, activates, then loads the runtime', async () => {
      const { service, tx, runtime, entitlements } = harness();
      const installedPath = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await fs.mkdir(installedPath, { recursive: true });
      await fs.writeFile(path.join(installedPath, 'index.js'), 'module.exports = {};');
      tx.pluginInstallation.findUnique
        .mockResolvedValueOnce({ id: 'wattanam.test', status: 'inactive', installedPath, manifestJson: JSON.stringify(manifest({ backendEntry: 'index.js' })) })
        .mockResolvedValueOnce({ id: 'wattanam.test', status: 'activating' });
      tx.pluginInstallation.update
        .mockResolvedValueOnce({ id: 'wattanam.test', status: 'activating' })
        .mockResolvedValueOnce({ id: 'wattanam.test', status: 'active' });
      (service as any).get = jest.fn().mockResolvedValue({ id: 'wattanam.test', status: 'active' });

      const result = await service.activate('wattanam.test');
      expect(result).toMatchObject({ status: 'active' });
      expect(runtime.load).toHaveBeenCalledWith('wattanam.test');
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(entitlements.assertCanActivate).toHaveBeenCalledWith('wattanam.test');
    });

    it('does not touch the registry or runtime when entitlement policy denies activation', async () => {
      const { service, tx, runtime, entitlements } = harness();
      entitlements.assertCanActivate.mockRejectedValue(Object.assign(new Error('licence read-only'), { status: 402 }));
      await expect(service.activate('wattanam.test')).rejects.toMatchObject({ status: 402 });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(runtime.load).not.toHaveBeenCalled();
    });

    it('marks the plugin failed without ever committing an active status when its entry file is missing', async () => {
      const { service, tx, prisma, runtime } = harness();
      const installedPath = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await fs.mkdir(installedPath, { recursive: true });
      tx.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.test', installedPath, manifestJson: JSON.stringify(manifest({ backendEntry: 'missing.js' })) });

      await expect(service.activate('wattanam.test')).rejects.toThrow();
      expect(tx.pluginInstallation.update).not.toHaveBeenCalled();
      expect(runtime.load).not.toHaveBeenCalled();
      expect(prisma.pluginInstallation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wattanam.test', status: { in: ['installed', 'inactive', 'failed'] } }, data: expect.objectContaining({ status: 'failed' }) }));
    });

    it('marks the plugin failed when the runtime fails to load after activation commits', async () => {
      const { service, tx, prisma, runtime } = harness();
      const installedPath = path.join(pluginDir, 'wattanam.test', '1.0.0');
      await fs.mkdir(installedPath, { recursive: true });
      tx.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.test', status: 'inactive', installedPath, manifestJson: JSON.stringify(manifest()) });
      tx.pluginInstallation.update.mockResolvedValue({ id: 'wattanam.test', status: 'activating' });
      runtime.load.mockRejectedValue(new Error('runtime exploded'));

      await expect(service.activate('wattanam.test')).rejects.toThrow('runtime exploded');
      expect(prisma.pluginInstallation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wattanam.test', status: 'activating' }, data: expect.objectContaining({ status: 'failed', lastError: 'runtime exploded' }) }));
    });
  });

  describe('deactivate and remove', () => {
    it('publishes deactivating, unloads the runtime, then publishes inactive', async () => {
      const { service, prisma, tx, runtime } = harness();
      tx.pluginInstallation.findUnique
        .mockResolvedValueOnce({ id: 'wattanam.test', status: 'active' })
        .mockResolvedValueOnce({ id: 'wattanam.test', status: 'deactivating' });
      const order: string[] = [];
      runtime.unload.mockImplementation(async () => { order.push('unload'); });
      tx.pluginInstallation.update.mockImplementation(async ({ data }: any) => { order.push(data.status); return { id: 'wattanam.test', status: data.status }; });

      await service.deactivate('wattanam.test');
      expect(order).toEqual(['deactivating', 'unload', 'inactive']);
    });

    it('refuses to deactivate a dependency required by an active plugin', async () => {
      const { service, prisma, runtime } = harness();
      prisma.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.base' });
      prisma.pluginInstallation.findMany.mockResolvedValue([{ id: 'wattanam.feature', manifestJson: JSON.stringify({ dependencies: { 'wattanam.base': '^1.0.0' } }) }]);
      await expect(service.deactivate('wattanam.base')).rejects.toThrow('wattanam.feature requires it');
      expect(runtime.unload).not.toHaveBeenCalled();
    });

    it('refuses to remove an active plugin', async () => {
      const { service, tx } = harness();
      tx.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.test', status: 'active' });
      await expect(service.remove('wattanam.test')).rejects.toThrow('Deactivate');
      expect(tx.pluginInstallation.delete).not.toHaveBeenCalled();
    });

    it('deletes the registry row inside the lock, then unloads and clears the plugin directory', async () => {
      const { service, tx, runtime } = harness();
      const pluginRoot = path.join(pluginDir, 'wattanam.test');
      await fs.mkdir(pluginRoot, { recursive: true });
      tx.pluginInstallation.findUnique.mockResolvedValue({ id: 'wattanam.test', status: 'inactive' });

      const result = await service.remove('wattanam.test');
      expect(result).toEqual({ id: 'wattanam.test', status: 'removed', dataPreserved: true });
      expect(tx.pluginInstallation.delete).toHaveBeenCalledWith({ where: { id: 'wattanam.test' } });
      expect(runtime.unload).toHaveBeenCalledWith('wattanam.test');
      await expect(fs.access(pluginRoot)).rejects.toThrow();
    });
  });
});
