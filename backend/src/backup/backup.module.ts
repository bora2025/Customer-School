import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { StorageModule } from '../storage/storage.module';
import { OFFSITE_BACKUP, OffsiteBackupUploader, readOffsiteBackupConfig } from './offsite-backup';

@Module({
  imports: [StorageModule],
  controllers: [BackupController],
  providers: [
    BackupService,
    // Invalid off-site configuration fails at boot rather than silently at 02:00.
    { provide: OFFSITE_BACKUP, useFactory: () => { const config = readOffsiteBackupConfig(); return config ? new OffsiteBackupUploader(config) : null; } },
  ],
  exports: [BackupService],
})
export class BackupModule {}
