import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(private prisma: PrismaService, private notifications: NotificationService) {}

  private hash(raw: string) {
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  async request(email: string, now = new Date()) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: { id: true, email: true, name: true },
    });
    if (!user?.email) return { requested: true };

    const raw = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null }, data: { consumedAt: now },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: this.hash(raw), expiresAt },
      });
    });

    const base = (process.env.PUBLIC_APP_URL || process.env.CORS_ORIGINS?.split(',')[0] || '').trim().replace(/\/$/, '');
    try {
      if (!base) throw new Error('PUBLIC_APP_URL or CORS_ORIGINS is not configured');
      const url = `${base}/reset-password?token=${encodeURIComponent(raw)}`;
      await this.notifications.sendEmail(
        user.email,
        'Reset your Wattanam password',
        `Hello ${user.name},\n\nUse this link within 30 minutes to reset your password:\n${url}\n\nIf you did not request this, ignore this message.`,
      );
    } catch (error: any) {
      // Never reveal account existence through a provider/configuration-dependent response.
      this.logger.error(`Password reset delivery failed: ${error?.message || error}`);
    }
    return { requested: true };
  }

  async confirm(rawToken: string, newPassword: string, now = new Date()) {
    const tokenHash = this.hash(rawToken);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const reset = await this.prisma.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!record || record.consumedAt || record.expiresAt <= now) return null;
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claimed.count !== 1) return null;
      await tx.user.update({ where: { id: record.userId }, data: { password: passwordHash } });
      await tx.refreshToken.deleteMany({ where: { userId: record.userId } });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null }, data: { consumedAt: now },
      });
      return record;
    }, { isolationLevel: 'Serializable' });
    if (!reset) throw new BadRequestException('Invalid or expired password reset token');
    return { reset: true };
  }
}
