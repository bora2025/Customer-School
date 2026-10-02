import { Module } from '@nestjs/common';
import { SessionConfigController } from './session-config.controller';
import { SessionConfigService } from './session-config.service';
import { DatabaseModule } from '../database/database.module';
import { DirectoryModule } from '../directory/directory.module';

@Module({
  imports: [DatabaseModule, DirectoryModule],
  controllers: [SessionConfigController],
  providers: [SessionConfigService],
  exports: [SessionConfigService],
})
export class SessionConfigModule {}
