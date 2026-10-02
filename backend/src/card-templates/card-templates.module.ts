import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CardTemplatesController } from './card-templates.controller';
import { CardTemplatesService } from './card-templates.service';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [DatabaseModule, PluginsModule],
  controllers: [CardTemplatesController],
  providers: [CardTemplatesService],
})
export class CardTemplatesModule {}
