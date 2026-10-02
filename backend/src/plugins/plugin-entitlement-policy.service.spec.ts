import { PluginEntitlementPolicyService } from './plugin-entitlement-policy.service';

describe('PluginEntitlementPolicyService', () => {
  const now = new Date('2026-09-25T00:00:00.000Z');
  const row = (overrides: Record<string, unknown> = {}) => ({
    status: 'ACTIVE', expiresAt: new Date('2026-10-25T00:00:00.000Z'),
    updatesThrough: new Date('2026-10-10T00:00:00.000Z'),
    offlineRecheckAfter: new Date('2026-10-01T00:00:00.000Z'), ...overrides,
  });
  const service = (value: unknown) => new PluginEntitlementPolicyService({
    pluginEntitlementCache: { findUnique: jest.fn().mockResolvedValue(value) },
  } as any);

  it('does not licence-gate free or subscription-included plugins', async () => {
    await expect(service(null).decision('wattanam.academic-management', now)).resolves.toMatchObject({ mode: 'unmanaged' });
    await expect(service(row({ status: 'NONE', expiresAt: null })).assertCanActivate('wattanam.free', now)).resolves.toMatchObject({ mode: 'unmanaged' });
  });

  it('keeps a last-known-good entitlement writable during offline refresh grace', async () => {
    const policy = service(row({ offlineRecheckAfter: new Date('2026-09-24T00:00:00.000Z') }));
    await expect(policy.assertRouteAllowed('wattanam.paid', 'POST', now)).resolves.toMatchObject({ mode: 'grace' });
    await expect(policy.jobsAllowed('wattanam.paid', now)).resolves.toBe(true);
  });

  it('allows reads but blocks writes, jobs and activation after expiry', async () => {
    const policy = service(row({ expiresAt: new Date('2026-09-24T00:00:00.000Z') }));
    await expect(policy.assertRouteAllowed('wattanam.paid', 'GET', now)).resolves.toMatchObject({ mode: 'read_only' });
    await expect(policy.assertRouteAllowed('wattanam.paid', 'PATCH', now)).rejects.toMatchObject({ status: 402 });
    await expect(policy.jobsAllowed('wattanam.paid', now)).resolves.toBe(false);
    await expect(policy.assertCanActivate('wattanam.paid', now)).rejects.toThrow('read-only');
  });

  it('blocks updates after updatesThrough without disabling the active plugin', async () => {
    const policy = service(row({ updatesThrough: new Date('2026-09-24T00:00:00.000Z') }));
    await expect(policy.assertCanUpdate('wattanam.paid', now)).rejects.toThrow('cannot update');
    await expect(policy.assertRouteAllowed('wattanam.paid', 'POST', now)).resolves.toMatchObject({ mode: 'active' });
  });
});
