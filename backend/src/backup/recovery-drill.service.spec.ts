import { randomBytes } from 'crypto';
import { ObjectStorageProvider, StoredObject } from '../storage/object-storage';
import { OffsiteBackupUploader } from './offsite-backup';
import { RecoveryDrillService, redact } from './recovery-drill.service';

class MemoryStorage implements ObjectStorageProvider {
  readonly kind = 'memory';
  readonly objects = new Map<string, Buffer>();
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, value: Buffer) { this.objects.set(key, Buffer.from(value)); return { key, size: value.length, sha256: '' }; }
  async delete(key: string) { this.objects.delete(key); }
  async list(prefix = ''): Promise<StoredObject[]> { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, size: 0, sha256: '' })); }
  async checksum() { return null; }
}

const env = { ...process.env, RECOVERY_DRILL_DATABASE_URL: 'postgresql://u:p@drill/recovery_drill', RECOVERY_DRILL_CONFIRM_TARGET: 'angkor-school' };

function setup(runner: (script: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>) {
  const storage = new MemoryStorage();
  const service = new RecoveryDrillService(new OffsiteBackupUploader({ storage, key: randomBytes(32), retentionDays: 35 }));
  service.runner = runner;
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  return { storage, service };
}

const passingRunner = jest.fn(async (script: string, _args: string[], runEnv: NodeJS.ProcessEnv) => {
  if (script === 'fetch-offsite-backup.js') return '{"status":"fetched","setId":"wattanam-recovery-2026-11-10T02-00-00"}\n';
  expect(runEnv.BACKUP_DIR).toMatch(/wattanam-offsite-drill-.*[\\/]set$/);
  return JSON.stringify({ passed: true, journalCreatedAt: '2026-11-10T02:00:00Z', targetDatabase: 'recovery_drill', pluginContractCount: 2 }, null, 2);
});

describe('off-site restore drill', () => {
  const original = { ...process.env };
  beforeEach(() => { Object.assign(process.env, env); });
  afterEach(() => { process.env = { ...original }; });

  it('restores the newest off-site set and records success evidence', async () => {
    const { service } = setup(passingRunner);
    const record = await service.run(new Date('2026-11-10T03:30:00Z'));
    expect(record).toMatchObject({ passed: true, source: 'offsite', setId: 'wattanam-recovery-2026-11-10T02-00-00', targetDatabase: 'recovery_drill' });
    expect((await service.lastSuccess())?.setId).toBe('wattanam-recovery-2026-11-10T02-00-00');
    expect((await service.lastAttempt())?.passed).toBe(true);
    expect(passingRunner.mock.calls.map((call) => call[0])).toEqual(['fetch-offsite-backup.js', 'scheduled-recovery-drill.js']);
  });

  it('records a redacted failure without overwriting the last success', async () => {
    const { service } = setup(passingRunner);
    await service.run(new Date('2026-10-01T03:30:00Z'));
    service.runner = async () => { throw Object.assign(new Error('restore failed'), { stderr: 'connect postgresql://drill:hunter2@drill.internal/recovery_drill password=hunter2' }); };
    const record = await service.run(new Date('2026-11-10T03:30:00Z'));
    expect(record?.passed).toBe(false);
    expect(record?.error).not.toContain('hunter2');
    expect(record?.error).toContain('<redacted>');
    expect((await service.lastAttempt())?.passed).toBe(false);
    expect((await service.lastSuccess())?.passed).toBe(true);
  });

  it('runs at most once per 30 days', async () => {
    const runner = jest.fn(passingRunner);
    const { service } = setup(runner);
    await service.runIfDue(new Date('2026-11-01T03:30:00Z'));
    expect(await service.runIfDue(new Date('2026-11-20T03:30:00Z'))).toBeNull();
    expect((await service.runIfDue(new Date('2026-12-02T03:30:00Z')))?.passed).toBe(true);
    expect(runner).toHaveBeenCalledTimes(4);
  });

  it('is only configured with off-site backup, a drill database and a confirmation target', () => {
    const { service } = setup(passingRunner);
    expect(service.configured(env)).toBe(true);
    expect(service.configured({ ...env, RECOVERY_DRILL_DATABASE_URL: '' })).toBe(false);
    expect(new RecoveryDrillService(null).configured(env)).toBe(false);
  });

  it('redacts credentials from tool output', () => {
    expect(redact('postgresql://user:secret@host/db token=abc key=xyz')).toBe('postgresql://<redacted>@host/db token=<redacted> key=<redacted>');
  });
});

describe('redact', () => {
  it('keeps the end of long tool output, where the failure reason is', () => {
    const output = `${'Restoring database...\n'.repeat(200)}pg_restore: error: role "wattanam_runtime" does not exist`;
    const kept = redact(output);
    expect(kept.length).toBeLessThanOrEqual(1501);
    expect(kept).toMatch(/role "wattanam_runtime" does not exist$/);
  });
});
