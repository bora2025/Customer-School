import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface UpdatePreferenceDto {
  emailEnabled?: boolean;
  smsEnabled?: boolean;
  inAppEnabled?: boolean;
  announcementsEnabled?: boolean;
  messagesEnabled?: boolean;
  digestFrequency?: 'NONE' | 'DAILY' | 'WEEKLY';
}

@Injectable()
export class NotificationPreferenceService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.notificationPreference.create({ data: { userId } });
  }

  async update(userId: string, dto: UpdatePreferenceDto) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto },
    });
  }
}
