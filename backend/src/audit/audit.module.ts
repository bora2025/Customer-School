import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { DatabaseModule } from '../database/database.module';

/**
 * Global audit module. Exposes `AuditService` for hand-tagged event logging
 * and installs `AuditInterceptor` app-wide so every mutating authenticated
 * request is automatically recorded.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
