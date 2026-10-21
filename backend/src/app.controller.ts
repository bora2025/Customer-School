import { Controller, Get, Query, Res, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';
import { HealthService } from './health/health.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Roles } from './auth/roles.decorator';
import { fetchSafeImage } from './security/safe-image-proxy';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly healthService: HealthService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): object {
    return this.healthService.liveness();
  }

  @Get('health/ready')
  async getReadiness(): Promise<object> {
    try {
      return await this.healthService.readiness();
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        service: 'wattanam-api',
        checks: { database: { status: 'down' } },
      });
    }
  }

  @Get('version')
  getVersion(): object {
    return this.healthService.version();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('diagnostics')
  getDiagnostics() {
    return this.healthService.diagnostics();
  }

  @Get('proxy-image')
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      throw new BadRequestException('url query parameter is required');
    }

    try {
      const image = await fetchSafeImage(url);
      res.set({
        'Content-Type': image.contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(image.buffer);
    } catch {
      throw new BadRequestException('Image URL is unavailable or not permitted');
    }
  }
}
