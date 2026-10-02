import { OUTAGE_UNLOCK_AFTER_MS, SchoolAccessService, evaluateSchoolAccess } from './school-access.service';

describe('evaluateSchoolAccess', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('leaves a school with no stored decision, or an active one, open', () => {
    expect(evaluateSchoolAccess(null, now)).toEqual({ suspended: false, reason: null, lockLiftedByOutage: false });
    expect(evaluateSchoolAccess({ access: 'ACTIVE', lastVerifiedAt: ago(1000) }, now).suspended).toBe(false);
  });

  it('locks on a stored suspension, carrying its reason', () => {
    expect(evaluateSchoolAccess({ access: 'SUSPENDED', reason: 'Invoice unpaid', lastVerifiedAt: ago(60_000) }, now))
      .toEqual({ suspended: true, reason: 'Invoice unpaid', lockLiftedByOutage: false });
  });

  // The seven-day rule, at its edge: "no successful sync for seven days" means more than seven.
  it('stays locked at exactly seven days without a sync', () => {
    expect(evaluateSchoolAccess({ access: 'SUSPENDED', lastVerifiedAt: ago(OUTAGE_UNLOCK_AFTER_MS) }, now).suspended).toBe(true);
  });

  it('lifts the lock a moment after seven days without a sync, and says why', () => {
    expect(evaluateSchoolAccess({ access: 'SUSPENDED', reason: 'Invoice unpaid', lastVerifiedAt: ago(OUTAGE_UNLOCK_AFTER_MS + 1) }, now))
      .toEqual({ suspended: false, reason: null, lockLiftedByOutage: true });
  });

  // Only a sync writes a suspension, and it always stamps the time; without one there is no outage to measure.
  it('takes a suspension with no verification time as it stands', () => {
    expect(evaluateSchoolAccess({ access: 'SUSPENDED', lastVerifiedAt: null }, now).suspended).toBe(true);
  });
});

describe('SchoolAccessService', () => {
  it('reads the stored decision once, then answers from its short cache', async () => {
    const findUnique = jest.fn().mockResolvedValue({ access: 'SUSPENDED', reason: 'Invoice unpaid', lastVerifiedAt: new Date() });
    const service = new SchoolAccessService({ marketplaceSchoolControl: { findUnique } } as any);
    await expect(service.isSuspended()).resolves.toBe(true);
    await expect(service.isSuspended()).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  // Students and parents see the lock screen; the school's debts are none of their business.
  it('tells the public lock screen only whether the school is locked and what it is called', async () => {
    const prisma = {
      marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue({ access: 'SUSPENDED', reason: 'Invoice WTN-1 unpaid: 50 USD', lastVerifiedAt: new Date() }) },
      installation: { findUnique: jest.fn().mockResolvedValue({ schoolName: 'Bora School' }) },
    } as any;
    const status = await new SchoolAccessService(prisma).publicStatus();
    expect(status).toEqual({ access: 'SUSPENDED', schoolName: 'Bora School' });
    expect(JSON.stringify(status)).not.toContain('USD');
  });

  it('reports an active school, and no name for a school not yet installed', async () => {
    const prisma = {
      marketplaceSchoolControl: { findUnique: jest.fn().mockResolvedValue(null) },
      installation: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    await expect(new SchoolAccessService(prisma).publicStatus()).resolves.toEqual({ access: 'ACTIVE', schoolName: null });
  });
});
