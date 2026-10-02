import { Controller, Get, UseGuards } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('status')
  status() {
    return this.backup.status();
  }
}

