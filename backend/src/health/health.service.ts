import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { readRuntimeConfig } from '../config/environment';
import { BackupService } from '../backup/backup.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
  ) {}

  liveness() {
    return {
      status: 'ok',
      service: 'wattanam-api',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const startedAt = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ready',
      service: 'wattanam-api',
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: 'up',
          responseTimeMs: Date.now() - startedAt,
        },
      },
    };
  }

  version() {
    const config = readRuntimeConfig();
    return {
      service: 'wattanam-api',
      version: config.appVersion,
      commit: config.gitCommit?.slice(0, 12) || null,
      environment: config.nodeEnv,
      distribution: config.distribution,
    };
  }

  async diagnostics() {
    const [readiness, installation, migrations, backup] = await Promise.all([
      this.readiness(),
      this.prisma.installation.findUnique({
        where: { id: 'singleton' },
        select: { installationId: true, schoolSlug: true, status: true, coreVersion: true, installedAt: true },
      }),
      this.prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `,
      this.backup.status(),
    ]);
    const applied = migrations.filter((migration) => migration.finished_at && !migration.rolled_back_at);
    const failed = migrations.filter((migration) => !migration.finished_at && !migration.rolled_back_at);
    return {
      ...readiness,
      version: this.version(),
      installation,
      migrations: {
        appliedCount: applied.length,
        latestApplied: applied[applied.length - 1]?.migration_name || null,
        failed: failed.map((migration) => migration.migration_name),
      },
      backup,
    };
  }
}
