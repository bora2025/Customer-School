import { Controller, Get, Query, Res, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Response } from 'express';
import { HealthService } from './health/health.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { Roles } from './auth/roles.decorator';

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

    // Only allow http/https image URLs
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Only HTTP/HTTPS URLs are allowed');
    }

    // Block private/internal IPs to prevent SSRF
    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      throw new BadRequestException('Cannot proxy internal URLs');
    }

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SchoolSync-ImageProxy/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        res.status(response.status).send('Failed to fetch image');
        return;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        throw new BadRequestException('URL does not point to an image');
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.send(buffer);
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      res.status(502).send('Failed to fetch image');
    }
  }
}
