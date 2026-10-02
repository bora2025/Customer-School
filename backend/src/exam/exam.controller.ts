import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('exams')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamController {
  constructor(private examService: ExamService) {}

  @Roles('ADMIN', 'TEACHER')
  @Get()
  getAll(@Query('classId') classId?: string, @Query('status') status?: string) {
    return this.examService.getAll(classId, status);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get(':id')
  getOne(@Param('id') id: string) { return this.examService.getOne(id); }

  // Student-safe view — strips correct-answer keys before the exam reaches a student.
  @Roles('STUDENT', 'ADMIN')
  @Get(':id/take')
  getOneForStudent(@Param('id') id: string) { return this.examService.getOneForStudent(id); }

  @Roles('ADMIN', 'TEACHER')
  @Post()
  create(@Body() body: any, @Request() req: any) {
    return this.examService.create(body, req.user.userId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) { return this.examService.update(id, body); }

  @Roles('ADMIN', 'TEACHER')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.examService.updateStatus(id, body.status);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get(':id/attempts')
  getAttempts(@Param('id') id: string) { return this.examService.getExamAttempts(id); }

  // Deletes the attempt so the student can start a fresh one.
  @Roles('ADMIN', 'TEACHER')
  @Delete('attempts/:attemptId/reset')
  resetAttempt(@Param('attemptId') attemptId: string) { return this.examService.resetAttempt(attemptId); }

  @Roles('ADMIN')
  @Delete(':id')
  delete(@Param('id') id: string) { return this.examService.delete(id); }

  // ── Student endpoints ──
  @Roles('STUDENT', 'ADMIN')
  @Get('student/my-exams')
  getMyExams(@Request() req: any) { return this.examService.getStudentExams(req.user.userId); }

  @Roles('STUDENT', 'ADMIN')
  @Post(':id/start')
  startAttempt(@Param('id') id: string, @Request() req: any) {
    return this.examService.startAttempt(id, req.user.userId);
  }

  @Roles('STUDENT', 'ADMIN')
  @Patch('attempts/:attemptId/answers')
  saveAnswers(@Param('attemptId') attemptId: string, @Body() body: { answers: Record<string, any> }) {
    return this.examService.saveAnswers(attemptId, body.answers);
  }

  @Roles('STUDENT', 'ADMIN')
  @Post('attempts/:attemptId/submit')
  submitAttempt(@Param('attemptId') attemptId: string, @Body() body?: { answers?: Record<string, any> }) {
    return this.examService.submitAttempt(attemptId, body?.answers);
  }

  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @Get('attempts/:attemptId/result')
  getResult(@Param('attemptId') attemptId: string) {
    return this.examService.getAttemptResult(attemptId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch('attempts/:attemptId/grade')
  gradeAttempt(
    @Param('attemptId') attemptId: string,
    @Body() body: { perQuestionMarks: Record<string, number>; feedback?: string },
  ) {
    return this.examService.gradeAttempt(attemptId, body.perQuestionMarks ?? {}, body.feedback);
  }

  @Roles('STUDENT', 'ADMIN')
  @Get('student/results')
  getMyResults(@Request() req: any) {
    return this.examService.getStudentResults(req.user.userId);
  }
}
