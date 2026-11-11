import { MetricsService } from './metrics.service';

// The restore drill runs on the worker; these metrics are served by the API, which has no drill
// settings. Production showed "restore drill is not configured" although the drill had passed.
describe('MetricsService restore-drill metrics', () => {
  async function gauge(drill: Record<string, unknown> | undefined, name = 'recovery_drill_configured') {
    const service = new MetricsService({} as any, {} as any, drill as any);
    service.onModuleInit();
    const metric = await (service as any).registry.getSingleMetric(name).get();
    return metric.values[0]?.value;
  }

  it('is configured on the worker, from its own settings', async () => {
    expect(await gauge({ configured: () => true, lastAttempt: jest.fn() })).toBe(1);
  });

  it('is configured on the API when the worker has written drill evidence off-site', async () => {
    const lastAttempt = jest.fn().mockResolvedValue({ passed: true, completedAt: '2026-11-11T03:31:00Z' });
    expect(await gauge({ configured: () => false, lastAttempt })).toBe(1);
    expect(lastAttempt).toHaveBeenCalled();
  });

  it('is not configured when no drill evidence exists or it cannot be read', async () => {
    expect(await gauge({ configured: () => false, lastAttempt: jest.fn().mockResolvedValue(null) })).toBe(0);
    expect(await gauge({ configured: () => false, lastAttempt: jest.fn().mockRejectedValue(new Error('bucket down')) })).toBe(0);
    expect(await gauge(undefined)).toBe(0);
  });
});
