import { PluginNotificationQuotaService } from './plugin-notification-quota.service';

describe('PluginNotificationQuotaService', () => {
  const originalEnv = process.env.PLUGIN_NOTIFICATION_DAILY_LIMIT;
  afterEach(() => { process.env.PLUGIN_NOTIFICATION_DAILY_LIMIT = originalEnv; });

  it('allows a send under the default limit and reports the running count', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ count: 5 }]);
    const service = new PluginNotificationQuotaService({ $queryRawUnsafe: queryRawUnsafe } as any);
    delete process.env.PLUGIN_NOTIFICATION_DAILY_LIMIT;

    await expect(service.recordAndCheck('wattanam.test')).resolves.toEqual({ allowed: true, count: 5, limit: 200 });
    expect(queryRawUnsafe.mock.calls[0][0]).toMatch(/ON CONFLICT \("pluginId", "windowStart"\) DO UPDATE SET count = "PluginNotificationUsage"\.count \+ 1/);
  });

  it('denies once the count exceeds a configured limit', async () => {
    process.env.PLUGIN_NOTIFICATION_DAILY_LIMIT = '10';
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ count: 11 }]);
    const service = new PluginNotificationQuotaService({ $queryRawUnsafe: queryRawUnsafe } as any);

    await expect(service.recordAndCheck('wattanam.test')).resolves.toEqual({ allowed: false, count: 11, limit: 10 });
  });

  it('increments against the same UTC-day window regardless of local time-of-day', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ count: 1 }]);
    const service = new PluginNotificationQuotaService({ $queryRawUnsafe: queryRawUnsafe } as any);

    await service.recordAndCheck('wattanam.test', new Date('2026-08-28T23:59:59.000Z'));
    const [, , , windowStart] = queryRawUnsafe.mock.calls[0];
    expect(windowStart.toISOString()).toBe('2026-08-28T00:00:00.000Z');
  });
});
