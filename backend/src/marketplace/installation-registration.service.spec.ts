import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { InstallationKeyService } from './installation-key.service';
import { InstallationRegistrationService } from './installation-registration.service';

describe('InstallationRegistrationService', () => {
  const originalEnvironment = process.env;
  let keyDir: string;
  let prisma: any;
  let keys: InstallationKeyService;
  let service: InstallationRegistrationService;
  let tokenStore: { write: jest.Mock };

  beforeEach(() => {
    keyDir = mkdtempSync(path.join(os.tmpdir(), 'wattanam-installation-registration-'));
    process.env = { ...originalEnvironment, MARKETPLACE_URL: 'https://marketplace.example.com', INSTALLATION_KEY_DIR: keyDir };
    // A tiny in-memory stand-in for the two singleton rows status() now reads, so these tests
    // exercise the real derivation rather than a mock that always answers the same way.
    const singletons: Record<string, any> = {};
    const store = (name: string) => ({
      findUnique: jest.fn(async () => singletons[name] ?? null),
      create: jest.fn(async ({ data }: any) => (singletons[name] = { registeredAt: new Date(), revokedAt: null, ...data })),
      upsert: jest.fn(async ({ create, update }: any) => (singletons[name] = singletons[name]
        ? { ...singletons[name], ...update }
        : { registeredAt: new Date(), revokedAt: null, ...create })),
      deleteMany: jest.fn(async () => { delete singletons[name]; return { count: 1 }; }),
    });
    prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'school-public-id' }) },
      marketplaceRegistration: store('registration'),
      marketplaceProxyLink: store('proxyLink'),
      marketplacePendingLink: store('pendingLink'),
    };
    tokenStore = { write: jest.fn().mockResolvedValue(undefined) };
    keys = new InstallationKeyService();
    service = new InstallationRegistrationService(prisma, keys, tokenStore as any);
  });

  afterEach(() => { rmSync(keyDir, { recursive: true, force: true }); jest.restoreAllMocks(); });
  afterAll(() => { process.env = originalEnvironment; });

  it('rejects any action before first-run installation has created the singleton row', async () => {
    prisma.installation.findUnique.mockResolvedValue(null);
    await expect(service.register('account-1')).rejects.toThrow('first-run installation');
  });

  it('requests a challenge, signs it, and submits registration', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ installationId: 'school-public-id', accountId: 'account-1', keyFingerprint: 'fp' }), { status: 201 }));
    const result = await service.register('account-1', 'Main Campus');
    expect(result).toMatchObject({ accountId: 'account-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const registerCall = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(registerCall).toMatchObject({ accountId: 'account-1', installationId: 'school-public-id', label: 'Main Campus' });
    expect(registerCall.signature).toEqual(expect.any(String));
  });

  it('forwards an enrollment token when one is supplied, and omits the field otherwise', async () => {
    const respond = () => jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ installationId: 'school-public-id', accountId: 'account-1', keyFingerprint: 'fp' }), { status: 201 }));

    const withToken = respond();
    await service.register('account-1', 'Main Campus', `  wtn_enr_${'a'.repeat(64)}  `);
    // Trimmed, because an operator pasting a token out of a chat message brings whitespace with it.
    expect(JSON.parse(String(withToken.mock.calls[1][1]?.body)).enrollmentToken).toBe(`wtn_enr_${'a'.repeat(64)}`);
    withToken.mockRestore();

    const withoutToken = respond();
    await service.register('account-1', 'Main Campus');
    // Absent rather than null: the marketplace input schema is strict, and an explicit null would
    // fail validation for every school that has no token.
    expect(JSON.parse(String(withoutToken.mock.calls[1][1]?.body))).not.toHaveProperty('enrollmentToken');
    withoutToken.mockRestore();
  });

  it('verifies enrollment ownership through the backend connector before registering', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'authenticated', accountId: 'account-1', sessionToken: 'unused' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ installationId: 'school-public-id', accountId: 'account-1', keyFingerprint: 'fp' }), { status: 201 }));

    await service.register(undefined, 'Main Campus', `wtn_enr_${'a'.repeat(64)}`, {
      email: ' owner@example.com ', password: 'secret', code: '123456',
    });

    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/sessions');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ email: 'owner@example.com', password: 'secret', code: '123456' });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({ accountId: 'account-1' });
  });

  it('requires MFA completion before consuming the enrollment token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'mfa_required' }), { status: 200 }),
    );
    await expect(service.register(undefined, 'Main Campus', `wtn_enr_${'a'.repeat(64)}`, {
      email: 'owner@example.com', password: 'secret',
    })).rejects.toThrow('MFA or recovery code');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('registers with an enrollment token alone, omitting the unverified account id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ installationId: 'school-public-id', accountId: null, keyFingerprint: 'fp', school: { slug: 'angkor1' } }), { status: 201 }));

    await service.register(undefined, 'Angkor1', `wtn_enr_${'a'.repeat(64)}`);

    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).not.toHaveProperty('accountId');
    expect(body.enrollmentToken).toBe(`wtn_enr_${'a'.repeat(64)}`);
  });

  it('refuses to register with neither an account nor a token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service.register()).rejects.toThrow('account id or the enrollment token');
    // Refused before the challenge round trip, so a mistyped form cannot consume a server nonce.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the marketplace error message when registration is rejected', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Installation is already registered; rotate its key instead' }), { status: 409 }));
    await expect(service.register('account-1')).rejects.toThrow('already registered');
  });

  it('treats a marketplace network failure as unavailable rather than crashing', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(service.register('account-1')).rejects.toThrow('unavailable');
  });

  it('proxies account requests and password reset without persisting credentials locally', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'request-1', status: 'PENDING' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ requested: true }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reset: true }), { status: 200 }));

    await service.requestMarketplaceAccount({ schoolName: ' Wattanam School ', displayName: ' School Owner ', email: ' owner@example.com ', password: 'long-password' });
    await service.requestMarketplacePasswordReset(' owner@example.com ');
    await service.confirmMarketplacePasswordReset(' reset-token-value ', 'next-password');

    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/account-requests');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ schoolName: 'Wattanam School', displayName: 'School Owner', email: 'owner@example.com', password: 'long-password' });
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/v1/password-resets');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ email: 'owner@example.com' });
    expect(new URL(String(fetchMock.mock.calls[2][0])).pathname).toBe('/v1/password-resets/confirm');
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ token: 'reset-token-value', newPassword: 'next-password' });
  });

  it('only persists the newly generated key locally after the marketplace confirms rotation', async () => {
    const before = await keys.ensureKeyPair();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-2', nonce: 'n'.repeat(64), purpose: 'rotate', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Signature is invalid' }), { status: 400 }));
    await expect(service.rotateKey()).rejects.toThrow('Signature is invalid');
    const stillCurrent = await new InstallationKeyService().ensureKeyPair();
    expect(stillCurrent.fingerprint).toBe(before.fingerprint);
  });

  it('rotates the local key only after the marketplace accepts the new public key', async () => {
    const before = await keys.ensureKeyPair();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-3', nonce: 'n'.repeat(64), purpose: 'rotate', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ installationId: 'school-public-id', keyFingerprint: 'server-reported-fp' }), { status: 200 }));
    await service.rotateKey();
    const rotated = await new InstallationKeyService().ensureKeyPair();
    expect(rotated.fingerprint).not.toBe(before.fingerprint);
  });

  it('reports itself unregistered when nothing local says otherwise', async () => {
    await keys.ensureKeyPair();
    const status = await service.status();
    expect(status).toMatchObject({ registered: false, registrationInferred: false, registeredAt: null });
  });

  it('records the registration once the marketplace accepts it', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ installationId: 'school-public-id', accountId: null, keyFingerprint: 'fp' }), { status: 201 }));

    await service.register(undefined, 'Bora School', `wtn_enr_${'a'.repeat(64)}`);

    const status = await service.status();
    expect(status).toMatchObject({ registered: true, registrationInferred: false });
    expect(status.registeredAt).toBeTruthy();
  });

  it('automatically persists delegated marketplace link state when registration returns autoLink', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        installationId: 'school-public-id',
        accountId: '00000000-0000-4000-8000-000000000020',
        keyFingerprint: 'fp',
        autoLink: {
          grantId: 'grant-1',
          accountId: '00000000-0000-4000-8000-000000000020',
          accountEmail: 'owner@example.com',
          scope: 'catalog:browse purchase:create download:artifact',
          grantExpiresAt: '2099-01-01T00:00:00.000Z',
          sessionToken: 'token-raw',
          sessionExpiresAt: '2098-01-01T00:00:00.000Z',
        },
      }), { status: 201 }));

    await service.register('00000000-0000-4000-8000-000000000020', 'Bora School', `wtn_enr_${'a'.repeat(64)}`);

    expect(tokenStore.write).toHaveBeenCalledWith('token-raw');
    expect(prisma.marketplaceProxyLink.upsert).toHaveBeenCalled();
  });

  it('does not record a registration the marketplace rejected', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ challengeId: 'challenge-1', nonce: 'n'.repeat(64), purpose: 'register', expiresAt: '2099-01-01T00:00:00.000Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Enrollment token is not valid' }), { status: 400 }));

    await expect(service.register(undefined, 'Bora School', `wtn_enr_${'b'.repeat(64)}`)).rejects.toThrow('not valid');
    await expect(service.status()).resolves.toMatchObject({ registered: false });
  });

  // Every school that registered before this record existed still has to read as registered, and
  // a live marketplace link is only obtainable by one that is.
  it('infers registration from an active marketplace link, and says the detail is not local', async () => {
    await prisma.marketplaceProxyLink.create({
      data: {
        id: 'singleton', grantId: 'grant-1', accountId: 'account-1', scope: 'catalog:browse',
        linkedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), sessionExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const status = await service.status();
    expect(status).toMatchObject({ registered: true, registrationInferred: true, registeredAt: null });
  });

  it('stops inferring registration once the link is revoked', async () => {
    await prisma.marketplaceProxyLink.create({
      data: {
        id: 'singleton', grantId: 'grant-1', accountId: 'account-1', scope: 'catalog:browse',
        linkedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), sessionExpiresAt: new Date(Date.now() + 3_600_000),
        revokedAt: new Date(),
      },
    });
    await expect(service.status()).resolves.toMatchObject({ registered: false });
  });

  it('reports local key status without requiring the marketplace to be reachable', async () => {
    await keys.ensureKeyPair();
    const status = await service.status();
    expect(status).toMatchObject({ installationId: 'school-public-id', hasLocalKey: true });
  });
});
