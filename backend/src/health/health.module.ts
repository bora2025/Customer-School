import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HealthService } from './health.service';
import { BackupModule } from '../backup/backup.module';

@Module({
  imports: [DatabaseModule, BackupModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
