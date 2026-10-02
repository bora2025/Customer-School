import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { SchoolAccessService } from '../marketplace/school-access.service';
import { getDistribution } from '../config/environment';

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
    private schoolAccess: SchoolAccessService,
  ) {}

  /** Runs every day at 07:00 server time. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async sendDailyDigests() {
    await this.runDigest('DAILY', 24 * 60 * 60 * 1000);
  }

  /** Runs every Monday at 07:00 server time. */
  @Cron('0 7 * * 1')
  async sendWeeklyDigests() {
    await this.runDigest('WEEKLY', 7 * 24 * 60 * 60 * 1000);
  }

  private async runDigest(frequency: 'DAILY' | 'WEEKLY', windowMs: number) {
    // A school locked for an unpaid platform bill gets no service, and that includes these emails.
    if (await this.schoolAccess.isSuspended()) {
      this.logger.log(`Skipping the ${frequency} digest: school access is suspended for an unpaid platform bill`);
      return;
    }
    const since = new Date(Date.now() - windowMs);
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { digestFrequency: frequency, emailEnabled: true },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    this.logger.log(`Running ${frequency} digest for ${prefs.length} users`);

    for (const p of prefs) {
      if (!p.user.email) continue;
      try {
        const [unreadMessages, announcements] = await Promise.all([
          getDistribution() === 'core' ? Promise.resolve(0) : this.prisma.message.count({
            where: { receiverId: p.userId, readAt: null, createdAt: { gte: since } },
          }),
          this.prisma.notification.count({
            where: { userId: p.userId, type: 'announcement', sentAt: { gte: since } },
          }),
        ]);

        if (unreadMessages === 0 && announcements === 0) continue;

        const subject = `Your ${frequency === 'DAILY' ? 'daily' : 'weekly'} school summary`;
        const body =
          `Hi ${p.user.name || 'there'},\n\n` +
          `Here is a summary of activity since ${since.toLocaleString()}:\n` +
          `• Unread messages: ${unreadMessages}\n` +
          `• New announcements: ${announcements}\n\n` +
          `Open the school portal to read them.`;

        await this.notifications.sendEmail(p.user.email, subject, body);
      } catch (e: any) {
        this.logger.error(`Digest send failed for ${p.userId}: ${e?.message || e}`);
      }
    }
  }
}
