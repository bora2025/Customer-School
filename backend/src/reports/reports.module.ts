import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { DatabaseModule } from '../database/database.module';
import { SessionConfigModule } from '../session-config/session-config.module';
import { HolidaysModule } from '../holidays/holidays.module';

@Module({
  imports: [DatabaseModule, SessionConfigModule, HolidaysModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}