import { applyPluginDatabasePolicy, pluginDatabasePolicy } from './plugin-database-policy';

describe('plugin database policy', () => {
  afterEach(() => {
    delete process.env.PLUGIN_SQL_STATEMENT_TIMEOUT_MS;
    delete process.env.PLUGIN_SQL_LOCK_TIMEOUT_MS;
  });

  it('applies bounded transaction-local statement and lock timeouts', async () => {
    const client = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any;
    await applyPluginDatabasePolicy(client, 'runtime');
    expect(client.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("set_config('statement_timeout'"), '5000ms', '1000ms');
  });

  it('rejects unsafe timeout configuration', () => {
    process.env.PLUGIN_SQL_STATEMENT_TIMEOUT_MS = '0';
    expect(() => pluginDatabasePolicy('runtime')).toThrow('PLUGIN_SQL_STATEMENT_TIMEOUT_MS');
  });
});
