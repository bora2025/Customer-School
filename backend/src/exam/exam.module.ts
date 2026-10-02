import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller';
import { ExamService } from './exam.service';
import { DatabaseModule } from '../database/database.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  imports: [DatabaseModule, DirectoryModule],
  controllers: [ExamController],
  providers: [ExamService],
})
export class ExamModule {}
