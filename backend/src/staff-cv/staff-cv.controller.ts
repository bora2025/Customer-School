import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { StaffCvService } from './staff-cv.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('staff-cv')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffCvController {
  constructor(private svc: StaffCvService) {}

  @Roles('ADMIN')
  @Get(':userId')
  getCv(@Param('userId') userId: string) {
    return this.svc.getCv(userId);
  }

  @Roles('ADMIN')
  @Put(':userId')
  saveCv(@Param('userId') userId: string, @Body() body: any) {
    return this.svc.saveCv(userId, body);
  }
}
