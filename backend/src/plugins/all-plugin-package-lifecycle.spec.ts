import { generateKeyPairSync } from 'crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import semver from 'semver';
import { PluginPackageVerifier, VerifiedPluginPackage } from './plugin-package';
import { PluginsService } from './plugins.service';

const { packPlugin } = require('../../../packages/plugin-cli/src/commands/pack');

type Packed = { artifact: Buffer; verified: VerifiedPluginPackage };

function pluginSources() {
  const root = path.resolve(__dirname, '../../../plugins');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((directory) => {
      try { return JSON.parse(readFileSync(path.join(directory, 'plugin.json'), 'utf8')).schemaVersion === 1; }
      catch { return false; }
    });
}

function dependencyOrder(packages: Packed[]) {
  const pending = new Map(packages.map((item) => [item.verified.manifest.id, item]));
  const ordered: Packed[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((item) => Object.keys(item.verified.manifest.dependencies).every((id) => !pending.has(id)));
    if (!ready.length) throw new Error(`Plugin dependency cycle or missing ordering: ${[...pending.keys()].join(', ')}`);
    ready.sort((a, b) => a.verified.manifest.id.localeCompare(b.verified.manifest.id));
    for (const item of ready) { pending.delete(item.verified.manifest.id); ordered.push(item); }
  }
  return ordered;
}

