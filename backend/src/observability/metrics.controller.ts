import { Controller, Get, Header, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { MetricsService } from './metrics.service';
import { matchesAnyToken, readMetricsTokens } from './metrics-config';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(@Req() request: Request) {
    const tokens = readMetricsTokens();
    if (!tokens.length) throw new UnauthorizedException('METRICS_TOKEN is not configured; /metrics is disabled by default');
    if (!matchesAnyToken(request.header('authorization') || '', tokens)) throw new UnauthorizedException('Invalid metrics token');
    return this.metrics.renderPrometheusText();
  }
}
