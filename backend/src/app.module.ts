import { DynamicModule, Module, Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { SchoolBillingAccessGuard } from './marketplace/school-billing-access.guard';
import { SchoolAccessModule } from './marketplace/school-access.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AttendanceModule } from './attendance/attendance.module';
import { NotificationModule } from './notification/notification.module';
import { ReportsModule } from './reports/reports.module';
import { ClassesModule } from './classes/classes.module';
import { SessionConfigModule } from './session-config/session-config.module';
import { HolidaysModule } from './holidays/holidays.module';
import { DepartmentsModule } from './departments/departments.module';
import { StudyYearsModule } from './study-years/study-years.module';
import { CardTemplatesModule } from './card-templates/card-templates.module';
import { TimetableModule } from './timetable/timetable.module';
import { ScoringModule } from './scoring/scoring.module';
import { FeesModule } from './fees/fees.module';
import { SalaryModule } from './salary/salary.module';
import { BusModule } from './bus/bus.module';
import { ExamModule } from './exam/exam.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { CoursesModule } from './courses/courses.module';
import { ParentModule } from './parent/parent.module';
import { BackupModule } from './backup/backup.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { NotificationPreferenceModule } from './notification-preference/notification-preference.module';
import { AuditModule } from './audit/audit.module';
import { CardAliasesModule } from './card-aliases/card-aliases.module';
import { SiteSettingsModule } from './site-settings/site-settings.module';
import { PostsModule } from './posts/posts.module';
import { ClassRegistrationsModule } from './class-registrations/class-registrations.module';
import { StaffCvModule } from './staff-cv/staff-cv.module';
import { HealthModule } from './health/health.module';
import { InstallationModule } from './installation/installation.module';
import { PluginsModule } from './plugins/plugins.module';
import { UpdatesModule } from './updates/updates.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { ObservabilityModule } from './observability/observability.module';
import { DataExportModule } from './data-export/data-export.module';
import { Distribution, runsBackgroundJobs } from './config/environment';
import { rootModuleNamesForDistribution } from './distribution/module-registry';

const LOCAL_ROOT_MODULES: Record<string, Type<unknown>> = {
  DatabaseModule, SchoolAccessModule, AuditModule, AuthModule, BackupModule, HealthModule,
  InstallationModule, PluginsModule, UpdatesModule, MarketplaceModule, ObservabilityModule,
  DataExportModule, SiteSettingsModule, NotificationModule, NotificationPreferenceModule,
  AnnouncementsModule, AttendanceModule, ReportsModule, ClassesModule, SessionConfigModule,
  HolidaysModule, DepartmentsModule, StudyYearsModule, CardTemplatesModule, TimetableModule,
  ScoringModule, FeesModule, SalaryModule, BusModule, ExamModule, AssignmentsModule, CoursesModule,
  ParentModule, CardAliasesModule, PostsModule, ClassRegistrationsModule, StaffCvModule,
};

export function localModulesForDistribution(distribution: Distribution): Type<unknown>[] {
  return rootModuleNamesForDistribution(distribution).map((name) => {
    const module = LOCAL_ROOT_MODULES[name];
    if (!module) throw new Error(`Root module registry references an unavailable module: ${name}`);
    return module;
  });
}

@Module({})
export class AppModule {
  static register(distribution: Distribution): DynamicModule {
    return {
      module: AppModule,
      imports: [
        // Rate limiting and scheduling are framework infrastructure, not business modules.
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
        ScheduleModule.forRoot({
          cronJobs: runsBackgroundJobs(),
          intervals: runsBackgroundJobs(),
          timeouts: runsBackgroundJobs(),
        }),
        ...localModulesForDistribution(distribution),
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
