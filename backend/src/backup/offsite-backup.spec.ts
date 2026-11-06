import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { ObjectStorageProvider, StoredObject } from '../storage/object-storage';
import { decryptOffsite, encryptOffsite, OffsiteBackupUploader, readOffsiteBackupConfig } from './offsite-backup';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchSet } = require('../../scripts/fetch-offsite-backup.js');

class MemoryStorage implements ObjectStorageProvider {
  readonly kind = 'memory';
  readonly objects = new Map<string, Buffer>();
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, value: Buffer) { this.objects.set(key, Buffer.from(value)); return { key, size: value.length, sha256: '' }; }
  async delete(key: string) { this.objects.delete(key); }
  async list(prefix = ''): Promise<StoredObject[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key, size: this.objects.get(key)!.length, sha256: '' }));
  }
  async checksum() { return null; }
}

const key = randomBytes(32);

async function recoverySet(directory: string, stamp: string) {
  const journal = {
    journalFile: `wattanam-recovery-${stamp}.recovery-set.json`,
    createdAt: new Date(stamp.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3')).toISOString(),
    database: { file: `wattanam-${stamp}.dump` },
    pluginFiles: { archive: { file: `wattanam-${stamp}.plugins.tar` } },
    pluginData: { archive: { file: `wattanam-${stamp}.plugin-data.tar` } },
  };
  await fs.writeFile(path.join(directory, journal.database.file), Buffer.from(`student records ${stamp}`));
  await fs.writeFile(path.join(directory, journal.pluginFiles.archive.file), randomBytes(2048));
  await fs.writeFile(path.join(directory, journal.pluginData.archive.file), randomBytes(1024));
  await fs.writeFile(path.join(directory, journal.journalFile), JSON.stringify(journal));
  return journal;
}

describe('off-site recovery-set backups', () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'offsite-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it('encrypts so the bucket never holds plaintext, and detects tampering', () => {
    const sealed = encryptOffsite(Buffer.from('student records'), key);
    expect(sealed.includes(Buffer.from('student records'))).toBe(false);
    expect(decryptOffsite(sealed, key).toString()).toBe('student records');
    sealed[sealed.length - 20] ^= 1;
    expect(() => decryptOffsite(sealed, key)).toThrow();
    expect(() => decryptOffsite(encryptOffsite(Buffer.from('x'), key), randomBytes(32))).toThrow();
  });

  it('uploads a complete set and the restore script recovers identical bytes', async () => {
    const storage = new MemoryStorage();
    const uploader = new OffsiteBackupUploader({ storage, key, retentionDays: 35 });
    const journal = await recoverySet(directory, '2026-11-06T02-00-00');
    const record = await uploader.upload(directory, journal);

    expect(record.files.map((file) => file.name)).toEqual([journal.database.file, journal.pluginFiles.archive.file, journal.pluginData.archive.file, journal.journalFile]);
    expect((await uploader.latest())?.setId).toBe('wattanam-recovery-2026-11-06T02-00-00');
    for (const [objectKey, value] of storage.objects) {
      if (objectKey.endsWith('.enc')) expect(value.includes(Buffer.from('student records'))).toBe(false);
    }

    const out = path.join(directory, 'restored');
    await fetchSet({ get: (objectKey: string) => storage.get(objectKey), key, out });
    for (const file of record.files) {
      expect(await fs.readFile(path.join(out, file.name))).toEqual(await fs.readFile(path.join(directory, file.name)));
    }
  });

  it('restore refuses a corrupted object instead of writing bad data', async () => {
    const storage = new MemoryStorage();
    const journal = await recoverySet(directory, '2026-11-06T02-00-00');
    const record = await new OffsiteBackupUploader({ storage, key, retentionDays: 35 }).upload(directory, journal);
    const dumpKey = record.files[0].key;
    const corrupted = Buffer.from(storage.objects.get(dumpKey)!);
    corrupted[10] ^= 1;
    storage.objects.set(dumpKey, corrupted);
    await expect(fetchSet({ get: (objectKey: string) => storage.get(objectKey), key, out: path.join(directory, 'restored') })).rejects.toThrow();
  });

  it('prunes sets past retention but never the latest set', async () => {
    const storage = new MemoryStorage();
    const uploader = new OffsiteBackupUploader({ storage, key, retentionDays: 30 });
    await uploader.upload(directory, await recoverySet(directory, '2026-09-01T02-00-00'));
    await uploader.upload(directory, await recoverySet(directory, '2026-11-05T02-00-00'));

    const removed = await uploader.prune(new Date('2026-11-06T03:00:00Z'));
    expect(removed).toEqual(['wattanam-recovery-2026-09-01T02-00-00']);
    expect([...storage.objects.keys()].some((objectKey) => objectKey.includes('2026-09-01'))).toBe(false);

    // A stalled job: the only remaining set is far past retention but is the latest; keep it.
    expect(await uploader.prune(new Date('2027-06-01T00:00:00Z'))).toEqual([]);
    expect((await uploader.latest())?.setId).toBe('wattanam-recovery-2026-11-05T02-00-00');
  });

  it('reclaims an interrupted upload (no set.json) once a complete set exists', async () => {
    const storage = new MemoryStorage();
    const uploader = new OffsiteBackupUploader({ storage, key, retentionDays: 30 });
    await storage.put('sets/wattanam-recovery-partial/wattanam-partial.dump.enc', Buffer.from('x'));
    expect(await uploader.prune(new Date())).toEqual([]);
    await uploader.upload(directory, await recoverySet(directory, '2026-11-06T02-00-00'));
    expect(await uploader.prune(new Date('2026-11-06T03:00:00Z'))).toEqual(['wattanam-recovery-partial']);
  });

  describe('nightly job', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BackupService } = require('./backup.service');
    const journal = { format: 'wattanam-recovery-set-v2', journalFile: 'wattanam-recovery-x.recovery-set.json', createdAt: '2026-11-06T02:00:00.000Z', database: { file: 'x.dump' } };

    it('uploads and prunes after a successful local recovery set', async () => {
      const offsite = { upload: jest.fn().mockResolvedValue({ setId: 'x', files: [] }), prune: jest.fn().mockResolvedValue([]), latest: jest.fn() };
      const service = new BackupService(undefined, offsite);
      jest.spyOn(service, 'createRecoverySet').mockResolvedValue(journal);
      await service.scheduledBackup();
      expect(offsite.upload).toHaveBeenCalledWith(expect.any(String), journal);
      expect(offsite.prune).toHaveBeenCalled();
    });

    it('logs an off-site failure as an error and does not throw', async () => {
      const offsite = { upload: jest.fn().mockRejectedValue(new Error('bucket unreachable')), prune: jest.fn(), latest: jest.fn() };
      const service = new BackupService(undefined, offsite);
      jest.spyOn(service, 'createRecoverySet').mockResolvedValue(journal);
      const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await expect(service.scheduledBackup()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Off-site backup upload failed: bucket unreachable'));
      expect(offsite.prune).not.toHaveBeenCalled();
    });

    it('skips the upload when the local backup itself failed', async () => {
      const offsite = { upload: jest.fn(), prune: jest.fn(), latest: jest.fn() };
      const service = new BackupService(undefined, offsite);
      jest.spyOn(service, 'createRecoverySet').mockRejectedValue(new Error('pg_dump failed'));
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await service.scheduledBackup();
      expect(offsite.upload).not.toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    const storage = new MemoryStorage();
    const encryptionKey = randomBytes(32).toString('base64');

    it('is disabled when no bucket is configured', () => {
      expect(readOffsiteBackupConfig({}, storage)).toBeNull();
    });

    it('requires a 32-byte encryption key; there is no unencrypted mode', () => {
      expect(() => readOffsiteBackupConfig({ BACKUP_OFFSITE_S3_BUCKET: 'b' }, storage)).toThrow('BACKUP_ENCRYPTION_KEY');
      expect(() => readOffsiteBackupConfig({ BACKUP_OFFSITE_S3_BUCKET: 'b', BACKUP_ENCRYPTION_KEY: randomBytes(16).toString('base64') }, storage)).toThrow('32 bytes');
    });

    it('validates retention and requires HTTPS in production', () => {
      expect(readOffsiteBackupConfig({ BACKUP_OFFSITE_S3_BUCKET: 'b', BACKUP_ENCRYPTION_KEY: encryptionKey }, storage)?.retentionDays).toBe(35);
      expect(() => readOffsiteBackupConfig({ BACKUP_OFFSITE_S3_BUCKET: 'b', BACKUP_ENCRYPTION_KEY: encryptionKey, BACKUP_OFFSITE_RETENTION_DAYS: '0' }, storage)).toThrow('RETENTION');
      expect(() => readOffsiteBackupConfig({
        NODE_ENV: 'production', BACKUP_OFFSITE_S3_BUCKET: 'b', BACKUP_ENCRYPTION_KEY: encryptionKey, BACKUP_OFFSITE_S3_ENDPOINT: 'http://insecure.example',
        BACKUP_OFFSITE_S3_REGION: 'auto', BACKUP_OFFSITE_S3_ACCESS_KEY_ID: 'a', BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY: 's',
      })).toThrow('HTTPS');
    });
  });
});
