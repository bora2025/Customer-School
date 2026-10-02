import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ConflictException } from '@nestjs/common';
import { StudyYearsService } from './study-years.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PluginExtensionsService } from '../plugins/plugin-extensions.service';

const PLUGIN_ID = 'wattanam.attendance-manager';

export function attendanceStudyYearsRouteOwner(value = process.env.ATTENDANCE_STUDY_YEARS_ROUTE_OWNER ?? process.env.ACADEMIC_STUDY_YEARS_ROUTE_OWNER): 'legacy' | 'plugin' {
  const owner = String(value || 'legacy').trim().toLowerCase();
  if (owner !== 'legacy' && owner !== 'plugin') throw new Error('ATTENDANCE_STUDY_YEARS_ROUTE_OWNER must be legacy or plugin');
  return owner;
}

/** @deprecated Compatibility alias for existing operator tooling. */
export const academicStudyYearsRouteOwner = attendanceStudyYearsRouteOwner;

@Controller('study-years')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudyYearsController {
  constructor(
    private studyYearsService: StudyYearsService,
    private readonly extensions: PluginExtensionsService,
  ) {}

  @Get()
  async getAll(@Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('GET', 'study-years', req, {})
      : this.studyYearsService.getAll();
  }

  @Get('current')
  async getCurrent(@Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('GET', 'study-years/current', req, {})
      : this.studyYearsService.getCurrent();
  }

  @Roles('ADMIN')
  @Post()
  async create(@Body() data: { year: number; label?: string; startDate?: string; endDate?: string; schoolName?: string; logoUrl?: string }, @Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('POST', 'study-years', req, data);
    return this.studyYearsService.create(data);
  }

  @Roles('ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() data: { year?: number; label?: string; startDate?: string; endDate?: string; schoolName?: string; logoUrl?: string | null }, @Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('PUT', `study-years/${id}`, req, data, { id });
    return this.studyYearsService.update(id, data);
  }

  @Roles('ADMIN')
  @Post(':id/set-current')
  async setCurrent(@Param('id') id: string, @Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('POST', `study-years/${id}/set-current`, req, {}, { id });
    return this.studyYearsService.setCurrent(id);
  }

  @Roles('ADMIN')
  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('DELETE', `study-years/${id}`, req, {}, { id });
    return this.studyYearsService.delete(id);
  }

  private pluginOwned() {
    return attendanceStudyYearsRouteOwner() === 'plugin';
  }

  private assertLegacyMutationOwner() {
    // StudyYear mutations now dispatch to the plugin in plugin mode; this helper
    // remains only for any future route that must stay legacy-only.
    if (this.pluginOwned()) {
      throw new ConflictException('Attendance Manager Study Year writes require a certified consistency policy; keep the route owner at legacy');
    }
  }

  private dispatch(method: 'GET' | 'POST' | 'PUT' | 'DELETE', route: string, req: any, body: unknown, params: Record<string, string> = {}) {
    return this.extensions.dispatch(PLUGIN_ID, {
      method,
      path: route,
      params,
      query: {},
      body,
      principal: {
        userId: req.user?.userId,
        role: req.user?.role,
        email: req.user?.email,
      },
    });
  }
}
