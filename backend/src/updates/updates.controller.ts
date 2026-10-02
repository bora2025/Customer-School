import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdatesService } from './updates.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('updates')
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get()
  check() { return this.updates.check(); }

  @Post('plugins/:pluginId/:version/install')
  installPlugin(@Param('pluginId') pluginId: string, @Param('version') version: string, @Body() body: { consentDigest?: string }) {
    return this.updates.installPlugin(pluginId, version, String(body?.consentDigest || ''));
  }

  @Post('core/:version/prepare')
  prepareCore(@Param('version') version: string) { return this.updates.prepareCoreUpdate(version); }

  @Post('core/operations/:operationId/complete')
  completeCore(@Param('operationId') operationId: string, @Body() body: { outcome?: unknown; detail?: unknown }) {
    return this.updates.completeCoreUpdate(operationId, body || {});
  }

  @Get('maintenance')
  maintenance() { return this.updates.maintenanceStatus(); }

  @Post('advisories/apply-emergency')
  applyEmergencyAdvisories() { return this.updates.applyEmergencyAdvisories(); }
}
