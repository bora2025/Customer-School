import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BackupModule } from '../backup/backup.module';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RequestLoggingMiddleware } from './request-logging.middleware';

@Module({
  imports: [DatabaseModule, BackupModule],
  controllers: [MetricsController],
  providers: [MetricsService, RequestLoggingMiddleware],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('{*splat}');
  }
}
