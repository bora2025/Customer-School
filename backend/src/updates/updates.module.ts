import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { DatabaseModule } from '../database/database.module';
import { PluginsModule } from '../plugins/plugins.module';
import { UpdatesController } from './updates.controller';
import { UpdatesService } from './updates.service';
import { MaintenanceModeMiddleware } from './maintenance-mode.middleware';

@Module({
  imports: [DatabaseModule, PluginsModule, BackupModule],
  controllers: [UpdatesController],
  providers: [UpdatesService, MaintenanceModeMiddleware],
  exports: [UpdatesService],
})
export class UpdatesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(MaintenanceModeMiddleware).forRoutes('{*splat}'); }
}
