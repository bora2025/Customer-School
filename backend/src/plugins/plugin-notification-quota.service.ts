import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';

const DEFAULT_DAILY_LIMIT = 200;

function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Caps how many notifications (email/SMS/in-app combined) a single plugin
 * can send per UTC day, so a runaway or abusive plugin can't run up
 * unbounded SendGrid/Twilio cost or flood the in-app inbox. The counter is
 * a single atomic upsert-increment, so concurrent sends from the same
 * plugin can never overshoot the limit via a race.
 */
@Injectable()
export class PluginNotificationQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async recordAndCheck(pluginId: string, now = new Date()): Promise<{ allowed: boolean; count: number; limit: number }> {
    const limit = this.dailyLimit();
    const windowStart = utcDayStart(now);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `INSERT INTO "PluginNotificationUsage" (id, "pluginId", "windowStart", count, "updatedAt")
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT ("pluginId", "windowStart") DO UPDATE SET count = "PluginNotificationUsage".count + 1, "updatedAt" = now()
       RETURNING count`,
      randomUUID(), pluginId, windowStart,
    );
    const count = rows[0]?.count ?? 1;
    return { allowed: count <= limit, count, limit };
  }

  private dailyLimit() {
    const raw = Number(process.env.PLUGIN_NOTIFICATION_DAILY_LIMIT);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_LIMIT;
  }
}
