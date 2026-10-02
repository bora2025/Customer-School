import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PluginExtensionsService } from '../plugins/plugin-extensions.service';

const PLUGIN_ID = 'wattanam.academic-management';
export function academicDepartmentsRouteOwner(value = process.env.ACADEMIC_DEPARTMENTS_ROUTE_OWNER): 'legacy' | 'plugin' {
  const owner = String(value || 'legacy').trim().toLowerCase();
  if (owner !== 'legacy' && owner !== 'plugin') throw new Error('ACADEMIC_DEPARTMENTS_ROUTE_OWNER must be legacy or plugin');
  return owner;
}

@Controller('departments')
export class DepartmentsController {
  constructor(private departmentsService: DepartmentsService, private readonly extensions: PluginExtensionsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Request() req: any) {
    return this.pluginOwned() ? this.dispatch('GET', 'departments', req, {}) : this.departmentsService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  async create(@Body() body: { name: string; nameKh?: string; description?: string }, @Request() req: any) {
    try {
      return this.pluginOwned() ? await this.dispatch('POST', 'departments', req, body) : await this.departmentsService.create(body);
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new HttpException('Department name already exists', HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; nameKh?: string; description?: string }, @Request() req: any) {
    try {
      return this.pluginOwned() ? await this.dispatch('PUT', `departments/${id}`, req, body, { id }) : await this.departmentsService.update(id, body);
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new HttpException('Department name already exists', HttpStatus.BAD_REQUEST);
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    return this.pluginOwned()
      ? this.dispatch('DELETE', `departments/${id}`, req, { idempotencyKey: `delete-department:${id}` }, { id })
      : this.departmentsService.delete(id);
  }

  private pluginOwned() { return academicDepartmentsRouteOwner() === 'plugin'; }

  private dispatch(method: 'GET' | 'POST' | 'PUT' | 'DELETE', route: string, req: any, body: unknown, params: Record<string, string> = {}) {
    return this.extensions.dispatch(PLUGIN_ID, {
      method, path: route, params, query: {}, body,
      principal: { userId: req.user?.userId, role: req.user?.role, email: req.user?.email },
    });
  }
}
