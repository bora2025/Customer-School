import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { DatabaseModule } from '../database/database.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  imports: [DatabaseModule, DirectoryModule],
  controllers: [CoursesController],
  providers: [CoursesService],
})
export class CoursesModule {}
