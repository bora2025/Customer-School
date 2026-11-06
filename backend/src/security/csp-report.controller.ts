import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CspViolationAggregator, summarizeCspReports } from './csp-report';

/** Receives browser Content-Security-Policy reports (gateway path /api/csp-report). Unauthenticated
 * by design: browsers send these without credentials. Input is minimized before logging. */
@Controller('csp-report')
export class CspReportController {
  private readonly logger = new Logger('CSP');
  private readonly aggregator = new CspViolationAggregator();

  @Post()
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  receive(@Body() body: unknown): void {
    for (const violation of summarizeCspReports(body)) {
      const { log, count } = this.aggregator.record(violation);
      // warn: production logs keep only warn/error, and these reports are the input for enforcing.
      if (log) this.logger.warn(`CSP ${violation.disposition} violation: directive=${violation.directive} blocked=${violation.blocked} page=${violation.page} count=${count}`);
    }
  }
}
