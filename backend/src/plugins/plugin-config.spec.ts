import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { applyPluginKeyRevocations, recordMarketplaceRevokedKeys, recordMarketplaceTrustedKey, revokedPluginKeys, trustedPluginKeys } from './plugin-config';

describe('database-backed marketplace publisher trust', () => {
  const original = process.env;
  let apiDirectory: string;
  let workerDirectory: string;

  beforeEach(async () => {
    apiDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-api-trust-'));
    workerDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-worker-trust-'));
    process.env = { ...original, NODE_ENV: 'test', PLUGIN_DIR: apiDirectory, PLUGIN_TRUSTED_KEYS: '{}' };
  });

  afterEach(async () => {
    process.env = original;
    await Promise.all([apiDirectory, workerDirectory].map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it('lets an independent worker volume verify a key learned by the API', async () => {
    let row: { valueJson: string } | undefined;
    const store = {
      pluginSetting: {
        findMany: jest.fn(async (args: any) => args.where.pluginId === '__wattanam_host_marketplace_trust__' && row ? [row] : []),
        upsert: jest.fn(async (args: any) => { row = { valueJson: args.create.valueJson }; return row; }),
      },
    };
    const publicKeyPem = '-----BEGIN PUBLIC KEY-----\ntest-key\n-----END PUBLIC KEY-----';

    await recordMarketplaceTrustedKey('wattanam', 'official-2026', publicKeyPem, store);
    process.env.PLUGIN_DIR = workerDirectory;

    await expect(trustedPluginKeys(store)).resolves.toEqual({ wattanam: { 'official-2026': publicKeyPem } });
    await expect(fs.access(path.join(workerDirectory, '.marketplace-trusted-keys.json'))).rejects.toThrow();
  });

  it('fails closed when a database trust record is malformed', async () => {
    const store = { pluginSetting: { findMany: jest.fn(async (args: any) => args.where.pluginId === '__wattanam_host_marketplace_trust__' ? [{ valueJson: '{"publisher":"../unsafe"}' }] : []), upsert: jest.fn() } };
    await expect(trustedPluginKeys(store)).rejects.toThrow('trust record is invalid');
  });

  it('adopts a legacy single-volume trust file into the shared database', async () => {
    const publicKeyPem = '-----BEGIN PUBLIC KEY-----\nlegacy-key\n-----END PUBLIC KEY-----';
    await fs.writeFile(path.join(apiDirectory, '.marketplace-trusted-keys.json'), JSON.stringify({ wattanam: { legacy: publicKeyPem } }));
    const upsert = jest.fn(async () => ({}));
    const store = { pluginSetting: { findMany: jest.fn(async () => []), upsert } };
    await expect(trustedPluginKeys(store)).resolves.toEqual({ wattanam: { legacy: publicKeyPem } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ pluginId: '__wattanam_host_marketplace_trust__', key: 'wattanam:legacy' }) }));
  });

  it('applies a revoked key after static and persisted trust are merged', async () => {
    process.env.PLUGIN_TRUSTED_KEYS = JSON.stringify({ wattanam: { compromised: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----' } });
    process.env.PLUGIN_REVOKED_PUBLISHER_KEYS_JSON = JSON.stringify({ wattanam: ['compromised'] });
    const keys = await trustedPluginKeys();
    expect(keys.wattanam.compromised).toBe('__WATTANAM_REVOKED_PLUGIN_KEY__');
  });

  it('cannot reintroduce a revoked key through a marketplace release merge', () => {
    const env = { PLUGIN_REVOKED_PUBLISHER_KEYS_JSON: '["wattanam:compromised"]' } as NodeJS.ProcessEnv;
    const keys = applyPluginKeyRevocations({ wattanam: { compromised: 'public-key' } }, env);
    expect(keys.wattanam.compromised).toBe('__WATTANAM_REVOKED_PLUGIN_KEY__');
    expect(revokedPluginKeys(env)).toEqual(new Set(['wattanam:compromised']));
  });

  it('rejects malformed revocation configuration', () => {
    expect(() => revokedPluginKeys({ PLUGIN_REVOKED_PUBLISHER_KEYS_JSON: '["unsafe"]' } as NodeJS.ProcessEnv)).toThrow('Revoked plugin key configuration is invalid');
  });

  it('persists signed marketplace revocations and applies them across runtime roles', async () => {
    const rows: Array<{ valueJson: string; pluginId: string }> = [];
    const store = { pluginSetting: {
      findMany: jest.fn(async (args: any) => rows.filter((row) => row.pluginId === args.where.pluginId)),
      upsert: jest.fn(async (args: any) => { rows.push({ pluginId: args.create.pluginId, valueJson: args.create.valueJson }); return args.create; }),
    } };
    await recordMarketplaceTrustedKey('wattanam', 'compromised', '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----', store);
    await recordMarketplaceRevokedKeys(['wattanam:compromised'], store);
    await expect(trustedPluginKeys(store)).resolves.toMatchObject({ wattanam: { compromised: '__WATTANAM_REVOKED_PLUGIN_KEY__' } });
  });
});
