import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards, Request, BadRequestException, ConflictException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClassRegistrationsService } from './class-registrations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PluginExtensionsService } from '../plugins/plugin-extensions.service';

const PLUGIN_ID = 'wattanam.academic-management';

export function academicClassRegistrationsRouteOwner(value = process.env.ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER): 'legacy' | 'plugin' {
  const owner = String(value || 'legacy').trim().toLowerCase();
  if (owner !== 'legacy' && owner !== 'plugin') throw new Error('ACADEMIC_CLASS_REGISTRATIONS_ROUTE_OWNER must be legacy or plugin');
  return owner;
}

@Controller('class-registrations')
export class ClassRegistrationsController {
  constructor(
    private svc: ClassRegistrationsService,
    private readonly extensions: PluginExtensionsService,
  ) {}

  // ─── Public — no auth required ─────────────────────────────────────────
  @Get('public/classes')
  async listPublicClasses() {
    if (!this.pluginOwned()) return this.svc.listPublicClasses();
    return this.extensions.dispatch(PLUGIN_ID, {
      method: 'GET',
      path: 'admissions/public/classes',
      params: {},
      query: {},
      body: {},
      principal: { userId: 'system-public-route', role: 'SUPER_ADMIN', email: undefined },
    });
  }

  @Get('public/form-config')
  async getFormConfig() {
    if (!this.pluginOwned()) return this.svc.getFormConfig();
    return this.extensions.dispatch(PLUGIN_ID, {
      method: 'GET',
      path: 'admissions/public/form-config',
      params: {},
      query: {},
      body: {},
      principal: { userId: 'system-public-route', role: 'SUPER_ADMIN', email: undefined },
    });
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('public')
  async submit(
    @Body()
    body: {
      classId: string;
      nameKh?: string;
      nameEn: string;
      email?: string;
      phone?: string;
      password?: string;
      photo?: string;
      sex?: string;
      dateOfBirth?: string;
      address?: string;
      generation?: string;
      customFieldValues?: Record<string, string | string[]>;
    },
  ) {
    if (this.pluginOwned()) {
      return this.dispatch('POST', 'admissions/public/submit', { user: { userId: 'system-public-route', role: 'SUPER_ADMIN' } }, body);
    }
    return this.svc.createRegistration(body);
  }

  // ─── Admin: form settings & custom fields ───────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('settings')
  getSettings(@Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('GET', 'admissions/settings', req, {});
    return this.svc.getSettings();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(
    @Request() req: any,
    @Body()
    body: {
      khmerNameMode?: string;
      phoneMode?: string;
      emailMode?: string;
      photoMode?: string;
      passwordMode?: string;
      sexMode?: string;
      dateOfBirthMode?: string;
      addressMode?: string;
      generationMode?: string;
    },
  ) {
    if (this.pluginOwned()) return this.dispatch('PATCH', 'admissions/settings', req, body);
    return this.svc.updateSettings(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('fields')
  listFields(@Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('GET', 'admissions/fields', req, {});
    return this.svc.listFields();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('fields')
  createField(@Request() req: any, @Body() body: { label: string; required?: boolean; fieldType?: string; options?: string[] }) {
    if (this.pluginOwned()) return this.dispatch('POST', 'admissions/fields', req, body);
    return this.svc.createField(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('fields/reorder')
  reorderFields(@Request() req: any, @Body() body: { ids: string[] }) {
    if (this.pluginOwned()) return this.dispatch('POST', 'admissions/fields/reorder', req, body);
    return this.svc.reorderFields(body?.ids);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('fields/:id')
  updateField(@Request() req: any, @Param('id') id: string, @Body() body: { label?: string; required?: boolean; enabled?: boolean; fieldType?: string; options?: string[] }) {
    if (this.pluginOwned()) return this.dispatch('PATCH', `admissions/fields/${id}`, req, body);
    return this.svc.updateField(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('fields/:id')
  deleteField(@Request() req: any, @Param('id') id: string) {
    if (this.pluginOwned()) return this.dispatch('DELETE', `admissions/fields/${id}`, req, {});
    return this.svc.deleteField(id);
  }

  // ─── Admin: list & resolve ──────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'CLASS_ADMIN')
  @Get('unread-count')
  async unreadCount(@Request() req: any) {
    return this.svc.countPending(req.user?.role, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'CLASS_ADMIN')
  @Get()
  async list(@Request() req: any, @Query('status') status?: string) {
    return this.svc.listRegistrations(status, req.user?.role, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'CLASS_ADMIN')
  @Patch(':id')
  async resolve(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; rejectReason?: string },
  ) {
    if (this.pluginOwned()) {
      return this.dispatch('PATCH', `admissions/registrations/${id}/resolve`, req, body);
    }
    if (body?.action !== 'APPROVE' && body?.action !== 'REJECT') {
      throw new BadRequestException('action must be APPROVE or REJECT');
    }
    return this.svc.resolveRegistration(req.user.userId, id, body);
  }

  private pluginOwned() {
    return academicClassRegistrationsRouteOwner() === 'plugin';
  }

  private assertLegacyMutationOwner() {
    if (this.pluginOwned()) {
      throw new ConflictException('Academic admissions writes require a certified consistency policy; keep the route owner at legacy');
    }
  }

  private dispatch(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', route: string, req: any, body: unknown) {
    return this.extensions.dispatch(PLUGIN_ID, {
      method,
      path: route,
      params: {},
      query: {},
      body,
      principal: {
        userId: req?.user?.userId ?? 'system-public-route',
        role: req?.user?.role ?? 'SUPER_ADMIN',
        email: req?.user?.email,
      },
    });
  }
}
