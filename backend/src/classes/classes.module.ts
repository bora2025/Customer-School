import { Module } from '@nestjs/common';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { DatabaseModule } from '../database/database.module';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [DatabaseModule, PluginsModule],
  controllers: [ClassesController],
  providers: [ClassesService],
})
export class ClassesModule {}