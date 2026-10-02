import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { DatabaseModule } from '../database/database.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  imports: [DatabaseModule, DirectoryModule],
  controllers: [ScoringController],
  providers: [ScoringService],
})
export class ScoringModule {}
