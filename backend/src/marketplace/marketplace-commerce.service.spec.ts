import { createHash } from 'crypto';
import { MarketplaceCommerceService } from './marketplace-commerce.service';
import { recordMarketplaceTrustedKey, trustedPluginKeys } from '../plugins/plugin-config';
import { pluginInstallConsentDigest } from './plugin-install-consent';

jest.mock('../plugins/plugin-config', () => ({
  trustedPluginKeys: jest.fn(),
  recordMarketplaceTrustedKey: jest.fn(),
}));

describe('MarketplaceCommerceService install', () => {
  const originalEnvironment = process.env;
  const trustedPluginKeysMock = trustedPluginKeys as jest.MockedFunction<typeof trustedPluginKeys>;
  const recordMarketplaceTrustedKeyMock = recordMarketplaceTrustedKey as jest.MockedFunction<typeof recordMarketplaceTrustedKey>;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost/wattanam_marketplace_commerce_test',
      APP_VERSION: '1.2.0',
      MARKETPLACE_URL: 'https://marketplace.example.com',
      UPDATE_REPOSITORY_KEY_ID: 'repository-test',
      UPDATE_REPOSITORY_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n-----END PUBLIC KEY-----',
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it('installs a marketplace plugin on clean core without requiring existing plugin rows', async () => {
    const artifact = Buffer.from('clean-core-marketplace-artifact');
    const sha256 = createHash('sha256').update(artifact).digest('hex');
    const prisma = { installation: { findUnique: jest.fn() }, pluginInstallation: { findUnique: jest.fn(), findMany: jest.fn() } } as any;
    const link = { getValidAccessToken: jest.fn().mockResolvedValue('token') } as any;
    const manifest = { capabilities: ['api.routes'], permissions: ['wattanam.announcements.read'], dependencies: {}, optionalDependencies: {}, migrations: [] };
    const updates = {
      index: jest.fn().mockResolvedValue({
        pluginReleases: [{
          pluginId: 'wattanam.announcements',
          version: '1.1.0',
          publisher: 'partner',
          manifest,
          sha256,
          downloadUrl: `https://marketplace.example.com/v1/artifacts/${sha256}`,
        }],
      }),
    } as any;
    const plugins = { install: jest.fn().mockResolvedValue({ id: 'wattanam.announcements', status: 'installed' }), activate: jest.fn() } as any;
    trustedPluginKeysMock.mockResolvedValue({});
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.length) } }) as any);

    const service = new MarketplaceCommerceService(prisma, link, updates, plugins, {} as any, {} as any);
    await expect(service.install('wattanam.announcements', '1.1.0', false, pluginInstallConsentDigest(manifest))).resolves.toMatchObject({ id: 'wattanam.announcements', status: 'installed' });

    expect(plugins.install).toHaveBeenCalledWith(artifact, undefined, {});
    expect(prisma.pluginInstallation.findUnique).not.toHaveBeenCalled();
    expect(prisma.pluginInstallation.findMany).not.toHaveBeenCalled();
    expect(recordMarketplaceTrustedKeyMock).not.toHaveBeenCalled();
  });

  it('merges and persists a release publisher key, then activates when requested', async () => {
    const artifact = Buffer.from('first-party-marketplace-artifact');
    const sha256 = createHash('sha256').update(artifact).digest('hex');
    const publisherKeyId = 'publisher-key-1';
    const publisherPublicKeyPem = '-----BEGIN PUBLIC KEY-----\npublisher\n-----END PUBLIC KEY-----';
    const prisma = {} as any;
    const link = { getValidAccessToken: jest.fn().mockResolvedValue('token') } as any;
    const manifest = { capabilities: ['api.routes'], permissions: ['wattanam.announcements.read'], dependencies: {}, optionalDependencies: {}, migrations: [] };
    const updates = {
      index: jest.fn().mockResolvedValue({
        pluginReleases: [{
          pluginId: 'wattanam.announcements',
          version: '1.2.0',
          publisher: 'wattanam',
          manifest,
          sha256,
          downloadUrl: `https://marketplace.example.com/v1/artifacts/${sha256}`,
          publisherKeyId,
          publisherPublicKeyPem,
        }],
      }),
    } as any;
    const plugins = {
      install: jest.fn().mockResolvedValue({ id: 'wattanam.announcements', status: 'installed' }),
      activate: jest.fn().mockResolvedValue({ id: 'wattanam.announcements', status: 'active' }),
    } as any;
    trustedPluginKeysMock.mockResolvedValue({
      wattanam: {
        existing: '-----BEGIN PUBLIC KEY-----\nexisting\n-----END PUBLIC KEY-----',
      },
    });
    recordMarketplaceTrustedKeyMock.mockResolvedValue(undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.length) } }) as any);

    const service = new MarketplaceCommerceService(prisma, link, updates, plugins, {} as any, {} as any);
    await expect(service.install('wattanam.announcements', '1.2.0', true, pluginInstallConsentDigest(manifest))).resolves.toMatchObject({ id: 'wattanam.announcements', status: 'active' });

    expect(plugins.install).toHaveBeenCalledWith(
      artifact,
      undefined,
      {
        wattanam: {
          existing: '-----BEGIN PUBLIC KEY-----\nexisting\n-----END PUBLIC KEY-----',
          [publisherKeyId]: publisherPublicKeyPem,
        },
      },
    );
    expect(recordMarketplaceTrustedKeyMock).toHaveBeenCalledWith('wattanam', publisherKeyId, publisherPublicKeyPem);
    expect(plugins.activate).toHaveBeenCalledWith('wattanam.announcements');
  });

  it('rejects a missing or stale capability consent before downloading the artifact', async () => {
    const artifact = Buffer.from('consent-bound-artifact');
    const sha256 = createHash('sha256').update(artifact).digest('hex');
    const release = {
      pluginId: 'wattanam.announcements', version: '1.3.0', publisher: 'wattanam', sha256,
      downloadUrl: `https://marketplace.example.com/v1/artifacts/${sha256}`,
      manifest: { capabilities: ['database.write'], permissions: ['wattanam.announcements.manage'], dependencies: {}, migrations: [] },
    };
    const link = { getValidAccessToken: jest.fn().mockResolvedValue('token') } as any;
    const service = new MarketplaceCommerceService({} as any, link, { index: jest.fn().mockResolvedValue({ pluginReleases: [release] }) } as any, { install: jest.fn() } as any, {} as any, {} as any);
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.install(release.pluginId, release.version, false, '')).rejects.toThrow('not approved');
    await expect(service.install(release.pluginId, release.version, false, 'a'.repeat(64))).rejects.toThrow('review');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires a freshly verified writable entitlement before downloading a paid plugin', async () => {
    const manifest = { capabilities: [], permissions: [], dependencies: {}, migrations: [] };
    const release = {
      pluginId: 'wattanam.paid', version: '1.0.0', publisher: 'wattanam', paid: true,
      manifest, sha256: 'a'.repeat(64), downloadUrl: `https://marketplace.example.com/v1/artifacts/${'a'.repeat(64)}`,
    };
    const cache = { refreshOne: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) } as any;
    const policy = { assertCanActivate: jest.fn().mockRejectedValue(new Error('read-only')) } as any;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new MarketplaceCommerceService({} as any, { getValidAccessToken: jest.fn().mockResolvedValue('token') } as any, { index: jest.fn().mockResolvedValue({ pluginReleases: [release] }) } as any, { install: jest.fn() } as any, cache, policy);

    await expect(service.install(release.pluginId, release.version, false, pluginInstallConsentDigest(manifest))).rejects.toThrow('read-only');
    expect(cache.refreshOne).toHaveBeenCalledWith(release.pluginId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('installs a published starter bundle in order and safely reuses a completed member on retry', async () => {
    const prisma = { pluginInstallation: { findUnique: jest.fn()
      .mockResolvedValueOnce({ id: 'wattanam.academic-management', version: '1.0.0', status: 'active' })
      .mockResolvedValueOnce(null) } } as any;
    const link = { getValidAccessToken: jest.fn().mockResolvedValue('token') } as any;
    const plugins = { activate: jest.fn() } as any;
    const service = new MarketplaceCommerceService(prisma, link, {} as any, plugins, {} as any, {} as any);
    jest.spyOn(service, 'starterBundles').mockResolvedValue([{
      id: 'bundle-1', plugins: [
        { pluginId: 'wattanam.academic-management', version: '1.0.0', compatible: true },
        { pluginId: 'wattanam.attendance-manager', version: '1.1.0', compatible: true },
      ],
    }] as any);
    jest.spyOn(service, 'install').mockResolvedValue({ id: 'wattanam.attendance-manager', status: 'active' } as any);

    const result = await service.installBundle('bundle-1', [
      { pluginId: 'wattanam.academic-management', version: '1.0.0', consentDigest: 'a'.repeat(64) },
      { pluginId: 'wattanam.attendance-manager', version: '1.1.0', consentDigest: 'b'.repeat(64) },
    ], true);
    expect(result.installed.map((item) => item.pluginId)).toEqual(['wattanam.academic-management', 'wattanam.attendance-manager']);
    expect(service.install).toHaveBeenCalledTimes(1);
    expect(service.install).toHaveBeenCalledWith('wattanam.attendance-manager', '1.1.0', true, 'b'.repeat(64));
  });

  it('rejects browser-supplied plugins that do not exactly match the current bundle plan', async () => {
    const service = new MarketplaceCommerceService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'starterBundles').mockResolvedValue([{
      id: 'bundle-1', plugins: [{ pluginId: 'wattanam.academic-management', version: '1.0.0', compatible: true }],
    }] as any);
    await expect(service.installBundle('bundle-1', [
      { pluginId: 'wattanam.unapproved', version: '9.9.9', consentDigest: 'a'.repeat(64) },
    ], true)).rejects.toThrow('does not match');
  });
});
