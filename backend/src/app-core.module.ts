import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { runsBackgroundJobs } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InstallationModule } from './installation/installation.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { SchoolAccessModule } from './marketplace/school-access.module';
import { SchoolBillingAccessGuard } from './marketplace/school-billing-access.guard';
import { NotificationModule } from './notification/notification.module';
import { NotificationPreferenceModule } from './notification-preference/notification-preference.module';
import { ObservabilityModule } from './observability/observability.module';
import { PluginsModule } from './plugins/plugins.module';
import { SiteSettingsModule } from './site-settings/site-settings.module';
import { UpdatesModule } from './updates/updates.module';

/**
 * Physical lean-core composition.
 *
 * This module intentionally does not import AppModule or the root module registry: both describe
 * the transitional legacy-full process and therefore keep optional modules reachable by a
 * compiler/bundler. A core artifact must make those modules unreachable at build time, not merely
 * omit them from Nest's runtime imports array.
 */
@Module({})
export class AppCoreModule {
  static register(): DynamicModule {
    return {
      module: AppCoreModule,
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
        ScheduleModule.forRoot({
          cronJobs: runsBackgroundJobs(),
          intervals: runsBackgroundJobs(),
          timeouts: runsBackgroundJobs(),
        }),
        DatabaseModule,
        SchoolAccessModule,
        AuditModule,
        AuthModule,
        BackupModule,
        HealthModule,
        InstallationModule,
        PluginsModule,
        UpdatesModule,
        MarketplaceModule,
        ObservabilityModule,
        SiteSettingsModule,
        NotificationModule,
        NotificationPreferenceModule,
      ],
      controllers: [AppController],
      providers: [
        AppService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SchoolBillingAccessGuard },
      ],
    };
  }
}

