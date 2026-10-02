import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { BackupService } from './backup.service';

describe('BackupService', () => {
  const originalEnvironment = process.env;
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-backup-test-'));
    process.env = { ...originalEnvironment, BACKUP_DIR: directory };
  });

  afterEach(async () => {
    process.env = originalEnvironment;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('reports configured storage with no backups', async () => {
    await expect(new BackupService().status()).resolves.toEqual(expect.objectContaining({
      strategy: 'postgresql-native', configured: true, backupCount: 0, latest: null,
    }));
  });

  it('returns the newest valid manifest and ignores malformed files', async () => {
    const oldManifest = { format: 'pg_dump-custom-v1', createdAt: '2026-01-01T00:00:00.000Z', file: 'old.dump', sizeBytes: 12, sha256: 'old' };
    const latestManifest = { format: 'pg_dump-custom-v1', createdAt: '2026-08-27T00:00:00.000Z', file: 'new.dump', sizeBytes: 42, sha256: 'new', installationSlug: 'test-school' };
    await Promise.all([
      fs.writeFile(path.join(directory, 'wattanam-old.manifest.json'), JSON.stringify(oldManifest)),
      fs.writeFile(path.join(directory, 'wattanam-new.manifest.json'), JSON.stringify(latestManifest)),
      fs.writeFile(path.join(directory, 'wattanam-broken.manifest.json'), '{broken'),
    ]);

    const status = await new BackupService().status();
    expect(status.backupCount).toBe(2);
    expect(status.latest).toEqual(expect.objectContaining({ file: 'new.dump', installationSlug: 'test-school' }));
  });

  it('does not expose the configured filesystem path', async () => {
    const serialized = JSON.stringify(await new BackupService().status());
    expect(serialized).not.toContain(directory);
  });

  it('reports complete plugin-aware recovery coverage only when all three bound artifacts exist', async () => {
    const journal = {
      format: 'wattanam-recovery-set-v1', createdAt: '2026-09-26T00:00:00.000Z',
      database: { file: 'school.dump', sha256: 'a', sizeBytes: 1 },
      pluginFiles: { archive: { file: 'plugin-files.tar', sha256: 'b', sizeBytes: 1 }, checksums: { files: { 'wattanam.test/plugin.json': 'c' } } },
      pluginData: { archive: { file: 'plugin-data.tar', sha256: 'd', sizeBytes: 1 }, checksums: { files: { 'wattanam.test/data.json': 'e' } } },
    };
    await Promise.all([
      fs.writeFile(path.join(directory, 'wattanam-recovery-test.recovery-set.json'), JSON.stringify(journal)),
      fs.writeFile(path.join(directory, 'school.dump'), 'db'),
      fs.writeFile(path.join(directory, 'plugin-files.tar'), 'plugins'),
      fs.writeFile(path.join(directory, 'plugin-data.tar'), 'data'),
    ]);
    await expect(new BackupService().status()).resolves.toMatchObject({
      recoverySetCount: 1,
      latestRecoverySet: { artifactsPresent: true, coverage: { database: true, pluginCode: true, pluginData: true }, pluginFileCount: 1, pluginDataFileCount: 1 },
    });
    await fs.rm(path.join(directory, 'plugin-data.tar'));
    await expect(new BackupService().status()).resolves.toMatchObject({ latestRecoverySet: { artifactsPresent: false } });
  });

  it('reports v2 operational-contract coverage and explicit legacy exceptions', async () => {
    const journal = {
      format: 'wattanam-recovery-set-v2', createdAt: '2026-09-28T00:00:00.000Z',
      database: { file: 'school.dump', sha256: 'a', sizeBytes: 1 },
      pluginFiles: { archive: { file: 'plugin-files.tar', sha256: 'b', sizeBytes: 1 }, checksums: { files: {} } },
      pluginData: { archive: { file: 'plugin-data.tar', sha256: 'c', sizeBytes: 1 }, checksums: { files: {} } },
      pluginContracts: [{ id: 'wattanam.files', version: '1.2.3' }],
      contractVerification: { verified: true, pluginCount: 1, legacyExceptionCount: 0 },
    };
    await Promise.all([
      fs.writeFile(path.join(directory, 'wattanam-recovery-v2.recovery-set.json'), JSON.stringify(journal)),
      fs.writeFile(path.join(directory, 'school.dump'), 'db'),
      fs.writeFile(path.join(directory, 'plugin-files.tar'), 'plugins'),
      fs.writeFile(path.join(directory, 'plugin-data.tar'), 'data'),
    ]);
    await expect(new BackupService().status()).resolves.toMatchObject({
      latestRecoverySet: { pluginContractCount: 1, contractVerified: true, contractJournalVerified: true, legacyPluginContractExceptions: 0 },
    });
  });

  it('does not describe a checksum-verified legacy exception as fully contract verified', async () => {
    const journal = {
      format: 'wattanam-recovery-set-v2', createdAt: '2026-09-29T00:00:00.000Z',
      database: { file: 'school.dump', sha256: 'a', sizeBytes: 1 },
      pluginFiles: { archive: { file: 'plugin-files.tar', sha256: 'b', sizeBytes: 1 }, checksums: { files: {} } },
      pluginData: { archive: { file: 'plugin-data.tar', sha256: 'c', sizeBytes: 1 }, checksums: { files: {} } },
      pluginContracts: [{ id: 'wattanam.legacy', version: '0.1.0', legacyException: true }],
      contractVerification: { verified: true, pluginCount: 1, legacyExceptionCount: 1 },
    };
    await Promise.all([
      fs.writeFile(path.join(directory, 'wattanam-recovery-legacy.recovery-set.json'), JSON.stringify(journal)),
      fs.writeFile(path.join(directory, 'school.dump'), 'db'),
      fs.writeFile(path.join(directory, 'plugin-files.tar'), 'plugins'),
      fs.writeFile(path.join(directory, 'plugin-data.tar'), 'data'),
    ]);
    await expect(new BackupService().status()).resolves.toMatchObject({
      latestRecoverySet: { contractVerified: false, contractJournalVerified: true, legacyPluginContractExceptions: 1 },
    });
  });

  it('scheduledBackup() logs and never throws when the underlying backup fails', async () => {
    const service = new BackupService();
    jest.spyOn(service, 'createRecoverySet').mockRejectedValue(new Error('pg_dump could not start'));
    await expect(service.scheduledBackup()).resolves.toBeUndefined();
  });

  it('scheduledBackup() calls createRecoverySet() exactly once on success', async () => {
    const service = new BackupService();
    const spy = jest.spyOn(service, 'createRecoverySet').mockResolvedValue({
      format: 'wattanam-recovery-set-v1', journalFile: 'wattanam-recovery-test.recovery-set.json', createdAt: new Date().toISOString(),
      database: { file: 'test.dump', sha256: 'abc', sizeBytes: 1 },
    });
    await service.scheduledBackup();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
