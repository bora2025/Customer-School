import { generateKeyPairSync, sign } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { canonicalJson } from './canonical-json';
import { EntitlementCacheService } from './entitlement-cache.service';
import { InstallationKeyService } from './installation-key.service';

const pluginId = 'official.attendance';

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function signedEntitlement(privateKeyPem: string, keyId: string, now: Date, overrides: Record<string, unknown> = {}) {
  const payload = {
    schemaVersion: 1, generation: 1, status: 'ACTIVE', tokenId: 'token-1', installationId: 'school-public-id', customerId: 'customer-1', productId: pluginId,
    licensedMajorRange: '^1.0.0', issuedAt: now.toISOString(), notBefore: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), updatesThrough: new Date(now.getTime() + 43_200_000).toISOString(),
    offlineRecheckAfter: new Date(now.getTime() + 3_600_000).toISOString(), features: [], issuer: 'https://marketplace.example',
    audience: 'wattanam-school', keyId, nonce: 'a'.repeat(32), ...overrides,
  };
  return { payload, signature: { algorithm: 'ed25519', keyId, value: sign(null, Buffer.from(canonicalJson(payload)), privateKeyPem).toString('base64') } };
}

describe('EntitlementCacheService', () => {
  const originalEnvironment = process.env;
  const now = new Date('2026-08-28T00:00:00.000Z');
  const entitlement = keyPair();
  let keyDir: string;
  let prisma: any;
  let audit: any;
  let service: EntitlementCacheService;

  beforeEach(() => {
    keyDir = mkdtempSync(path.join(os.tmpdir(), 'wattanam-entitlement-cache-'));
    process.env = {
      ...originalEnvironment, MARKETPLACE_URL: 'https://marketplace.example.com', INSTALLATION_KEY_DIR: keyDir,
      ENTITLEMENT_PUBLIC_KEY: entitlement.publicKey, ENTITLEMENT_KEY_ID: 'entitlement-2026',
    };
    prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'school-public-id' }) },
      pluginEntitlementCache: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn((args: any) => Promise.resolve({ pluginId, ...args.create })), findMany: jest.fn() },
      pluginInstallation: { findMany: jest.fn() },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new EntitlementCacheService(prisma, new InstallationKeyService(), audit);
  });

  afterEach(() => { rmSync(keyDir, { recursive: true, force: true }); jest.restoreAllMocks(); });
  afterAll(() => { process.env = originalEnvironment; });

  it('is disabled entirely when marketplace or entitlement keys are not configured', async () => {
    process.env.MARKETPLACE_URL = '';
    await expect(service.refreshOne(pluginId, now)).rejects.toThrow('not configured');
  });

  it('caches a freshly verified entitlement', async () => {
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ACTIVE', signedToken: token }), { status: 200 }));
    const result = await service.refreshOne(pluginId, now);
    expect(result).toMatchObject({ pluginId, status: 'ACTIVE', consecutiveFailures: 0 });
    expect(prisma.pluginEntitlementCache.upsert.mock.calls[0][0].create.tokenId).toBe('token-1');
    expect(prisma.pluginEntitlementCache.upsert.mock.calls[0][0].create.generation).toBe(1);
  });

  it('rejects an unsigned transport status that contradicts the signed status', async () => {
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'REVOKED', signedToken: token }), { status: 200 }));
    await service.refreshOne(pluginId, now);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement_verification_failed', success: false }));
    expect(prisma.pluginEntitlementCache.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ lastError: 'Entitlement verification failed' }) }));
  });

  it('leaves the cache completely untouched when the marketplace is unreachable', async () => {
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({ pluginId, status: 'ACTIVE', consecutiveFailures: 0, lastRefreshAttemptAt: null });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await service.refreshOne(pluginId, now);
    expect(prisma.pluginEntitlementCache.upsert).toHaveBeenCalledWith({
      where: { pluginId }, create: expect.objectContaining({ status: 'UNKNOWN' }),
      update: { consecutiveFailures: 1, lastError: 'Marketplace is unreachable', lastRefreshAttemptAt: now },
    });
  });

  it('leaves the cache untouched and audits when the returned token fails verification', async () => {
    const tampered = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    (tampered.payload as any).productId = 'official.other-plugin';
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({ pluginId, status: 'ACTIVE', consecutiveFailures: 0, lastRefreshAttemptAt: null });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ACTIVE', signedToken: tampered }), { status: 200 }));
    await service.refreshOne(pluginId, now);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement_verification_failed', success: false }));
    expect(prisma.pluginEntitlementCache.upsert).toHaveBeenCalledWith({
      where: { pluginId }, create: expect.objectContaining({ status: 'UNKNOWN' }),
      update: { consecutiveFailures: 1, lastError: 'Entitlement verification failed', lastRefreshAttemptAt: now },
    });
  });

  it('treats a first-ever 404 as an authoritative absence of any entitlement', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }));
    const result = await service.refreshOne(pluginId, now);
    expect(result).toMatchObject({ status: 'NONE' });
  });

  it('treats an unexpected 404 for a previously-known active plugin as a failure, not a downgrade', async () => {
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({ pluginId, status: 'ACTIVE', consecutiveFailures: 0, lastRefreshAttemptAt: null });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }));
    await service.refreshOne(pluginId, now);
    expect(prisma.pluginEntitlementCache.upsert).toHaveBeenCalledWith({
      where: { pluginId }, create: expect.objectContaining({ status: 'UNKNOWN' }),
      update: expect.objectContaining({ lastError: expect.stringContaining('unexpectedly reports no entitlement') }),
    });
  });

  it('skips a refresh that is not yet due under the failure backoff schedule', async () => {
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({
      pluginId, status: 'ACTIVE', consecutiveFailures: 1, lastRefreshAttemptAt: new Date(now.getTime() - 60_000),
    });
    const fetchMock = jest.spyOn(global, 'fetch');
    await service.refreshOne(pluginId, now);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes again once the backoff window has elapsed', async () => {
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({
      pluginId, status: 'ACTIVE', consecutiveFailures: 1, lastRefreshAttemptAt: new Date(now.getTime() - 6 * 60_000),
    });
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ACTIVE', signedToken: token }), { status: 200 }));
    await service.refreshOne(pluginId, now);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('isolates a single plugin refresh failure from the rest of the sweep', async () => {
    prisma.pluginInstallation.findMany.mockResolvedValue([{ id: 'official.a' }, { id: 'official.b' }]);
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now, { productId: 'official.b' });
    jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('official.a')) throw new Error('network down');
      return new Response(JSON.stringify({ status: 'ACTIVE', signedToken: token }), { status: 200 });
    });
    await expect(service.refreshAll(now)).resolves.toBeUndefined();
    expect(prisma.pluginEntitlementCache.upsert).toHaveBeenCalledTimes(2);
  });

  it('imports a valid offline token without contacting the marketplace', async () => {
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service.importOne(pluginId, token, now)).resolves.toMatchObject({ pluginId, status: 'ACTIVE', tokenId: 'token-1' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement_offline_imported', success: true }));
  });

  it('rejects an older signed generation during refresh without overwriting the last-known-good token', async () => {
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({ pluginId, status: 'ACTIVE', generation: 2, tokenId: 'token-2', consecutiveFailures: 0, lastRefreshAttemptAt: null });
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now, { generation: 1 });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ACTIVE', signedToken: token }), { status: 200 }));
    await service.refreshOne(pluginId, now);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement_verification_failed', success: false }));
    expect(prisma.pluginEntitlementCache.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ lastError: 'Entitlement verification failed' }) }));
  });

  it('rejects an older signed generation during offline import', async () => {
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({ pluginId, status: 'ACTIVE', generation: 2, tokenId: 'token-2' });
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now, { generation: 1 });
    await expect(service.importOne(pluginId, token, now)).rejects.toThrow('invalid');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement_offline_import_failed', success: false }));
  });

  it('rejects and audits a tampered offline token without overwriting the cache', async () => {
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    (token.payload as any).productId = 'official.other-plugin';
    await expect(service.importOne(pluginId, token, now)).rejects.toThrow('invalid');
    expect(prisma.pluginEntitlementCache.upsert).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'entitlement_offline_import_failed', success: false }));
  });

  it('exports only a previously verified signed token', async () => {
    const token = signedEntitlement(entitlement.privateKey, 'entitlement-2026', now);
    prisma.pluginEntitlementCache.findUnique.mockResolvedValue({ pluginId, status: 'ACTIVE', signedTokenJson: JSON.stringify(token) });
    await expect(service.exportOne(pluginId)).resolves.toMatchObject({ schemaVersion: 1, pluginId, status: 'ACTIVE', signedToken: token });
  });
});