describe('official plugin catalog signed-package lifecycle', () => {
  jest.setTimeout(60_000);
  const originalEnvironment = process.env;
  let directory = '';

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'wattanam-all-plugin-lifecycle-'));
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/wattanam_all_plugin_lifecycle_test',
      APP_VERSION: '0.1.0',
      PLUGIN_DIR: path.join(directory, 'installed'),
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    rmSync(directory, { recursive: true, force: true });
  });

  it('verifies install, signed version rollback/update, remove, and reinstall for every official package', async () => {
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = path.join(directory, 'official-private.pem');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    writeFileSync(privateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const trusted = { wattanam: { 'catalog-lifecycle-test': publicKey } };
    const verifier = new PluginPackageVerifier();
    const packed: Packed[] = [];
    const previousPacked: Packed[] = [];
    const ids = new Set<string>();

    for (const source of pluginSources()) {
      const sourceManifest = JSON.parse(readFileSync(path.join(source, 'plugin.json'), 'utf8'));
      const output = path.join(directory, `${sourceManifest.id}-${sourceManifest.version}.wtp`);
      await packPlugin({ source, privateKeyFile, keyId: 'catalog-lifecycle-test', output });
      const artifact = readFileSync(output);
      const verified = await verifier.verify(artifact, trusted, '0.1.0');
      expect(verified.manifest.id).toBe(sourceManifest.id);
      expect(verified.manifest.version).toBe(sourceManifest.version);
      expect(ids.has(verified.manifest.id)).toBe(false);
      ids.add(verified.manifest.id);
      for (const [dependencyId, range] of Object.entries(verified.manifest.dependencies)) {
        const dependencySource = pluginSources().find((candidate) => JSON.parse(readFileSync(path.join(candidate, 'plugin.json'), 'utf8')).id === dependencyId);
        expect(dependencySource).toBeDefined();
        const dependencyVersion = JSON.parse(readFileSync(path.join(dependencySource!, 'plugin.json'), 'utf8')).version;
        expect(semver.satisfies(dependencyVersion, range)).toBe(true);
      }
      packed.push({ artifact, verified });

      const parsedVersion = semver.parse(sourceManifest.version);
      expect(parsedVersion).not.toBeNull();
      expect(parsedVersion!.patch).toBeGreaterThan(0);
      const previousVersion = `${parsedVersion!.major}.${parsedVersion!.minor}.${parsedVersion!.patch - 1}`;
      const previousSource = path.join(directory, 'previous-sources', sourceManifest.id);
      mkdirSync(path.dirname(previousSource), { recursive: true });
      cpSync(source, previousSource, { recursive: true });
      writeFileSync(path.join(previousSource, 'plugin.json'), JSON.stringify({ ...sourceManifest, version: previousVersion }, null, 2));
      const previousOutput = path.join(directory, `${sourceManifest.id}-${previousVersion}.wtp`);
      await packPlugin({ source: previousSource, privateKeyFile, keyId: 'catalog-lifecycle-test', output: previousOutput });
      const previousArtifact = readFileSync(previousOutput);
      const previousVerified = await verifier.verify(previousArtifact, trusted, '0.1.0');
      expect(previousVerified.manifest.version).toBe(previousVersion);
      previousPacked.push({ artifact: previousArtifact, verified: previousVerified });
    }
    expect(packed.length).toBeGreaterThanOrEqual(13);

    const registry = new Map<string, any>();
    const durablePluginData = new Map(packed.map((item) => [item.verified.manifest.id, `preserved:${item.verified.manifest.id}`]));
    const pluginInstallation = {
      findUnique: jest.fn(async ({ where }: any) => registry.get(where.id) || null),
      findMany: jest.fn(async ({ where }: any = {}) => [...registry.values()].filter((row) => !where?.status || row.status === where.status)),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...registry.get(where.id), ...data }; registry.set(where.id, row); return row; }),
      updateMany: jest.fn(async ({ where, data }: any) => { const prior = registry.get(where.id); if (prior) registry.set(where.id, { ...prior, ...data }); return { count: prior ? 1 : 0 }; }),
      upsert: jest.fn(async ({ where, create, update }: any) => { const row = registry.has(where.id) ? { ...registry.get(where.id), ...update } : { ...create, installedAt: new Date(), activatedAt: null, deactivatedAt: null, lastError: null }; registry.set(where.id, row); return row; }),
      delete: jest.fn(async ({ where }: any) => { const row = registry.get(where.id); registry.delete(where.id); return row; }),
    };
    const tx = { $executeRaw: jest.fn(async () => 0), pluginInstallation };
    const prisma = { pluginInstallation, $transaction: jest.fn(async (work: (client: any) => unknown) => work(tx)) } as any;
    const runtime = { load: jest.fn(async () => undefined), unload: jest.fn(async () => undefined), status: jest.fn(() => ({ safeMode: false, loaded: [] })) } as any;
    const migrations = { createRecoveryPoint: jest.fn(async () => undefined), apply: jest.fn(async () => undefined) } as any;
    const service = new PluginsService(prisma, verifier, runtime, migrations, undefined, undefined, undefined, { assertCanActivate: jest.fn(async () => ({ mode: 'active' })) } as any);
    const ordered = dependencyOrder(packed);

    for (const item of ordered) {
      await expect(service.install(item.artifact, undefined, trusted)).resolves.toMatchObject({ id: item.verified.manifest.id, status: 'installed' });
      await expect(service.activate(item.verified.manifest.id)).resolves.toMatchObject({ status: 'active' });
    }
    expect(registry.size).toBe(packed.length);

    const previousById = new Map(previousPacked.map((item) => [item.verified.manifest.id, item]));
    for (const item of [...ordered].reverse()) await service.deactivate(item.verified.manifest.id);
    for (const current of ordered) {
      const previous = previousById.get(current.verified.manifest.id)!;
      await expect(service.install(previous.artifact, undefined, trusted)).resolves.toMatchObject({ id: previous.verified.manifest.id, version: previous.verified.manifest.version });
      await service.activate(previous.verified.manifest.id);
      expect(durablePluginData.get(previous.verified.manifest.id)).toBe(`preserved:${previous.verified.manifest.id}`);
    }
    for (const item of [...ordered].reverse()) await service.deactivate(item.verified.manifest.id);
    for (const current of ordered) {
      await expect(service.install(current.artifact, undefined, trusted)).resolves.toMatchObject({ id: current.verified.manifest.id, version: current.verified.manifest.version });
      await service.activate(current.verified.manifest.id);
      expect(durablePluginData.get(current.verified.manifest.id)).toBe(`preserved:${current.verified.manifest.id}`);
    }

    for (const item of [...ordered].reverse()) {
      await expect(service.deactivate(item.verified.manifest.id)).resolves.toMatchObject({ status: 'inactive' });
      await expect(service.remove(item.verified.manifest.id)).resolves.toMatchObject({ status: 'removed', dataPreserved: true });
    }
    expect(registry.size).toBe(0);
    expect(durablePluginData.size).toBe(packed.length);

    for (const item of ordered) {
      await service.install(item.artifact, undefined, trusted);
      await service.activate(item.verified.manifest.id);
      expect(durablePluginData.get(item.verified.manifest.id)).toBe(`preserved:${item.verified.manifest.id}`);
    }
    expect(registry.size).toBe(packed.length);
    expect(runtime.load).toHaveBeenCalledTimes(packed.length * 4);
    expect(runtime.unload).toHaveBeenCalledTimes(packed.length * 4);
  });
});
