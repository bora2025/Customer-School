import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Cron } from '@nestjs/schedule';

const execFileAsync = promisify(execFile);

interface BackupManifest {
  format: string;
  createdAt: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  installationSlug?: string | null;
  appVersion?: string | null;
}

interface RecoverySetJournal {
  format: string;
  journalFile: string;
  createdAt: string;
  database: { file: string; sha256: string; sizeBytes: number };
  pluginFiles?: { archive?: { file?: string; sha256?: string; sizeBytes?: number }; checksums?: { files?: Record<string, string> } };
  pluginData?: { archive?: { file?: string; sha256?: string; sizeBytes?: number }; checksums?: { files?: Record<string, string> } };
  pluginContracts?: Array<{ id?: string; version?: string; legacyException?: boolean }>;
  contractVerification?: { verified?: boolean; pluginCount?: number; legacyExceptionCount?: number };
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private backupDirectory() {
    return path.resolve(process.env.BACKUP_DIR || (process.env.NODE_ENV === 'production' ? '/data/backups' : './backups'));
  }

  async status() {
    const directory = this.backupDirectory();
    try {
      const names = await fs.readdir(directory);
      const manifests: BackupManifest[] = [];
      const recoverySets: Array<RecoverySetJournal & { journalFile: string }> = [];
      for (const name of names.filter((item) => /^wattanam-.*\.manifest\.json$/.test(item))) {
        try {
          const parsed = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as BackupManifest;
          if (parsed.format === 'pg_dump-custom-v1' && parsed.createdAt && parsed.file) manifests.push(parsed);
        } catch {
          // Invalid manifests are ignored and remain available for operator investigation.
        }
      }
      for (const name of names.filter((item) => /^wattanam-recovery-.*\.recovery-set\.json$/.test(item))) {
        try {
          const parsed = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as RecoverySetJournal;
          if (['wattanam-recovery-set-v1', 'wattanam-recovery-set-v2'].includes(parsed.format) && parsed.createdAt && parsed.database?.file) recoverySets.push({ ...parsed, journalFile: name });
        } catch {
          // Invalid journals remain for operator investigation and are never advertised as backups.
        }
      }
      manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      recoverySets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = manifests[0] || null;
      const latestRecoverySet = recoverySets[0] || null;
      const recoveryArtifacts = latestRecoverySet ? [
        latestRecoverySet.database.file,
        latestRecoverySet.pluginFiles?.archive?.file,
        latestRecoverySet.pluginData?.archive?.file,
      ].filter((name): name is string => !!name) : [];
      const recoveryArtifactsPresent = latestRecoverySet
        ? (await Promise.all(recoveryArtifacts.map((name) => fs.access(path.join(directory, name)).then(() => true).catch(() => false)))).every(Boolean)
          && recoveryArtifacts.length === 3
        : false;
      return {
        strategy: 'postgresql-native',
        configured: true,
        backupCount: manifests.length,
        latest: latest ? {
          createdAt: latest.createdAt,
          file: latest.file,
          sizeBytes: latest.sizeBytes,
          sha256: latest.sha256,
          installationSlug: latest.installationSlug || null,
          appVersion: latest.appVersion || null,
        } : null,
        recoverySetCount: recoverySets.length,
        latestRecoverySet: latestRecoverySet ? {
          createdAt: latestRecoverySet.createdAt, journalFile: latestRecoverySet.journalFile,
          artifactsPresent: recoveryArtifactsPresent,
          coverage: {
            database: !!latestRecoverySet.database?.file,
            pluginCode: !!latestRecoverySet.pluginFiles?.archive?.file,
            pluginData: !!latestRecoverySet.pluginData?.archive?.file,
          },
          pluginFileCount: Object.keys(latestRecoverySet.pluginFiles?.checksums?.files || {}).length,
          pluginDataFileCount: Object.keys(latestRecoverySet.pluginData?.checksums?.files || {}).length,
          pluginContractCount: latestRecoverySet.pluginContracts?.length || 0,
          contractVerified: latestRecoverySet.format === 'wattanam-recovery-set-v2'
            && latestRecoverySet.contractVerification?.verified === true
            && latestRecoverySet.contractVerification.pluginCount === (latestRecoverySet.pluginContracts?.length || 0)
            && latestRecoverySet.contractVerification.legacyExceptionCount === 0,
          contractJournalVerified: latestRecoverySet.format === 'wattanam-recovery-set-v2'
            && latestRecoverySet.contractVerification?.verified === true,
          legacyPluginContractExceptions: latestRecoverySet.contractVerification?.legacyExceptionCount || 0,
        } : null,
        restoreMode: 'offline-cli-only',
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return { strategy: 'postgresql-native', configured: false, backupCount: 0, latest: null, recoverySetCount: 0, latestRecoverySet: null, restoreMode: 'offline-cli-only' };
      }
      throw error;
    }
  }

  async create() {
    const script = path.resolve(process.cwd(), 'scripts/backup-database.js');
    const { stdout } = await execFileAsync(process.execPath, [script], {
      env: process.env,
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const manifest = JSON.parse(lines[lines.length - 1]) as BackupManifest;
    if (manifest.format !== 'pg_dump-custom-v1' || !manifest.file || !manifest.sha256) throw new Error('Backup command returned an invalid manifest');
    return manifest;
  }

  /** Database + PLUGIN_DIR + PLUGIN_DATA_DIR as one recovery-set journal (B-012's format). */
  async createRecoverySet(): Promise<RecoverySetJournal> {
    const script = path.resolve(process.cwd(), 'scripts/backup-recovery-set.js');
    const { stdout } = await execFileAsync(process.execPath, [script], {
      env: process.env,
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const journal = JSON.parse(lines[lines.length - 1]) as RecoverySetJournal;
    if (!['wattanam-recovery-set-v1', 'wattanam-recovery-set-v2'].includes(journal.format) || !journal.journalFile) throw new Error('Recovery-set backup command returned an invalid journal');
    return journal;
  }

  /**
   * Runs once daily -- matching the 24h RPO target in docs/operations/reliability-and-slos.md.
   * Automatically skipped in API-only process role: ScheduleModule.forRoot() is configured
   * with cronJobs gated on runsBackgroundJobs(), so this never needs its own role check.
   * A failed scheduled backup is logged, not thrown -- it must never crash the process, and
   * the next day's run (or an operator alerted by the backup_age_seconds/backup_count metrics
   * this repo already exposes) is the recovery path, not a retry loop here.
   */
  @Cron('0 2 * * *')
  async scheduledBackup(): Promise<void> {
    try {
      const journal = await this.createRecoverySet();
      this.logger.log(`Scheduled recovery-set backup completed: ${journal.journalFile}`);
    } catch (error) {
      this.logger.error(`Scheduled recovery-set backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
