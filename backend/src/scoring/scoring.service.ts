import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DirectoryService } from '../directory/directory.service';

@Injectable()
export class ScoringService {
  constructor(private prisma: PrismaService, private readonly directory: DirectoryService) {}

  // ─── Score Sheets ─────────────────────────────────────────────────────────

  async createSheet(data: { name: string; degree?: string; logoUrl?: string; classIds?: string[]; studyYearId?: string }) {
    const { classIds, ...sheetData } = data;
    return this.prisma.scoreSheet.create({
      data: {
        ...sheetData,
        ...(classIds?.length ? {
          classes: { create: classIds.map(classId => ({ classId })) },
        } : {}),
      },
      include: {
        subjects: { orderBy: { order: 'asc' } },
        examTabs: { orderBy: { order: 'asc' } },
        classes: true,
      },
    });
  }

  async getSheets() {
    return this.prisma.scoreSheet.findMany({
      include: {
        subjects: { orderBy: { order: 'asc' } },
        examTabs: { orderBy: { order: 'asc' } },
        classes: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns only sheets linked to at least one of the given class IDs (for CLASS_ADMIN scoping). */
  async getSheetsByClassIds(classIds: string[]) {
    if (!classIds.length) return [];
    return this.prisma.scoreSheet.findMany({
      where: {
        classes: { some: { classId: { in: classIds } } },
      },
      include: {
        subjects: { orderBy: { order: 'asc' } },
        examTabs: { orderBy: { order: 'asc' } },
        classes: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns sheets scoped to a CLASS_ADMIN user — only sheets for their assigned classes. */
  async getSheetsForClassAdmin(userId: string) {
    const classIds = await this.directory.classesForUser(userId, 'CLASS_ADMIN');
    return this.getSheetsByClassIds(classIds);
  }

  async getSheet(id: string) {
    const sheet = await this.prisma.scoreSheet.findUnique({
      where: { id },
      include: {
        subjects: { orderBy: { order: 'asc' } },
        examTabs: { orderBy: { order: 'asc' } },
        classes: true,
      },
    });
    if (!sheet) throw new NotFoundException('Score sheet not found');
    return sheet;
  }

  async updateSheet(id: string, data: { name?: string; degree?: string; logoUrl?: string; classIds?: string[]; studyYearId?: string }) {
    const { classIds, ...sheetData } = data;

    if (classIds !== undefined) {
      await this.prisma.$transaction([
        this.prisma.scoreSheetClass.deleteMany({ where: { scoreSheetId: id } }),
        ...(classIds.length > 0
          ? [this.prisma.scoreSheetClass.createMany({
              data: classIds.map(classId => ({ scoreSheetId: id, classId })),
              skipDuplicates: true,
            })]
          : []),
      ]);
    }

    if (Object.keys(sheetData).length > 0) {
      await this.prisma.scoreSheet.update({ where: { id }, data: sheetData });
    }

    return this.getSheet(id);
  }

  async deleteSheet(id: string) {
    return this.prisma.scoreSheet.delete({ where: { id } });
  }

  // ─── Subjects ─────────────────────────────────────────────────────────────

  async addSubject(scoreSheetId: string, data: {
    name: string;
    maxScore?: number;
    color?: string;
    order?: number;
    timetableSubjectId?: string;
  }) {
    return this.prisma.scoreSubject.create({ data: { scoreSheetId, ...data } });
  }

  async updateSubject(id: string, data: { name?: string; maxScore?: number; color?: string; order?: number }) {
    return this.prisma.scoreSubject.update({ where: { id }, data });
  }

  async deleteSubject(id: string) {
    return this.prisma.scoreSubject.delete({ where: { id } });
  }

  // ─── Timetable subjects (for import picker) ───────────────────────────────

  async getTimetableSubjects() {
    return this.prisma.timetableSubject.findMany({
      select: {
        id: true,
        name: true,
        short: true,
        color: true,
        timetableId: true,
        timetable: { select: { name: true, academicYear: true } },
      },
      orderBy: [{ timetable: { academicYear: 'desc' } }, { name: 'asc' }],
    });
  }

  // ─── Exam Tabs ────────────────────────────────────────────────────────────

  async addExamTab(scoreSheetId: string, data: { label: string; type: string; order?: number }) {
    return this.prisma.scoreExamTab.create({ data: { scoreSheetId, ...data } });
  }

  async deleteExamTab(id: string) {
    return this.prisma.scoreExamTab.delete({ where: { id } });
  }

  // ─── Score Entries ────────────────────────────────────────────────────────

  async getTabScores(examTabId: string, classIds?: string[]) {
    const studentsWhere: Record<string, unknown> = {};
    if (classIds?.length) {
      studentsWhere.classId = { in: classIds };
    }

    const [entries, students] = await Promise.all([
      this.prisma.scoreEntry.findMany({
        where: { examTabId },
        select: { studentId: true, subjectId: true, score: true, formula: true },
      }),
      this.prisma.student.findMany({
        where: studentsWhere,
        include: {
          user: { select: { name: true } },
          class: { select: { id: true, name: true } },
        },
        orderBy: [{ class: { name: 'asc' } }, { studentNumber: 'asc' }],
      }),
    ]);

    return { entries, students };
  }

  async upsertEntry(data: {
    examTabId: string;
    subjectId: string;
    studentId: string;
    score: number | null;
    formula?: string | null;
  }) {
    const { formula, ...rest } = data;
    return this.prisma.scoreEntry.upsert({
      where: {
        examTabId_subjectId_studentId: {
          examTabId: data.examTabId,
          subjectId: data.subjectId,
          studentId: data.studentId,
        },
      },
      create: { ...rest, formula: formula ?? null },
      update: { score: data.score, formula: formula ?? null },
    });
  }

  async bulkUpsertEntries(
    entries: Array<{
      examTabId: string;
      subjectId: string;
      studentId: string;
      score: number | null;
      formula?: string | null;
    }>,
  ) {
    const ops = entries.map(e => {
      const { formula, ...rest } = e;
      return this.prisma.scoreEntry.upsert({
        where: {
          examTabId_subjectId_studentId: {
            examTabId: e.examTabId,
            subjectId: e.subjectId,
            studentId: e.studentId,
          },
        },
        create: { ...rest, formula: formula ?? null },
        update: { score: e.score, formula: formula ?? null },
      });
    });
    return this.prisma.$transaction(ops);
  }
}
