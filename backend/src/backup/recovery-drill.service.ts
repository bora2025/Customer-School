import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { runsBackgroundJobs } from '../config/environment';
import { OFFSITE_BACKUP, OffsiteBackupUploader } from './offsite-backup';

const execFileAsync = promisify(execFile);
const DRILL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecoveryDrillRecord {
  format: 'wattanam-recovery-drill-v1';
  passed: boolean;
  source: 'offsite';
  startedAt: string;
  completedAt: string;
  setId?: string;
  journalCreatedAt?: string;
  targetDatabase?: string;
  pluginContractCount?: number;
  error?: string;
}

type Runner = (script: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

const defaultRunner: Runner = async (script, args, env) => {
  const { stdout } = await execFileAsync(process.execPath, [path.resolve(process.cwd(), 'scripts', script), ...args], {
    env, timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  return stdout;
};

/** Errors from pg/S3 tooling can echo connection strings; never let credentials reach logs or the bucket. */
export function redact(message: string): string {
  return message
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s@/]+@/gi, '$1<redacted>@')
    .replace(/(password|secret|token|key)=[^\s&]+/gi, '$1=<redacted>')
    .slice(0, 500);
}

function lastJsonLine(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* keep looking */ }
  }
  // scheduled-recovery-drill.js prints pretty JSON across lines.
  return JSON.parse(stdout.slice(stdout.indexOf('{')));
}

/**
 * Proves backups are restorable, not merely present: restores the newest ENCRYPTED OFF-SITE recovery
 * set (the copy that survives losing the host) into the separate recovery-drill database, using the
 * same fetch and restore scripts an operator would use after a disaster. Runs in the worker at most
 * once per 30 days (daily check at 03:30 UTC, plus shortly after boot so a new deployment proves
 * itself). Evidence goes to the bucket so the API's metrics and the external monitor can see it.
 */
@Injectable()
export class RecoveryDrillService implements OnApplicationBootstrap {
  private readonly logger = new Logger('RecoveryDrill');
  private running = false;
  runner: Runner = defaultRunner;

  constructor(@Optional() @Inject(OFFSITE_BACKUP) private readonly offsite?: OffsiteBackupUploader | null) {}

  configured(env: NodeJS.ProcessEnv = process.env): boolean {
    return !!this.offsite && !!env.RECOVERY_DRILL_DATABASE_URL?.trim() && !!env.RECOVERY_DRILL_CONFIRM_TARGET?.trim();
  }

  lastSuccess() { return this.offsite ? this.offsite.readRecord<RecoveryDrillRecord>('drills/last-success.json') : Promise.resolve(null); }
  lastAttempt() { return this.offsite ? this.offsite.readRecord<RecoveryDrillRecord>('drills/latest.json') : Promise.resolve(null); }

  onApplicationBootstrap() {
    if (!runsBackgroundJobs() || !this.configured()) return;
    setTimeout(() => { void this.runIfDue(); }, 2 * 60_000).unref();
  }

  @Cron('30 3 * * *')
  async scheduled() { if (this.configured()) await this.runIfDue(); }

  async runIfDue(now = new Date()): Promise<RecoveryDrillRecord | null> {
    try {
      const last = await this.lastSuccess();
      if (last?.passed && now.getTime() - Date.parse(last.completedAt) < DRILL_INTERVAL_MS) return null;
    } catch (error) {
      this.logger.error(`Recovery drill could not read previous evidence: ${redact(String((error as Error).message))}`);
    }
    return this.run(now);
  }

  async run(now = new Date()): Promise<RecoveryDrillRecord | null> {
    if (!this.offsite || this.running) return null;
    this.running = true;
    const startedAt = now.toISOString();
    const wallStart = Date.now();
    const completedAt = () => new Date(now.getTime() + (Date.now() - wallStart)).toISOString();
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'wattanam-offsite-drill-'));
    let record: RecoveryDrillRecord;
    try {
      const setDirectory = path.join(stage, 'set');
      const fetched = lastJsonLine(await this.runner('fetch-offsite-backup.js', ['--out', setDirectory], process.env));
      const drill = lastJsonLine(await this.runner('scheduled-recovery-drill.js', [], { ...process.env, BACKUP_DIR: setDirectory }));
      if (drill.passed !== true) throw new Error('restore drill did not report success');
      record = {
        format: 'wattanam-recovery-drill-v1', passed: true, source: 'offsite', startedAt, completedAt: completedAt(),
        setId: fetched.setId, journalCreatedAt: drill.journalCreatedAt, targetDatabase: drill.targetDatabase, pluginContractCount: drill.pluginContractCount,
      };
      await this.offsite.writeRecord('drills/last-success.json', record);
      // warn, not log: production keeps only warn/error, and this is the restore evidence.
      this.logger.warn(`Recovery drill passed: restored off-site set ${record.setId} into ${record.targetDatabase}`);
    } catch (error: any) {
      const detail = [error?.message, error?.stderr].filter(Boolean).join(' ');
      record = { format: 'wattanam-recovery-drill-v1', passed: false, source: 'offsite', startedAt, completedAt: completedAt(), error: redact(detail || 'unknown error') };
      this.logger.error(`Recovery drill failed: ${record.error}`);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
      this.running = false;
    }
    try { await this.offsite.writeRecord('drills/latest.json', record); } catch (error) {
      this.logger.error(`Recovery drill evidence upload failed: ${redact(String((error as Error).message))}`);
    }
    return record;
  }
}
