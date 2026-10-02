import { BadGatewayException, BadRequestException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { InstallationKeyService } from './installation-key.service';
import { readMarketplaceIdentityConfig } from './marketplace-identity-config';
import { readEntitlementConfig } from './entitlement-config';
import { verifySchoolControl } from './school-control-verification';
import { evaluateSchoolAccess } from './school-access.service';
import { schoolPaymentSignedPayload } from './school-payment-signing';

type Warning = { invoiceId: string; invoiceNumber: string; currency: string; outstandingMinor: number; dueAt: string; suspendAt: string; final: boolean };
type BillingNotification = { id: string; invoiceId?: string | null; type: string; subject?: string | null; message?: string | null; createdAt?: string };
type BillingSummary = { schoolName?: string; marketplaceUrl?: string; billingPlan?: unknown; outstandingMinor?: number; invoices?: unknown[]; notifications?: BillingNotification[] };

/** Shared by every notification this service raises, so one unread count covers the lot. */
const NOTIFICATION_TYPE_PREFIX = 'platform_billing_';

/** OVERDUE is absent deliberately — see the sync's comment where these are raised. */
const NOTIFIED_TYPES = new Set(['INVOICE_ISSUED', 'DUE_SOON', 'PAYMENT_RECEIVED']);

@Injectable()
export class SchoolBillingControlService {
  private readonly logger = new Logger(SchoolBillingControlService.name);
  constructor(private readonly prisma: PrismaService, private readonly keys: InstallationKeyService) {}

  @Cron('0 * * * *')
  async sync(now = new Date()) {
    const config = readMarketplaceIdentityConfig();
    const signing = readEntitlementConfig();
    if (!config || !signing) return { configured: false };
    const installation = await this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { installationId: true } });
    if (!installation) return { configured: true, installed: false };
    const ts = String(Math.floor(now.getTime() / 1000));
    const signature = await this.keys.sign({ installationId: installation.installationId, ts });
    const url = new URL(`/v1/installations/${installation.installationId}/school-control`, config.marketplaceUrl);
    url.searchParams.set('ts', ts); url.searchParams.set('signature', signature);
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Marketplace responded with ${response.status}`);
      const body = verifySchoolControl(await response.json(), signing.publicKeys, { installationId: installation.installationId, now }) as {
        generation: number; access: 'ACTIVE' | 'SUSPENDED'; reason?: string | null; warnings: Warning[]; billing?: BillingSummary;
      };
      await this.prisma.$transaction(async (tx) => {
        const previous = await tx.marketplaceSchoolControl.findUnique({ where: { id: 'singleton' } });
        if (previous && body.generation <= previous.generation) throw new Error(`School control generation ${body.generation} is not newer than cached generation ${previous.generation}`);
        await tx.marketplaceSchoolControl.upsert({
          where: { id: 'singleton' },
          create: { id: 'singleton', generation: body.generation, access: body.access, reason: body.reason || null, warningsJson: JSON.stringify(body.warnings), billingJson: JSON.stringify(body.billing || {}), lastVerifiedAt: now, lastAttemptAt: now },
          update: { generation: body.generation, access: body.access, reason: body.reason || null, warningsJson: JSON.stringify(body.warnings), billingJson: JSON.stringify(body.billing || {}), lastVerifiedAt: now, lastAttemptAt: now, lastError: null },
        });
        const admins = await tx.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } }, select: { id: true } });
        const previousWarnings = new Set<string>(previous ? safeWarnings(previous.warningsJson).map(item => item.invoiceId) : []);
        for (const warning of body.warnings) {
          if (previousWarnings.has(warning.invoiceId)) continue;
          await tx.notification.createMany({ data: admins.map(admin => ({
            userId: admin.id, type: 'platform_billing_final_notice',
            message: `FINAL BILLING NOTICE: invoice ${warning.invoiceNumber} has ${warning.outstandingMinor / 100} ${warning.currency} outstanding. Pay before ${new Date(warning.suspendAt).toLocaleString()} to prevent school suspension.`,
          })) });
        }
        /**
         * The billing lifecycle in the school's own notification bell.
         *
         * The marketplace records INVOICE_ISSUED, DUE_SOON and PAYMENT_RECEIVED and delivers them
         * by email, which this deployment has switched off -- so without this the first a school
         * hears of a bill is the final notice above, three days before it is locked out of its own
         * system. These records reach us on every sync regardless of whether their email was ever
         * delivered, which is exactly why they are worth surfacing here.
         *
         * OVERDUE is excluded on purpose: the warnings loop above already raises the final notice
         * for the same invoice, and two bells for one event teaches people to ignore both.
         */
        const seenNotificationIds = new Set(previous ? safeNotificationIds(previous.billingJson) : []);
        const fresh = (body.billing?.notifications ?? []).filter(
          (item) => NOTIFIED_TYPES.has(item.type) && !seenNotificationIds.has(item.id),
        );
        // On a school's first successful sync every historical record looks new. Recording them
        // without ringing avoids dumping a back catalogue into the bell on day one.
        if (previous?.lastVerifiedAt) {
          for (const item of fresh) {
            await tx.notification.createMany({ data: admins.map(admin => ({
              userId: admin.id,
              type: `platform_billing_${item.type.toLowerCase()}`,
              message: item.subject || `Platform billing update (${item.type.toLowerCase().replace(/_/g, ' ')}).`,
            })) });
          }
        }

        if (previous?.access !== 'SUSPENDED' && body.access === 'SUSPENDED') {
          await tx.notification.createMany({ data: admins.map(admin => ({ userId: admin.id, type: 'platform_billing_suspended', message: `School access is suspended: ${body.reason || 'platform invoice unpaid'}.` })) });
        }
        if (previous?.access === 'SUSPENDED' && body.access === 'ACTIVE') {
          await tx.notification.createMany({ data: admins.map(admin => ({ userId: admin.id, type: 'platform_billing_reactivated', message: 'School access has been automatically reactivated after billing clearance.' })) });
        }
      });
      return { configured: true, access: body.access, warnings: body.warnings.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.marketplaceSchoolControl.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', lastAttemptAt: now, lastError: message }, update: { lastAttemptAt: now, lastError: message } });
      this.logger.warn(`School billing control sync failed: ${message}`);
      await this.noticeOutageUnlock(now).catch(() => undefined);
      return { configured: true, unavailable: true };
    }
  }

  /**
   * While the school is locked, or while a payment it reported awaits confirmation, check every five
   * minutes instead of hourly -- otherwise a school finance has just cleared can stay locked for up to
   * an hour. Minutes 5 to 55 only: the hourly sync already runs at minute 0, and two syncs at once
   * would race each other's notifications. An active school with nothing pending costs nothing extra.
   */
  @Cron('5-55/5 * * * *')
  async syncWhileLocked(now = new Date()) {
    const state = await this.prisma.marketplaceSchoolControl.findUnique({ where: { id: 'singleton' }, select: { access: true, billingJson: true } });
    if (!state || (state.access !== 'SUSPENDED' && !hasPendingPayment(state.billingJson))) return { skipped: true };
    return this.sync(now);
  }

  /**
   * After seven days without a successful sync the lock lifts (evaluateSchoolAccess). Say so once: to
   * the administrators, who would otherwise watch a lock vanish with the bill still unpaid, and to
   * Wattanam operations in the log -- a school out of contact for a week is an incident on our side.
   */
  private async noticeOutageUnlock(now: Date) {
    const state = await this.prisma.marketplaceSchoolControl.findUnique({ where: { id: 'singleton' }, select: { access: true, reason: true, lastVerifiedAt: true } });
    if (!state?.lastVerifiedAt || !evaluateSchoolAccess(state, now).lockLiftedByOutage) return;
    this.logger.error(`No successful billing sync since ${state.lastVerifiedAt.toISOString()}; the billing lock is lifted until the marketplace answers again`);
    const already = await this.prisma.notification.findFirst({ where: { type: 'platform_billing_outage_unlocked', sentAt: { gt: state.lastVerifiedAt } }, select: { id: true } });
    if (already) return;
    const admins = await this.prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } }, select: { id: true } });
    if (admins.length === 0) return;
    await this.prisma.notification.createMany({ data: admins.map(admin => ({
      userId: admin.id, type: 'platform_billing_outage_unlocked',
      message: 'Wattanam could not be reached for seven days, so the billing lock has been lifted until contact is restored. The unpaid balance still stands.',
    })) });
  }

  /**
   * Unread platform-billing notifications for one administrator, which is what puts the badge on
   * the Platform Billing nav item. Without it the notifications raised above sit in a table with no
   * inbox: the billing page renders them, but nothing tells anybody to go and look at it.
   */
  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null, type: { startsWith: NOTIFICATION_TYPE_PREFIX } } });
    return { count };
  }

  /** Called when an administrator opens the billing page -- seeing the notices is what clears them. */
  async markRead(userId: string, now = new Date()) {
    const result = await this.prisma.notification.updateMany({ where: { userId, readAt: null, type: { startsWith: NOTIFICATION_TYPE_PREFIX } }, data: { readAt: now } });
    return { marked: result.count };
  }

  /**
   * The school telling the marketplace it paid, signed with its installation key -- the same proof
   * of identity the hourly sync uses -- so an administrator needs no marketplace account and no
   * second sign-in. The signature covers every field, the receipt by its hash, so the request cannot
   * be replayed with a different amount or reference. Afterwards the bill is re-synced, so the
   * payment shows as awaiting confirmation straight away rather than at the next hour.
   */
  async submitPayment(value: unknown, user: { userId: string; role: string }) {
    const config = readMarketplaceIdentityConfig();
    if (!config) throw new ServiceUnavailableException('Marketplace integration is not configured for this school');
    const installation = await this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { installationId: true } });
    if (!installation) throw new BadRequestException('This school has not completed installation');
    const input = parsePaymentSubmission(value);
    const admin = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    const submission = {
      invoiceId: input.invoiceId, provider: 'bank-transfer', providerReference: input.providerReference, amountMinor: input.amountMinor,
      ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.receiptImage ? { receiptImage: input.receiptImage } : {}),
      submittedBy: `${admin?.name || 'School administrator'} (${user.role})`,
    };
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await this.keys.sign(schoolPaymentSignedPayload(installation.installationId, ts, submission));
    let response: Response;
    try {
      response = await fetch(new URL(`/v1/installations/${installation.installationId}/school-billing/payment-submissions`, config.marketplaceUrl), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...submission, ts, signature }),
      });
    } catch {
      throw new BadGatewayException('The marketplace could not be reached, so the payment was not submitted. Try again shortly.');
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // A refusal the school can act on -- a reference already used, an amount over the balance -- is
    // passed through with its message. A signature refusal or a server fault is not theirs to fix.
    if (response.status >= 400 && response.status < 500 && response.status !== 401) throw new HttpException(body.error || 'The marketplace refused this payment submission', response.status);
    if (!response.ok) throw new BadGatewayException(body.error || 'The marketplace could not record this payment submission');
    await this.sync().catch(() => undefined);
    return body;
  }

  async status() {
    const state = await this.prisma.marketplaceSchoolControl.findUnique({ where: { id: 'singleton' } });
    if (!state) return null;
    return {
      ...state,
      // So the billing page does not show a lock the outage rule has already lifted.
      lockLiftedByOutage: evaluateSchoolAccess(state, new Date()).lockLiftedByOutage,
      warnings: safeJson(state.warningsJson, []), billing: safeJson(state.billingJson, {}), marketplaceUrl: readMarketplaceIdentityConfig()?.marketplaceUrl || null,
    };
  }
}

function safeWarnings(value: string): Warning[] {
  try { const result = JSON.parse(value); return Array.isArray(result) ? result : []; } catch { return []; }
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Whether the synced bill shows a payment this school reported that finance has not yet decided. */
function hasPendingPayment(billingJson: string): boolean {
  const billing = safeJson<{ invoices?: Array<{ paymentSubmissions?: Array<{ status?: string }> } | null> }>(billingJson, {});
  return Array.isArray(billing.invoices) && billing.invoices.some(
    (invoice) => Array.isArray(invoice?.paymentSubmissions) && invoice!.paymentSubmissions!.some((submission) => submission?.status === 'PENDING'),
  );
}

/** Ids already surfaced, read back out of the previously stored billing summary so a notification
 * rings once rather than on every hourly sync for as long as the marketplace keeps returning it. */
function safeNotificationIds(value: string): string[] {
  const billing = safeJson<BillingSummary>(value, {});
  return Array.isArray(billing.notifications)
    ? billing.notifications.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
    : [];
}

/** Light checks with messages an administrator can act on. The marketplace validates authoritatively. */
function parsePaymentSubmission(value: unknown) {
  const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
  const invoiceId = text('invoiceId');
  const providerReference = text('providerReference');
  const amountMinor = body.amountMinor;
  if (!invoiceId) throw new BadRequestException('Choose the invoice you paid');
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Enter the amount you paid');
  if (providerReference.length < 3) throw new BadRequestException('Enter the transaction reference from your bank receipt');
  const receiptImage = typeof body.receiptImage === 'string' && body.receiptImage ? body.receiptImage : undefined;
  if (receiptImage && !/^data:image\/(png|jpeg|webp);base64,/.test(receiptImage)) throw new BadRequestException('The receipt must be a PNG, JPEG or WebP image');
  return { invoiceId, providerReference, amountMinor, paymentMethodId: text('paymentMethodId') || undefined, note: text('note') || undefined, receiptImage };
}
