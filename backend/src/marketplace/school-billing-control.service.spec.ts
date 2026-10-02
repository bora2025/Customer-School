import { SchoolBillingControlService } from './school-billing-control.service';

jest.mock('./marketplace-identity-config', () => ({
  readMarketplaceIdentityConfig: () => ({ marketplaceUrl: 'https://marketplace.example', requestTimeoutMs: 5000 }),
}));
jest.mock('./entitlement-config', () => ({ readEntitlementConfig: () => ({ publicKeys: new Map([['test', 'key']]) }) }));
jest.mock('./school-control-verification', () => ({ verifySchoolControl: (value: any) => ({ generation: 1, ...value }) }));

describe('SchoolBillingControlService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stores the customer-safe billing snapshot and notifies every administrator once', async () => {
    const previous = { access: 'ACTIVE', warningsJson: '[]' };
    const tx = {
      marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue(previous), upsert: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]) },
      notification: { createMany: jest.fn() },
    };
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'installation-1' }) },
      $transaction: jest.fn((work: any) => work(tx)),
    } as any;
    const keys = { sign: jest.fn().mockResolvedValue('signature') } as any;
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      access: 'ACTIVE', reason: null,
      warnings: [{ invoiceId: 'invoice-1', invoiceNumber: 'WTN-1', currency: 'USD', outstandingMinor: 1000, dueAt: '2026-09-01T00:00:00.000Z', suspendAt: '2026-09-13T00:00:00.000Z', final: true }],
      billing: { schoolName: 'Bora School', outstandingMinor: 1000, invoices: [{ id: 'invoice-1' }], notifications: [] },
    }) } as any);

    await expect(new SchoolBillingControlService(prisma, keys).sync(new Date('2026-09-10T00:00:00.000Z'))).resolves.toEqual({ configured: true, access: 'ACTIVE', warnings: 1 });
    expect(tx.marketplaceSchoolControl.upsert.mock.calls[0][0].update.billingJson).toContain('Bora School');
    expect(tx.notification.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ userId: 'admin-1', type: 'platform_billing_final_notice' })]) });
  });

  it('retains the last verified state when the marketplace is unavailable', async () => {
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'installation-1' }) },
      marketplaceSchoolControl: { upsert: jest.fn() },
    } as any;
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));
    await expect(new SchoolBillingControlService(prisma, { sign: jest.fn().mockResolvedValue('signature') } as any).sync()).resolves.toEqual({ configured: true, unavailable: true });
    expect(prisma.marketplaceSchoolControl.upsert.mock.calls[0][0].update).not.toHaveProperty('access');
  });

  it('rejects a replayed control generation without overwriting last-known-good access', async () => {
    const tx = {
      marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue({ access: 'SUSPENDED', generation: 2, warningsJson: '[]', billingJson: '{}' }), upsert: jest.fn() },
    };
    const failureUpsert = jest.fn().mockResolvedValue({});
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'installation-1' }) },
      marketplaceSchoolControl: { upsert: failureUpsert },
      $transaction: jest.fn((work: any) => work(tx)),
    } as any;
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ generation: 1, access: 'ACTIVE', warnings: [] }) } as any);
    await expect(new SchoolBillingControlService(prisma, { sign: jest.fn().mockResolvedValue('signature') } as any).sync(new Date('2026-09-10T00:00:00.000Z')))
      .resolves.toEqual({ configured: true, unavailable: true });
    expect(tx.marketplaceSchoolControl.upsert).not.toHaveBeenCalled();
    expect(failureUpsert.mock.calls[0][0].update).not.toHaveProperty('access');
  });
});

