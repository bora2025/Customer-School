import { BadRequestException, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@prisma/client';
import { runsBackgroundJobs } from '../config/environment';
import { SchoolAccessService } from '../marketplace/school-access.service';
import { PluginResourceQuotaService } from './plugin-resource-quota.service';
import { PluginEntitlementPolicyService } from './plugin-entitlement-policy.service';

@Injectable()
export class PluginJobsService implements OnApplicationShutdown {
  private readonly logger = new Logger(PluginJobsService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly definitions = new Set<string>();
  private readonly running = new Set<string>();
  private readonly draining = new Set<string>();

  constructor(private readonly prisma: PrismaService, private readonly schoolAccess: SchoolAccessService, @Optional() private readonly quota?: PluginResourceQuotaService, @Optional() private readonly entitlements?: PluginEntitlementPolicyService) {}

  async register(pluginId: string, definition: { id: string; intervalSeconds: number; handler(): void | Promise<void> }) {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(definition.id)) throw new BadRequestException('Plugin job id is invalid');
    const minimum = process.env.NODE_ENV === 'test' ? 1 : 60;
    if (!Number.isInteger(definition.intervalSeconds) || definition.intervalSeconds < minimum || definition.intervalSeconds > 31_536_000) {
      throw new BadRequestException(`Plugin job interval must be ${minimum}..31536000 seconds`);
    }
    const key = `${pluginId}:${definition.id}`;
    this.draining.delete(pluginId);
    if (this.definitions.has(key)) throw new BadRequestException(`Plugin job is already registered: ${definition.id}`);
    await this.prisma.pluginJobDefinition.upsert({
      where: { pluginId_jobId: { pluginId, jobId: definition.id } },
      create: { pluginId, jobId: definition.id, intervalSeconds: definition.intervalSeconds },
      update: { intervalSeconds: definition.intervalSeconds, enabled: true },
    });
    if (runsBackgroundJobs()) {
      const timer = setInterval(() => this.run(pluginId, definition.id, definition.handler), definition.intervalSeconds * 1000);
      timer.unref();
      this.timers.set(key, timer);
    }
    this.definitions.add(key);
    return () => this.unregister(pluginId, definition.id);
  }

  unregister(pluginId: string, jobId: string) {
    const key = `${pluginId}:${jobId}`;
    const timer = this.timers.get(key);
    if (timer) clearInterval(timer);
    this.timers.delete(key);
    this.definitions.delete(key);
  }

  async clear(pluginId: string) {
    this.draining.add(pluginId);
    for (const key of [...this.definitions]) if (key.startsWith(`${pluginId}:`)) this.unregister(pluginId, key.slice(pluginId.length + 1));
    await this.prisma.pluginJobDefinition.updateMany({ where: { pluginId }, data: { enabled: false } });
    const timeout = Number(process.env.PLUGIN_JOB_DRAIN_TIMEOUT_MS || 30_000);
    const deadline = Date.now() + timeout;
    while ([...this.running].some((key) => key.startsWith(`${pluginId}:`))) {
      if (Date.now() >= deadline) throw new Error(`Timed out draining plugin jobs for ${pluginId}`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    }
  }

  async run(pluginId: string, jobId: string, handler: () => void | Promise<void>) {
    const key = `${pluginId}:${jobId}`;
    if (this.draining.has(pluginId) || this.running.has(key)) return;
    this.running.add(key);
    let leaveQuota: (() => void) | undefined;
    try {
      leaveQuota = this.quota?.enterJob(pluginId);
      // A plugin is part of the service a school locked for an unpaid platform bill has stopped
      // paying for, so its jobs pause and resume with the school. Checked after claiming `running`,
      // so two timer ticks cannot both slip past while the lock is read. If the lock cannot be read
      // the job runs: this is called from a timer and must never reject.
      if (await this.schoolAccess.isSuspended().catch(() => false)) return;
      if (this.entitlements && !await this.entitlements.jobsAllowed(pluginId)) return;
      await this.prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRawUnsafe<Array<{ acquired: boolean }>>(
          'SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS acquired', pluginId, jobId,
        );
        if (!lock[0]?.acquired) return;
        await this.executeClaimed(tx, pluginId, jobId, handler);
      }, { maxWait: 5_000, timeout: 24 * 60 * 60 * 1000 });
    } catch (error) {
      this.logger.error(`Plugin job ${key} transaction failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { leaveQuota?.(); this.running.delete(key); }
  }

  private async executeClaimed(tx: Prisma.TransactionClient, pluginId: string, jobId: string, handler: () => void | Promise<void>) {
    const startedAt = new Date();
    const run = await tx.pluginJobRun.create({ data: { pluginId, jobId, status: 'running', startedAt } });
    await tx.pluginJobDefinition.update({ where: { pluginId_jobId: { pluginId, jobId } }, data: { lastStartedAt: startedAt, lastStatus: 'running', lastError: null } });
    try {
      await handler();
      const finishedAt = new Date();
      await tx.pluginJobRun.update({ where: { id: run.id }, data: { status: 'completed', finishedAt } });
      await tx.pluginJobDefinition.update({ where: { pluginId_jobId: { pluginId, jobId } }, data: { lastCompletedAt: finishedAt, lastStatus: 'completed' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date();
      this.logger.error(`Plugin job ${pluginId}:${jobId} failed: ${message}`);
      await tx.pluginJobRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt, error: message } });
      await tx.pluginJobDefinition.update({ where: { pluginId_jobId: { pluginId, jobId } }, data: { lastCompletedAt: finishedAt, lastStatus: 'failed', lastError: message } });
    }
  }

  onApplicationShutdown() { for (const timer of this.timers.values()) clearInterval(timer); this.timers.clear(); this.definitions.clear(); this.draining.clear(); }
}
