import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/** Rows per query: large enough to be quick, small enough that a big school never sits in memory. */
const PAGE = 1000;

export type ExportName = 'students' | 'attendance' | 'grades';
export const EXPORT_NAMES: readonly ExportName[] = ['students', 'attendance', 'grades'];

/**
 * One CSV cell. Text that a spreadsheet would run as a formula -- anything starting with = + - @, a
 * tab or a carriage return -- is prefixed with an apostrophe. Student names arrive through public
 * self-registration, so without this a registrant could plant a formula in the school's own Excel.
 * Numbers are written as numbers, so a negative score is not mistaken for one.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : '');

/**
 * The school's own records, for its SUPER_ADMIN to take out -- including while the school is locked for
 * an unpaid platform bill, because a school owns its records whether or not it has paid for the
 * software. Read-only: nothing here writes to the school's data.
 *
 * Each export yields the file a line at a time, header first, one page of rows per query.
 */
@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  lines(name: ExportName): AsyncGenerator<string> {
    if (name === 'students') return this.students();
    if (name === 'attendance') return this.attendance();
    return this.grades();
  }

  private async *students(): AsyncGenerator<string> {
    yield csvRow(['student_id', 'student_number', 'name', 'name_khmer', 'sex', 'date_of_birth', 'class', 'generation', 'address', 'email', 'phone', 'parent_name', 'parent_phone', 'parent_email', 'registered_on']);
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.student.findMany({
        take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: 'asc' },
        select: {
          id: true, studentNumber: true, nameKh: true, sex: true, dateOfBirth: true, generation: true, address: true, createdAt: true,
          user: { select: { name: true, email: true, phone: true } },
          class: { select: { name: true } },
          parent: { select: { name: true, phone: true, email: true } },
        },
      });
      for (const student of page) {
        yield csvRow([
          student.id, student.studentNumber, student.user.name, student.nameKh, student.sex, day(student.dateOfBirth), student.class?.name,
          student.generation, student.address, student.user.email, student.user.phone, student.parent?.name, student.parent?.phone,
          student.parent?.email, day(student.createdAt),
        ]);
      }
      if (page.length < PAGE) return;
      cursor = page[page.length - 1].id;
    }
  }

  private async *attendance(): AsyncGenerator<string> {
    yield csvRow(['date', 'session', 'student_id', 'student_number', 'student_name', 'class', 'status', 'permission_type', 'permission_from', 'permission_to', 'check_in', 'check_out', 'marked_by', 'recorded_at']);
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.attendance.findMany({
        take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: {
          id: true, date: true, session: true, status: true, permissionType: true, permissionStartDate: true, permissionEndDate: true,
          checkInTime: true, checkOutTime: true, timestamp: true, studentId: true,
          student: { select: { studentNumber: true, user: { select: { name: true } } } },
          class: { select: { name: true } },
          markedBy: { select: { name: true } },
        },
      });
      for (const record of page) {
        yield csvRow([
          day(record.date), record.session, record.studentId, record.student.studentNumber, record.student.user.name, record.class.name,
          record.status, record.permissionType, day(record.permissionStartDate), day(record.permissionEndDate), record.checkInTime,
          record.checkOutTime, record.markedBy.name, record.timestamp,
        ]);
      }
      if (page.length < PAGE) return;
      cursor = page[page.length - 1].id;
    }
  }

  /**
   * ScoreEntry.studentId is a plain column with no relation to Student, so the names are looked up a
   * page at a time. A grade whose student has since been deleted keeps its student_id and leaves the
   * name blank rather than vanishing from the export.
   */
  private async *grades(): AsyncGenerator<string> {
    yield csvRow(['score_sheet', 'exam', 'exam_type', 'subject', 'max_score', 'student_id', 'student_number', 'student_name', 'score']);
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.scoreEntry.findMany({
        take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: 'asc' },
        select: {
          id: true, studentId: true, score: true,
          examTab: { select: { label: true, type: true, scoreSheet: { select: { name: true } } } },
          subject: { select: { name: true, maxScore: true } },
        },
      });
      const students = await this.prisma.student.findMany({
        where: { id: { in: [...new Set(page.map((entry) => entry.studentId))] } },
        select: { id: true, studentNumber: true, user: { select: { name: true } } },
      });
      const byId = new Map(students.map((student) => [student.id, student]));
      for (const entry of page) {
        const student = byId.get(entry.studentId);
        yield csvRow([
          entry.examTab.scoreSheet.name, entry.examTab.label, entry.examTab.type, entry.subject.name, entry.subject.maxScore,
          entry.studentId, student?.studentNumber, student?.user.name, entry.score,
        ]);
      }
      if (page.length < PAGE) return;
      cursor = page[page.length - 1].id;
    }
  }
}
