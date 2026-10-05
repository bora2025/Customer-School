import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createPublicKey, generateKeyPairSync } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { InstallationKeyService } from './installation-key.service';
import { MarketplaceLinkTokenStore } from './marketplace-link-token.store';
import { MarketplaceIdentityConfig, readMarketplaceIdentityConfig } from './marketplace-identity-config';

@Injectable()
export class InstallationRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: InstallationKeyService,
    private readonly tokenStore: MarketplaceLinkTokenStore,
  ) {}

  /**
   * Local-only status. Deliberately never contacts the marketplace: an outage must not make the
   * licensing screen hang or appear broken. The marketplace stays the authority on whether this
   * installation is registered, and says so when register/rotate is actually attempted.
   */
  async status() {
    const installation = await this.installationId();
    const key = await this.keys.ensureKeyPair().catch(() => null);
    const [record, proxyLink] = await Promise.all([
      this.prisma.marketplaceRegistration.findUnique({ where: { id: 'singleton' } }),
      this.prisma.marketplaceProxyLink.findUnique({ where: { id: 'singleton' } }),
    ]);
    // A live marketplace link is only obtainable by a registered installation, so it proves
    // registration for schools that registered before this record existed.
    const linked = Boolean(proxyLink && !proxyLink.revokedAt);
    return {
      installationId: installation,
      hasLocalKey: !!key,
      keyFingerprint: key?.fingerprint ?? null,
      marketplaceConfigured: !!readMarketplaceIdentityConfig(),
      registered: Boolean(record) || linked,
      registeredAt: record?.registeredAt ?? null,
      registeredAccountId: record?.accountId ?? null,
      // True when registration is inferred from a link rather than recorded, so the screen can say
      // so instead of implying it holds details it does not have.
      registrationInferred: !record && linked,
    };
  }

  /**
   * `enrollmentToken` is the one-time secret a platform operator minted for this school before it
   * was deployed. It is optional: a school that has no token (a self-hosted installation, or any
   * of the schools that registered before the customer directory existed) registers exactly as it
   * always did. Passing one binds this installation to that customer record on the marketplace
   * side, which is what lets the operator console show a named school rather than a bare UUID.
   *
   * Deliberately not persisted here. It is single-use and is spent the moment this call succeeds,
   * so keeping a copy in the school's database would only create a secret with no remaining
   * purpose.
   */
  async register(
    accountId?: string,
    label?: string,
    enrollmentToken?: string,
    owner?: { email?: string; password?: string; code?: string },
  ) {
    const config = this.requireConfig();
    let account = accountId?.trim();
    const token = enrollmentToken?.trim();
    if (token && owner) account = await this.verifyOwner(config, owner);
    if (!account && !token) {
      throw new BadRequestException('Provide a marketplace account id or the enrollment token issued for this school');
    }
    const installationId = await this.installationId();
    const { publicKeyPem } = await this.keys.ensureKeyPair();
    const challenge = await this.requestChallenge(config, installationId, 'register');
    const signature = await this.keys.sign({ installationId, challengeId: challenge.challengeId, nonce: challenge.nonce, purpose: 'register' });
    // Both are omitted rather than sent empty: the marketplace input schema is strict, and an
    // empty string fails its uuid check instead of reading as "not supplied".
    const result = await this.postJson(config, '/v1/installations/register', {
      installationId, label, publicKeyPem, challengeId: challenge.challengeId, signature,
      ...(account ? { accountId: account } : {}),
      ...(token ? { enrollmentToken: token } : {}),
    });
    // Recorded only after the marketplace accepted it, so the licensing screen never claims a
    // registration that failed.
    const fingerprint = fingerprintOf(publicKeyPem);
    await this.prisma.marketplaceRegistration.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', installationId, keyFingerprint: fingerprint, accountId: result?.accountId ?? account ?? null, label },
      update: { installationId, keyFingerprint: fingerprint, accountId: result?.accountId ?? account ?? null, label, registeredAt: new Date() },
    });

    const autoLink = this.asAutoLinkPayload(result?.autoLink);
    if (autoLink) {
      await this.tokenStore.write(autoLink.sessionToken);
      await this.prisma.marketplaceProxyLink.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          grantId: autoLink.grantId,
          accountId: autoLink.accountId,
          accountEmailMasked: maskEmail(autoLink.accountEmail),
          scope: autoLink.scope,
          linkedAt: new Date(),
          expiresAt: new Date(autoLink.grantExpiresAt),
          sessionExpiresAt: new Date(autoLink.sessionExpiresAt),
        },
        update: {
          grantId: autoLink.grantId,
          accountId: autoLink.accountId,
          accountEmailMasked: maskEmail(autoLink.accountEmail),
          scope: autoLink.scope,
          linkedAt: new Date(),
          expiresAt: new Date(autoLink.grantExpiresAt),
          sessionExpiresAt: new Date(autoLink.sessionExpiresAt),
          revokedAt: null,
        },
      });
      await this.prisma.marketplacePendingLink.deleteMany({ where: { id: 'singleton' } });
    }
    return result;
  }

  async requestMarketplaceAccount(input: { email?: string; password?: string; displayName?: string; schoolName?: string }) {
    const config = this.requireConfig();
    const email = input?.email?.trim();
    const displayName = input?.displayName?.trim();
    const schoolName = input?.schoolName?.trim();
    if (!email || !displayName || !schoolName || !input?.password) {
      throw new BadRequestException('School name, owner name, email, and password are required');
    }
    return this.postJson(config, '/v1/account-requests', { email, password: input.password, displayName, schoolName });
  }

  async requestMarketplacePasswordReset(email?: string) {
    const config = this.requireConfig();
    const normalizedEmail = email?.trim();
    if (!normalizedEmail) throw new BadRequestException('Email is required');
    return this.postJson(config, '/v1/password-resets', { email: normalizedEmail });
  }

  async confirmMarketplacePasswordReset(token?: string, newPassword?: string) {
    const config = this.requireConfig();
    const normalizedToken = token?.trim();
    if (!normalizedToken || !newPassword) throw new BadRequestException('Reset token and new password are required');
    return this.postJson(config, '/v1/password-resets/confirm', { token: normalizedToken, newPassword });
  }

  private async verifyOwner(
    config: MarketplaceIdentityConfig,
    owner: { email?: string; password?: string; code?: string },
  ): Promise<string> {
    const email = owner.email?.trim();
    if (!email || !owner.password) throw new BadRequestException('Enter the marketplace owner email and password');
    const login = await this.postJson(config, '/v1/sessions', {
      email,
      password: owner.password,
      ...(owner.code?.trim() ? { code: owner.code.trim() } : {}),
    });
    if (login?.status === 'mfa_required') throw new BadRequestException('Enter the owner’s MFA or recovery code, then try again');
    if (typeof login?.accountId !== 'string' || !login.accountId) {
      throw new BadGatewayException('Marketplace sign-in did not return an account identity');
    }
    return login.accountId;
  }

  private asAutoLinkPayload(value: unknown): {
    sessionToken: string;
    sessionExpiresAt: string;
    grantId: string;
    grantExpiresAt: string;
    accountId: string;
    accountEmail?: string;
    scope: string;
  } | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.sessionToken !== 'string' || !row.sessionToken.trim()) return null;
    if (typeof row.sessionExpiresAt !== 'string' || Number.isNaN(Date.parse(row.sessionExpiresAt))) return null;
    if (typeof row.grantId !== 'string' || !row.grantId.trim()) return null;
    if (typeof row.grantExpiresAt !== 'string' || Number.isNaN(Date.parse(row.grantExpiresAt))) return null;
    if (typeof row.accountId !== 'string' || !row.accountId.trim()) return null;
    if (typeof row.scope !== 'string' || !row.scope.trim()) return null;
    return {
      sessionToken: row.sessionToken,
      sessionExpiresAt: row.sessionExpiresAt,
      grantId: row.grantId,
      grantExpiresAt: row.grantExpiresAt,
      accountId: row.accountId,
      accountEmail: typeof row.accountEmail === 'string' ? row.accountEmail : undefined,
      scope: row.scope,
    };
  }

  async rotateKey() {
    const config = this.requireConfig();
    const installationId = await this.installationId();
    const challenge = await this.requestChallenge(config, installationId, 'rotate');
    const nextPair = generateKeyPairSync('ed25519');
    const newPrivateKeyPem = nextPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const newPublicKeyPem = nextPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const newKeyFingerprint = fingerprintOf(newPublicKeyPem);
    const signature = await this.keys.sign({ installationId, challengeId: challenge.challengeId, nonce: challenge.nonce, purpose: 'rotate', newKeyFingerprint });
    const result = await this.postJson(config, `/v1/installations/${installationId}/keys/rotate`, { challengeId: challenge.challengeId, signature, newPublicKeyPem });
    await this.keys.replaceKeyPair(newPrivateKeyPem);
    // A rotation only succeeds for a registered installation, so this both refreshes the recorded
    // fingerprint and establishes the record for a school that registered before it existed.
    await this.prisma.marketplaceRegistration.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', installationId, keyFingerprint: newKeyFingerprint },
      update: { keyFingerprint: newKeyFingerprint },
    });
    return result;
  }

  private async installationId(): Promise<string> {
    const installation = await this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { installationId: true } });
    if (!installation) throw new BadRequestException('This school has not completed first-run installation yet');
    return installation.installationId;
  }

  private requireConfig(): MarketplaceIdentityConfig {
    const config = readMarketplaceIdentityConfig();
    if (!config) throw new ServiceUnavailableException('Marketplace integration is not configured (MARKETPLACE_URL is not set)');
    return config;
  }

  private async requestChallenge(config: MarketplaceIdentityConfig, installationId: string, purpose: 'register' | 'rotate') {
    return this.postJson(config, '/v1/installations/challenges', { installationId, purpose });
  }

  private async postJson(config: MarketplaceIdentityConfig, urlPath: string, body: unknown): Promise<any> {
    const url = new URL(urlPath, config.marketplaceUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException('Marketplace is unavailable');
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new BadGatewayException('Marketplace returned invalid JSON'); }
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error: unknown }).error) : `Marketplace responded with ${response.status}`;
      throw new BadGatewayException(message);
    }
    return payload;
  }
}

function maskEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

function fingerprintOf(publicKeyPem: string): string {
  return createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex');
}
