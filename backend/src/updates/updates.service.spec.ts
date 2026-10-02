import { generateKeyPairSync, sign } from 'crypto';
import { createHash } from 'crypto';
import { UpdatesService } from './updates.service';
import { canonicalRepositoryJson } from './repository-signature';
import { pluginInstallConsentDigest } from '../marketplace/plugin-install-consent';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';

describe('UpdatesService', () => {
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const originalEnvironment = process.env;
  const prisma = { pluginInstallation: { findMany: jest.fn() } } as any;
  const plugins = { install: jest.fn() } as any;
  const backup = { create: jest.fn() } as any;
  const entitlements = { assertCanUpdate: jest.fn().mockResolvedValue({ mode: 'active' }) } as any;
  let service: UpdatesService;
  let stateDirectory: string;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test', DATABASE_URL: 'postgresql://test/test', APP_VERSION: '1.2.0',
      MARKETPLACE_URL: 'https://marketplace.example.com', UPDATE_CHANNEL: 'stable',
      UPDATE_REPOSITORY_KEY_ID: 'repository-test', UPDATE_REPOSITORY_PUBLIC_KEY: publicKey,
    };
    stateDirectory = mkdtempSync(path.join(os.tmpdir(), 'wattanam-update-suite-'));
    process.env.UPDATE_STATE_DIR = stateDirectory;
    service = new UpdatesService(prisma, plugins, backup, entitlements);
  });

  afterEach(() => { rmSync(stateDirectory, { recursive: true, force: true }); });
  afterAll(() => { process.env = originalEnvironment; });

  function signed(payload: any) {
    const complete = { generatedAt: '2026-08-28T00:00:00.000Z', ...payload };
    return { payload: complete, signature: { algorithm: 'ed25519', keyId: 'repository-test', value: sign(null, Buffer.from(canonicalRepositoryJson(complete)), privateKey).toString('base64') } };
  }

  it('reports compatible plugin updates, local advisories, and active core blockers', async () => {
    prisma.pluginInstallation.findMany.mockResolvedValue([{ id: 'wattanam.announcements', version: '1.0.0', status: 'active', manifestJson: JSON.stringify({ requiresCore: '<2.0.0' }) }]);
    const payload = {
      schemaVersion: 1,
      pluginReleases: [{ pluginId: 'wattanam.announcements', name: 'Announcements', version: '1.1.0', publisher: 'wattanam', requiresCore: '>=1.0.0 <2.0.0', channel: 'stable', paid: false, changelog: 'Fix', sha256: 'a'.repeat(64), sizeBytes: 100, manifest: { capabilities: ['database.write'], permissions: ['wattanam.announcements.manage'], dependencies: {}, migrations: [{ destructive: false }] } }],
      coreReleases: [{ version: '2.0.0', releaseNotes: 'Major release' }],
      advisories: [{ id: 'WAT-2026-0001', pluginId: 'wattanam.announcements', affectedVersions: '<1.1.0', severity: 'high' }],
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(signed(payload)), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result: any = await service.check();
    expect(result.pluginUpdates[0].release.version).toBe('1.1.0');
    expect(result.pluginUpdates[0].release).toMatchObject({ capabilities: ['database.write'], migrationSummary: { count: 1, destructive: false } });
    expect(result.pluginUpdates[0].release.consentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.advisories[0].id).toBe('WAT-2026-0001');
    expect(result.core.updates[0].blockedByActivePlugins).toEqual(['wattanam.announcements']);
  });

  it('checks the downloaded bytes against signed metadata before local installation', async () => {
    const artifact = Buffer.from('signed-wtp-fixture');
    const sha256 = createHash('sha256').update(artifact).digest('hex');
    const manifest = { capabilities: ['api.routes'], permissions: ['wattanam.announcements.read'], dependencies: {}, migrations: [] };
    const payload = {
      schemaVersion: 1, coreReleases: [], advisories: [],
      pluginReleases: [{ pluginId: 'wattanam.announcements', version: '1.1.0', sha256, downloadUrl: `https://marketplace.example.com/v1/artifacts/${sha256}`, manifest }],
    };
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(signed(payload)), { status: 200 }))
      .mockResolvedValueOnce(new Response(artifact, { status: 200, headers: { 'content-length': String(artifact.length) } }));
    plugins.install.mockResolvedValue({ id: 'wattanam.announcements', version: '1.1.0' });
    await expect(service.installPlugin('wattanam.announcements', '1.1.0', pluginInstallConsentDigest(manifest))).resolves.toMatchObject({ version: '1.1.0' });
    expect(entitlements.assertCanUpdate).toHaveBeenCalledWith('wattanam.announcements');
    expect(plugins.install).toHaveBeenCalledWith(artifact);
  });

  it('does not contact the repository when entitlement policy denies an update', async () => {
    entitlements.assertCanUpdate.mockRejectedValueOnce(Object.assign(new Error('updates expired'), { status: 402 }));
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service.installPlugin('wattanam.paid', '1.1.0', 'a'.repeat(64))).rejects.toMatchObject({ status: 402 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plugins.install).not.toHaveBeenCalled();
  });

  it('rejects an artifact whose bytes do not match signed metadata', async () => {
    const manifest = { capabilities: [], permissions: [], dependencies: {}, migrations: [] };
    const payload = {
      schemaVersion: 1, coreReleases: [], advisories: [],
      pluginReleases: [{ pluginId: 'wattanam.announcements', version: '1.1.0', sha256: 'a'.repeat(64), downloadUrl: `https://marketplace.example.com/v1/artifacts/${'a'.repeat(64)}`, manifest }],
    };
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(signed(payload)), { status: 200 }))
      .mockResolvedValueOnce(new Response('tampered', { status: 200 }));
    await expect(service.installPlugin('wattanam.announcements', '1.1.0', pluginInstallConsentDigest(manifest))).rejects.toThrow('checksum does not match');
    expect(plugins.install).not.toHaveBeenCalled();
  });

  it('creates a backup, persists maintenance state, and records the recovery path', async () => {
    const directory = stateDirectory;
    prisma.pluginInstallation.findMany.mockResolvedValue([{ id: 'compatible', version: '1.0.0', status: 'active', manifestJson: JSON.stringify({ requiresCore: '>=1 <2' }) }]);
    backup.create.mockResolvedValue({ file: 'wattanam-before.dump', sha256: 'b'.repeat(64), createdAt: '2026-08-28T00:00:00.000Z' });
    const release = { version: '1.3.0', apiImage: `api@sha256:${'a'.repeat(64)}`, webImage: `web@sha256:${'b'.repeat(64)}`, gatewayImage: `gateway@sha256:${'c'.repeat(64)}` };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(signed({ schemaVersion: 1, pluginReleases: [], advisories: [], coreReleases: [release] })), { status: 200 }));
    const prepared: any = await service.prepareCoreUpdate('1.3.0');
    expect(prepared).toMatchObject({ state: 'prepared', fromVersion: '1.2.0', toVersion: '1.3.0', backup: { file: 'wattanam-before.dump' } });
    expect(await service.maintenanceStatus()).toMatchObject({ active: true, operationId: prepared.id });
    const failed: any = await service.completeCoreUpdate(prepared.id, { outcome: 'failed', detail: 'health gate failed' });
    expect(failed).toMatchObject({ state: 'recovery_required', recovery: { restoreArchive: 'wattanam-before.dump' } });
    expect(await service.maintenanceStatus()).toMatchObject({ active: true });
  });

  it('blocks an incompatible active plugin before creating a backup', async () => {
    prisma.pluginInstallation.findMany.mockResolvedValue([{ id: 'legacy-plugin', status: 'active', manifestJson: JSON.stringify({ requiresCore: '<1.3.0' }) }]);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(signed({
      schemaVersion: 1, pluginReleases: [], advisories: [], coreReleases: [{ version: '1.3.0' }],
    })), { status: 200 }));
    await expect(service.prepareCoreUpdate('1.3.0')).rejects.toThrow('Active plugins block');
    expect(backup.create).not.toHaveBeenCalled();
  });

  it('rejects a signed older index after observing a newer generation', async () => {
    prisma.pluginInstallation.findMany.mockResolvedValue([]);
    const newer = signed({ schemaVersion: 1, generatedAt: '2026-08-28T02:00:00.000Z', pluginReleases: [], coreReleases: [], advisories: [] });
    const older = signed({ schemaVersion: 1, generatedAt: '2026-08-28T01:00:00.000Z', pluginReleases: [], coreReleases: [], advisories: [] });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(newer), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify(older), { status: 200 }));
    await expect(service.check()).resolves.toMatchObject({ enabled: true });
    service = new UpdatesService(prisma, plugins, backup, entitlements);
    await expect(service.check()).rejects.toThrow('replay or downgrade');
  });

  it('bounds a slow repository request while leaving plugin state untouched', async () => {
    process.env.UPDATE_INDEX_TIMEOUT_MS = '100';
    jest.spyOn(global, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await expect(service.check()).rejects.toThrow('repository is unavailable');
    expect(prisma.pluginInstallation.findMany).not.toHaveBeenCalled();
    expect(plugins.install).not.toHaveBeenCalled();
  });

  it('deactivates affected plugins for signed emergency advisories without removing data', async () => {
    prisma.pluginInstallation.findMany.mockResolvedValue([{ id: 'vulnerable.plugin', version: '1.0.0', status: 'active', manifestJson: '{}' }]);
    plugins.deactivate = jest.fn().mockResolvedValue({ status: 'inactive' });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(signed({
      schemaVersion: 1, pluginReleases: [], coreReleases: [],
      advisories: [{ id: 'WAT-2026-9999', pluginId: 'vulnerable.plugin', affectedVersions: '<2.0.0', recommendedAction: 'disable' }],
    })), { status: 200 }));
    await expect(service.applyEmergencyAdvisories()).resolves.toEqual({
      applied: [{ pluginId: 'vulnerable.plugin', advisoryId: 'WAT-2026-9999', action: 'deactivated' }], destructiveRemovalPerformed: false,
    });
    expect(plugins.deactivate).toHaveBeenCalledWith('vulnerable.plugin');
  });
});
