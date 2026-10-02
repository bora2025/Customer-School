import { Controller, Get, Post, Put, Patch, Body, Query, Param, Delete, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Request, ConflictException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClassesService } from './classes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PluginExtensionsService } from '../plugins/plugin-extensions.service';

const PLUGIN_ID = 'wattanam.academic-management';

export function academicClassesRouteOwner(value = process.env.ACADEMIC_CLASSES_ROUTE_OWNER): 'legacy' | 'plugin' {
  const owner = String(value || 'legacy').trim().toLowerCase();
  if (owner !== 'legacy' && owner !== 'plugin') throw new Error('ACADEMIC_CLASSES_ROUTE_OWNER must be legacy or plugin');
  return owner;
}

@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassesController {
  constructor(
    private classesService: ClassesService,
    private readonly extensions: PluginExtensionsService,
  ) {}

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Post()
  async createClass(@Request() req: any, @Body() data: { name: string; subject?: string; teacherId: string; classAdminId?: string; schedule?: string; studyYearId?: string; registrationStatus?: string; thumbnail?: string; description?: string; price?: number | null; showPrice?: boolean }) {
    if (this.pluginOwned()) return this.dispatch('POST', 'classes', req, data);
    return this.classesService.createClass(data);
  }

  @Get()
  async getClasses(
    @Request() req: any,
    @Query('teacherId') teacherId?: string,
    @Query('studyYearId') studyYearId?: string,
  ) {
    // CLASS_ADMIN always sees only classes assigned to them
    if (this.pluginOwned()) {
      const query: Record<string, string> = {};
      if (req?.user?.role === 'CLASS_ADMIN') {
        query.classAdminId = req.user.userId;
      } else {
        const resolvedTeacherId = teacherId === 'me' ? req?.user?.userId : teacherId;
        if (resolvedTeacherId) query.teacherId = resolvedTeacherId;
      }
      if (studyYearId) query.studyYearId = studyYearId;
      return this.dispatch('GET', 'classes', req, {}, query);
    }
    if (req?.user?.role === 'CLASS_ADMIN') {
      return this.classesService.getClassesByAdmin(req.user.userId, studyYearId);
    }
    // Alias 'me' resolves to the current user's id (useful for teachers)
    const resolvedTeacherId = teacherId === 'me' ? req?.user?.userId : teacherId;
    return this.classesService.getClasses(resolvedTeacherId, studyYearId);
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Get('parents')
  async listParents(@Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('GET', 'classes/parents', req, {});
    return this.classesService.listParents();
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Put(':id')
  async updateClass(@Request() req: any, @Param('id') id: string, @Body() data: { name?: string; subject?: string; teacherId?: string; classAdminId?: string | null; schedule?: string; studyYearId?: string; registrationStatus?: string; thumbnail?: string; description?: string; price?: number | null; showPrice?: boolean }) {
    if (this.pluginOwned()) return this.dispatch('PUT', `classes/${id}`, req, data, { id });
    return this.classesService.updateClass(id, data);
  }

  @Get(':id/students')
  async getStudentsInClass(@Request() req: any, @Param('id') classId: string) {
    if (this.pluginOwned()) return this.dispatch('GET', `classes/${classId}/students`, req, {}, {}, { id: classId });
    return this.classesService.getStudentsInClass(classId);
  }

  /**
   * Batch endpoint: fetch students for many classes in one round-trip.
   * Query: ?ids=classId1,classId2,...
   * Returns: { [classId]: Student[] }
   */
  @Get('students/batch')
  async getStudentsByClasses(@Request() req: any, @Query('ids') ids?: string) {
    const classIds = (ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (this.pluginOwned()) return this.dispatch('GET', 'classes/students/batch', req, {}, { ids: classIds.join(',') });
    return this.classesService.getStudentsByClasses(classIds);
  }

  @Roles('ADMIN', 'CLASS_ADMIN', 'TEACHER')
  @Patch(':classId/students/:studentId')
  async updateStudent(
    @Request() req: any,
    @Param('classId') classId: string,
    @Param('studentId') studentId: string,
    @Body() data: { name?: string; nameKh?: string; sex?: string; phone?: string; photo?: string; dateOfBirth?: string; address?: string; generation?: string; studentNumber?: string; parentId?: string | null; customFieldValues?: Record<string, string> },
  ) {
    if (this.pluginOwned()) return this.dispatch('PATCH', `classes/${classId}/students/${studentId}`, req, data, {}, { classId, studentId });
    return this.classesService.updateStudent(studentId, data);
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Post(':id/students')
  async addStudentToClass(@Request() req: any, @Param('id') classId: string, @Body() data: { studentId: string }) {
    if (this.pluginOwned()) return this.dispatch('POST', `classes/${classId}/students`, req, data, {}, { id: classId });
    return this.classesService.addStudentToClass(classId, data.studentId);
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Post(':id/students/bulk-csv')
  @UseInterceptors(FileInterceptor('file'))
  async bulkAddStudentsFromCsv(@Request() req: any, @Param('id') classId: string, @UploadedFile() file: Express.Multer.File) {
    if (this.pluginOwned()) {
      if (!file) throw new BadRequestException('CSV file is required');
      return this.dispatch('POST', `classes/${classId}/students/bulk-csv`, req, { csv: file.buffer.toString('utf8') }, {}, { id: classId });
    }
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }
    return this.classesService.bulkAddStudentsFromCsv(classId, file.buffer);
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Delete(':id')
  async deleteClass(@Request() req: any, @Param('id') id: string) {
    if (this.pluginOwned()) return this.dispatch('DELETE', `classes/${id}`, req, {}, { id });
    return this.classesService.deleteClass(id);
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Post('cleanup-orphaned-students')
  async cleanupOrphanedStudents(@Request() req: any) {
    if (this.pluginOwned()) return this.dispatch('POST', 'classes/cleanup-orphaned-students', req, {});
    return this.classesService.cleanupOrphanedStudents();
  }

  @Roles('ADMIN', 'CLASS_ADMIN')
  @Delete(':id/students/:studentId')
  async removeStudentFromClass(@Request() req: any, @Param('id') classId: string, @Param('studentId') studentId: string) {
    if (this.pluginOwned()) return this.dispatch('DELETE', `classes/${classId}/students/${studentId}`, req, {}, {}, { id: classId, studentId });
    return this.classesService.removeStudentFromClass(classId, studentId);
  }

  @Get(':id/available-students')
  async getAvailableStudents(@Request() req: any, @Param('id') classId: string) {
    if (this.pluginOwned()) return this.dispatch('GET', `classes/${classId}/available-students`, req, {}, {}, { id: classId });
    return this.classesService.getAvailableStudents(classId);
  }

  private pluginOwned() {
    return academicClassesRouteOwner() === 'plugin';
  }

  private assertLegacyMutationOwner() {
    if (this.pluginOwned()) {
      throw new ConflictException('Academic Class writes require a certified consistency policy; keep the route owner at legacy');
    }
  }

  private dispatch(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', route: string, req: any, body: unknown, query: Record<string, string> = {}, params: Record<string, string> = {}) {
    return this.extensions.dispatch(PLUGIN_ID, {
      method,
      path: route,
      params,
      query,
      body,
      principal: {
        userId: req.user?.userId,
        role: req.user?.role,
        email: req.user?.email,
      },
    });
  }
}
