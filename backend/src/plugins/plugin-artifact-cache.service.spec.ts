import { createHash } from 'crypto';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { PluginArtifactCacheService } from './plugin-artifact-cache.service';

describe('per-role plugin artifact cache', () => {
  const original = process.env;
  let roots: string[] = [];

  beforeEach(() => { process.env = { ...original, NODE_ENV: 'test', DATABASE_URL: 'postgresql://test', JWT_SECRET: 'test', MARKETPLACE_URL: 'https://marketplace.example' }; });
  afterEach(async () => { process.env = original; jest.restoreAllMocks(); await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); roots = []; });

  it('downloads, verifies and materializes the same digest independently for API and worker caches', async () => {
    const bytes = Buffer.from('immutable-wtp');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const verifier = {
      verify: jest.fn(async (value: Buffer) => {
        expect(createHash('sha256').update(value).digest('hex')).toBe(digest);
        return { packageSha256: digest, publisherKeyId: 'key', manifest: { id: 'wattanam.test', version: '1.0.0' }, files: new Map([['plugin.json', Buffer.from('{}')]]) };
      }),
      verifyInstalledDirectory: jest.fn(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }),
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200, ok: true, headers: new Headers({ 'content-length': String(bytes.length) }),
      body: { async *[Symbol.asyncIterator]() { yield bytes; } },
    } as any);

    for (const role of ['api', 'worker']) {
      const root = await mkdtemp(path.join(os.tmpdir(), `wattanam-${role}-`)); roots.push(root);
      process.env.PLUGIN_DIR = root; process.env.PROCESS_ROLE = role;
      const installedPath = path.join(root, 'wattanam.test', '1.0.0');
      const service = new PluginArtifactCacheService({} as any, verifier as any);
      const result = await service.ensure({ id: 'wattanam.test', version: '1.0.0', packageSha256: digest, installedPath });
      expect(result.cacheHit).toBe(false);
      expect(await readFile(path.join(installedPath, 'plugin.json'), 'utf8')).toBe('{}');
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses bytes that do not match their content address', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wattanam-cache-')); roots.push(root); process.env.PLUGIN_DIR = root;
    const expected = createHash('sha256').update('expected').digest('hex');
    const service = new PluginArtifactCacheService({} as any, {} as any);
    await service.seed(Buffer.from('corrupt'), expected).catch(() => undefined);
    await expect(service.seed(Buffer.from('corrupt'), expected)).rejects.toThrow('digest mismatch');
  });
});
