import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SiteSettingsService, SiteSettingDto } from './site-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('site-settings')
export class SiteSettingsController {
  constructor(private readonly service: SiteSettingsService) {}

  /** Public read — all portals and the homepage can read site settings without auth. */
  @Get()
  async get() {
    return this.service.get();
  }

  /** Admin-only write. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch()
  async update(@Body() dto: SiteSettingDto) {
    return this.service.update(dto);
  }
}
