import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InstallDto } from './dto/install.dto';
import { InstallationService } from './installation.service';
import { InstallationPreflightService } from './installation-preflight.service';

@Controller('installation')
export class InstallationController {
  constructor(
    private readonly installationService: InstallationService,
    private readonly preflightService: InstallationPreflightService,
  ) {}

  @Get('status')
  status() {
    return this.installationService.status();
  }

  /** Idempotent dry-run: runs every preflight check without persisting anything. */
  @Throttle({ default: { ttl: 60 * 1000, limit: 10 } })
  @Post('preflight')
  preflight(@Body() dto: InstallDto) {
    return this.preflightService.run({
      locale: dto.locale,
      timezone: dto.timezone,
      currency: dto.currency,
      acceptedLicenseVersion: dto.acceptedLicenseVersion,
    });
  }

  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 3 } })
  @Post('install')
  async install(@Body() dto: InstallDto) {
    const report = await this.preflightService.run({
      locale: dto.locale,
      timezone: dto.timezone,
      currency: dto.currency,
      acceptedLicenseVersion: dto.acceptedLicenseVersion,
    });
    if (!report.ok) {
      const blockers = report.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
      throw new BadRequestException(`Installation preflight failed: ${blockers.join('; ')}`);
    }
    return this.installationService.install(dto);
  }
}
