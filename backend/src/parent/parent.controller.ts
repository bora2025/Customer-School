import { Controller, Get, Post, Patch, Body, Query, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ParentService } from './parent.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('parent')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParentController {
  constructor(private svc: ParentService) {}

  @Roles('PARENT', 'ADMIN')
  @Get('children')
  getChildren(@Request() req: any) { return this.svc.getChildren(req.user.userId); }

  @Roles('PARENT', 'ADMIN')
  @Get('children/:studentId/attendance')
  getAttendance(
    @Param('studentId') studentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getChildAttendance(studentId, from, to);
  }

  @Roles('PARENT', 'ADMIN')
  @Get('children/:studentId/grades')
  getGrades(@Param('studentId') studentId: string) { return this.svc.getChildGrades(studentId); }

  @Roles('PARENT', 'ADMIN')
  @Get('children/:studentId/fees')
  getFees(@Param('studentId') studentId: string) { return this.svc.getChildFees(studentId); }

  // ─── Student-side parent link ──────────────────────────────────────────
  @Roles('STUDENT')
  @Get('my-parent')
  getMyParent(@Request() req: any) { return this.svc.getMyParent(req.user.userId); }

  @Roles('STUDENT')
  @Get('my-parent/request')
  getMyParentRequest(@Request() req: any) { return this.svc.getMyParentRequest(req.user.userId); }

  @Roles('STUDENT')
  @Post('my-parent/request')
  async createMyParentRequest(
    @Request() req: any,
    @Body() body: { parentEmail: string; parentName?: string; parentPhone?: string; note?: string },
  ) {
    try {
      return await this.svc.createParentLinkRequest(req.user.userId, body);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Failed to create request');
    }
  }

  // ─── Admin: list & resolve link requests ───────────────────────────────
  @Roles('ADMIN')
  @Get('admin/link-requests')
  listLinkRequests(@Query('status') status?: string) { return this.svc.listParentLinkRequests(status); }

  @Roles('ADMIN')
  @Patch('admin/link-requests/:id')
  async resolveLinkRequest(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; rejectReason?: string },
  ) {
    if (body?.action !== 'APPROVE' && body?.action !== 'REJECT') {
      throw new BadRequestException('action must be APPROVE or REJECT');
    }
    try {
      return await this.svc.resolveParentLinkRequest(req.user.userId, id, body);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Failed to resolve request');
    }
  }
}
