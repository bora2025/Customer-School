import { Module } from '@nestjs/common';
import { FeesController } from './fees.controller';
import { FeesService } from './fees.service';
import { DatabaseModule } from '../database/database.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  imports: [DatabaseModule, DirectoryModule],
  controllers: [FeesController],
  providers: [FeesService],
})
export class FeesModule {}
