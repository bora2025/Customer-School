import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { InstallationKeyService } from './installation-key.service';
import { MarketplaceLinkTokenStore } from './marketplace-link-token.store';
import { MarketplaceIdentityConfig, readMarketplaceIdentityConfig } from './marketplace-identity-config';

const REQUESTED_SCOPE = 'catalog:browse purchase:create download:artifact';
const REFRESH_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

export function marketplaceApprovalUrl(configuredOrigin: string, requestId: string, supplied?: unknown): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new BadGatewayException('Marketplace returned an invalid link request');
  }
  let url: URL;
  try { url = new URL(String(supplied || '')); }
  catch { throw new BadGatewayException('Marketplace returned an invalid approval URL'); }
  const origin = new URL(configuredOrigin);
  if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash || url.pathname !== `/marketplace/link/${requestId}`) {
    throw new BadGatewayException('Marketplace returned an untrusted approval URL');
  }
  return url.toString();
}

function maskEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

@Injectable()
export class MarketplaceLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: InstallationKeyService,
    private readonly tokenStore: MarketplaceLinkTokenStore,
  ) {}

  async start(label?: string) {
    const config = this.requireConfig();
    const installationId = await this.installationId();
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await this.keys.sign({ installationId, requestedScope: REQUESTED_SCOPE, ts });
    const result = await this.postJson(config, `/v1/installations/${installationId}/marketplace-links`, { installationId, requestedScope: REQUESTED_SCOPE, ts, signature, label });
    if (result.status !== 201) throw new BadGatewayException(errorMessage(result.body));
    // Persisted before the browser is told about it, so an approval can still be claimed if the
    // admin page is reloaded or closed while the owner is deciding.
    const approvalUrl = marketplaceApprovalUrl(config.marketplaceUrl, result.body.requestId, result.body.approvalUrl);
    await this.prisma.marketplacePendingLink.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', requestId: result.body.requestId, scope: REQUESTED_SCOPE, expiresAt: new Date(result.body.expiresAt) },
      update: { requestId: result.body.requestId, scope: REQUESTED_SCOPE, startedAt: new Date(), expiresAt: new Date(result.body.expiresAt) },
    });
    return { requestId: result.body.requestId, approvalUrl, expiresAt: result.body.expiresAt };
  }

  /** `requestId` is optional: with none, the pending request recorded by `start()` is resumed. */
  async poll(requestId?: string) {
    const pending = requestId?.trim()
      ? requestId.trim()
      : (await this.prisma.marketplacePendingLink.findUnique({ where: { id: 'singleton' } }))?.requestId;
    if (!pending) throw new BadRequestException('No marketplace link is awaiting approval');
    requestId = pending;
    const config = this.requireConfig();
    const installationId = await this.installationId();
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await this.keys.sign({ installationId, requestId, ts });
    const result = await this.postJson(config, `/v1/installations/${installationId}/marketplace-links/${requestId}/exchange`, { installationId, requestId, ts, signature });
    // Marketplace currently returns HTTP 200 with { status: 'pending' }; older deployments used
    // HTTP 202. Accept both contracts so a waiting approval is never mistaken for a delivered
    // credential (which would otherwise attempt to write an undefined token to disk).
    if (result.status === 202 || result.body?.status === 'pending' || result.body?.pending === true) {
      return { status: 'pending' as const };
    }
    // Denied and expired are final answers, so the pending record stops being useful.
    if (result.status === 403) { await this.clearPending(); return { status: 'denied' as const }; }
    if (result.status === 410) { await this.clearPending(); return { status: 'expired' as const }; }
    if (result.status !== 200) throw new BadGatewayException(errorMessage(result.body));
    const body = result.body as { sessionToken?: unknown; expiresAt?: unknown; accountId?: unknown; accountEmail?: unknown; scope?: unknown; grantId?: unknown };
    if (
      typeof body?.sessionToken !== 'string' || !body.sessionToken ||
      typeof body.expiresAt !== 'string' || Number.isNaN(Date.parse(body.expiresAt)) ||
      typeof body.accountId !== 'string' || !body.accountId ||
      typeof body.scope !== 'string' || !body.scope ||
      typeof body.grantId !== 'string' || !body.grantId ||
      (body.accountEmail !== undefined && typeof body.accountEmail !== 'string')
    ) {
      throw new BadGatewayException('Marketplace returned an invalid completed link response');
    }
    const accountEmail = typeof body.accountEmail === 'string' ? body.accountEmail : undefined;
    await this.tokenStore.write(body.sessionToken);
    const now = new Date();
    await this.prisma.marketplaceProxyLink.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton', grantId: body.grantId, accountId: body.accountId, accountEmailMasked: maskEmail(accountEmail),
        scope: body.scope, linkedAt: now, expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), sessionExpiresAt: new Date(body.expiresAt),
      },
      update: {
        grantId: body.grantId, accountId: body.accountId, accountEmailMasked: maskEmail(accountEmail),
        scope: body.scope, linkedAt: now, expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000), sessionExpiresAt: new Date(body.expiresAt), revokedAt: null,
      },
    });
    // The request is spent; leaving it would make a later resume attempt fail with "already
    // exchanged" rather than reporting the link it successfully established.
    await this.prisma.marketplacePendingLink.deleteMany({ where: { id: 'singleton' } });
    return { status: 'linked' as const, accountEmailMasked: maskEmail(accountEmail), scope: body.scope };
  }

  async status() {
    const [link, pending] = await Promise.all([
      this.prisma.marketplaceProxyLink.findUnique({ where: { id: 'singleton' } }),
      this.prisma.marketplacePendingLink.findUnique({ where: { id: 'singleton' } }),
    ]);
    // Reported even once linked, so a stale record left by an interrupted relink is visible rather
    // than silently absent.
    const config = readMarketplaceIdentityConfig();
    const awaiting = pending ? {
      requestId: pending.requestId,
      startedAt: pending.startedAt,
      expiresAt: pending.expiresAt,
      approvalUrl: config ? new URL(`/marketplace/link/${pending.requestId}`, config.marketplaceUrl).toString() : undefined,
    } : null;
    if (!link || link.revokedAt) return { linked: false as const, pending: awaiting };
    return { linked: true as const, accountEmailMasked: link.accountEmailMasked, scope: link.scope, linkedAt: link.linkedAt, expiresAt: link.expiresAt, pending: awaiting };
  }

  private async clearPending() {
    await this.prisma.marketplacePendingLink.deleteMany({ where: { id: 'singleton' } });
  }

  async revoke() {
    const link = await this.prisma.marketplaceProxyLink.findUnique({ where: { id: 'singleton' } });
    if (!link || link.revokedAt) return { revoked: true };
    const config = this.requireConfig();
    const token = await this.tokenStore.read();
    if (token) {
      try {
        await fetch(new URL(`/v1/marketplace-links/${link.grantId}/revoke`, config.marketplaceUrl), {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs),
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
      } catch {
        // Best-effort: the marketplace-side grant will also expire on its own (90-day cap) and the
        // account owner can always revoke it from their own portal. Local state must still clear.
      }
    }
    await this.tokenStore.clear();
    await this.prisma.marketplaceProxyLink.update({ where: { id: 'singleton' }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  /** Returns a usable delegated session token, transparently rotating it via the marketplace's
   * existing refresh-with-reuse-detection endpoint when it is close to expiry -- the browser never
   * sees this token, so nothing else needs to change when it rotates. */
  async getValidAccessToken(): Promise<string> {
    const link = await this.prisma.marketplaceProxyLink.findUnique({ where: { id: 'singleton' } });
    if (!link || link.revokedAt) throw new ServiceUnavailableException('This installation is not linked to a marketplace account');
    const token = await this.tokenStore.read();
    if (!token) throw new ServiceUnavailableException('Marketplace link session is missing locally; relink this installation');
    if (link.sessionExpiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS) return token;
    const config = this.requireConfig();
    const result = await this.postJson(config, '/v1/sessions/refresh', { sessionToken: token });
    if (result.status !== 200) {
      if (link.sessionExpiresAt.getTime() > Date.now()) return token;
      throw new ServiceUnavailableException('Marketplace link session has expired; relink this installation');
    }
    const refreshed = result.body as { sessionToken: string; expiresAt: string };
    await this.tokenStore.write(refreshed.sessionToken);
    await this.prisma.marketplaceProxyLink.update({ where: { id: 'singleton' }, data: { sessionExpiresAt: new Date(refreshed.expiresAt), lastUsedAt: new Date() } });
    return refreshed.sessionToken;
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

  private async postJson(config: MarketplaceIdentityConfig, urlPath: string, body: unknown): Promise<{ status: number; body: any }> {
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
    return { status: response.status, body: payload };
  }
}

function errorMessage(body: unknown): string {
  return body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : 'Marketplace request failed';
}
