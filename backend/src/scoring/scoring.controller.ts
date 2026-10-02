import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('scoring')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScoringController {
  constructor(private scoringService: ScoringService) {}

  // ─── Score Sheets ─────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Post('sheets')
  createSheet(@Body() data: { name: string; degree?: string; logoUrl?: string; classIds?: string[]; studyYearId?: string }) {
    return this.scoringService.createSheet(data);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Get('sheets')
  getSheets(@Request() req: any) {
    if (req?.user?.role === 'CLASS_ADMIN') {
      return this.scoringService.getSheetsForClassAdmin(req.user.userId);
    }
    return this.scoringService.getSheets();
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Get('sheets/:id')
  getSheet(@Param('id') id: string) {
    return this.scoringService.getSheet(id);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Put('sheets/:id')
  updateSheet(@Param('id') id: string, @Body() data: { name?: string; degree?: string; logoUrl?: string; classIds?: string[]; studyYearId?: string }) {
    return this.scoringService.updateSheet(id, data);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Delete('sheets/:id')
  deleteSheet(@Param('id') id: string) {
    return this.scoringService.deleteSheet(id);
  }

  // ─── Subjects ─────────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Post('sheets/:id/subjects')
  addSubject(
    @Param('id') scoreSheetId: string,
    @Body() data: { name: string; maxScore?: number; color?: string; order?: number; timetableSubjectId?: string },
  ) {
    return this.scoringService.addSubject(scoreSheetId, data);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Put('subjects/:id')
  updateSubject(@Param('id') id: string, @Body() data: { name?: string; maxScore?: number; color?: string; order?: number }) {
    return this.scoringService.updateSubject(id, data);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Delete('subjects/:id')
  deleteSubject(@Param('id') id: string) {
    return this.scoringService.deleteSubject(id);
  }

  // ─── Timetable subjects (for import) ──────────────────────────────────────

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Get('timetable-subjects')
  getTimetableSubjects() {
    return this.scoringService.getTimetableSubjects();
  }

  // ─── Exam Tabs ────────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Post('sheets/:id/exam-tabs')
  addExamTab(@Param('id') scoreSheetId: string, @Body() data: { label: string; type: string; order?: number }) {
    return this.scoringService.addExamTab(scoreSheetId, data);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Delete('exam-tabs/:id')
  deleteExamTab(@Param('id') id: string) {
    return this.scoringService.deleteExamTab(id);
  }

  // ─── Score Entries ────────────────────────────────────────────────────────

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Get('exam-tabs/:id/scores')
  getTabScores(
    @Param('id') examTabId: string,
    @Query('classIds') classIds?: string, // comma-separated
  ) {
    const ids = classIds ? classIds.split(',').filter(Boolean) : undefined;
    return this.scoringService.getTabScores(examTabId, ids);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Put('entries')
  upsertEntry(
    @Body() data: { examTabId: string; subjectId: string; studentId: string; score: number | null; formula?: string | null },
  ) {
    return this.scoringService.upsertEntry(data);
  }

  @Roles('ADMIN', 'TEACHER', 'CLASS_ADMIN')
  @Post('entries/bulk')
  bulkUpsertEntries(
    @Body() body: {
      entries: Array<{ examTabId: string; subjectId: string; studentId: string; score: number | null; formula?: string | null }>;
    },
  ) {
    return this.scoringService.bulkUpsertEntries(body.entries);
  }
}

