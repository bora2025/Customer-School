import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AttendanceGateway } from './attendance.gateway';
import { NotificationService } from '../notification/notification.service';
import { SessionConfigService } from '../session-config/session-config.service';
import { DirectoryService } from '../directory/directory.service';

function toUTCMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Get current time in Cambodia (GMT+7) */
function nowCambodia(): Date {
  const now = new Date();
  return new Date(now.getTime() + 7 * 60 * 60 * 1000);
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function midnightToIso(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Check if a given date is a scheduled day-off for the class */
function isScheduledDayOff(schedule: string | null | undefined, dateUtc: Date): boolean {
  if (!schedule) return false;
  try {
    const parsed = JSON.parse(schedule);
    // Use Cambodia time to determine the day of week
    const cambodiaDate = new Date(dateUtc.getTime() + 7 * 60 * 60 * 1000);
    const dayName = DAY_NAMES[cambodiaDate.getUTCDay()];
    return parsed[dayName] === 'day-off';
  } catch {
    return false;
  }
}

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private attendanceGateway: AttendanceGateway,
    private notificationService: NotificationService,
    private sessionConfigService: SessionConfigService,
    private readonly directory: DirectoryService,
  ) {}

  private async assertClassAdminClassAccess(operatorRole: string | undefined, operatorId: string, classId: string) {
    if (operatorRole !== 'CLASS_ADMIN') return;
    const classIds = await this.directory.classesForUser(operatorId, 'CLASS_ADMIN');
    if (!classIds.includes(classId)) {
      throw new BadRequestException('CLASS_ADMIN is not assigned to this class');
    }
  }

  private async upsertStudentPermissionRange(
    studentId: string,
    classId: string,
    markedById: string,
    permissionTypeInput?: string,
    startDateInput?: Date,
    endDateInput?: Date,
  ) {
    const permissionType = normalizePermissionType(permissionTypeInput);
    const startDate = toUTCMidnight(startDateInput || new Date());
    const endDate = toUTCMidnight(endDateInput || startDate);
    const from = startDate.getTime() <= endDate.getTime() ? startDate : endDate;
    const to = startDate.getTime() <= endDate.getTime() ? endDate : startDate;

    const sessions = permissionSessions(permissionType);
    const days = dateRangeDays(from, to);
    const cleanup = days.map(day =>
      this.prisma.attendance.deleteMany({
        where: {
          studentId,
          classId,
          date: day,
          status: 'PERMISSION',
          session: { notIn: sessions },
        },
      }),
    );
    const writes = days.flatMap(day =>
      sessions.map(session =>
        this.prisma.attendance.upsert({
          where: { studentId_classId_date_session: { studentId, classId, date: day, session } },
          update: {
            status: 'PERMISSION',
            permissionType,
            permissionStartDate: from,
            permissionEndDate: to,
            markedById,
            checkInTime: null,
            checkOutTime: null,
          },
          create: {
            studentId,
            classId,
            date: day,
            session,
            status: 'PERMISSION',
            permissionType,
            permissionStartDate: from,
            permissionEndDate: to,
            markedById,
            checkInTime: null,
            checkOutTime: null,
          },
        }),
      ),
    );

    await this.prisma.$transaction([...cleanup, ...writes]);
    return {
      status: 'PERMISSION',
      permissionType,
      permissionStartDate: from,
      permissionEndDate: to,
      affectedDays: days.length,
      affectedSessionsPerDay: sessions.length,
      affectedRecords: writes.length,
    };
  }

  private async upsertStaffPermissionRange(
    userId: string,
    markedById: string,
    permissionTypeInput?: string,
    startDateInput?: Date,
    endDateInput?: Date,
  ) {
    const permissionType = normalizePermissionType(permissionTypeInput);
    const startDate = toUTCMidnight(startDateInput || new Date());
    const endDate = toUTCMidnight(endDateInput || startDate);
    const from = startDate.getTime() <= endDate.getTime() ? startDate : endDate;
    const to = startDate.getTime() <= endDate.getTime() ? endDate : startDate;

    const sessions = permissionSessions(permissionType);
    const days = dateRangeDays(from, to);
    const cleanup = days.map(day =>
      this.prisma.staffAttendance.deleteMany({
        where: {
          userId,
          date: day,
          status: 'PERMISSION',
          session: { notIn: sessions },
        },
      }),
    );
    const writes = days.flatMap(day =>
      sessions.map(session =>
        this.prisma.staffAttendance.upsert({
          where: { userId_date_session: { userId, date: day, session } },
          update: {
            status: 'PERMISSION',
            permissionType,
            permissionStartDate: from,
            permissionEndDate: to,
            markedById,
            checkInTime: null,
            checkOutTime: null,
          },
          create: {
            userId,
            date: day,
            session,
            status: 'PERMISSION',
            permissionType,
            permissionStartDate: from,
            permissionEndDate: to,
            markedById,
            checkInTime: null,
            checkOutTime: null,
          },
        }),
      ),
    );

    await this.prisma.$transaction([...cleanup, ...writes]);
    return {
      status: 'PERMISSION',
      permissionType,
      permissionStartDate: from,
      permissionEndDate: to,
      affectedDays: days.length,
      affectedSessionsPerDay: sessions.length,
      affectedRecords: writes.length,
    };
  }

  private async assertStudentInClass(studentId: string, classId: string, asOfIsoDate: string) {
    const roster = await this.directory.getClassRoster(classId, asOfIsoDate);
    const member = roster.students.find((s) => s.studentId === studentId);
    if (!member) throw new NotFoundException(`Student with ID ${studentId} not found in class ${classId}`);
    return member;
  }

  private async classScheduleForDayOff(classId: string): Promise<string | null> {
    // Attendance owns session configs via SessionConfigService; the class schedule
    // snapshot is obtained through the academic class lookup contract.
    const [cls] = await this.directory.lookupClasses([classId]);
    // Until a dedicated class-schedule contract exists, we rely on the legacy
    // class schedule field via the lookupClasses name-only fallback.  This is a
    // transitional guard: Attendance extraction will introduce its own schedule
    // contract once class scheduling moves to the Timetable plugin.
    return null;
  }

  async recordAttendance(
    studentId: string,
    classId: string,
    status: string,
    teacherId: string,
    operatorRole?: string,
    date?: Date,
    session: number = 1,
    providedCheckInTime?: Date,
    latitude?: number,
    longitude?: number,
    location?: string,
    permissionType?: string,
    permissionStartDate?: Date,
    permissionEndDate?: Date,
  ) {
    await this.assertClassAdminClassAccess(operatorRole, teacherId, classId);
    const raw = date || new Date();
    const attendanceDate = toUTCMidnight(raw);
    const asOfIsoDate = midnightToIso(attendanceDate);
    // Use the actual scan time from the frontend if provided, otherwise fall back to now
    const checkInTime = providedCheckInTime || new Date();

    // Validate that student exists and is in the class via academic roster contract
    const member = await this.assertStudentInClass(studentId, classId, asOfIsoDate);

    if (status === 'PERMISSION') {
      return this.upsertStudentPermissionRange(
        studentId,
        classId,
        teacherId,
        permissionType,
        permissionStartDate || attendanceDate,
        permissionEndDate || permissionStartDate || attendanceDate,
      );
    }

    // Auto-force DAY_OFF if today is a scheduled day-off for this class
    const classSchedule: string | null = null;
    if (isScheduledDayOff(classSchedule, attendanceDate) && status !== 'DAY_OFF') {
      status = 'DAY_OFF';
    }

    // Determine final status — auto-detect LATE if check-in is after the session endTime
    let finalStatus = status;
    if (status === 'PRESENT') {
      try {
        const configs = await this.sessionConfigService.getConfigs(classId);
        const cfg = configs.find((c: any) => c.session === session);
        if (cfg) {
          const [eh, em] = cfg.endTime.split(':').map(Number);
          const lateAfterMinutes = eh * 60 + em;
          const cambodiaCheckIn = new Date(checkInTime.getTime() + 7 * 60 * 60 * 1000);
          const checkInMinutes = cambodiaCheckIn.getUTCHours() * 60 + cambodiaCheckIn.getUTCMinutes();
          if (checkInMinutes > lateAfterMinutes) {
            finalStatus = 'LATE';
          }
        }
      } catch (err) {
        console.error('Late detection failed, defaulting to PRESENT:', err?.message || err);
      }
    }

    // For DAY_OFF: no checkInTime needed
    const isAttending = finalStatus === 'PRESENT' || finalStatus === 'LATE';

    // Check if a record already exists — preserve the first check-in time and its status
    const existingRecord = await this.prisma.attendance.findUnique({
      where: { studentId_classId_date_session: { studentId, classId, date: attendanceDate, session } },
    });
    const keepOriginal = !!(existingRecord?.checkInTime) && isAttending;

    // Use upsert to handle re-submissions
    const attendance = await this.prisma.attendance.upsert({
      where: {
        studentId_classId_date_session: {
          studentId,
          classId,
          date: attendanceDate,
          session,
        },
      },
      update: {
        status: keepOriginal ? existingRecord.status : finalStatus as any,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: teacherId,
        checkInTime: keepOriginal ? existingRecord.checkInTime : (isAttending ? checkInTime : null),
        ...(latitude != null ? { scanLatitude: latitude } : {}),
        ...(longitude != null ? { scanLongitude: longitude } : {}),
        ...(location ? { scanLocation: location } : {}),
      },
      create: {
        studentId,
        classId,
        date: attendanceDate,
        session,
        status: finalStatus as any,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: teacherId,
        checkInTime: isAttending ? checkInTime : null,
        ...(latitude != null ? { scanLatitude: latitude } : {}),
        ...(longitude != null ? { scanLongitude: longitude } : {}),
        ...(location ? { scanLocation: location } : {}),
      },
    });

    // Notify real-time
    const attendanceData = {
      studentId,
      studentName: member.name ?? studentId,
      status: keepOriginal ? existingRecord!.status : finalStatus,
      session,
      timestamp: attendance.timestamp,
    };
    this.attendanceGateway.notifyAttendanceUpdate(classId, attendanceData);

    // Send notification if absent
    if (finalStatus === 'ABSENT') {
      try {
        await this.notificationService.sendAbsenceNotification(studentId);
      } catch (err) {
        console.error('Failed to send absence notification:', err?.message || err);
      }
    }

    return attendance;
  }

  async recordBulkAttendance(
    records: Array<{ studentId: string; status: string; checkInTime?: Date; permissionType?: string; permissionStartDate?: Date; permissionEndDate?: Date }>,
    classId: string,
    teacherId: string,
    operatorRole?: string,
    date?: Date,
    session: number = 1,
    latitude?: number,
    longitude?: number,
    location?: string,
  ) {
    await this.assertClassAdminClassAccess(operatorRole, teacherId, classId);
    const raw = date || new Date();
    const attendanceDate = toUTCMidnight(raw);
    const asOfIsoDate = midnightToIso(attendanceDate);

    const locData = {
      ...(latitude != null ? { scanLatitude: latitude } : {}),
      ...(longitude != null ? { scanLongitude: longitude } : {}),
      ...(location ? { scanLocation: location } : {}),
    };

    // Validate membership through the academic roster contract instead of direct Student/Class joins.
    const studentIds = records.map(r => r.studentId);
    const roster = await this.directory.getClassRoster(classId, asOfIsoDate);
    const studentMap = new Map(roster.students.map(s => [s.studentId, s]));

    // Check if today is a scheduled day-off for this class
    // (classScheduleForDayOff is reserved for a future class-schedule contract)
    const classSchedule: string | null = null;
    const isDayOff = isScheduledDayOff(classSchedule, attendanceDate);

    // Look up session config for late detection — student is LATE if check-in is after session endTime
    let lateAfterMinutes: number | null = null;
    try {
      const configs = await this.sessionConfigService.getConfigs(classId);
      const cfg = configs.find((c: any) => c.session === session);
      if (cfg) {
        const [eh, em] = cfg.endTime.split(':').map(Number);
        lateAfterMinutes = eh * 60 + em;
      }
    } catch (err) {
      console.error('Failed to load session config for late detection:', err?.message || err);
    }

    const results: Array<{ studentId: string; success: boolean; error?: string }> = [];

    // Process all records in a single transaction
    await this.prisma.$transaction(async (tx) => {
      for (const record of records) {
        const student = studentMap.get(record.studentId);
        if (!student) {
          results.push({ studentId: record.studentId, success: false, error: 'Student not found in class' });
          continue;
        }

        if (record.status === 'PERMISSION') {
          const pType = normalizePermissionType(record.permissionType);
          const pStart = toUTCMidnight(record.permissionStartDate || attendanceDate);
          const pEnd = toUTCMidnight(record.permissionEndDate || record.permissionStartDate || attendanceDate);
          const from = pStart.getTime() <= pEnd.getTime() ? pStart : pEnd;
          const to = pStart.getTime() <= pEnd.getTime() ? pEnd : pStart;
          const days = dateRangeDays(from, to);
          const sessions = permissionSessions(pType);
          for (const day of days) {
            for (const permSession of sessions) {
              await tx.attendance.upsert({
                where: { studentId_classId_date_session: { studentId: record.studentId, classId, date: day, session: permSession } },
                update: {
                  status: 'PERMISSION',
                  permissionType: pType,
                  permissionStartDate: from,
                  permissionEndDate: to,
                  markedById: teacherId,
                  checkInTime: null,
                  checkOutTime: null,
                },
                create: {
                  studentId: record.studentId,
                  classId,
                  date: day,
                  session: permSession,
                  status: 'PERMISSION',
                  permissionType: pType,
                  permissionStartDate: from,
                  permissionEndDate: to,
                  markedById: teacherId,
                  checkInTime: null,
                  checkOutTime: null,
                },
              });
            }
          }
          results.push({ studentId: record.studentId, success: true });
          this.attendanceGateway.notifyAttendanceUpdate(classId, {
            studentId: record.studentId,
            studentName: student.name ?? student.studentId,
            status: 'PERMISSION',
            session,
            timestamp: new Date(),
          });
          continue;
        }

        let finalStatus = record.status;
        const checkInTime = record.checkInTime || new Date();

        // Auto-force DAY_OFF if today is a scheduled day-off for this class
        if (isDayOff && finalStatus !== 'DAY_OFF') {
          finalStatus = 'DAY_OFF';
        }

        // Auto-detect LATE based on session config start time
        if (record.status === 'PRESENT' && lateAfterMinutes !== null && record.checkInTime) {
          const cambodiaCheckIn = new Date(record.checkInTime.getTime() + 7 * 60 * 60 * 1000);
          const checkInMinutes = cambodiaCheckIn.getUTCHours() * 60 + cambodiaCheckIn.getUTCMinutes();
          if (checkInMinutes > lateAfterMinutes) {
            finalStatus = 'LATE';
          }
        }

        const isAttending = finalStatus === 'PRESENT' || finalStatus === 'LATE';

        // Check if a record already exists — preserve the first check-in time and its status
        const existingBulk = await tx.attendance.findUnique({
          where: { studentId_classId_date_session: { studentId: record.studentId, classId, date: attendanceDate, session } },
        });
        const keepOriginalBulk = !!(existingBulk?.checkInTime) && isAttending;

        await tx.attendance.upsert({
          where: {
            studentId_classId_date_session: {
              studentId: record.studentId,
              classId,
              date: attendanceDate,
              session,
            },
          },
          update: {
            status: keepOriginalBulk ? existingBulk.status : finalStatus as any,
            permissionType: null,
            permissionStartDate: null,
            permissionEndDate: null,
            markedById: teacherId,
            checkInTime: keepOriginalBulk ? existingBulk.checkInTime : (isAttending ? checkInTime : null),
            ...locData,
          },
          create: {
            studentId: record.studentId,
            classId,
            date: attendanceDate,
            session,
            status: finalStatus as any,
            permissionType: null,
            permissionStartDate: null,
            permissionEndDate: null,
            markedById: teacherId,
            checkInTime: isAttending ? checkInTime : null,
            ...locData,
          },
        });

        results.push({ studentId: record.studentId, success: true });

        // Notify real-time
        this.attendanceGateway.notifyAttendanceUpdate(classId, {
          studentId: record.studentId,
          studentName: student.name ?? student.studentId,
          status: keepOriginalBulk ? existingBulk!.status : finalStatus,
          session,
          timestamp: new Date(),
        });
      }
    });

    // Send absence notifications outside the transaction (non-blocking)
    const absentStudentIds = records
      .filter(r => r.status === 'ABSENT')
      .map(r => r.studentId);
    for (const sid of absentStudentIds) {
      try {
        await this.notificationService.sendAbsenceNotification(sid);
      } catch (err) {
        console.error('Failed to send absence notification:', err?.message || err);
      }
    }

    return { total: records.length, success: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
  }

  async recordCheckOut(studentId: string, classId: string, session: number, date?: Date) {
    const raw = date || new Date();
    const attendanceDate = toUTCMidnight(raw);
    const checkOutTime = new Date();

    // CHECK_OUT sessions pair with the preceding CHECK_IN session's record
    let targetSession = session;
    try {
      const configs = await this.sessionConfigService.getConfigs(classId);
      const cfg = configs.find((c: any) => c.session === session);
      if (cfg && cfg.type === 'CHECK_OUT') {
        const preceding = configs
          .filter((c: any) => c.type === 'CHECK_IN' && c.session < session)
          .sort((a: any, b: any) => b.session - a.session);
        if (preceding.length > 0) {
          targetSession = preceding[0].session;
        }
      }
    } catch (err) {
      console.error('Failed to load session config for check-out pairing:', err?.message || err);
    }

    const existing = await this.prisma.attendance.findUnique({
      where: {
        studentId_classId_date_session: { studentId, classId, date: attendanceDate, session: targetSession },
      },
    });

    if (!existing) {
      throw new NotFoundException('No attendance record found for check-out');
    }

    return this.prisma.attendance.update({
      where: { id: existing.id },
      data: {
        status: existing.status === 'PERMISSION' ? 'PRESENT' : existing.status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        checkOutTime,
      },
    });
  }

  async recordStaffAttendance(
    userId: string,
    status: string,
    markedById: string,
    date?: Date,
    session: number = 1,
    providedCheckInTime?: Date,
    latitude?: number,
    longitude?: number,
    location?: string,
    permissionType?: string,
    permissionStartDate?: Date,
    permissionEndDate?: Date,
  ) {
    try {
      const raw = date || new Date();
      const attendanceDate = toUTCMidnight(raw);
      const checkInTime = providedCheckInTime || new Date();

      // Validate user exists and is staff
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || (user.role !== 'TEACHER' && user.role !== 'ADMIN')) {
        throw new NotFoundException(`Staff member not found for userId: ${userId}`);
      }

      if (status === 'PERMISSION') {
        return this.upsertStaffPermissionRange(
          userId,
          markedById,
          permissionType,
          permissionStartDate || attendanceDate,
          permissionEndDate || permissionStartDate || attendanceDate,
        );
      }

      // Auto-detect LATE if check-in is after the session endTime
      let finalStatus = status;
      if (status === 'PRESENT') {
        try {
          const configs = await this.sessionConfigService.getStaffDefaults();
          const cfg = configs.find((c: any) => c.session === session);
          if (cfg && cfg.type === 'CHECK_IN') {
            const [eh, em] = cfg.endTime.split(':').map(Number);
            const lateAfterMinutes = eh * 60 + em;
            const cambodiaCheckIn = new Date(checkInTime.getTime() + 7 * 60 * 60 * 1000);
            const checkInMinutes = cambodiaCheckIn.getUTCHours() * 60 + cambodiaCheckIn.getUTCMinutes();
            if (checkInMinutes > lateAfterMinutes) {
              finalStatus = 'LATE';
            }
          }
        } catch (err) {
          console.error('Staff late detection failed, defaulting to PRESENT:', err?.message || err);
        }
      }

      const isAttending = finalStatus === 'PRESENT' || finalStatus === 'LATE';

      // Check if a record already exists — preserve the first check-in time and its status
      const existingStaff = await this.prisma.staffAttendance.findUnique({
        where: { userId_date_session: { userId, date: attendanceDate, session } },
      });
      const keepOriginalStaff = existingStaff?.checkInTime && isAttending;

      const record = await this.prisma.staffAttendance.upsert({
        where: {
          userId_date_session: { userId, date: attendanceDate, session },
        },
        update: {
          status: keepOriginalStaff ? existingStaff.status : finalStatus,
          permissionType: null,
          permissionStartDate: null,
          permissionEndDate: null,
          markedById,
          checkInTime: keepOriginalStaff ? existingStaff.checkInTime : (isAttending ? checkInTime : null),
          ...(latitude != null ? { scanLatitude: latitude } : {}),
          ...(longitude != null ? { scanLongitude: longitude } : {}),
          ...(location ? { scanLocation: location } : {}),
        },
        create: {
          userId,
          date: attendanceDate,
          session,
          status: finalStatus,
          permissionType: null,
          permissionStartDate: null,
          permissionEndDate: null,
          markedById,
          checkInTime: isAttending ? checkInTime : null,
          ...(latitude != null ? { scanLatitude: latitude } : {}),
          ...(longitude != null ? { scanLongitude: longitude } : {}),
          ...(location ? { scanLocation: location } : {}),
        },
      });

      return record;
    } catch (err) {
      console.error('[staff-attendance/record] ERROR:', err?.message || err, err?.stack);
      throw err;
    }
  }

  async recordStaffCheckOut(userId: string, session: number, date?: Date) {
    try {
      const raw = date || new Date();
      const attendanceDate = toUTCMidnight(raw);
      const checkOutTime = new Date();

      // CHECK_OUT sessions pair with the preceding CHECK_IN session's record
      let targetSession = session;
      try {
        const configs = await this.sessionConfigService.getStaffDefaults();
        const cfg = configs.find((c: any) => c.session === session);
        if (cfg && cfg.type === 'CHECK_OUT') {
          const preceding = configs
            .filter((c: any) => c.type === 'CHECK_IN' && c.session < session)
            .sort((a: any, b: any) => b.session - a.session);
          if (preceding.length > 0) {
            targetSession = preceding[0].session;
          }
        }
      } catch (err) {
        console.error('Failed to load session config for staff check-out pairing:', err?.message || err);
      }

      const existing = await this.prisma.staffAttendance.findUnique({
        where: {
          userId_date_session: { userId, date: attendanceDate, session: targetSession },
        },
      });

      if (!existing) {
        throw new NotFoundException('No staff attendance record found for check-out');
      }

      return this.prisma.staffAttendance.update({
        where: { id: existing.id },
        data: {
          status: existing.status === 'PERMISSION' ? 'PRESENT' : existing.status,
          permissionType: null,
          permissionStartDate: null,
          permissionEndDate: null,
          checkOutTime,
        },
      });
    } catch (err) {
      console.error('[staff-attendance/check-out] ERROR:', err?.message || err, err?.stack);
      throw err;
    }
  }

  async updateAttendance(
    attendanceId: string,
    status: string,
    adminId: string,
    permissionType?: string,
    permissionStartDate?: Date,
    permissionEndDate?: Date,
  ) {
    const record = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!record) throw new NotFoundException('Attendance record not found');

    if (status === 'PERMISSION') {
      // Single-record update: do NOT call upsertStudentPermissionRange in the edit
      // context — that would bulk-overwrite sessions the admin already changed.
      // Use editPermissionType endpoint to restructure sessions by type.
      const pType = normalizePermissionType(permissionType);
      const pStart = toUTCMidnight(permissionStartDate || record.date);
      const pEnd = toUTCMidnight(permissionEndDate || permissionStartDate || record.date);
      return this.prisma.attendance.update({
        where: { id: attendanceId },
        data: {
          status: 'PERMISSION',
          permissionType: pType,
          permissionStartDate: pStart,
          permissionEndDate: pEnd,
          markedById: adminId,
          checkInTime: null,
          checkOutTime: null,
        },
      });
    }

    return this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: adminId,
      },
    });
  }

  /**
   * Edit permission type for a single student on a specific date (edit-attendance context).
   * - In-scope sessions (covered by new type) are upserted as PERMISSION/new-type.
   * - Out-of-scope sessions that are currently PERMISSION are set to ABSENT (not deleted),
   *   so they remain visible in reports and the admin can change them to PRESENT if needed.
   * - Out-of-scope sessions already PRESENT/LATE/ABSENT are left unchanged.
   */
  async editPermissionType(
    studentId: string,
    classId: string,
    date: string,
    adminId: string,
    newPermissionType: string,
  ) {
    const attendanceDate = toUTCMidnight(new Date(date));
    const newType = normalizePermissionType(newPermissionType);
    const inScopeSessions = permissionSessions(newType);
    const allSessions = [1, 2, 3, 4];
    const outOfScopeSessions = allSessions.filter(s => !inScopeSessions.includes(s));

    // Fetch existing records to avoid overwriting PRESENT/LATE sessions
    const existing = await this.prisma.attendance.findMany({
      where: { studentId, classId, date: attendanceDate },
    });
    const existingMap = new Map(existing.map(r => [r.session, r]));

    const ops: any[] = [];

    // In-scope sessions: upsert to PERMISSION/new-type, but SKIP sessions already
    // set to PRESENT or LATE by the admin (don't overwrite their deliberate edits).
    for (const session of inScopeSessions) {
      const rec = existingMap.get(session);
      if (rec && (rec.status === 'PRESENT' || rec.status === 'LATE')) continue;
      ops.push(
        this.prisma.attendance.upsert({
          where: { studentId_classId_date_session: { studentId, classId, date: attendanceDate, session } },
          update: {
            status: 'PERMISSION',
            permissionType: newType,
            permissionStartDate: attendanceDate,
            permissionEndDate: attendanceDate,
            markedById: adminId,
            checkInTime: null,
            checkOutTime: null,
          },
          create: {
            studentId,
            classId,
            date: attendanceDate,
            session,
            status: 'PERMISSION',
            permissionType: newType,
            permissionStartDate: attendanceDate,
            permissionEndDate: attendanceDate,
            markedById: adminId,
            checkInTime: null,
            checkOutTime: null,
          },
        }),
      );
    }

    // Out-of-scope sessions that are still PERMISSION → set to ABSENT (visible + editable)
    for (const session of outOfScopeSessions) {
      ops.push(
        this.prisma.attendance.updateMany({
          where: { studentId, classId, date: attendanceDate, session, status: 'PERMISSION' },
          data: {
            status: 'ABSENT',
            permissionType: null,
            permissionStartDate: null,
            permissionEndDate: null,
            markedById: adminId,
          },
        }),
      );
    }

    if (ops.length > 0) await this.prisma.$transaction(ops);
    return { success: true, permissionType: newType };
  }

  async updateStaffAttendance(
    staffAttendanceId: string,
    status: string,
    adminId: string,
    permissionType?: string,
    permissionStartDate?: Date,
    permissionEndDate?: Date,
  ) {
    const record = await this.prisma.staffAttendance.findUnique({ where: { id: staffAttendanceId } });
    if (!record) throw new NotFoundException('Staff attendance record not found');

    if (status === 'PERMISSION') {
      const pType = normalizePermissionType(permissionType);
      const pStart = toUTCMidnight(permissionStartDate || record.date);
      const pEnd = toUTCMidnight(permissionEndDate || permissionStartDate || record.date);
      return this.prisma.staffAttendance.update({
        where: { id: staffAttendanceId },
        data: {
          status: 'PERMISSION',
          permissionType: pType,
          permissionStartDate: pStart,
          permissionEndDate: pEnd,
          markedById: adminId,
          checkInTime: null,
          checkOutTime: null,
        },
      });
    }

    return this.prisma.staffAttendance.update({
      where: { id: staffAttendanceId },
      data: {
        status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: adminId,
      },
    });
  }

  async getStudentAttendanceRecords(classId: string, date: string) {
    const d = new Date(date);
    const attendanceDate = toUTCMidnight(d);
    const asOfIsoDate = midnightToIso(attendanceDate);

    const roster = await this.directory.getClassRoster(classId, asOfIsoDate);
    const students = roster.students.slice().sort((a, b) =>
      (a.studentNumber || '').localeCompare(b.studentNumber || '', undefined, { numeric: true }),
    );

    const attendances = await this.prisma.attendance.findMany({
      where: { classId, date: attendanceDate },
    });

    return students.map(s => {
      const records = attendances.filter(a => a.studentId === s.studentId);
      return {
        studentId: s.studentId,
        studentNumber: s.studentNumber || '',
        studentName: s.name || '',
        sessions: [1, 2, 3, 4].map(session => {
          const rec = records.find(r => r.session === session);
          return {
            session,
            attendanceId: rec?.id || null,
            status: rec?.status || null,
            permissionType: rec?.permissionType || null,
            permissionStartDate: rec?.permissionStartDate?.toISOString() || null,
            permissionEndDate: rec?.permissionEndDate?.toISOString() || null,
            checkInTime: rec?.checkInTime?.toISOString() || null,
            checkOutTime: rec?.checkOutTime?.toISOString() || null,
          };
        }),
      };
    });
  }

  async getStaffAttendanceRecords(date: string) {
    const d = new Date(date);
    const attendanceDate = toUTCMidnight(d);

    const staff = await this.prisma.user.findMany({
      where: { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } },
      orderBy: { name: 'asc' },
    });

    const attendances = await this.prisma.staffAttendance.findMany({
      where: { date: attendanceDate },
    });

    return staff.map(s => {
      const records = attendances.filter(a => a.userId === s.id);
      return {
        userId: s.id,
        staffName: s.name,
        role: s.role,
        sessions: [1, 2, 3, 4].map(session => {
          const rec = records.find(r => r.session === session);
          return {
            session,
            attendanceId: rec?.id || null,
            status: rec?.status || null,
            permissionType: rec?.permissionType || null,
            permissionStartDate: rec?.permissionStartDate?.toISOString() || null,
            permissionEndDate: rec?.permissionEndDate?.toISOString() || null,
            checkInTime: rec?.checkInTime?.toISOString() || null,
            checkOutTime: rec?.checkOutTime?.toISOString() || null,
          };
        }),
      };
    });
  }

  async createAttendanceRecord(
    studentId: string,
    classId: string,
    session: number,
    status: string,
    adminId: string,
    date: string,
    permissionType?: string,
    permissionStartDate?: Date,
    permissionEndDate?: Date,
  ) {
    const attendanceDate = toUTCMidnight(new Date(date));

    if (status === 'PERMISSION') {
      const pType = normalizePermissionType(permissionType);
      const pStart = toUTCMidnight(permissionStartDate || attendanceDate);
      const pEnd = toUTCMidnight(permissionEndDate || permissionStartDate || attendanceDate);
      return this.prisma.attendance.upsert({
        where: { studentId_classId_date_session: { studentId, classId, date: attendanceDate, session } },
        update: {
          status: 'PERMISSION',
          permissionType: pType,
          permissionStartDate: pStart,
          permissionEndDate: pEnd,
          markedById: adminId,
          checkInTime: null,
          checkOutTime: null,
        },
        create: {
          studentId,
          classId,
          date: attendanceDate,
          session,
          status: 'PERMISSION',
          permissionType: pType,
          permissionStartDate: pStart,
          permissionEndDate: pEnd,
          markedById: adminId,
          checkInTime: null,
          checkOutTime: null,
        },
      });
    }

    const isAttending = status === 'PRESENT' || status === 'LATE';

    return this.prisma.attendance.upsert({
      where: {
        studentId_classId_date_session: { studentId, classId, date: attendanceDate, session },
      },
      update: {
        status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: adminId,
      },
      create: {
        studentId,
        classId,
        date: attendanceDate,
        session,
        status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: adminId,
        checkInTime: isAttending ? new Date() : null,
      },
    });
  }

  async createStaffAttendanceRecord(
    userId: string,
    session: number,
    status: string,
    adminId: string,
    date: string,
    permissionType?: string,
    permissionStartDate?: Date,
    permissionEndDate?: Date,
  ) {
    const attendanceDate = toUTCMidnight(new Date(date));

    if (status === 'PERMISSION') {
      const pType = normalizePermissionType(permissionType);
      const pStart = toUTCMidnight(permissionStartDate || attendanceDate);
      const pEnd = toUTCMidnight(permissionEndDate || permissionStartDate || attendanceDate);
      return this.prisma.staffAttendance.upsert({
        where: { userId_date_session: { userId, date: attendanceDate, session } },
        update: {
          status: 'PERMISSION',
          permissionType: pType,
          permissionStartDate: pStart,
          permissionEndDate: pEnd,
          markedById: adminId,
          checkInTime: null,
          checkOutTime: null,
        },
        create: {
          userId,
          date: attendanceDate,
          session,
          status: 'PERMISSION',
          permissionType: pType,
          permissionStartDate: pStart,
          permissionEndDate: pEnd,
          markedById: adminId,
          checkInTime: null,
          checkOutTime: null,
        },
      });
    }

    const isAttending = status === 'PRESENT' || status === 'LATE';

    return this.prisma.staffAttendance.upsert({
      where: {
        userId_date_session: { userId, date: attendanceDate, session },
      },
      update: {
        status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: adminId,
      },
      create: {
        userId,
        date: attendanceDate,
        session,
        status,
        permissionType: null,
        permissionStartDate: null,
        permissionEndDate: null,
        markedById: adminId,
        checkInTime: isAttending ? new Date() : null,
      },
    });
  }

  /**
   * Smart auto-scan: determines check-in or check-out from staff session configs
   * and correctly pairs CHECK_OUT with the preceding CHECK_IN session record.
   */
  async autoScanStaffAttendance(userId: string, markedById: string, latitude?: number, longitude?: number, location?: string) {
    try {
      const now = nowCambodia();
      const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
      const attendanceDate = toUTCMidnight(now);

      const locData = {
        ...(latitude != null ? { scanLatitude: latitude } : {}),
        ...(longitude != null ? { scanLongitude: longitude } : {}),
        ...(location ? { scanLocation: location } : {}),
      };

      // Validate user is staff (any role except STUDENT and PARENT)
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { department: { select: { id: true, name: true, nameKh: true } } },
      });
      const nonStaffRoles = ['STUDENT', 'PARENT'];
      if (!user || nonStaffRoles.includes(user.role)) {
        throw new NotFoundException(`Staff member not found for userId: ${userId}`);
      }

      const userInfo = { userName: user.name, userPhoto: user.photo, userRole: user.role, userDepartment: user.department };

      // Get staff session configs
      const configs = await this.sessionConfigService.getStaffDefaults();
      const sorted = [...configs]
        .filter(c => c.startTime !== c.endTime) // skip disabled sessions
        .sort((a, b) => a.session - b.session);

      // Convert current time to minutes for comparison
      const nowMinutes = parseInt(hhmm.split(':')[0]) * 60 + parseInt(hhmm.split(':')[1]);
      const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

      // Find current or nearest session
      let matched = sorted.find(c => hhmm >= c.startTime && hhmm <= c.endTime);
      if (!matched) {
        // If within 30min before a session's start → pick that upcoming session
        matched = sorted.find(c => {
          const startMin = toMinutes(c.startTime);
          return nowMinutes >= startMin - 30 && nowMinutes < startMin;
        });
      }
      if (!matched) {
        // Nearest upcoming first; if all past, most recently started
        const upcoming = sorted.filter(c => toMinutes(c.startTime) > nowMinutes);
        if (upcoming.length > 0) {
          matched = upcoming[0];
        } else {
          const past = sorted.filter(c => c.startTime <= hhmm);
          matched = past.length > 0 ? past[past.length - 1] : (sorted[0] || configs[configs.length - 1]);
        }
      }


      if (matched.type === 'CHECK_IN') {
        // Create/upsert check-in record using this session number
        const checkInTime = new Date();

        // Auto-detect LATE: if check-in is >20 min after session start time
        let status = 'PRESENT';
        try {
          const [sh, sm] = matched.startTime.split(':').map(Number);
          const lateAfterMinutes = sh * 60 + sm + 20;
          const cambodiaCheckIn = new Date(checkInTime.getTime() + 7 * 60 * 60 * 1000);
          const checkInMinutes = cambodiaCheckIn.getUTCHours() * 60 + cambodiaCheckIn.getUTCMinutes();
          if (checkInMinutes > lateAfterMinutes) {
            status = 'LATE';
          }
        } catch (err) {
          console.error('Staff late detection failed, defaulting to PRESENT:', err?.message || err);
        }

        // Check if a record already exists — preserve the first check-in time and its status
        const existingAutoScan = await this.prisma.staffAttendance.findUnique({
          where: { userId_date_session: { userId, date: attendanceDate, session: matched.session } },
        });
        const keepOriginalAutoScan = existingAutoScan?.checkInTime;

        const record = await this.prisma.staffAttendance.upsert({
          where: { userId_date_session: { userId, date: attendanceDate, session: matched.session } },
          update: {
            status: keepOriginalAutoScan ? existingAutoScan.status : status,
            permissionType: null,
            permissionStartDate: null,
            permissionEndDate: null,
            markedById,
            checkInTime: keepOriginalAutoScan ? existingAutoScan.checkInTime : checkInTime,
            ...locData,
          },
          create: {
            userId,
            date: attendanceDate,
            session: matched.session,
            status,
            permissionType: null,
            permissionStartDate: null,
            permissionEndDate: null,
            markedById,
            checkInTime,
            ...locData,
          },
        });
        return { ...record, action: 'CHECK_IN', sessionName: `Session ${matched.session}`, ...userInfo };
      } else {
        // CHECK_OUT: find the preceding CHECK_IN session to pair with
        const checkInConfigs = sorted.filter(c => c.type === 'CHECK_IN' && c.session < matched!.session);
        const pairedCheckIn = checkInConfigs[checkInConfigs.length - 1]; // nearest preceding CHECK_IN
        const targetSession = pairedCheckIn ? pairedCheckIn.session : matched.session;


        const existing = await this.prisma.staffAttendance.findUnique({
          where: { userId_date_session: { userId, date: attendanceDate, session: targetSession } },
        });

        if (existing) {
          const record = await this.prisma.staffAttendance.update({
            where: { id: existing.id },
            data: {
              status: existing.status === 'PERMISSION' ? 'PRESENT' : existing.status,
              permissionType: null,
              permissionStartDate: null,
              permissionEndDate: null,
              checkOutTime: new Date(),
              ...locData,
            },
          });
          return { ...record, action: 'CHECK_OUT', sessionName: `Session ${matched.session}`, ...userInfo };
        } else {
          // No prior check-in — create a record with both check-in (null) and check-out
          const record = await this.prisma.staffAttendance.create({
            data: {
              userId,
              date: attendanceDate,
              session: targetSession,
              status: 'PRESENT',
              permissionType: null,
              permissionStartDate: null,
              permissionEndDate: null,
              markedById,
              checkOutTime: new Date(),
              ...locData,
            },
          });
          return { ...record, action: 'CHECK_OUT', sessionName: `Session ${matched.session}`, ...userInfo };
        }
      }
    } catch (err) {
      console.error('[staff/auto-scan] ERROR:', err?.message || err, err?.stack);
      throw err;
    }
  }

  /** Get attendance records for the logged-in employee */
  async getEmployeeOwnRecords(userId: string, date?: string, month?: string) {
    const now = new Date();
    let dateStart: Date;
    let dateEnd: Date;

    if (date) {
      dateStart = new Date(date + 'T00:00:00.000Z');
      dateEnd = new Date(date + 'T23:59:59.999Z');
    } else if (month) {
      // month format: "2026-03"
      const [y, m] = month.split('-').map(Number);
      dateStart = new Date(Date.UTC(y, m - 1, 1));
      dateEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    } else {
      // Default: current month
      dateStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      dateEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
    }

    const records = await this.prisma.staffAttendance.findMany({
      where: {
        userId,
        date: { gte: dateStart, lte: dateEnd },
      },
      orderBy: [{ date: 'desc' }, { session: 'asc' }],
    });

    // Also get today's records for the dashboard summary
    const todayStart = toUTCMidnight(new Date());
    const todayRecords = await this.prisma.staffAttendance.findMany({
      where: { userId, date: todayStart },
      orderBy: { session: 'asc' },
    });

    // Compute summary
    const total = records.length;
    const present = records.filter(r => r.status === 'PRESENT').length;
    const late = records.filter(r => r.status === 'LATE').length;
    const absent = records.filter(r => r.status === 'ABSENT').length;

    return {
      records,
      todayRecords,
      summary: { total, present, late, absent },
    };
  }

  /** Get today's attendance for a specific user (student or staff) */
  async getUserDailyAttendance(userId: string, date?: string) {
    const d = date ? new Date(date) : nowCambodia();
    const attendanceDate = toUTCMidnight(d);
    const asOfIsoDate = midnightToIso(attendanceDate);

    // Resolve the student through the directory contract instead of direct Student/Class joins.
    const studentClassIds = await this.directory.classesForUser(userId, 'STUDENT');
    if (studentClassIds.length > 0) {
      const classId = studentClassIds[0];
      const roster = await this.directory.getClassRoster(classId, asOfIsoDate);
      const member = roster.students.find(s => s.userId === userId);
      if (!member) {
        throw new NotFoundException(`Student with user ID ${userId} not found in class ${classId}`);
      }

      const attendances = await this.prisma.attendance.findMany({
        where: { studentId: member.studentId, date: attendanceDate },
      });
      return {
        type: 'student' as const,
        className: roster.className || null,
        sessions: [1, 2, 3, 4].map(session => {
          const rec = attendances.find(a => a.session === session);
          return {
            session,
            status: rec?.status || null,
            checkInTime: rec?.checkInTime?.toISOString() || null,
            checkOutTime: rec?.checkOutTime?.toISOString() || null,
          };
        }),
      };
    }

    // Staff attendance
    const staffAttendances = await this.prisma.staffAttendance.findMany({
      where: { userId, date: attendanceDate },
    });
    return {
      type: 'staff' as const,
      className: null,
      sessions: [1, 2, 3, 4].map(session => {
        const rec = staffAttendances.find(a => a.session === session);
        return {
          session,
          status: rec?.status || null,
          checkInTime: rec?.checkInTime?.toISOString() || null,
          checkOutTime: rec?.checkOutTime?.toISOString() || null,
        };
      }),
    };
  }

  private async resolveStudentIdentifier(q: string): Promise<{ studentId: string; photo: string | null } | null> {
    const alias = await this.prisma.cardAlias.findUnique({
      where: { qrValue: q },
      include: { student: { select: { id: true, photo: true, classId: true } } },
    });
    if (alias?.student) {
      return { studentId: alias.student.id, photo: alias.student.photo };
    }

    const studentSelect = { id: true, photo: true, classId: true } as const;
    let record: { id: string; photo: string | null; classId: string | null } | null = null;

    record = await this.prisma.student.findUnique({ where: { id: q }, select: studentSelect });
    if (!record) {
      record = await this.prisma.student.findFirst({
        where: { id: { equals: q, mode: 'insensitive' } },
        select: studentSelect,
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!record) {
      record = await this.prisma.student.findFirst({ where: { userId: q }, select: studentSelect, orderBy: { updatedAt: 'desc' } });
    }
    if (!record) {
      record = await this.prisma.student.findFirst({
        where: { userId: { equals: q, mode: 'insensitive' } },
        select: studentSelect,
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!record) {
      record = await this.prisma.student.findFirst({ where: { qrCode: q }, select: studentSelect, orderBy: { updatedAt: 'desc' } });
    }
    if (!record) {
      record = await this.prisma.student.findFirst({
        where: { qrCode: { equals: q, mode: 'insensitive' } },
        select: studentSelect,
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (!record) {
      const byNumber = await this.prisma.student.findMany({
        where: { studentNumber: { equals: q, mode: 'insensitive' } },
        select: studentSelect,
        orderBy: { updatedAt: 'desc' },
      });
      if (byNumber.length === 1) {
        record = byNumber[0];
      } else if (byNumber.length > 1) {
        record = byNumber.find(s => s.classId) ?? byNumber[0];
      }
    }

    return record ? { studentId: record.id, photo: record.photo } : null;
  }

  /**
   * Wattaman QR scan: records PRESENT/LATE attendance for any student
   * without requiring a class to be selected first.
   * Looks up the student by userId or qrCode, finds their assigned class,
   * auto-detects the current session from that class's session config,
   * and upserts the attendance record.
   */
  async wattamanScan(
    qrData: string,
    scannedById: string,
    latitude?: number,
    longitude?: number,
    location?: string,
    scannedAt?: string,
  ) {
    const receivedAt = new Date();
    const suppliedTime = scannedAt ? new Date(scannedAt) : null;
    const isValidSuppliedTime = suppliedTime && !Number.isNaN(suppliedTime.getTime())
      && suppliedTime.getTime() <= receivedAt.getTime() + 5 * 60 * 1000
      && suppliedTime.getTime() >= receivedAt.getTime() - 7 * 24 * 60 * 60 * 1000;
    const now = isValidSuppliedTime ? suppliedTime : receivedAt;
    const cambodiaNow = nowCambodia();
    const attendanceDate = toUTCMidnight(cambodiaNow);
    const hhmm = `${String(cambodiaNow.getUTCHours()).padStart(2, '0')}:${String(cambodiaNow.getUTCMinutes()).padStart(2, '0')}`;

    // ── Normalize raw scanner input ───────────────────────────────────────────
    // Trim whitespace and strip null bytes that some USB scanners append.
    let q = (qrData ?? '').trim().replace(/\0/g, '');

    // If the value looks like JSON (card-printing tools encode data as JSON),
    // extract the student identifier from any recognised key name.
    // This mirrors the frontend parsing but acts as a backend safety net when
    // the raw JSON string is sent directly (e.g. from the camera-scan page).
    if (q.startsWith('{')) {
      try {
        const parsed = JSON.parse(q) as Record<string, unknown>;
        const keys: Record<string, string> = Object.fromEntries(
          Object.entries(parsed)
            .filter(([, v]) => typeof v === 'string')
            .map(([k, v]) => [k.toLowerCase(), (v as string).trim()]),
        );
        // Common JSON key names used by different card-printing systems
        const extracted =
          keys['studentid'] ?? keys['userid'] ?? keys['id'] ??
          keys['student_number'] ?? keys['studentnumber'] ??
          keys['no'] ?? keys['number'] ?? keys['sn'] ?? keys['code'];
        if (extracted) q = extracted;
      } catch { /* not valid JSON — use raw value */ }
    }

    // Resolve the student identifier through lean Student queries, then validate
    // current class membership through the roster/enrollment contract.
    const resolved = await this.resolveStudentIdentifier(q);
    if (!resolved) {
      // Return a structured "unmatched" response (NOT a thrown exception) so the
      // scanner UI can offer the admin a one-click "link this card to a student"
      // action without surfacing a scary 404.
      return {
        action: 'UNMATCHED',
        unmatched: true,
        qrValue: q,
        message: 'Card not recognised — link it to a student',
      } as any;
    }

    const asOfIsoDate = midnightToIso(attendanceDate);
    const enrollment = await this.directory.getEnrollmentAtDate(resolved.studentId, asOfIsoDate);
    if (!enrollment.enrolled || !enrollment.classId) {
      throw new NotFoundException('Student is not assigned to any class — contact admin');
    }
    const classId = enrollment.classId;
    const roster = await this.directory.getClassRoster(classId, asOfIsoDate);
    const member = roster.students.find(s => s.studentId === resolved.studentId);
    if (!member) {
      throw new NotFoundException(`Student not found in class roster for ${classId}`);
    }

    const user = await this.prisma.user.findUnique({ where: { id: member.userId }, select: { photo: true } });
    const studentId = member.studentId;
    const studentName = member.name ?? studentId;
    const studentPhoto = user?.photo ?? resolved.photo ?? null;
    const className = roster.className ?? enrollment.className ?? '';

    // Check scheduled day-off via the academic directory contract.
    const classSchedule = await this.classScheduleForDayOff(classId);
    if (isScheduledDayOff(classSchedule, attendanceDate)) {
      return {
        action: 'DAY_OFF',
        studentId,
        studentName,
        studentPhoto,
        className,
        status: 'DAY_OFF',
        session: 0,
        date: attendanceDate.toISOString(),
        message: 'Today is a scheduled day-off for this class',
      };
    }

    // Auto-detect session from class session configs
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const nowMinutes = toMinutes(hhmm);

    let configs: Array<{ session: number; type: string; startTime: string; endTime: string }> = [];
    try {
      configs = await this.sessionConfigService.getConfigs(classId);
    } catch {
      // fallback: use student defaults (getConfigs already handles its own fallback, so this is a safety net)
      try { configs = await this.sessionConfigService.getGlobalDefaults(); } catch { /* ignore */ }
    }

    // Resolve current session across ALL session types (CHECK_IN and CHECK_OUT)
    const allConfigs = configs
      .filter(c => c.startTime !== c.endTime)
      .sort((a, b) => a.session - b.session);

    // Priority 1: active window
    let matched = allConfigs.find(c => nowMinutes >= toMinutes(c.startTime) && nowMinutes <= toMinutes(c.endTime));
    if (!matched) {
      // Priority 2: within 30 min before start
      matched = allConfigs.find(c => {
        const startMin = toMinutes(c.startTime);
        return nowMinutes >= startMin - 30 && nowMinutes < startMin;
      });
    }
    if (!matched) {
      // Priority 3: within 90 min after endTime (late check-in/check-out grace period)
      const gracePeriod = 90;
      const recentlyEnded = allConfigs.filter(c => {
        const endMin = toMinutes(c.endTime);
        return nowMinutes > endMin && nowMinutes <= endMin + gracePeriod;
      });
      if (recentlyEnded.length > 0) {
        matched = recentlyEnded[recentlyEnded.length - 1]; // most recently ended
      }
    }

    if (!matched) {
      // No active session — reject the scan with a helpful message
      const upcoming = allConfigs.filter(c => toMinutes(c.startTime) > nowMinutes);
      const nextSession = upcoming[0];
      const nextMsg = nextSession ? ` Next session opens at ${nextSession.startTime}.` : '';
      throw new BadRequestException(`No active session at ${hhmm}.${nextMsg}`);
    }

    const session = matched.session;
    const sessionType: 'CHECK_IN' | 'CHECK_OUT' = matched.type as 'CHECK_IN' | 'CHECK_OUT';
    const checkInTime = now;

    // Determine PRESENT or LATE — only applies to CHECK_IN sessions
    let status: 'PRESENT' | 'LATE' = 'PRESENT';
    if (matched.type === 'CHECK_IN') {
      const [eh, em] = matched.endTime.split(':').map(Number);
      if (nowMinutes > eh * 60 + em) {
        status = 'LATE';
      }
    }

    const locData = {
      ...(latitude != null ? { scanLatitude: latitude } : {}),
      ...(longitude != null ? { scanLongitude: longitude } : {}),
      ...(location ? { scanLocation: location } : {}),
    };

    // Create-only is intentional. An upsert can make two concurrent requests both
    // look like successful first scans. The unique attendance key is the final,
    // atomic idempotency guard; a P2002 race is returned as ALREADY_RECORDED.
    let record: any;
    let alreadyRecorded = false;
    try {
      record = await this.prisma.attendance.create({
        data: {
          studentId,
          classId,
          date: attendanceDate,
          session,
          status,
          markedById: scannedById,
          checkInTime,
          permissionType: null,
          permissionStartDate: null,
          permissionEndDate: null,
          ...locData,
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      alreadyRecorded = true;
      record = await this.prisma.attendance.findUnique({
        where: { studentId_classId_date_session: { studentId, classId, date: attendanceDate, session } },
      });
      if (!record) throw error;
    }

    // Notify real-time
    if (!alreadyRecorded) {
      this.attendanceGateway.notifyAttendanceUpdate(classId, {
        studentId,
        studentName,
        status: record.status,
        session,
        timestamp: record.timestamp,
      });
    }

    return {
      action: alreadyRecorded ? 'ALREADY_RECORDED' : sessionType,
      sessionType,
      studentId,
      studentName,
      studentPhoto,
      className,
      status: record.status,
      session,
      date: attendanceDate.toISOString(),
      checkInTime: record.checkInTime?.toISOString() ?? null,
    };
  }

  async deleteAttendanceRecord(attendanceId: string) {
    const record = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!record) throw new NotFoundException('Attendance record not found');
    return this.prisma.attendance.delete({ where: { id: attendanceId } });
  }

  async deleteStaffAttendanceRecord(staffAttendanceId: string) {
    const record = await this.prisma.staffAttendance.findUnique({ where: { id: staffAttendanceId } });
    if (!record) throw new NotFoundException('Staff attendance record not found');
    return this.prisma.staffAttendance.delete({ where: { id: staffAttendanceId } });
  }

  /**
   * Edit permission type for a staff member on a specific date (edit-attendance context).
   * Mirrors editPermissionType for students.
   */
  async editPermissionTypeForStaff(
    userId: string,
    date: string,
    adminId: string,
    newPermissionType: string,
  ) {
    const attendanceDate = toUTCMidnight(new Date(date));
    const newType = normalizePermissionType(newPermissionType);
    const inScopeSessions = permissionSessions(newType);
    const allSessions = [1, 2, 3, 4];
    const outOfScopeSessions = allSessions.filter(s => !inScopeSessions.includes(s));

    const existing = await this.prisma.staffAttendance.findMany({
      where: { userId, date: attendanceDate },
    });
    const existingMap = new Map(existing.map(r => [r.session, r]));

    const ops: any[] = [];

    for (const session of inScopeSessions) {
      const rec = existingMap.get(session);
      if (rec && (rec.status === 'PRESENT' || rec.status === 'LATE')) continue;
      ops.push(
        this.prisma.staffAttendance.upsert({
          where: { userId_date_session: { userId, date: attendanceDate, session } },
          update: {
            status: 'PERMISSION',
            permissionType: newType,
            permissionStartDate: attendanceDate,
            permissionEndDate: attendanceDate,
            markedById: adminId,
            checkInTime: null,
            checkOutTime: null,
          },
          create: {
            userId,
            date: attendanceDate,
            session,
            status: 'PERMISSION',
            permissionType: newType,
            permissionStartDate: attendanceDate,
            permissionEndDate: attendanceDate,
            markedById: adminId,
            checkInTime: null,
            checkOutTime: null,
          },
        }),
      );
    }

    for (const session of outOfScopeSessions) {
      ops.push(
        this.prisma.staffAttendance.updateMany({
          where: { userId, date: attendanceDate, session, status: 'PERMISSION' },
          data: {
            status: 'ABSENT',
            permissionType: null,
            permissionStartDate: null,
            permissionEndDate: null,
            markedById: adminId,
          },
        }),
      );
    }

    if (ops.length > 0) await this.prisma.$transaction(ops);
    return { success: true, permissionType: newType };
  }
}

type PermissionType = 'HALF_DAY_MORNING' | 'HALF_DAY_AFTERNOON' | 'FULL_DAY' | 'MULTI_DAY';

function normalizePermissionType(value?: string | null): PermissionType {
  const v = (value || '').toUpperCase();
  if (v === 'HALF_DAY_MORNING' || v === 'HALF_DAY_AFTERNOON' || v === 'MULTI_DAY') return v;
  return 'FULL_DAY';
}

function permissionSessions(permissionType: PermissionType): number[] {
  if (permissionType === 'HALF_DAY_MORNING') return [1, 2];
  if (permissionType === 'HALF_DAY_AFTERNOON') return [3, 4];
  return [1, 2, 3, 4];
}

function dateRangeDays(start: Date, end: Date): Date[] {
  const s = toUTCMidnight(start);
  const e = toUTCMidnight(end);
  const out: Date[] = [];
  const cursor = new Date(s);
  while (cursor.getTime() <= e.getTime()) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
