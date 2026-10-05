import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EntitlementCacheService } from './entitlement-cache.service';
import { readEntitlementConfig } from './entitlement-config';
import { InstallationRegistrationService } from './installation-registration.service';
import { MarketplaceLinkService } from './marketplace-link.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/marketplace')
export class MarketplaceIdentityController {
  constructor(
    private readonly registration: InstallationRegistrationService,
    private readonly entitlements: EntitlementCacheService,
    private readonly link: MarketplaceLinkService,
  ) {}

  @Get('installation')
  async status() {
    return { ...(await this.registration.status()), entitlementKeysConfigured: !!readEntitlementConfig() };
  }

  @Post('installation/register')
  register(@Body() body: { accountId?: string; label?: string; enrollmentToken?: string; owner?: { email?: string; password?: string; code?: string } }) {
    return this.registration.register(body?.accountId, body?.label, body?.enrollmentToken, body?.owner);
  }

  @Post('accounts')
  createAccount(@Body() body: { email?: string; password?: string; displayName?: string }) {
    return this.registration.createMarketplaceAccount(body);
  }

  @Post('password-resets')
  requestPasswordReset(@Body() body: { email?: string }) {
    return this.registration.requestMarketplacePasswordReset(body?.email);
  }

  @Post('password-resets/confirm')
  confirmPasswordReset(@Body() body: { token?: string; newPassword?: string }) {
    return this.registration.confirmMarketplacePasswordReset(body?.token, body?.newPassword);
  }

  @Post('installation/keys/rotate')
  rotateKey() { return this.registration.rotateKey(); }

  @Get('entitlements')
  entitlementStatuses() { return this.entitlements.getAllStatuses(); }

  @Post('entitlements/refresh')
  refreshEntitlements() { return this.entitlements.refreshAll(); }

  @Post('entitlements/:pluginId/refresh')
  refreshEntitlement(@Param('pluginId') pluginId: string) { return this.entitlements.refreshOne(pluginId); }

  @Get('entitlements/:pluginId/export')
  exportEntitlement(@Param('pluginId') pluginId: string) { return this.entitlements.exportOne(pluginId); }

  @Post('entitlements/:pluginId/import')
  importEntitlement(@Param('pluginId') pluginId: string, @Body() body: { signedToken?: unknown }) {
    return this.entitlements.importOne(pluginId, body?.signedToken);
  }

  @Post('link/start')
  startLink(@Body() body: { label?: string }) { return this.link.start(body?.label); }

  @Post('link/poll')
  pollLink(@Body() body: { requestId?: string }) { return this.link.poll(body?.requestId); }

  @Get('link/status')
  linkStatus() { return this.link.status(); }

  @Post('link/revoke')
  revokeLink() { return this.link.revoke(); }
}
