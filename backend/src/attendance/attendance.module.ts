import { Module } from '@nestjs/common';
import { AttendanceGateway } from './attendance.gateway';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { SessionConfigModule } from '../session-config/session-config.module';
import { AuthModule } from '../auth/auth.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  imports: [DatabaseModule, NotificationModule, SessionConfigModule, AuthModule, DirectoryModule],
  providers: [AttendanceGateway, AttendanceService],
  controllers: [AttendanceController],
  exports: [AttendanceService],
})
export class AttendanceModule {}
