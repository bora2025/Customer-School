import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [PluginsModule],
  controllers: [AnnouncementsController],
})
export class AnnouncementsModule {}
