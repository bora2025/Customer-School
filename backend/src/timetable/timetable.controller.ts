import {
  Controller, Get, Post, Put, Delete, Patch,
  Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { TimetableService } from './timetable.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('timetable')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TimetableController {
  constructor(private readonly svc: TimetableService) {}

  // â”€â”€â”€ Timetable documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Get()
  list() { return this.svc.listTimetables(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.getTimetable(id); }

  @Roles('ADMIN')
  @Post()
  create(@Body() body: any) { return this.svc.createTimetable(body); }

  @Roles('ADMIN')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateTimetable(id, body);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) { return this.svc.deleteTimetable(id); }

  // â”€â”€â”€ Generate (Test button) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/generate')
  generate(@Param('id') id: string) { return this.svc.generateTimetable(id); }

  // â”€â”€â”€ Subjects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/subjects')
  createSubject(@Param('id') timetableId: string, @Body() body: any) {
    return this.svc.createSubject(timetableId, body);
  }

  @Roles('ADMIN')
  @Put('subjects/:id')
  updateSubject(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateSubject(id, body);
  }

  @Roles('ADMIN')
  @Delete('subjects/:id')
  deleteSubject(@Param('id') id: string) { return this.svc.deleteSubject(id); }

  // â”€â”€â”€ Classes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/classes')
  createClass(@Param('id') timetableId: string, @Body() body: any) {
    return this.svc.createClass(timetableId, body);
  }

  @Roles('ADMIN')
  @Put('classes/:id')
  updateClass(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateClass(id, body);
  }

  @Roles('ADMIN')
  @Delete('classes/:id')
  deleteClass(@Param('id') id: string) { return this.svc.deleteClass(id); }

  // â”€â”€â”€ Classrooms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/classrooms')
  createClassroom(@Param('id') timetableId: string, @Body() body: any) {
    return this.svc.createClassroom(timetableId, body);
  }

  @Roles('ADMIN')
  @Put('classrooms/:id')
  updateClassroom(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateClassroom(id, body);
  }

  @Roles('ADMIN')
  @Delete('classrooms/:id')
  deleteClassroom(@Param('id') id: string) { return this.svc.deleteClassroom(id); }

  // â”€â”€â”€ Teachers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/teachers')
  createTeacher(@Param('id') timetableId: string, @Body() body: any) {
    return this.svc.createTeacher(timetableId, body);
  }

  @Roles('ADMIN')
  @Put('teachers/:id')
  updateTeacher(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateTeacher(id, body);
  }

  @Roles('ADMIN')
  @Delete('teachers/:id')
  deleteTeacher(@Param('id') id: string) { return this.svc.deleteTeacher(id); }

  // â”€â”€â”€ Lessons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/lessons')
  createLesson(@Param('id') timetableId: string, @Body() body: any) {
    return this.svc.createLesson(timetableId, body);
  }

  @Roles('ADMIN')
  @Put('lessons/:id')
  updateLesson(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateLesson(id, body);
  }

  @Roles('ADMIN')
  @Delete('lessons/:id')
  deleteLesson(@Param('id') id: string) { return this.svc.deleteLesson(id); }

  // â”€â”€â”€ Entries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Roles('ADMIN')
  @Post(':id/entries')
  upsertEntry(@Param('id') timetableId: string, @Body() body: any) {
    return this.svc.upsertEntry(timetableId, body);
  }

  @Roles('ADMIN')
  @Delete('entries/:id')
  deleteEntry(@Param('id') id: string) { return this.svc.deleteEntry(id); }

  // â”€â”€â”€ Teacher Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Post('teacher-attendance/scan')
  scanQr(@Body() body: { qrCode: string; period: number }) {
    return this.svc.markTeacherAttendanceByQr(body.qrCode, body.period);
  }

  @Roles('ADMIN', 'WATTAMAN')
  @Post('teacher-attendance/wattaman-scan')
  wattamanTeacherScan(
    @Request() req,
    @Body() body: { qrCode: string; latitude?: number; longitude?: number; location?: string },
  ) {
    return this.svc.wattamanTeacherScan(
      body.qrCode,
      req.user.userId,
      body.latitude,
      body.longitude,
      body.location,
    );
  }

  @Get('scheduled-teachers/all')
  getAllScheduledTeachers() {
    return this.svc.getAllScheduledTeachers();
  }

  @Roles('ADMIN')
  @Post('teacher-attendance/mark')
  markAttendance(@Body() body: { teacherId: string; date: string; period: number; status: string }) {
    return this.svc.markTeacherAttendance(body.teacherId, body.date, body.period, body.status);
  }

  @Roles('ADMIN')
  @Get(':id/teacher-attendance')
  getTeacherReport(
    @Param('id') timetableId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.svc.getTeacherAttendanceReport(timetableId, startDate, endDate);
  }

  @Get(':id/teacher-attendance/monthly')
  getTeacherMonthly(
    @Param('id') timetableId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.svc.getTeacherAttendanceMonthly(timetableId, startDate, endDate);
  }
}
