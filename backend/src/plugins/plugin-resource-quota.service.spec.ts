import { PluginResourceQuotaService } from './plugin-resource-quota.service';

describe('PluginResourceQuotaService', () => {
  const original = process.env;
  afterEach(() => { process.env = original; });

  it('isolates minute windows by plugin and resource', () => {
    process.env = { ...original, PLUGIN_REQUEST_QUOTA_PER_MINUTE: '1' };
    const quota = new PluginResourceQuotaService();
    expect(quota.consume('one', 'request', 1)).toEqual({ count: 1, limit: 1 });
    expect(() => quota.consume('one', 'request', 2)).toThrow('request quota');
    expect(quota.consume('two', 'request', 2)).toEqual({ count: 1, limit: 1 });
    expect(quota.consume('one', 'request', 60_002)).toEqual({ count: 1, limit: 1 });
  });

  it('bounds concurrent jobs and releases capacity', () => {
    process.env = { ...original, PLUGIN_JOB_QUOTA_PER_PLUGIN: '1' };
    const quota = new PluginResourceQuotaService();
    const leave = quota.enterJob('one');
    expect(() => quota.enterJob('one')).toThrow('concurrent job quota');
    leave(); expect(quota.enterJob('one')).toBeInstanceOf(Function);
  });
});
