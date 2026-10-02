import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PluginStorageService } from './plugin-storage.service';
import { LocalVolumeStorageProvider } from '../storage/object-storage';

describe('PluginStorageService', () => {
  const original = process.env;
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-plugin-data-')); process.env = { ...original, PLUGIN_DATA_DIR: directory }; });
  afterEach(async () => { process.env = original; await fs.rm(directory, { recursive: true, force: true }); });

  it('reads, lists, and deletes files only inside a plugin namespace', async () => {
    const service = new PluginStorageService(new LocalVolumeStorageProvider(directory));
    await service.writeText('wattanam.test', 'jobs/state.txt', 'ready');
    await expect(service.readText('wattanam.test', 'jobs/state.txt')).resolves.toBe('ready');
    await expect(service.readText('wattanam.other', 'jobs/state.txt')).resolves.toBeNull();
    await expect(service.list('wattanam.test')).resolves.toEqual(['jobs/state.txt']);
    await service.delete('wattanam.test', 'jobs/state.txt');
    await expect(service.readText('wattanam.test', 'jobs/state.txt')).resolves.toBeNull();
  });

  it('rejects traversal and oversized content', async () => {
    const service = new PluginStorageService(new LocalVolumeStorageProvider(directory));
    await expect(service.writeText('wattanam.test', '../escape', 'bad')).rejects.toThrow('invalid');
    process.env.PLUGIN_STORAGE_MAX_FILE_BYTES = '3';
    await expect(service.writeText('wattanam.test', 'large.txt', 'four')).rejects.toThrow('limit');
  });

  it('round-trips bounded binary data without crossing plugin namespaces', async () => {
    const service = new PluginStorageService(new LocalVolumeStorageProvider(directory));
    const encoded = Buffer.from([0, 1, 2, 250, 255]).toString('base64');
    await service.writeBinary('wattanam.test', 'uploads/sample.bin', encoded);
    await expect(service.readBinary('wattanam.test', 'uploads/sample.bin')).resolves.toBe(encoded);
    await expect(service.readBinary('wattanam.other', 'uploads/sample.bin')).resolves.toBeNull();
    await expect(service.writeBinary('wattanam.test', 'uploads/bad.bin', 'not base64!')).rejects.toThrow('base64');
  });

  it('enforces a total quota across a plugin storage namespace', async () => {
    process.env.PLUGIN_STORAGE_MAX_FILE_BYTES = '10';
    process.env.PLUGIN_STORAGE_MAX_TOTAL_BYTES = '5';
    const service = new PluginStorageService(new LocalVolumeStorageProvider(directory));
    await service.writeText('wattanam.test', 'one', '123');
    await expect(service.writeText('wattanam.test', 'two', '456')).rejects.toThrow('total quota');
    await service.writeText('wattanam.test', 'one', '12345');
  });
});
