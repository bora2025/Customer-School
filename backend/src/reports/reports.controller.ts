import { Controller, Get, Query, Res, Request, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

function getDateRange(period: string, dateStr?: string): { start: Date; end: Date } {
  const base = dateStr ? new Date(dateStr) : new Date();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();

  switch (period) {
    case 'weekly': {
      const dayOfWeek = base.getUTCDay();
      const monday = new Date(Date.UTC(y, m, d - ((dayOfWeek + 6) % 7)));
      const sunday = new Date(Date.UTC(y, m, d - ((dayOfWeek + 6) % 7) + 6));
      return { start: monday, end: sunday };
    }
    case 'monthly':
      return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 0)) };
    case 'yearly':
      return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 31)) };
    default: // daily
      return { start: new Date(Date.UTC(y, m, d)), end: new Date(Date.UTC(y, m, d)) };
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('system-status')
  async getSystemStatus() {
    return this.reportsService.getSystemStatus();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'WATTAMAN_REPORTER')
  @Get('dashboard-summary')
  async getDashboardSummary(@Request() req, @Query('date') date?: string) {
    return this.reportsService.getDashboardSummary(
      date ? new Date(date) : undefined,
      req?.user?.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'WATTAMAN_REPORTER')
  @Get('class-attendance-progress')
  async getClassAttendanceProgress(@Request() req, @Query('date') date?: string) {
    return this.reportsService.getClassAttendanceProgress(
      date ? new Date(date) : undefined,
      req?.user?.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('monthly-trend')
  async getMonthlyTrend(@Query('year') year?: string, @Query('month') month?: string) {
    const y = year ? parseInt(year, 10) : new Date().getUTCFullYear();
    const m = month ? parseInt(month, 10) : new Date().getUTCMonth() + 1;
    return this.reportsService.getMonthlyTrend(y, m);
  }

  @UseGuards(JwtAuthGuard)
  @Get('attendance-summary')
  async getAttendanceSummary(@Query('classId') classId?: string, @Query('date') date?: string) {
    return this.reportsService.getAttendanceSummary(classId, date ? new Date(date) : undefined);
  }

  @UseGuards(JwtAuthGuard)
  @Get('student-attendance')
  async getStudentAttendance(
    @Query('studentId') studentId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.reportsService.getStudentAttendance(studentId, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('audit-logs')
  async getAuditLogs() {
    return this.reportsService.getAuditLogs();
  }

  @UseGuards(JwtAuthGuard)
  @Get('class-summaries')
  async getClassSummaries(
    @Query('teacherId') teacherId: string,
    @Query('date') date?: string,
    @Query('session') session?: string,
  ) {
    return this.reportsService.getClassSummaries(
      teacherId,
      date ? new Date(date) : undefined,
      session ? parseInt(session, 10) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('daily-summary')
  async getDailySummary(@Query('date') date?: string) {
    return this.reportsService.getDailySummary(date ? new Date(date) : undefined);
  }

  @UseGuards(JwtAuthGuard)
  @Get('class-student-detail')
  async getClassStudentDetail(
    @Query('classId') classId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getClassStudentDetail(classId, new Date(startDate), new Date(endDate));
  }

  @UseGuards(JwtAuthGuard)
  @Get('attendance-grid')
  async getAttendanceGrid(
    @Query('classId') classId: string,
    @Query('date') date: string,
  ) {
    return this.reportsService.getAttendanceGrid(classId, new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('attendance-totals')
  async getAttendanceTotals(
    @Query('classId') classId: string,
    @Query('date') date: string,
  ) {
    return this.reportsService.getAttendanceTotals(classId, new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('export-grid')
  async exportGrid(
    @Query('classId') classId: string,
    @Query('date') date: string,
    @Res() res?: Response,
  ) {
    const csv = await this.reportsService.exportAttendanceGrid(classId, new Date(date));
    const fileName = `attendance_grid_${date}.csv`;
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(bom + csv);
  }

  @UseGuards(JwtAuthGuard)
  @Get('export')
  async exportAttendance(
    @Query('classId') classId: string,
    @Query('period') period: string,
    @Query('date') date?: string,
    @Res() res?: Response,
  ) {
    const { start, end } = getDateRange(period, date);
    const csv = await this.reportsService.exportClassAttendance(classId, start, end);
    const fileName = `attendance_${period}_${start.toISOString().split('T')[0]}.csv`;
    // Add BOM for Excel UTF-8 support
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(bom + csv);
  }

  @UseGuards(JwtAuthGuard)
  @Get('export-xlsx')
  async exportXlsx(
    @Query('classId') classId: string,
    @Query('date') date: string,
    @Query('period') period: string,
    @Res() res?: Response,
  ) {
    const buffer = await this.reportsService.exportAttendanceXlsx(classId, new Date(date), period);
    const fileName = `attendance_report_${period || 'all'}_${date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  // ========== STAFF ATTENDANCE REPORTS ==========

  @UseGuards(JwtAuthGuard)
  @Get('staff-attendance-grid')
  async getStaffAttendanceGrid(@Query('date') date: string) {
    return this.reportsService.getStaffAttendanceGrid(new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('staff-attendance-daily-grid')
  async getStaffAttendanceDailyGrid(@Query('date') date: string) {
    return this.reportsService.getStaffAttendanceDailyGrid(new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('staff-attendance-totals')
  async getStaffAttendanceTotals(@Query('date') date: string) {
    return this.reportsService.getStaffAttendanceTotals(new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('export-staff-grid')
  async exportStaffGrid(
    @Query('date') date: string,
    @Res() res?: Response,
  ) {
    const csv = await this.reportsService.exportStaffAttendanceGrid(new Date(date));
    const fileName = `staff_attendance_${date}.csv`;
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(bom + csv);
  }

  @UseGuards(JwtAuthGuard)
  @Get('export-staff-xlsx')
  async exportStaffXlsx(
    @Query('date') date: string,
    @Query('period') period: string,
    @Res() res?: Response,
  ) {
    const buffer = await this.reportsService.exportStaffAttendanceXlsx(new Date(date), period);
    const fileName = `staff_attendance_${period || 'daily'}_${date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Get('export-staff-period')
  async exportStaffPeriod(
    @Query('period') period: string,
    @Query('date') date?: string,
    @Res() res?: Response,
  ) {
    const { start, end } = getDateRange(period, date);
    const csv = await this.reportsService.exportStaffPeriod(start, end);
    const fileName = `staff_attendance_${period}_${start.toISOString().split('T')[0]}.csv`;
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(bom + csv);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('duplicate-students')
  async getDuplicateStudents() {
    return this.reportsService.getDuplicateStudents();
  }

  // ========== EMPLOYEE SELF-SERVICE REPORTS ==========

  @UseGuards(JwtAuthGuard)
  @Get('print-report-data')
  async getPrintReportData(
    @Query('classId') classId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getPrintReportData(classId, new Date(startDate), new Date(endDate));
  }

  @UseGuards(JwtAuthGuard)
  @Get('staff-print-report-data')
  async getStaffPrintReportData(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getStaffPrintReportData(new Date(startDate), new Date(endDate));
  }

  @UseGuards(JwtAuthGuard)
  @Get('employee/my-daily-grid')
  async getEmployeeDailyGrid(@Request() req, @Query('date') date: string) {
    return this.reportsService.getEmployeeDailyGrid(req.user.userId, new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('employee/my-totals')
  async getEmployeeTotals(@Request() req, @Query('date') date: string) {
    return this.reportsService.getEmployeeTotals(req.user.userId, new Date(date));
  }

  @UseGuards(JwtAuthGuard)
  @Get('employee/my-export-xlsx')
  async exportEmployeeXlsx(
    @Request() req,
    @Query('date') date: string,
    @Query('period') period: string,
    @Res() res?: Response,
  ) {
    const buffer = await this.reportsService.exportEmployeeXlsx(req.user.userId, new Date(date), period);
    const fileName = `my_attendance_${period || 'daily'}_${date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}