import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(private svc: CoursesService) {}

  // ── Listing & detail ────────────────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Get()
  list(
    @Request() req: any,
    @Query('classId') classId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.list({
      teacherUserId: req.user.userId,
      role: req.user.role,
      classId,
      status,
    });
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER', 'STUDENT')
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.svc.getOne(id);
  }

  // ── Course CRUD ─────────────────────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.svc.create(body, req.user.userId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.update(id, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.svc.remove(id, req.user.userId, req.user.role);
  }

  // ── State transition (DRAFT → PUBLISHED → … → ARCHIVED) ────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Request() req: any,
  ) {
    return this.svc.transition(id, body?.status, req.user.userId, req.user.role);
  }

  // ── Enrollments ─────────────────────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Get(':id/enrollments')
  listEnrollments(@Param('id') id: string, @Request() req: any) {
    return this.svc.listEnrollments(id, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post(':id/enrollments')
  enroll(
    @Param('id') id: string,
    @Body() body: { studentId: string },
    @Request() req: any,
  ) {
    return this.svc.enrollStudent(
      id,
      body?.studentId,
      req.user.userId,
      req.user.role,
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Delete(':id/enrollments/:studentId')
  unenroll(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
    @Request() req: any,
  ) {
    return this.svc.unenrollStudent(id, studentId, req.user.userId, req.user.role);
  }

  // ── Lessons ─────────────────────────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER', 'STUDENT')
  @Get(':id/lessons')
  listLessons(@Param('id') id: string) {
    return this.svc.listLessons(id);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post(':id/lessons')
  createLesson(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.createLesson(id, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Put('lessons/:lessonId')
  updateLesson(
    @Param('lessonId') lessonId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.svc.updateLesson(lessonId, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Delete('lessons/:lessonId')
  deleteLesson(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.svc.deleteLesson(lessonId, req.user.userId, req.user.role);
  }

  // ── Lesson pages ────────────────────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER', 'STUDENT')
  @Get('lessons/:lessonId/pages')
  listPages(@Param('lessonId') lessonId: string) {
    return this.svc.listPages(lessonId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post('lessons/:lessonId/pages')
  createPage(
    @Param('lessonId') lessonId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.svc.createPage(lessonId, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Put('pages/:pageId')
  updatePage(
    @Param('pageId') pageId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.svc.updatePage(pageId, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Delete('pages/:pageId')
  deletePage(@Param('pageId') pageId: string, @Request() req: any) {
    return this.svc.deletePage(pageId, req.user.userId, req.user.role);
  }

  // ── Student-facing list ─────────────────────────────────────────────
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Get('student/my-courses')
  studentCourses(@Request() req: any) {
    return this.svc.getStudentCourses(req.user.userId);
  }

  // ── Lesson attempts (student player) ────────────────────────────────
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Post('lessons/:lessonId/attempts/start')
  startAttempt(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.svc.startLessonAttempt(lessonId, req.user.userId);
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Get('lessons/:lessonId/my-attempt')
  myAttempt(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.svc.getMyLessonAttempt(lessonId, req.user.userId);
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Post('attempts/:attemptId/responses')
  submitResponse(
    @Param('attemptId') attemptId: string,
    @Body() body: { pageId: string; answer: any },
    @Request() req: any,
  ) {
    return this.svc.submitPageResponse(
      attemptId,
      body?.pageId,
      body?.answer ?? {},
      req.user.userId,
    );
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Post('attempts/:attemptId/finish')
  finishAttempt(@Param('attemptId') attemptId: string, @Request() req: any) {
    return this.svc.finishLessonAttempt(attemptId, req.user.userId);
  }

  // ── Manual grading (Essay / H5P questions pending review) ───────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Get('lessons/:lessonId/pending-grading')
  pendingGrading(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.svc.listPendingGrading(lessonId, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Patch('responses/:responseId/grade')
  gradeResponse(
    @Param('responseId') responseId: string,
    @Body() body: { pointsAwarded: number },
    @Request() req: any,
  ) {
    return this.svc.gradePageResponse(
      responseId,
      body?.pointsAwarded,
      req.user.userId,
      req.user.role,
    );
  }

  // Voids an attempt (IN_PROGRESS/AWAITING_GRADE/COMPLETED) so the student can
  // start a clean one — see resetLessonAttempt for why this is needed.
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Patch('attempts/:attemptId/reset')
  resetAttempt(@Param('attemptId') attemptId: string, @Request() req: any) {
    return this.svc.resetLessonAttempt(attemptId, req.user.userId, req.user.role);
  }

  // ── Course attendance: sessions ─────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER', 'STUDENT')
  @Get(':id/sessions')
  listSessions(@Param('id') id: string, @Request() req: any) {
    return this.svc.listSessions(id, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post(':id/sessions')
  createSession(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.svc.createSession(id, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Put('sessions/:sessionId')
  updateSession(
    @Param('sessionId') sessionId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.svc.updateSession(sessionId, body, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Delete('sessions/:sessionId')
  deleteSession(@Param('sessionId') sessionId: string, @Request() req: any) {
    return this.svc.deleteSession(sessionId, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Get('sessions/:sessionId/attendance')
  sessionRoster(@Param('sessionId') sessionId: string, @Request() req: any) {
    return this.svc.getSessionRoster(sessionId, req.user.userId, req.user.role);
  }

  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post('sessions/:sessionId/attendance')
  markAttendance(
    @Param('sessionId') sessionId: string,
    @Body() body: { studentId: string; status: string; notes?: string },
    @Request() req: any,
  ) {
    return this.svc.markAttendance(
      sessionId,
      body,
      req.user.userId,
      req.user.role,
    );
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Post('sessions/:sessionId/check-in')
  studentCheckIn(
    @Param('sessionId') sessionId: string,
    @Body() body: { code: string },
    @Request() req: any,
  ) {
    return this.svc.studentCheckIn(sessionId, body?.code, req.user.userId);
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Get(':id/my-attendance')
  myCourseAttendance(@Param('id') id: string, @Request() req: any) {
    return this.svc.getMyCourseAttendance(id, req.user.userId);
  }

  // ── Lesson access tracking ──────────────────────────────────────────
  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Post('lessons/:lessonId/views/open')
  recordOpen(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.svc.recordLessonOpen(lessonId, req.user.userId);
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Post('lessons/:lessonId/views/progress')
  updateProgress(
    @Param('lessonId') lessonId: string,
    @Body() body: { watchedSeconds?: number; videoDurationSec?: number },
    @Request() req: any,
  ) {
    return this.svc.updateLessonVideoProgress(lessonId, body, req.user.userId);
  }

  @Roles('STUDENT', 'ADMIN', 'SUPER_ADMIN')
  @Get('lessons/:lessonId/my-view')
  myLessonView(@Param('lessonId') lessonId: string, @Request() req: any) {
    return this.svc.getMyLessonView(lessonId, req.user.userId);
  }

  // ── Bulk: generate one session per published lesson ─────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Post(':id/sessions/generate-from-lessons')
  generateSessions(@Param('id') id: string, @Request() req: any) {
    return this.svc.generateSessionsFromLessons(id, req.user.userId, req.user.role);
  }

  // ── Engagement report ───────────────────────────────────────────────
  @Roles('ADMIN', 'SUPER_ADMIN', 'TEACHER')
  @Get(':id/engagement-report')
  engagementReport(@Param('id') id: string, @Request() req: any) {
    return this.svc.getEngagementReport(id, req.user.userId, req.user.role);
  }
}
