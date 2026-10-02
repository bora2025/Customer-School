import { Module } from '@nestjs/common';
import { ClassRegistrationsController } from './class-registrations.controller';
import { ClassRegistrationsService } from './class-registrations.service';
import { AcademicLifecycleSubscriber } from './academic-lifecycle-subscriber.service';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [DatabaseModule, NotificationModule, PluginsModule],
  controllers: [ClassRegistrationsController],
  providers: [ClassRegistrationsService, AcademicLifecycleSubscriber],
})
export class ClassRegistrationsModule {}
