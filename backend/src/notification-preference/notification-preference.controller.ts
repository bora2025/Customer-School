import { Body, Controller, Get, Patch, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  NotificationPreferenceService,
  UpdatePreferenceDto,
} from './notification-preference.service';

@Controller('notification-preference')
@UseGuards(JwtAuthGuard)
export class NotificationPreferenceController {
  constructor(private service: NotificationPreferenceService) {}

  @Get()
  get(@Request() req: any) {
    return this.service.get(req.user.userId);
  }

  @Patch()
  update(@Request() req: any, @Body() dto: UpdatePreferenceDto) {
    return this.service.update(req.user.userId, dto);
  }
}
