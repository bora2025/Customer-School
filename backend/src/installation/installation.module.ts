import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { InstallationController } from './installation.controller';
import { InstallationService } from './installation.service';
import { InstallationPreflightService } from './installation-preflight.service';
@Module({
  imports: [DatabaseModule],
  controllers: [InstallationController],
  providers: [InstallationService, InstallationPreflightService],
  exports: [InstallationService, InstallationPreflightService],
})
export class InstallationModule {}
