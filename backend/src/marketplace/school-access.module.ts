import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SchoolAccessController } from './school-access.controller';
import { SchoolAccessService } from './school-access.service';
import { SchoolAccessWsGuard } from './school-access.ws-guard';

/**
 * Global so that the HTTP guard, the three gateways, the email digests and plugin jobs all share one
 * SchoolAccessService -- and so one short cache -- without every feature module importing this one.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [SchoolAccessController],
  providers: [SchoolAccessService, SchoolAccessWsGuard],
  exports: [SchoolAccessService, SchoolAccessWsGuard],
})
export class SchoolAccessModule {}
