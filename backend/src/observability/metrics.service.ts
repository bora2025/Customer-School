import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import * as client from 'prom-client';
import { PrismaService } from '../database/prisma.service';
import { BackupService } from '../backup/backup.service';
import { RecoveryDrillService } from '../backup/recovery-drill.service';

/**
 * db_up, db_migrations_pending, backup_age_seconds, and the per-plugin/entitlement gauges
 * are all defined with an async collect() that queries the database fresh on every scrape,
 * rather than being pushed incrementally from plugin-jobs.service.ts / entitlement-cache.service.ts.
 * That keeps them accurate across restarts and needs no changes to those services' own logic.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new client.Registry();

  private httpRequestDuration!: client.Histogram<'method' | 'route' | 'status_code'>;
  private httpRequestsTotal!: client.Counter<'method' | 'route' | 'status_code'>;
  private httpRequestsInFlight!: client.Gauge;

  constructor(private readonly prisma: PrismaService, private readonly backup: BackupService, @Optional() private readonly drill?: RecoveryDrillService) {}

  onModuleInit() {
    const prisma = this.prisma;
    const backupService = this.backup;
    const drillService = this.drill;
    client.collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds', help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'], buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    this.httpRequestsInFlight = new client.Gauge({
      name: 'http_requests_in_flight', help: 'HTTP requests currently being handled (saturation proxy)',
      registers: [this.registry],
    });

    new client.Gauge({
      name: 'release_version_info', help: 'Always 1; the app_version/git_commit labels identify the running release',
      labelNames: ['app_version', 'git_commit'], registers: [this.registry],
    }).set({
      app_version: process.env.APP_VERSION?.trim() || '0.1.0-dev',
      git_commit: (process.env.GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown').trim(),
    }, 1);

    new client.Gauge({
      name: 'db_up', help: '1 if a database round trip on this scrape succeeded, 0 otherwise', registers: [this.registry],
      async collect() {
        try { await prisma.$queryRawUnsafe('SELECT 1'); this.set(1); } catch { this.set(0); }
      },
    });

    new client.Gauge({
      name: 'db_migrations_pending', help: 'Prisma migrations recorded as started but not finished', registers: [this.registry],
      async collect() {
        try {
          const rows = await prisma.$queryRawUnsafe<Array<{ pending: bigint }>>(
            `SELECT COUNT(*)::bigint AS pending FROM "_prisma_migrations" WHERE finished_at IS NULL`,
          );
          this.set(Number(rows[0]?.pending ?? 0));
        } catch { /* table may not exist against a not-yet-migrated database; leave unset rather than fail the scrape */ }
      },
    });

    new client.Gauge({
      name: 'plugin_job_last_run_success', help: 'Whether a plugin job\'s most recent run completed successfully',
      labelNames: ['plugin_id', 'job_id'], registers: [this.registry],
      async collect() {
        this.reset();
        try {
          const jobs = await prisma.pluginJobDefinition.findMany({ select: { pluginId: true, jobId: true, lastStatus: true } });
          for (const job of jobs) this.set({ plugin_id: job.pluginId, job_id: job.jobId }, job.lastStatus === 'completed' ? 1 : 0);
        } catch { /* PluginJobDefinition may not exist on an older schema; leave empty rather than fail the scrape */ }
      },
    });

    new client.Gauge({
      name: 'plugin_job_last_completed_age_seconds', help: 'Seconds since a plugin job last completed successfully',
      labelNames: ['plugin_id', 'job_id'], registers: [this.registry],
      async collect() {
        this.reset();
        try {
          const jobs = await prisma.pluginJobDefinition.findMany({ where: { lastCompletedAt: { not: null } }, select: { pluginId: true, jobId: true, lastCompletedAt: true } });
          for (const job of jobs) this.set({ plugin_id: job.pluginId, job_id: job.jobId }, (Date.now() - job.lastCompletedAt!.getTime()) / 1000);
        } catch { /* see above */ }
      },
    });

    new client.Gauge({
      name: 'plugin_entitlement_consecutive_failures', help: 'Consecutive failed entitlement refresh attempts for a plugin',
      labelNames: ['plugin_id'], registers: [this.registry],
      async collect() {
        this.reset();
        try {
          const rows = await prisma.pluginEntitlementCache.findMany({ select: { pluginId: true, consecutiveFailures: true } });
          for (const row of rows) this.set({ plugin_id: row.pluginId }, row.consecutiveFailures);
        } catch { /* PluginEntitlementCache may not exist on an older schema; leave empty rather than fail the scrape */ }
      },
    });

    new client.Gauge({
      name: 'plugin_entitlement_active', help: '1 if the cached entitlement status is ACTIVE, 0 otherwise',
      labelNames: ['plugin_id'], registers: [this.registry],
      async collect() {
        this.reset();
        try {
          const rows = await prisma.pluginEntitlementCache.findMany({ select: { pluginId: true, status: true } });
          for (const row of rows) this.set({ plugin_id: row.pluginId }, row.status === 'ACTIVE' ? 1 : 0);
        } catch { /* see above */ }
      },
    });

    new client.Gauge({
      // +Inf when no backup exists yet, deliberately, so a "backup_age_seconds > threshold"
      // alert fires correctly instead of a bare 0 (a prom-client gauge's default value) being
      // misread as "a backup just ran".
      name: 'backup_age_seconds', help: 'Seconds since the most recent successful backup manifest was written; +Inf if none exists', registers: [this.registry],
      async collect() {
        try {
          const status = await backupService.status();
          this.set(status.latest ? (Date.now() - Date.parse(status.latest.createdAt)) / 1000 : Infinity);
        } catch { this.set(Infinity); }
      },
    });
    new client.Gauge({
      name: 'backup_count', help: 'Number of backup manifests currently on disk', registers: [this.registry],
      async collect() {
        try { this.set((await backupService.status()).backupCount); } catch { /* see above */ }
      },
    });

    new client.Gauge({
      name: 'recovery_set_age_seconds', help: 'Seconds since the latest complete recovery set; +Inf if none exists', registers: [this.registry],
      async collect() {
        try {
          const status = await backupService.status();
          this.set(status.latestRecoverySet ? (Date.now() - Date.parse(status.latestRecoverySet.createdAt)) / 1000 : Infinity);
        } catch { this.set(Infinity); }
      },
    });
    // Off-site state is read from the bucket, so the API reports the worker's backups correctly
    // even though the two processes have separate volumes.
    new client.Gauge({
      name: 'offsite_backup_configured', help: '1 when encrypted off-site backup is configured', registers: [this.registry],
      collect() { this.set(backupService.offsiteConfigured() ? 1 : 0); },
    });
    new client.Gauge({
      name: 'offsite_backup_age_seconds', help: 'Seconds since the recovery point of the newest complete off-site set; +Inf if none or unreadable', registers: [this.registry],
      async collect() {
        try {
          const latest = await backupService.offsiteLatest();
          this.set(latest ? (Date.now() - Date.parse(latest.createdAt)) / 1000 : Infinity);
        } catch { this.set(Infinity); }
      },
    });
    // Restore-drill evidence lives in the off-site bucket, written by the worker.
    new client.Gauge({
      name: 'recovery_drill_configured', help: '1 when the off-site restore drill is configured', registers: [this.registry],
      collect() { this.set(drillService?.configured() ? 1 : 0); },
    });
    new client.Gauge({
      name: 'recovery_drill_success_age_seconds', help: 'Seconds since the last successful restore of an off-site set into the rehearsal database; +Inf if never or unreadable', registers: [this.registry],
      async collect() {
        try {
          const last = await drillService?.lastSuccess();
          this.set(last?.passed ? (Date.now() - Date.parse(last.completedAt)) / 1000 : Infinity);
        } catch { this.set(Infinity); }
      },
    });
    new client.Gauge({
      name: 'recovery_drill_last_attempt_passed', help: '1 if the most recent restore drill passed, 0 if it failed or none ran', registers: [this.registry],
      async collect() {
        try { this.set((await drillService?.lastAttempt())?.passed ? 1 : 0); } catch { this.set(0); }
      },
    });
    new client.Gauge({
      name: 'recovery_set_contract_verified', help: '1 when the latest recovery set has complete verified plugin contracts', registers: [this.registry],
      async collect() {
        try { this.set((await backupService.status()).latestRecoverySet?.contractVerified ? 1 : 0); }
        catch { this.set(0); }
      },
    });
    new client.Gauge({
      name: 'plugin_installations_failed', help: 'Number of plugin installations in failed state', registers: [this.registry],
      async collect() {
        try { this.set(await prisma.pluginInstallation.count({ where: { status: 'failed' } })); }
        catch { this.set(0); }
      },
    });
    new client.Gauge({
      name: 'plugin_dead_letters_unreplayed', help: 'Number of plugin event dead letters awaiting replay', registers: [this.registry],
      async collect() {
        try {
          const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT COUNT(*)::bigint AS count FROM "PluginDeadLetter" WHERE "replayedAt" IS NULL');
          this.set(Number(rows[0]?.count || 0));
        } catch { this.set(0); }
      },
    });
    new client.Gauge({
      name: 'plugin_rollouts_staging_age_seconds', help: 'Age of the oldest staging plugin rollout; 0 when none is staging', registers: [this.registry],
      async collect() {
        try {
          const rows = await prisma.$queryRawUnsafe<Array<{ createdAt: Date }>>('SELECT "createdAt" FROM "PluginArtifactGeneration" WHERE status=\'staging\' ORDER BY "createdAt" ASC LIMIT 1');
          this.set(rows[0] ? Math.max(0, (Date.now() - rows[0].createdAt.getTime()) / 1000) : 0);
        } catch { this.set(0); }
      },
    });
  }

  observeHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestDuration.observe(labels, durationSeconds);
    this.httpRequestsTotal.inc(labels);
  }

  incInFlight() { this.httpRequestsInFlight.inc(); }
  decInFlight() { this.httpRequestsInFlight.dec(); }

  async renderPrometheusText(): Promise<string> {
    return this.registry.metrics();
  }
}
