import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { DatabaseModule } from '../database/database.module';
import { ACADEMIC_DEPARTMENTS_PROVIDER } from './academic-departments.contract';
import { PrismaAcademicDepartmentsProvider } from './academic-departments.provider';
import { PluginsModule } from '../plugins/plugins.module';

@Module({
  imports: [DatabaseModule, PluginsModule],
  providers: [
    PrismaAcademicDepartmentsProvider,
    { provide: ACADEMIC_DEPARTMENTS_PROVIDER, useExisting: PrismaAcademicDepartmentsProvider },
    DepartmentsService,
  ],
  controllers: [DepartmentsController],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
