import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { MetricsService } from './metrics.service';
import { logEvent } from './structured-logger';
import { runWithRequestContext } from './request-context';

const PLUGIN_ROUTE = /^\/plugin-api\/([^/]+)/;

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction) {
    const correlationId = request.header('x-request-id') || randomUUID();
    response.setHeader('x-request-id', correlationId);
    this.metrics.incInFlight();
    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      this.metrics.decInFlight();
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const route = (request.route?.path as string | undefined) ?? (response.statusCode === 404 ? 'not_found' : request.path);
      this.metrics.observeHttpRequest(request.method, route, response.statusCode, durationSeconds);

      const user = (request as Request & { user?: { userId?: string; role?: string } }).user;
      const pluginMatch = PLUGIN_ROUTE.exec(request.path);
      logEvent(response.statusCode >= 500 ? 'error' : 'info', {
        correlationId,
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationMs: Math.round(durationSeconds * 1000),
        actorId: user?.userId ?? null,
        actorRole: user?.role ?? null,
        pluginId: pluginMatch?.[1] ?? null,
        releaseVersion: process.env.APP_VERSION?.trim() || '0.1.0-dev',
        action: `${request.method} ${route}`,
        outcome: response.statusCode < 400 ? 'success' : 'failure',
      });
    });

    runWithRequestContext({ correlationId }, next);
  }
}
