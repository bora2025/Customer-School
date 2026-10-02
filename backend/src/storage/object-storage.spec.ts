import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DualWriteStorageProvider, LocalVolumeStorageProvider, ObjectStorageProvider } from './object-storage';
import { createPluginStorageProvider } from './storage-config';

describe('object storage providers', () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-storage-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('atomically stores, hashes, lists, reads, and deletes local objects', async () => {
    const provider = new LocalVolumeStorageProvider(directory);
    const stored = await provider.put('plugin/jobs/state.txt', Buffer.from('ready'));
    expect(stored.sha256).toHaveLength(64);
    await expect(provider.checksum('plugin/jobs/state.txt')).resolves.toBe(stored.sha256);
    await expect(provider.get('plugin/jobs/state.txt')).resolves.toEqual(Buffer.from('ready'));
    await expect(provider.list('plugin/')).resolves.toEqual([stored]);
    await provider.delete('plugin/jobs/state.txt');
    await expect(provider.get('plugin/jobs/state.txt')).resolves.toBeNull();
  });

  it('rejects traversal and filesystem-root configuration', async () => {
    const provider = new LocalVolumeStorageProvider(directory);
    expect(() => new LocalVolumeStorageProvider(path.parse(directory).root)).toThrow('filesystem root');
    await expect(provider.put('../escape', Buffer.from('bad'))).rejects.toThrow('invalid');
  });

  it('requires complete S3 configuration and HTTPS in production', () => {
    expect(() => createPluginStorageProvider({ NODE_ENV: 'test', PLUGIN_DATA_DIR: directory, PLUGIN_STORAGE_PROVIDER: 's3' })).toThrow('PLUGIN_STORAGE_S3_BUCKET');
    expect(() => createPluginStorageProvider({
      NODE_ENV: 'production', PLUGIN_DATA_DIR: directory, PLUGIN_STORAGE_PROVIDER: 's3',
      PLUGIN_STORAGE_S3_ENDPOINT: 'http://objects.example', PLUGIN_STORAGE_S3_BUCKET: 'school', PLUGIN_STORAGE_S3_REGION: 'auto',
      PLUGIN_STORAGE_S3_ACCESS_KEY_ID: 'access', PLUGIN_STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    })).toThrow('HTTPS');
    expect(() => createPluginStorageProvider({ NODE_ENV: 'production', PROCESS_ROLE: 'worker', PLUGIN_DATA_DIR: directory })).toThrow('shared S3');
    expect(() => createPluginStorageProvider({ NODE_ENV: 'test', PLUGIN_STORAGE_PROVIDER: 's3', PLUGIN_STORAGE_S3_BUCKET: 'school', PLUGIN_STORAGE_S3_REGION: 'auto', PLUGIN_STORAGE_S3_ACCESS_KEY_ID: 'only-one' })).toThrow('configured together');
  });

  it('dual-writes identical bytes and falls back to the secondary for reads', async () => {
    const primary = memoryProvider('primary'); const secondary = memoryProvider('secondary');
    const dual = new DualWriteStorageProvider(primary, secondary);
    const stored = await dual.put('a.txt', Buffer.from('same'));
    expect(await primary.checksum('a.txt')).toBe(stored.sha256);
    expect(await secondary.checksum('a.txt')).toBe(stored.sha256);
    await primary.delete('a.txt');
    await expect(dual.get('a.txt')).resolves.toEqual(Buffer.from('same'));
  });
});

function memoryProvider(kind: string): ObjectStorageProvider {
  const values = new Map<string, Buffer>();
  return {
    kind,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value) { values.set(key, Buffer.from(value)); const sha256 = require('node:crypto').createHash('sha256').update(value).digest('hex'); return { key, size: value.length, sha256 }; },
    async delete(key) { values.delete(key); },
    async list(prefix = '') { return [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.length, sha256: require('node:crypto').createHash('sha256').update(value).digest('hex') })); },
    async checksum(key) { const value = values.get(key); return value ? require('node:crypto').createHash('sha256').update(value).digest('hex') : null; },
  };
}
