jest.mock('./marketplace-identity-config', () => ({
  readMarketplaceIdentityConfig: () => ({ marketplaceUrl: 'https://marketplace.example', requestTimeoutMs: 5000 }),
}));

import { Logger } from '@nestjs/common';
import { OUTAGE_UNLOCK_AFTER_MS } from './school-access.service';
import { SchoolBillingControlService } from './school-billing-control.service';

jest.mock('./entitlement-config', () => ({ readEntitlementConfig: () => ({ publicKeys: new Map([['test', 'key']]) }) }));

const keys = { sign: jest.fn().mockResolvedValue('signature') } as any;

/** Unlocking within minutes: the sync that runs every five minutes, but only when there is reason to. */
describe('SchoolBillingControlService.syncWhileLocked', () => {
  afterEach(() => jest.restoreAllMocks());

  function harness(state: { access: string; billingJson: string } | null) {
    const prisma = { marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue(state) } } as any;
    const service = new SchoolBillingControlService(prisma, keys);
    const sync = jest.spyOn(service, 'sync').mockResolvedValue({ configured: true } as any);
    return { service, sync };
  }

  it('checks with the marketplace while the school is locked', async () => {
    const { service, sync } = harness({ access: 'SUSPENDED', billingJson: '{}' });
    await service.syncWhileLocked();
    expect(sync).toHaveBeenCalled();
  });

  // Finance may confirm it at any moment; the school should not wait an hour to see the result.
  it('checks while a payment the school reported awaits confirmation', async () => {
    const billingJson = JSON.stringify({ invoices: [{ id: 'invoice-1', paymentSubmissions: [{ id: 'p1', status: 'PENDING' }] }] });
    const { service, sync } = harness({ access: 'ACTIVE', billingJson });
    await service.syncWhileLocked();
    expect(sync).toHaveBeenCalled();
  });

  it('leaves an active school with nothing pending to the hourly sync', async () => {
    const billingJson = JSON.stringify({ invoices: [{ id: 'invoice-1', paymentSubmissions: [{ id: 'p1', status: 'CONFIRMED' }] }, null] });
    const { service, sync } = harness({ access: 'ACTIVE', billingJson });
    await expect(service.syncWhileLocked()).resolves.toEqual({ skipped: true });
    expect(sync).not.toHaveBeenCalled();
  });

  it('does nothing for a school that has never synced', async () => {
    const { service, sync } = harness(null);
    await expect(service.syncWhileLocked()).resolves.toEqual({ skipped: true });
    expect(sync).not.toHaveBeenCalled();
  });
});

/** Seven days without contact lifts the lock; the administrators and Wattanam operations are told once. */
describe('SchoolBillingControlService and the outage rule', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  afterEach(() => jest.restoreAllMocks());

  function harness(lastVerifiedAt: Date, alreadyNotified = false) {
    const prisma = {
      installation: { findUnique: jest.fn().mockResolvedValue({ installationId: 'installation-1' }) },
      marketplaceSchoolControl: {
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ access: 'SUSPENDED', reason: 'Invoice unpaid', lastVerifiedAt }),
      },
      notification: { findFirst: jest.fn().mockResolvedValue(alreadyNotified ? { id: 'n-1' } : null), createMany: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'owner-1' }, { id: 'admin-1' }]) },
    } as any;
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('marketplace unreachable'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    return { prisma, error, service: new SchoolBillingControlService(prisma, keys) };
  }

  it('tells every administrator, and logs an error, when a failed sync finds the lock lifted', async () => {
    const { prisma, error, service } = harness(new Date(now.getTime() - OUTAGE_UNLOCK_AFTER_MS - 60_000));
    await expect(service.sync(now)).resolves.toEqual({ configured: true, unavailable: true });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ userId: 'owner-1', type: 'platform_billing_outage_unlocked' }),
      expect.objectContaining({ userId: 'admin-1', type: 'platform_billing_outage_unlocked' }),
    ] });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('the billing lock is lifted'));
  });

  // The hourly sync keeps failing through an outage; the bell should ring once, not every hour.
  it('does not ring again on the next failed sync', async () => {
    const { prisma, service } = harness(new Date(now.getTime() - OUTAGE_UNLOCK_AFTER_MS - 60_000), true);
    await service.sync(now);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('says nothing while the lock is still inside its seven days', async () => {
    const { prisma, error, service } = harness(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));
    await service.sync(now);
    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  // Otherwise the billing page would announce a lock the school no longer has.
  it('reports on the billing page when the outage rule has lifted the lock', async () => {
    const prisma = { marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue({
      access: 'SUSPENDED', reason: 'Invoice unpaid', warningsJson: '[]', billingJson: '{}', lastVerifiedAt: new Date(Date.now() - OUTAGE_UNLOCK_AFTER_MS - 60_000),
    }) } } as any;
    await expect(new SchoolBillingControlService(prisma, keys).status()).resolves.toMatchObject({ access: 'SUSPENDED', lockLiftedByOutage: true });
  });
});
