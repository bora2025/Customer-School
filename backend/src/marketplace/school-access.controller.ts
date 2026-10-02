import { Controller, Get } from '@nestjs/common';
import { SchoolAccessService } from './school-access.service';

/**
 * Public, and open while the school is locked -- it is on the lock's allow-list. The lock screen polls
 * it to send people back to work the moment the bill is settled. It says only whether the school is
 * locked and what the school is called: never an amount, and never the reason.
 */
@Controller('school-access')
export class SchoolAccessController {
  constructor(private readonly access: SchoolAccessService) {}

  @Get()
  status() {
    return this.access.publicStatus();
  }
}
