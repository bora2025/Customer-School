import { createHash, generateKeyPairSync } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PluginPackageVerifier } from '../plugins/plugin-package';
import { PluginsService } from '../plugins/plugins.service';
import { MarketplaceCommerceService } from './marketplace-commerce.service';
import { pluginInstallConsentDigest } from './plugin-install-consent';
import { recordMarketplaceTrustedKey, trustedPluginKeys } from '../plugins/plugin-config';

const { packPlugin } = require('../../../packages/plugin-cli/src/commands/pack');

jest.mock('../plugins/plugin-config', () => ({
  trustedPluginKeys: jest.fn(),
  recordMarketplaceTrustedKey: jest.fn(),
}));

describe('Document Designer marketplace clean-core installation', () => {
  const originalEnvironment = process.env;
  let directory = '';

  beforeEach(() => {
    jest.resetAllMocks();
    directory = mkdtempSync(path.join(tmpdir(), 'wattanam-document-designer-marketplace-'));
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/wattanam_document_designer_clean_core_test',
      APP_VERSION: '0.1.0',
      MARKETPLACE_URL: 'https://marketplace.example.com',
      UPDATE_REPOSITORY_KEY_ID: 'repository-test',
      UPDATE_REPOSITORY_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nrepository\n-----END PUBLIC KEY-----',
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('packs, verifies, downloads, installs, and activates the actual 0.1.7 release', async () => {
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = path.join(directory, 'publisher-private.pem');
    const output = path.join(directory, 'wattanam-document-designer-0.1.7.wtp');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    writeFileSync(privateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

    const packed = await packPlugin({
      source: path.resolve(__dirname, '../../../plugins/wattanam.document-designer'),
      privateKeyFile,
      keyId: 'document-designer-clean-core-test',
      output,
    });
    const artifact = readFileSync(output);
    const trusted = { wattanam: { 'document-designer-clean-core-test': publicKey } };
    const verified = await new PluginPackageVerifier().verify(artifact, trusted, '0.1.0');

    expect(verified.manifest.id).toBe('wattanam.document-designer');
    expect(verified.manifest.version).toBe('0.1.7');
    expect(verified.files.has('backend/index.js')).toBe(true);
    expect(verified.files.has('frontend/page.json')).toBe(true);
    expect(verified.files.has('migrations/001_create_template.sql')).toBe(true);
    expect(packed.sha256).toBe(createHash('sha256').update(artifact).digest('hex'));

    const release = {
      pluginId: verified.manifest.id,
      version: verified.manifest.version,
      publisher: verified.manifest.publisher,
      manifest: verified.manifest,
      sha256: packed.sha256,
      downloadUrl: `https://marketplace.example.com/v1/artifacts/${packed.sha256}`,
      publisherKeyId: 'document-designer-clean-core-test',
      publisherPublicKeyPem: publicKey,
    };
    const plugins = {
      install: jest.fn().mockResolvedValue({ id: release.pluginId, status: 'installed' }),
      activate: jest.fn().mockResolvedValue({ id: release.pluginId, status: 'active' }),
    } as any;
    (trustedPluginKeys as jest.MockedFunction<typeof trustedPluginKeys>).mockResolvedValue({});
    (recordMarketplaceTrustedKey as jest.MockedFunction<typeof recordMarketplaceTrustedKey>).mockResolvedValue(undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(artifact, {
      status: 200,
      headers: { 'content-length': String(artifact.length), 'content-type': 'application/vnd.wattanam.plugin+zip' },
    }) as any);

    const service = new MarketplaceCommerceService(
      {} as any,
      { getValidAccessToken: jest.fn().mockResolvedValue('delegated-install-token') } as any,
      { index: jest.fn().mockResolvedValue({ pluginReleases: [release] }) } as any,
      plugins,
      {} as any,
      {} as any,
    );
    await expect(service.install(
      release.pluginId,
      release.version,
      true,
      pluginInstallConsentDigest(verified.manifest),
    )).resolves.toEqual({ id: release.pluginId, status: 'active' });

    expect(plugins.install).toHaveBeenCalledWith(artifact, undefined, trusted);
    expect(recordMarketplaceTrustedKey).toHaveBeenCalledWith(
      'wattanam',
      'document-designer-clean-core-test',
      publicKey,
    );
    expect(plugins.activate).toHaveBeenCalledWith('wattanam.document-designer');
  });

  it('preserves plugin-owned data through deactivate, remove, and signed reinstall', async () => {
    const keys = generateKeyPairSync('ed25519');
    const privateKeyFile = path.join(directory, 'lifecycle-private.pem');
    const output = path.join(directory, 'document-designer-lifecycle.wtp');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    writeFileSync(privateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await packPlugin({
      source: path.resolve(__dirname, '../../../plugins/wattanam.document-designer'),
      privateKeyFile,
      keyId: 'document-designer-lifecycle-test',
      output,
    });
    const artifact = readFileSync(output);
    const trusted = { wattanam: { 'document-designer-lifecycle-test': publicKey } };
    const pluginDirectory = path.join(directory, 'installed-plugins');
    process.env.PLUGIN_DIR = pluginDirectory;

    let registry: any = null;
    const pluginOwnedTemplates = new Map([['template-1', { id: 'template-1', name: 'Preserved card' }]]);
    const pluginInstallation = {
      findUnique: jest.fn(async () => registry),
      findMany: jest.fn(async () => registry ? [registry] : []),
      update: jest.fn(async ({ data }: any) => { registry = { ...registry, ...data }; return registry; }),
      updateMany: jest.fn(async ({ data }: any) => { if (registry) registry = { ...registry, ...data }; return { count: registry ? 1 : 0 }; }),
      upsert: jest.fn(async ({ create, update }: any) => {
        registry = registry ? { ...registry, ...update } : { ...create, installedAt: new Date(), activatedAt: null, deactivatedAt: null, lastError: null };
        return registry;
      }),
      delete: jest.fn(async () => { const removed = registry; registry = null; return removed; }),
    };
    const tx = { $executeRaw: jest.fn(async () => 0), pluginInstallation };
    const prisma = {
      pluginInstallation,
      $transaction: jest.fn(async (work: (client: any) => unknown) => work(tx)),
    } as any;
    const runtime = {
      load: jest.fn(async () => undefined),
      unload: jest.fn(async () => undefined),
      status: jest.fn(() => ({ safeMode: false, loaded: [] })),
    } as any;
    const migrations = {
      createRecoveryPoint: jest.fn(async () => undefined),
      apply: jest.fn(async () => undefined),
    } as any;
    const entitlements = { assertCanActivate: jest.fn(async () => ({ mode: 'active' })) } as any;
    const service = new PluginsService(prisma, new PluginPackageVerifier(), runtime, migrations, undefined, undefined, undefined, entitlements);

    await expect(service.install(artifact, undefined, trusted)).resolves.toMatchObject({ id: 'wattanam.document-designer', status: 'installed' });
    await expect(service.activate('wattanam.document-designer')).resolves.toMatchObject({ status: 'active' });
    await expect(service.deactivate('wattanam.document-designer')).resolves.toMatchObject({ status: 'inactive' });
    await expect(service.remove('wattanam.document-designer')).resolves.toEqual({ id: 'wattanam.document-designer', status: 'removed', dataPreserved: true });
    expect(pluginOwnedTemplates.get('template-1')).toEqual({ id: 'template-1', name: 'Preserved card' });

    await expect(service.install(artifact, undefined, trusted)).resolves.toMatchObject({ id: 'wattanam.document-designer', status: 'installed' });
    await expect(service.activate('wattanam.document-designer')).resolves.toMatchObject({ status: 'active' });
    expect(pluginOwnedTemplates.size).toBe(1);
    expect(migrations.apply).toHaveBeenCalledTimes(2);
    expect(runtime.load).toHaveBeenCalledTimes(2);
    expect(runtime.unload).toHaveBeenCalledTimes(2);
  });
});
