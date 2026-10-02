import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PrismaAcademicDirectoryProvider } from './academic-directory.provider';
import { ACADEMIC_DIRECTORY_PROVIDER, DirectoryService } from './directory.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    PrismaAcademicDirectoryProvider,
    { provide: ACADEMIC_DIRECTORY_PROVIDER, useExisting: PrismaAcademicDirectoryProvider },
    DirectoryService,
  ],
  exports: [DirectoryService],
})
export class DirectoryModule {}
