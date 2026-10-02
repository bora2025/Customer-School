import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DataExportController],
  providers: [DataExportService],
})
export class DataExportModule {}
