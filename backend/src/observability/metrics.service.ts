import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';
import { PrismaService } from '../database/prisma.service';
import { BackupService } from '../backup/backup.service';

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

  constructor(private readonly prisma: PrismaService, private readonly backup: BackupService) {}

  onModuleInit() {
    const prisma = this.prisma;
    const backupService = this.backup;
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
