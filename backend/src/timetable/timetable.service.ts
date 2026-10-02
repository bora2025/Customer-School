import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class TimetableService {
  constructor(private prisma: PrismaService) {}

  // ─── Timetable CRUD ────────────────────────────────────────────────

  async listTimetables() {
    return this.prisma.timetable.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, short: true, academicYear: true,
        periodsPerDay: true, numberOfDays: true, weekend: true,
        status: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async getTimetable(id: string) {
    const tt = await this.prisma.timetable.findUnique({
      where: { id },
      include: {
        subjects: { orderBy: { name: 'asc' } },
        classes: { orderBy: { name: 'asc' }, include: { classTeachers: true } },
        classrooms: { orderBy: { name: 'asc' } },
        teachers: { orderBy: { lastName: 'asc' }, include: { classTeacher: true } },
        lessons: {
          include: { teacher: true, subject: true, class: true },
          orderBy: { createdAt: 'asc' },
        },
        entries: {
          include: { class: true, teacher: true, subject: true, classroom: true },
          orderBy: [{ day: 'asc' }, { period: 'asc' }],
        },
      },
    });
    if (!tt) throw new NotFoundException('Timetable not found');
    return tt;
  }

  async createTimetable(data: {
    name: string;
    short?: string;
    academicYear: string;
    periodsPerDay?: number;
    numberOfDays?: number;
    weekend?: string[];
    timeOffRules?: string;
    distribution?: string;
    homeworkPrep?: string;
    maxOnDay?: number;
    docNotes?: string;
  }) {
    return this.prisma.timetable.create({ data });
  }

  async updateTimetable(id: string, data: Partial<{
    name: string; short: string | null; academicYear: string;
    periodsPerDay: number; numberOfDays: number; weekend: string[];
    timeOffRules: string | null; distribution: string | null; homeworkPrep: string | null;
    maxOnDay: number | null; docNotes: string | null; periodTimes: string | null; status: string;
  }>) {
    return this.prisma.timetable.update({ where: { id }, data });
  }

  async deleteTimetable(id: string) {
    const tt = await this.prisma.timetable.findUnique({ where: { id }, select: { status: true } });
    if (!tt) throw new NotFoundException('Timetable not found');
    if (tt.status === 'PUBLISHED') {
      throw new BadRequestException('Cannot delete a published timetable. Unpublish it first.');
    }

    // Delete all related records in dependency order to avoid FK constraint errors.
    // Cross-references between child tables (lessons→teacher, entry→lesson, attendance→teacher etc.)
    // are not cascade-configured, so we must remove them manually before deleting the timetable.
    await this.prisma.$transaction([
      // 1. Teacher attendances reference TimetableTeacher — delete first
      this.prisma.timetableTeacherAttendance.deleteMany({
        where: { teacher: { timetableId: id } },
      }),
      // 2. Entries reference TimetableLesson / TimetableClass / TimetableTeacher / TimetableSubject
      this.prisma.timetableEntry.deleteMany({ where: { timetableId: id } }),
      // 3. Lessons reference TimetableTeacher / TimetableSubject / TimetableClass
      this.prisma.timetableLesson.deleteMany({ where: { timetableId: id } }),
      // 4. Null-out classTeacherId on teachers (FK to TimetableClass) before deleting classes
      this.prisma.timetableTeacher.updateMany({
        where: { timetableId: id },
        data: { classTeacherId: null },
      }),
      // 5. Delete teachers
      this.prisma.timetableTeacher.deleteMany({ where: { timetableId: id } }),
      // 6. Delete classes, classrooms, subjects
      this.prisma.timetableClass.deleteMany({ where: { timetableId: id } }),
      this.prisma.timetableClassroom.deleteMany({ where: { timetableId: id } }),
      this.prisma.timetableSubject.deleteMany({ where: { timetableId: id } }),
      // 7. Finally delete the timetable itself
      this.prisma.timetable.delete({ where: { id } }),
    ]);

    return { deleted: true, id };
  }

  // ─── Subjects ──────────────────────────────────────────────────────

  async createSubject(timetableId: string, data: {
    name: string; short: string; color?: string;
    picture?: string; classroomCount?: number; customFields?: object;
  }) {
    return this.prisma.timetableSubject.create({ data: { timetableId, ...data } });
  }

  async updateSubject(id: string, data: Partial<{
    name: string; short: string; color: string;
    picture: string; classroomCount: number; customFields: object;
  }>) {
    return this.prisma.timetableSubject.update({ where: { id }, data });
  }

  async deleteSubject(id: string) {
    return this.prisma.timetableSubject.delete({ where: { id } });
  }

  // ─── Classes ───────────────────────────────────────────────────────

  async createClass(timetableId: string, data: {
    name: string; short: string; color?: string;
    picture?: string; printSubjectPicture?: boolean; customFields?: object;
  }) {
    return this.prisma.timetableClass.create({ data: { timetableId, ...data } });
  }

  async updateClass(id: string, data: Partial<{
    name: string; short: string; color: string;
    picture: string; printSubjectPicture: boolean; customFields: object;
  }>) {
    return this.prisma.timetableClass.update({ where: { id }, data });
  }

  async deleteClass(id: string) {
    return this.prisma.timetableClass.delete({ where: { id } });
  }

  // ─── Classrooms ────────────────────────────────────────────────────

  async createClassroom(timetableId: string, data: {
    name: string; short: string; color?: string;
    picture?: string; customFields?: object;
  }) {
    return this.prisma.timetableClassroom.create({ data: { timetableId, ...data } });
  }

  async updateClassroom(id: string, data: Partial<{
    name: string; short: string; color: string;
    picture: string; customFields: object;
  }>) {
    return this.prisma.timetableClassroom.update({ where: { id }, data });
  }

  async deleteClassroom(id: string) {
    return this.prisma.timetableClassroom.delete({ where: { id } });
  }

  // ─── Teachers ──────────────────────────────────────────────────────

  async createTeacher(timetableId: string, data: {
    lastName: string; firstName: string; khmerName?: string; short: string;
    sex?: string; email?: string; phone?: string; photo?: string;
    color?: string; classTeacherId?: string;
  }) {
    const qrCode = crypto.randomBytes(16).toString('hex');
    return this.prisma.timetableTeacher.create({
      data: { timetableId, qrCode, ...data },
    });
  }

  async updateTeacher(id: string, data: Partial<{
    lastName: string; firstName: string; khmerName: string | null; short: string;
    sex: string; email: string; phone: string; photo: string | null;
    color: string; classTeacherId: string | null;
  }>) {
    return this.prisma.timetableTeacher.update({ where: { id }, data });
  }

  async deleteTeacher(id: string) {
    return this.prisma.timetableTeacher.delete({ where: { id } });
  }

  // ─── Lessons ───────────────────────────────────────────────────────

  async createLesson(timetableId: string, data: {
    teacherId: string; subjectId: string; classId: string;
    perWeek: number; lessonType?: string;
  }) {
    return this.prisma.timetableLesson.create({
      data: { timetableId, lessonType: 'SINGLE', ...data },
      include: { teacher: true, subject: true, class: true },
    });
  }

  async updateLesson(id: string, data: Partial<{
    teacherId: string; subjectId: string; classId: string;
    perWeek: number; lessonType: string;
  }>) {
    return this.prisma.timetableLesson.update({
      where: { id }, data,
      include: { teacher: true, subject: true, class: true },
    });
  }

  async deleteLesson(id: string) {
    return this.prisma.timetableLesson.delete({ where: { id } });
  }

  // ─── Entries (grid cells) ──────────────────────────────────────────

  async upsertEntry(timetableId: string, data: {
    classId: string; teacherId: string; subjectId: string;
    classroomId?: string; lessonId?: string; day: number; period: number;
  }) {
    return this.prisma.timetableEntry.upsert({
      where: { timetableId_classId_day_period: { timetableId, classId: data.classId, day: data.day, period: data.period } },
      create: { timetableId, ...data },
      update: { teacherId: data.teacherId, subjectId: data.subjectId, classroomId: data.classroomId, lessonId: data.lessonId },
      include: { class: true, teacher: true, subject: true, classroom: true },
    });
  }

  async deleteEntry(id: string) {
    return this.prisma.timetableEntry.delete({ where: { id } });
  }

  // ─── Generate (Test) ──────────────────────────────────────────────

  async generateTimetable(id: string) {
    const tt = await this.getTimetable(id);

    // Clear existing entries
    await this.prisma.timetableEntry.deleteMany({ where: { timetableId: id } });

    const days = tt.numberOfDays;
    const maxPeriods = tt.periodsPerDay;
    const created: any[] = [];

    // Simple greedy fill: for each lesson, assign to empty slots round-robin
    for (const lesson of tt.lessons) {
      let assigned = 0;
      const needed = lesson.perWeek;

      // Build occupied slots for this class
      const occupied = new Set<string>();
      for (const e of created) {
        if (e.classId === lesson.classId) {
          occupied.add(`${e.day}_${e.period}`);
        }
      }

      for (let day = 1; day <= days && assigned < needed; day++) {
        for (let period = 1; period <= maxPeriods && assigned < needed; period++) {
          const key = `${day}_${period}`;
          if (!occupied.has(key)) {
            const entry = await this.prisma.timetableEntry.create({
              data: {
                timetableId: id,
                lessonId: lesson.id,
                classId: lesson.classId,
                teacherId: lesson.teacherId,
                subjectId: lesson.subjectId,
                day,
                period,
              },
            });
            created.push(entry);
            occupied.add(key);
            assigned++;
          }
        }
      }
    }

    return { generated: created.length, entries: created };
  }

  // ─── Teacher Attendance ────────────────────────────────────────────

  async markTeacherAttendance(teacherId: string, date: string, period: number, status = 'PRESENT') {
    const dateObj = new Date(date + 'T00:00:00.000Z');
    return this.prisma.timetableTeacherAttendance.upsert({
      where: { teacherId_date_period: { teacherId, date: dateObj, period } },
      create: { teacherId, date: dateObj, period, status, checkIn: new Date() },
      update: { status, checkIn: new Date() },
    });
  }

  async markTeacherAttendanceByQr(qrCode: string, period: number) {
    const teacher = await this.prisma.timetableTeacher.findUnique({ where: { qrCode } });
    if (!teacher) throw new NotFoundException('Teacher QR code not found');
    const today = new Date().toISOString().split('T')[0];
    return this.markTeacherAttendance(teacher.id, today, period, 'PRESENT');
  }

  async getTeacherAttendanceReport(timetableId: string, startDate: string, endDate: string) {
    const start = new Date(startDate + 'T00:00:00.000Z');
    const end = new Date(endDate + 'T23:59:59.999Z');
    const teachers = await this.prisma.timetableTeacher.findMany({
      where: { timetableId },
      include: {
        attendances: { where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } },
        entries: { where: { timetable: { id: timetableId } } },
      },
    });
    return teachers;
  }

  // ─── Auto-detect current period from periodTimes JSON (Cambodia time) ─

  private detectCurrentPeriod(periodTimes: string[]): number | null {
    if (!periodTimes || periodTimes.length === 0) return null;
    const now = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    for (let i = 0; i < periodTimes.length; i++) {
      const startMin = toMin(periodTimes[i]);
      const nextMin = i + 1 < periodTimes.length ? toMin(periodTimes[i + 1]) : startMin + 60;
      if (nowMinutes >= startMin && nowMinutes < nextMin) return i + 1;
    }
    if (nowMinutes < toMin(periodTimes[0])) return 1;
    return periodTimes.length;
  }

  // ─── Wattaman: scan a teacher QR code and record attendance ────────

  async wattamanTeacherScan(
    qrCode: string,
    scannedById: string,
    latitude?: number,
    longitude?: number,
    location?: string,
  ) {
    const teacher = await this.prisma.timetableTeacher.findUnique({
      where: { qrCode },
      include: {
        timetable: { select: { id: true, name: true, periodTimes: true } },
        lessons: {
          include: {
            subject: { select: { name: true, color: true } },
            class: { select: { name: true } },
          },
        },
      },
    });

    if (!teacher) {
      throw new NotFoundException(`Teacher QR code not found`);
    }

    // Cambodia date / day-of-week (1=Mon … 6=Sat per timetable convention)
    const cambodiaDate = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const jsDay = cambodiaDate.getUTCDay(); // 0=Sun
    const day = jsDay === 0 ? 7 : jsDay;   // 1=Mon … 7=Sun
    const dateStr = `${cambodiaDate.getUTCFullYear()}-${String(cambodiaDate.getUTCMonth() + 1).padStart(2, '0')}-${String(cambodiaDate.getUTCDate()).padStart(2, '0')}`;
    const dateObj = new Date(dateStr + 'T00:00:00.000Z');

    // Today's scheduled entries for this teacher
    const todayEntries = await this.prisma.timetableEntry.findMany({
      where: { teacherId: teacher.id, timetableId: teacher.timetableId, day },
      include: {
        subject: { select: { name: true, color: true } },
        class: { select: { name: true } },
        classroom: { select: { name: true } },
      },
      orderBy: { period: 'asc' },
    });

    // Detect current period from timetable period times
    const periodTimes: string[] = teacher.timetable.periodTimes
      ? JSON.parse(teacher.timetable.periodTimes)
      : [];
    const currentPeriod = this.detectCurrentPeriod(periodTimes);

    // Find best matching entry (current period → first scheduled → fallback 1)
    let targetEntry = todayEntries.find(e => e.period === currentPeriod);
    if (!targetEntry && todayEntries.length > 0) targetEntry = todayEntries[0];
    const period = targetEntry?.period ?? (currentPeriod ?? 1);

    const teacherName = `${teacher.firstName} ${teacher.lastName}`;
    const subjectName = targetEntry?.subject?.name ?? '';
    const className = targetEntry?.class?.name ?? '';

    // Check for duplicate
    const existing = await this.prisma.timetableTeacherAttendance.findUnique({
      where: { teacherId_date_period: { teacherId: teacher.id, date: dateObj, period } },
    });

    if (existing) {
      return {
        action: 'ALREADY_RECORDED',
        teacherId: teacher.id,
        teacherName,
        period,
        status: existing.status,
        checkIn: existing.checkIn?.toISOString() ?? null,
        subjectName,
        className,
        timetableName: teacher.timetable.name,
        scheduledPeriods: todayEntries.map(e => e.period),
      };
    }

    // Auto-detect LATE (> graceMinutes after period start). Grace is admin-configurable
    // via AttendanceFormatRule.teacherLateGraceMinutes (STAFF scope). Defaults to 20.
    let status = 'PRESENT';
    if (periodTimes.length >= period) {
      let graceMinutes = 20;
      try {
        const rule = await this.prisma.attendanceFormatRule.findFirst({
          where: { scope: 'STAFF', organizationId: null },
        });
        if (rule && typeof (rule as any).teacherLateGraceMinutes === 'number') {
          graceMinutes = (rule as any).teacherLateGraceMinutes;
        }
      } catch { /* fall back to default 20 */ }
      const [ph, pm] = periodTimes[period - 1].split(':').map(Number);
      const lateAfterMin = ph * 60 + pm + graceMinutes;
      const cambodiaNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
      const nowMin = cambodiaNow.getUTCHours() * 60 + cambodiaNow.getUTCMinutes();
      if (nowMin > lateAfterMin) status = 'LATE';
    }

    const attendance = await this.prisma.timetableTeacherAttendance.create({
      data: { teacherId: teacher.id, date: dateObj, period, status, checkIn: new Date() },
    });

    return {
      action: 'CHECK_IN',
      teacherId: teacher.id,
      teacherName,
      period,
      status,
      checkIn: attendance.checkIn?.toISOString() ?? null,
      subjectName,
      className,
      timetableName: teacher.timetable.name,
      scheduledPeriods: todayEntries.map(e => e.period),
    };
  }

  // ─── Get all scheduled teachers (from PUBLISHED timetables) ────────

  async getAllScheduledTeachers() {
    const timetables = await this.prisma.timetable.findMany({
      select: { id: true, name: true, status: true, periodTimes: true, numberOfDays: true },
      orderBy: { createdAt: 'desc' },
    });

    if (timetables.length === 0) return [];

    const results: any[] = [];
    for (const tt of timetables) {
      const teachers = await this.prisma.timetableTeacher.findMany({
        where: { timetableId: tt.id },
        include: {
          lessons: {
            include: {
              subject: { select: { name: true, color: true } },
              class: { select: { name: true } },
            },
          },
          entries: { orderBy: [{ day: 'asc' }, { period: 'asc' }] },
        },
        orderBy: { lastName: 'asc' },
      });

      // Batch-lookup user photos by email for teachers who don't have a photo set
      const emailsNeedingPhoto = teachers
        .filter(t => !t.photo && t.email)
        .map(t => t.email!);
      const emailToPhoto = new Map<string, string | null>();
      if (emailsNeedingPhoto.length > 0) {
        const users = await this.prisma.user.findMany({
          where: { email: { in: emailsNeedingPhoto } },
          select: { email: true, photo: true },
        });
        for (const u of users) emailToPhoto.set(u.email, u.photo);
      }

      const cambodiaDate = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
      const jsDay = cambodiaDate.getUTCDay();
      const todayDay = jsDay === 0 ? 7 : jsDay;

      for (const t of teachers) {
        const weeklyLessons = t.lessons.reduce((s, l) => s + l.perWeek, 0);
        const todayEntries = t.entries.filter(e => e.day === todayDay);
        // Use teacher's own photo first; fall back to system user photo by email
        const photo = t.photo ?? (t.email ? (emailToPhoto.get(t.email) ?? null) : null);
        results.push({
          id: t.id,
          timetableId: tt.id,
          timetableName: tt.name,
          name: `${t.firstName} ${t.lastName}`,
          khmerName: t.khmerName ?? null,
          short: t.short,
          sex: t.sex,
          color: t.color,
          photo,
          qrCode: t.qrCode,
          weeklyLessons,
          lessons: t.lessons.map(l => ({
            id: l.id,
            subjectName: (l.subject as any)?.name ?? '',
            className: (l.class as any)?.name ?? '',
            perWeek: l.perWeek,
          })),
          timetableStatus: tt.status,
          todayPeriods: todayEntries.map(e => e.period),
          totalEntries: t.entries.length,
        });
      }
    }

    return results;
  }

  // ─── Teacher monthly attendance report ──────────────────────────────

  async getTeacherAttendanceMonthly(timetableId: string, startDate: string, endDate: string) {
    const start = new Date(startDate + 'T00:00:00.000Z');
    const end = new Date(endDate + 'T23:59:59.999Z');

    const teachers = await this.prisma.timetableTeacher.findMany({
      where: { timetableId, lessons: { some: {} } },
      include: {
        lessons: {
          include: {
            subject: { select: { name: true } },
            class: { select: { name: true } },
          },
        },
        attendances: {
          where: { date: { gte: start, lte: end } },
          orderBy: [{ date: 'asc' }, { period: 'asc' }],
        },
      },
      orderBy: { lastName: 'asc' },
    });

    return teachers.map(t => {
      const present = t.attendances.filter(a => a.status === 'PRESENT').length;
      const late = t.attendances.filter(a => a.status === 'LATE').length;
      const absent = t.attendances.filter(a => a.status === 'ABSENT').length;
      return {
        id: t.id,
        name: `${t.firstName} ${t.lastName}`,
        short: t.short,
        color: t.color,
        weeklyLessons: t.lessons.reduce((s, l) => s + l.perWeek, 0),
        lessons: t.lessons.map(l => ({
          subjectName: (l.subject as any)?.name ?? '',
          className: (l.class as any)?.name ?? '',
          perWeek: l.perWeek,
        })),
        present,
        late,
        absent,
        total: present + late + absent,
        attendances: t.attendances.map(a => ({
          id: a.id,
          date: a.date.toISOString(),
          period: a.period,
          status: a.status,
          checkIn: a.checkIn?.toISOString() ?? null,
        })),
      };
    });
  }
}
