import { Module } from '@nestjs/common';
import { StaffCvService } from './staff-cv.service';
import { StaffCvController } from './staff-cv.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [StaffCvService],
  controllers: [StaffCvController],
})
export class StaffCvModule {}
