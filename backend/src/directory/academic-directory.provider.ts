import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AcademicDirectoryProvider } from './directory.service';
import { ACADEMIC_ROSTER_CONTRACT_ID, ACADEMIC_ROSTER_CONTRACT_VERSION, AcademicClassRoster, AcademicEnrollment, currentAcademicDate } from './academic-roster.contract';

type CoreUser = { id: string; email: string | null; phone: string | null; role: string };

@Injectable()
export class PrismaAcademicDirectoryProvider implements AcademicDirectoryProvider {
  constructor(private readonly prisma: PrismaService) {}

  async resolveClassAudience(classId: string): Promise<CoreUser[]> {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        teacher: { select: { id: true, email: true, phone: true, role: true } },
        students: {
          include: {
            user: { select: { id: true, email: true, phone: true, role: true } },
            parent: { select: { id: true, email: true, phone: true, role: true } },
          },
        },
      },
    });
    if (!cls) return [];
    const byId = new Map<string, CoreUser>();
    if (cls.teacher) byId.set(cls.teacher.id, cls.teacher);
    for (const student of cls.students) {
      byId.set(student.user.id, student.user);
      if (student.parent) byId.set(student.parent.id, student.parent);
    }
    return [...byId.values()];
  }

  async resolveClassesForUser(userId: string, role: string): Promise<string[]> {
    const teacherClassIds = (await this.prisma.class.findMany({ where: { teacherId: userId }, select: { id: true } })).map((item) => item.id);
    const classAdminIds = role === 'CLASS_ADMIN'
      ? (await this.prisma.class.findMany({ where: { classAdminId: userId }, select: { id: true } })).map((item) => item.id)
      : [];
    let studentClassIds: string[] = [];
    if (role === 'STUDENT') {
      const record = await this.prisma.student.findUnique({ where: { userId }, select: { classId: true } });
      if (record?.classId) studentClassIds.push(record.classId);
    } else if (role === 'PARENT') {
      const kids = await this.prisma.student.findMany({ where: { parentId: userId }, select: { classId: true } });
      studentClassIds = kids.map((kid) => kid.classId).filter((id): id is string => !!id);
    }
    return [...new Set([...teacherClassIds, ...classAdminIds, ...studentClassIds])];
  }

  async lookupClasses(ids: string[]): Promise<Array<{ id: string; name: string }>> {
    if (!ids.length) return [];
    return this.prisma.class.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  }

  async getClassRoster(classId: string, asOfIsoDate: string): Promise<AcademicClassRoster> {
    const date = currentAcademicDate(asOfIsoDate);
    await this.assertCurrentAcademicDate(date);
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true, name: true,
        students: { orderBy: { id: 'asc' }, select: {
          id: true, userId: true, studentNumber: true, parentId: true,
          user: { select: { name: true } },
        } },
      },
    });
    return {
      contract: { id: ACADEMIC_ROSTER_CONTRACT_ID, version: ACADEMIC_ROSTER_CONTRACT_VERSION },
      classId, className: cls?.name ?? null, asOfIsoDate: date, source: 'legacy-current-membership',
      students: (cls?.students ?? []).map((student) => ({
        studentId: student.id, userId: student.userId, studentNumber: student.studentNumber,
        name: student.user.name, parentId: student.parentId,
      })),
    };
  }

  async getEnrollmentAtDate(studentId: string, asOfIsoDate: string): Promise<AcademicEnrollment> {
    const date = currentAcademicDate(asOfIsoDate);
    await this.assertCurrentAcademicDate(date);
    const student = await this.prisma.student.findUnique({
      where: { id: studentId }, select: { id: true, classId: true, class: { select: { name: true } } },
    });
    return {
      contract: { id: ACADEMIC_ROSTER_CONTRACT_ID, version: ACADEMIC_ROSTER_CONTRACT_VERSION },
      studentId, classId: student?.classId ?? null, className: student?.class?.name ?? null,
      enrolled: Boolean(student?.classId), asOfIsoDate: date, source: 'legacy-current-membership' as const,
    };
  }

  async departmentForUser(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } });
    return user?.departmentId ?? null;
  }

  private async assertCurrentAcademicDate(value: string): Promise<string> {
    const date = currentAcademicDate(value);
    const today = await this.schoolToday();
    if (date !== today) {
      throw new Error('Historical enrollment lookup is unavailable until Academic Management stores enrollment intervals');
    }
    return date;
  }

  private async schoolToday(): Promise<string> {
    const installation = await this.prisma.installation.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
    if (!installation) throw new Error('Installation timezone is unavailable');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: installation.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
}
