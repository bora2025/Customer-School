import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}