import { Module } from '@nestjs/common';
import { NotificationPreferenceController } from './notification-preference.controller';
import { NotificationPreferenceService } from './notification-preference.service';
import { DigestService } from './digest.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [DatabaseModule, NotificationModule],
  controllers: [NotificationPreferenceController],
  providers: [NotificationPreferenceService, DigestService],
  exports: [NotificationPreferenceService],
})
export class NotificationPreferenceModule {}
