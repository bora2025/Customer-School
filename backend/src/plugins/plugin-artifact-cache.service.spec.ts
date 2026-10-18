import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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

    const shared = new Map<string, Buffer>();
    const storage = {
      kind: 'memory', get: jest.fn(async (key: string) => shared.get(key) || null),
      put: jest.fn(async (key: string, value: Buffer) => { shared.set(key, value); return { key, size: value.length, sha256: digest }; }),
      checksum: jest.fn(async (key: string) => shared.has(key) ? digest : null), delete: jest.fn(), list: jest.fn(),
    } as any;
    for (const role of ['api', 'worker']) {
      const root = await mkdtemp(path.join(os.tmpdir(), `wattanam-${role}-`)); roots.push(root);
      process.env.PLUGIN_DIR = root; process.env.PROCESS_ROLE = role;
      const installedPath = path.join(root, 'wattanam.test', '1.0.0');
      const service = new PluginArtifactCacheService({} as any, verifier as any, storage);
      const result = await service.ensure({ id: 'wattanam.test', version: '1.0.0', packageSha256: digest, installedPath });
      expect(result.cacheHit).toBe(false);
      expect(await readFile(path.join(installedPath, 'plugin.json'), 'utf8')).toBe('{}');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('refuses bytes that do not match their content address', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wattanam-cache-')); roots.push(root); process.env.PLUGIN_DIR = root;
    const expected = createHash('sha256').update('expected').digest('hex');
    const service = new PluginArtifactCacheService({} as any, {} as any);
    await service.seed(Buffer.from('corrupt'), expected).catch(() => undefined);
    await expect(service.seed(Buffer.from('corrupt'), expected)).rejects.toThrow('digest mismatch');
  });

  it('never asks a worker with an independent identity volume to download a missing paid artifact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wattanam-worker-cache-')); roots.push(root);
    process.env.PLUGIN_DIR = root; process.env.PROCESS_ROLE = 'worker';
    const fetchSpy = jest.spyOn(global, 'fetch');
    const storage = { kind: 'memory', get: jest.fn(async () => null), checksum: jest.fn(async () => null), put: jest.fn(), delete: jest.fn(), list: jest.fn() } as any;
    const digest = createHash('sha256').update('missing').digest('hex');
    const service = new PluginArtifactCacheService({} as any, {} as any, storage);
    await expect(service.ensure({ id: 'wattanam.test', version: '1.0.0', packageSha256: digest, installedPath: path.join(root, 'wattanam.test', '1.0.0') })).rejects.toThrow('API must authenticate');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-seeds shared storage from a restored API cache without contacting Marketplace', async () => {
    const bytes = Buffer.from('restored-paid-artifact');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const root = await mkdtemp(path.join(os.tmpdir(), 'wattanam-restored-api-cache-')); roots.push(root);
    process.env.PLUGIN_DIR = root; process.env.PROCESS_ROLE = 'api';
    const cacheFile = path.join(root, '.artifact-cache', 'sha256', digest.slice(0, 2), `${digest}.wtp`);
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes);
    const storage = { kind: 'memory', get: jest.fn(async () => null), checksum: jest.fn(async () => null), put: jest.fn(async (key: string, value: Buffer) => ({ key, size: value.length, sha256: digest })), delete: jest.fn(), list: jest.fn() } as any;
    const verifier = { verify: jest.fn(async () => ({ manifest: { id: 'wattanam.test', version: '1.0.0' }, files: new Map([['plugin.json', Buffer.from('{}')]]) })), verifyInstalledDirectory: jest.fn(async () => { throw new Error('restore materialization required'); }) } as any;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new PluginArtifactCacheService({} as any, verifier, storage);
    await expect(service.ensure({ id: 'wattanam.test', version: '1.0.0', packageSha256: digest, installedPath: path.join(root, 'wattanam.test', '1.0.0') })).resolves.toMatchObject({ cacheHit: true });
    expect(storage.put).toHaveBeenCalledWith(expect.stringContaining(digest), bytes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
