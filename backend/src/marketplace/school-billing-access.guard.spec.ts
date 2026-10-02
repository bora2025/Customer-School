import { SchoolBillingAccessGuard } from './school-billing-access.guard';

function context(path: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ path }) }) } as any;
}

const accessWith = (state: { suspended: boolean; reason?: string | null; lockLiftedByOutage?: boolean }) =>
  ({ current: jest.fn().mockResolvedValue({ reason: null, lockLiftedByOutage: false, ...state }) }) as any;

describe('SchoolBillingAccessGuard', () => {
  it('blocks normal school APIs after verified billing suspension', async () => {
    const access = accessWith({ suspended: true, reason: 'Invoice unpaid' });
    await expect(new SchoolBillingAccessGuard(access).canActivate(context('/classes'))).rejects.toMatchObject({ status: 402 });
  });

  // After seven days without a sync the lock lifts: a Wattanam outage must never keep a school shut.
  it('lets normal school APIs through once the outage rule has lifted the lock', async () => {
    const access = accessWith({ suspended: false, lockLiftedByOutage: true });
    await expect(new SchoolBillingAccessGuard(access).canActivate(context('/classes'))).resolves.toBe(true);
  });

  it('keeps health, authentication, and billing recovery available during suspension', async () => {
    const access = accessWith({ suspended: true });
    const guard = new SchoolBillingAccessGuard(access);
    await expect(guard.canActivate(context('/health/ready'))).resolves.toBe(true);
    await expect(guard.canActivate(context('/auth/login'))).resolves.toBe(true);
    await expect(guard.canActivate(context('/auth/refresh'))).resolves.toBe(true);
    await expect(guard.canActivate(context('/admin/marketplace/billing-control/sync'))).resolves.toBe(true);
    expect(access.current).not.toHaveBeenCalled();
  });

  // The lock screen polls /school-access; the SUPER_ADMIN takes the records out through /admin/data-export.
  it("keeps the lock screen's status and the records download reachable during suspension", async () => {
    const access = accessWith({ suspended: true });
    const guard = new SchoolBillingAccessGuard(access);
    await expect(guard.canActivate(context('/school-access'))).resolves.toBe(true);
    await expect(guard.canActivate(context('/admin/data-export/students.csv'))).resolves.toBe(true);
    expect(access.current).not.toHaveBeenCalled();
  });

  it('does not let a path that merely starts with an allowed name through', async () => {
    const access = accessWith({ suspended: true });
    await expect(new SchoolBillingAccessGuard(access).canActivate(context('/school-accessories'))).rejects.toMatchObject({ status: 402 });
    await expect(new SchoolBillingAccessGuard(access).canActivate(context('/admin/data-exporter'))).rejects.toMatchObject({ status: 402 });
  });
});
