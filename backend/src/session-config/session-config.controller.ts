import { Controller, Get, Post, Delete, Body, Query, UseGuards } from '@nestjs/common';
import { Request } from '@nestjs/common';
import { SessionConfigService } from './session-config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('session-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionConfigController {
  constructor(private sessionConfigService: SessionConfigService) {}

  @Get()
  async getConfigs(@Query('classId') classId?: string) {
    return this.sessionConfigService.getConfigs(classId || undefined);
  }

  @Get('global')
  async getGlobalDefaults() {
    return this.sessionConfigService.getGlobalDefaults();
  }

  @Get('staff')
  async getStaffDefaults() {
    return this.sessionConfigService.getStaffDefaults();
  }

  /** Save all 4 session configs (global or per-class) */
  @Roles('ADMIN')
  @Post()
  async saveConfigs(
    @Body()
    body: {
      classId?: string | null;
      scope?: string;
      configs: Array<{ session: number; type: string; startTime: string; endTime: string }>;
    },
  ) {
    return this.sessionConfigService.saveAllConfigs(body.configs, body.classId, body.scope);
  }

  /** Delete class-specific overrides */
  @Roles('ADMIN')
  @Delete()
  async deleteClassConfigs(@Query('classId') classId: string) {
    return this.sessionConfigService.deleteClassConfigs(classId);
  }

  /** Get attendance format rules (all scopes or specific) */
  @Get('format-rules')
  async getFormatRules(@Request() req, @Query('scope') scope?: string) {
    const orgId = req?.user?.role === 'ADMIN'
      ? await this.sessionConfigService.getUserOrganizationId(req.user.userId)
      : null;
    if (scope) {
      return this.sessionConfigService.getFormatRules(scope, orgId);
    }
    return this.sessionConfigService.getAllFormatRules(orgId);
  }

  /** Save attendance format rules for a scope */
  @Roles('ADMIN')
  @Post('format-rules')
  async saveFormatRules(
    @Request() req,
    @Body()
    body: {
      scope: string;
      permissionsPerAbsent: number;
      latesPerAbsentHalf: number;
      absentSessionsForDayAbsent?: number;
      teacherLateGraceMinutes?: number;
      caseStudyABEnabled?: boolean;
      enabled: boolean;
    },
  ) {
    const orgId = req?.user?.role === 'ADMIN'
      ? await this.sessionConfigService.getUserOrganizationId(req.user.userId)
      : null;
    return this.sessionConfigService.saveFormatRules({
      ...body,
      organizationId: orgId,
      caseStudyABEnabled: body.caseStudyABEnabled ?? true,
    });
  }

  /** Get the global staff weekly schedule (which weekdays are working/day-off) */
  @Get('staff-schedule')
  async getStaffSchedule() {
    return this.sessionConfigService.getStaffWeeklySchedule();
  }

  /** Save the global staff weekly schedule */
  @Roles('ADMIN')
  @Post('staff-schedule')
  async saveStaffSchedule(@Body() body: { schedule: Record<string, string> }) {
    return this.sessionConfigService.saveStaffWeeklySchedule(body.schedule);
  }
}