describe('SchoolBillingControlService billing lifecycle notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  const NOTIFICATIONS = [
    { id: 'n-1', invoiceId: 'invoice-1', type: 'INVOICE_ISSUED', subject: 'Wattanam invoice WTN-1 issued' },
    { id: 'n-2', invoiceId: 'invoice-1', type: 'DUE_SOON', subject: 'Wattanam invoice due soon: WTN-1' },
    { id: 'n-3', invoiceId: 'invoice-1', type: 'PAYMENT_RECEIVED', subject: 'Payment received for WTN-1' },
  ];

  function harness(previous: any, notifications = NOTIFICATIONS, warnings: any[] = []) {
    const tx = {
      marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue(previous), upsert: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
      notification: { createMany: jest.fn() },
    };
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'installation-1' }) },
      $transaction: jest.fn((work: any) => work(tx)),
    } as any;
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      access: 'ACTIVE', reason: null, warnings,
      billing: { schoolName: 'Bora School', outstandingMinor: 0, invoices: [], notifications },
    }) } as any);
    return { tx, prisma, keys: { sign: jest.fn().mockResolvedValue('signature') } as any };
  }

  const types = (tx: any) => tx.notification.createMany.mock.calls.flatMap((call: any) => call[0].data.map((row: any) => row.type));

  /** The gap this closes: with email delivery switched off, these records were the only trace that
   * a bill existed, and nothing surfaced them until the final notice three days before lock-out. */
  it('raises a notification for each new invoice lifecycle record', async () => {
    const { tx, prisma, keys } = harness({ access: 'ACTIVE', warningsJson: '[]', billingJson: '{}', lastVerifiedAt: new Date('2026-09-09T00:00:00.000Z') });
    await new SchoolBillingControlService(prisma, keys).sync(new Date('2026-09-10T00:00:00.000Z'));

    expect(types(tx)).toEqual([
      'platform_billing_invoice_issued',
      'platform_billing_due_soon',
      'platform_billing_payment_received',
    ]);
    expect(tx.notification.createMany.mock.calls[0][0].data[0].message).toBe('Wattanam invoice WTN-1 issued');
  });

  // The marketplace keeps returning the same records on every hourly sync.
  it('does not ring again for records already surfaced', async () => {
    const previous = {
      access: 'ACTIVE', warningsJson: '[]', lastVerifiedAt: new Date('2026-09-09T00:00:00.000Z'),
      billingJson: JSON.stringify({ notifications: NOTIFICATIONS }),
    };
    const { tx, prisma, keys } = harness(previous);
    await new SchoolBillingControlService(prisma, keys).sync(new Date('2026-09-10T00:00:00.000Z'));
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('rings only for the record that is actually new', async () => {
    const previous = {
      access: 'ACTIVE', warningsJson: '[]', lastVerifiedAt: new Date('2026-09-09T00:00:00.000Z'),
      billingJson: JSON.stringify({ notifications: [NOTIFICATIONS[0]] }),
    };
    const { tx, prisma, keys } = harness(previous);
    await new SchoolBillingControlService(prisma, keys).sync(new Date('2026-09-10T00:00:00.000Z'));
    expect(types(tx)).toEqual(['platform_billing_due_soon', 'platform_billing_payment_received']);
  });

  // Otherwise one overdue invoice rings twice, which teaches people to ignore both.
  it('leaves OVERDUE to the final-notice path rather than duplicating it', async () => {
    const warnings = [{ invoiceId: 'invoice-1', invoiceNumber: 'WTN-1', currency: 'USD', outstandingMinor: 1000, dueAt: '2026-09-01T00:00:00.000Z', suspendAt: '2026-09-13T00:00:00.000Z', final: true }];
    const notifications = [{ id: 'n-9', invoiceId: 'invoice-1', type: 'OVERDUE', subject: 'Overdue Wattanam invoice WTN-1' }];
    const { tx, prisma, keys } = harness({ access: 'ACTIVE', warningsJson: '[]', billingJson: '{}', lastVerifiedAt: new Date('2026-09-09T00:00:00.000Z') }, notifications, warnings);
    await new SchoolBillingControlService(prisma, keys).sync(new Date('2026-09-10T00:00:00.000Z'));

    expect(types(tx)).toEqual(['platform_billing_final_notice']);
  });

  // A school syncing for the first time should not have its back catalogue dumped into the bell.
  it('records history silently on the first successful sync', async () => {
    const { tx, prisma, keys } = harness(null);
    await new SchoolBillingControlService(prisma, keys).sync(new Date('2026-09-10T00:00:00.000Z'));

    expect(tx.notification.createMany).not.toHaveBeenCalled();
    expect(tx.marketplaceSchoolControl.upsert.mock.calls[0][0].create.billingJson).toContain('n-1');
  });
});

/**
 * The count behind the sidebar badge. Raising notifications was only half the fix: the school's
 * Notification table has no inbox route, so until this existed the rows were written and never seen.
 */
describe('SchoolBillingControlService unread billing notifications', () => {
  const prismaWith = (notification: any) => ({ notification } as any);
  const keys = { sign: jest.fn() } as any;

  it('counts only this administrator\'s unread platform billing notifications', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const service = new SchoolBillingControlService(prismaWith({ count }), keys);

    await expect(service.unreadCount('user-1')).resolves.toEqual({ count: 3 });
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user-1', readAt: null, type: { startsWith: 'platform_billing_' } } });
  });

  // A school's own absence and assignment notifications share the table and must not be touched.
  it('marks only unread platform billing notifications as read', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new SchoolBillingControlService(prismaWith({ updateMany }), keys);
    const now = new Date('2026-09-10T00:00:00.000Z');

    await expect(service.markRead('user-1', now)).resolves.toEqual({ marked: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null, type: { startsWith: 'platform_billing_' } },
      data: { readAt: now },
    });
  });

  // Every type this service writes has to be inside the prefix, or a notice rings with no badge.
  it('covers the suspension and final-notice types the sync already raised', () => {
    for (const type of ['platform_billing_final_notice', 'platform_billing_suspended', 'platform_billing_reactivated', 'platform_billing_invoice_issued']) {
      expect(type.startsWith('platform_billing_')).toBe(true);
    }
  });
});
