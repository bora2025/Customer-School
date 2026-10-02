import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PluginsService } from './plugins.service';
import { PluginPermissionsService } from './plugin-permissions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('plugins')
export class PluginsController {
  constructor(
    private readonly plugins: PluginsService,
    private readonly grants: PluginPermissionsService,
  ) {}

  @Get()
  list() {
    return this.plugins.list();
  }

  @Get('runtime-status')
  runtimeStatus() { return this.plugins.runtimeStatus(); }

  @Get('diagnostics')
  diagnostics() { return this.plugins.diagnostics(); }

  @Get(':id/contract-health')
  contractHealth(@Param('id') id: string) { return this.plugins.contractHealth(id); }

  @Post(':id/dead-letters/:deadLetterId/replay')
  replayDeadLetter(@Param('id') id: string, @Param('deadLetterId') deadLetterId: string) { return this.plugins.replayDeadLetter(id, deadLetterId); }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.plugins.activate(id);
  }

  @Post(':id/rollback')
  rollback(@Param('id') id: string) { return this.plugins.rollback(id); }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.plugins.deactivate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.plugins.remove(id); }

  @Get(':id/permission-grants')
  listPermissionGrants(@Param('id') id: string) { return this.grants.list(id); }

  @Post(':id/permission-grants')
  grantPermission(@Param('id') id: string, @Body('permissionId') permissionId: string, @Body('role') role: string) {
    if (!permissionId || !role) throw new BadRequestException('permissionId and role are required');
    return this.grants.grant(id, permissionId, role);
  }

  @Delete(':id/permission-grants/:permissionId/:role')
  revokePermission(@Param('id') id: string, @Param('permissionId') permissionId: string, @Param('role') role: string) {
    return this.grants.revoke(id, permissionId, role);
  }
}
