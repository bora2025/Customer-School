import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SessionConfigService } from '../session-config/session-config.service';
import { HolidaysService } from '../holidays/holidays.service';
import * as ExcelJS from 'exceljs';

function toUTCMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Format a UTC Date as Cambodia time (GMT+7) string */
function toCambodiaTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '')
    .slice(0, 19);
}

/** Format a UTC Date as Cambodia time HH:mm only */
function toCambodiaTimeShort(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(11, 16);
}

const SESSION_LABELS: Record<number, string> = {
  1: 'Morning 1',
  2: 'Morning 2',
  3: 'Afternoon 1',
  4: 'Afternoon 2',
};

// Day-of-week keys aligned with Date.getUTCDay() (0=Sun .. 6=Sat) — matches the
// frontend Class.schedule JSON ({ MON: 'same', SAT: 'day-off', ... }).
const SCHEDULE_DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Parse the JSON weekly schedule stored on Class.schedule. Returns null when
 *  the field is missing or contains legacy free-text (e.g. "Mon 9:00-10:00"). */
function parseWeeklySchedule(schedule: string | null | undefined): Record<string, string> | null {
  if (!schedule) return null;
  try {
    const parsed = JSON.parse(schedule);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Legacy free-text schedule — caller should fall back to defaults.
  }
  return null;
}

/** Whether the given UTC-midnight date is a 'day-off' per the class weekly schedule. */
function isScheduleDayOff(weeklySchedule: Record<string, string> | null, date: Date): boolean {
  if (!weeklySchedule) return false;
  const key = SCHEDULE_DAY_KEYS[date.getUTCDay()];
  return (weeklySchedule[key] || 'same') === 'day-off';
}

/** Check if a session's end time has passed for a given date (Cambodia time) */
function isSessionOvertime(
  sessionNum: number,
  configs: any[],
  date: Date,
  todayCambodia: Date,
  cambodiaNowHHMM: string,
): boolean {
  const dayStart = toUTCMidnight(date);
  if (dayStart.getTime() < todayCambodia.getTime()) return true;   // past date
  if (dayStart.getTime() > todayCambodia.getTime()) return false;  // future date
  // Today: compare current Cambodia time with session endTime
  const cfg = configs.find((c: any) => c.session === sessionNum);
  if (!cfg) return false;
  return cambodiaNowHHMM > cfg.endTime;
}

/** Check if a status represents permission/day-off (both "PERMISSION" and "DAY_OFF" are used) */
function isDayOffStatus(status: string | null | undefined): boolean {
  return status === 'DAY_OFF' || status === 'PERMISSION';
}

function buildPermissionTypeBreakdown(records: Array<{ status: string; permissionType: string | null }>) {
  const base = {
    halfDayMorning: 0,
    halfDayAfternoon: 0,
    fullDay: 0,
    multiDay: 0,
    unknown: 0,
  };

  for (const r of records) {
    if (!isDayOffStatus(r.status)) continue;
    if (r.permissionType === 'HALF_DAY_MORNING') base.halfDayMorning += 1;
    else if (r.permissionType === 'HALF_DAY_AFTERNOON') base.halfDayAfternoon += 1;
    else if (r.permissionType === 'FULL_DAY') base.fullDay += 1;
    else if (r.permissionType === 'MULTI_DAY') base.multiDay += 1;
    else base.unknown += 1;
  }

  return base;
}

function permissionDayEquivalentForGroup(records: Array<{ status: string; permissionType: string | null }>): number {
  const perms = records.filter(r => isDayOffStatus(r.status));
  if (perms.length === 0) return 0;

  // DAY_OFF and FULL_DAY/MULTI_DAY represent a full-day permission.
  if (perms.some(r => r.status === 'DAY_OFF')) return 1;
  if (perms.some(r => r.permissionType === 'FULL_DAY' || r.permissionType === 'MULTI_DAY')) return 1;

  const hasMorningHalf = perms.some(r => r.permissionType === 'HALF_DAY_MORNING');
  const hasAfternoonHalf = perms.some(r => r.permissionType === 'HALF_DAY_AFTERNOON');
  if (hasMorningHalf && hasAfternoonHalf) return 1;
  if (hasMorningHalf || hasAfternoonHalf) return 0.5;

  // Legacy PERMISSION rows without permissionType: treat as full day to avoid undercount.
  return 1;
}

function countPermissionDayEquivalents<T extends { status: string; permissionType: string | null; date: Date }>(
  records: T[],
  entityKey: (r: T) => string,
): number {
  const groups = new Map<string, T[]>();
  for (const rec of records) {
    if (!isDayOffStatus(rec.status)) continue;
    const key = `${entityKey(rec)}|${rec.date.toISOString().split('T')[0]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rec);
  }

  let total = 0;
  for (const groupRecords of groups.values()) {
    total += permissionDayEquivalentForGroup(groupRecords);
  }
  return total;
}

function blockContribution(
  statuses: string[],
  preferPermissionOverAbsent: boolean,
): { present: number; late: number; absent: number; permission: number } {
  const hasPresent = statuses.some(s => s === 'PRESENT');
  const hasLate = statuses.some(s => s === 'LATE');
  const hasPermission = statuses.some(s => isDayOffStatus(s));
  const hasAbsent = statuses.some(s => s === 'ABSENT');

  // Precedence for mixed states in the same half-day block:
  // PRESENT > LATE > (PERMISSION > ABSENT) if Case A/B enabled
  // PRESENT > LATE > (ABSENT > PERMISSION) if disabled
  if (hasPresent) return { present: 0.5, late: 0, absent: 0, permission: 0 };
  if (hasLate) return { present: 0, late: 0.5, absent: 0, permission: 0 };
  if (preferPermissionOverAbsent) {
    if (hasPermission) return { present: 0, late: 0, absent: 0, permission: 0.5 };
    if (hasAbsent) return { present: 0, late: 0, absent: 0.5, permission: 0 };
  } else {
    if (hasAbsent) return { present: 0, late: 0, absent: 0.5, permission: 0 };
    if (hasPermission) return { present: 0, late: 0, absent: 0, permission: 0.5 };
  }
  return { present: 0, late: 0, absent: 0, permission: 0 };
}

function countHalfDayBlocks<T extends { status: string; date: Date; session: number }>(
  records: T[],
  entityKey: (r: T) => string,
  preferPermissionOverAbsent: boolean,
): { present: number; late: number; absent: number; permission: number } {
  const grouped = new Map<string, T[]>();
  for (const rec of records) {
    const key = `${entityKey(rec)}|${rec.date.toISOString().split('T')[0]}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rec);
  }

  const total = { present: 0, late: 0, absent: 0, permission: 0 };
  for (const dayRecords of grouped.values()) {
    const morningStatuses = dayRecords.filter(r => r.session === 1 || r.session === 2).map(r => r.status);
    const afternoonStatuses = dayRecords.filter(r => r.session === 3 || r.session === 4).map(r => r.status);

    const morning = blockContribution(morningStatuses, preferPermissionOverAbsent);
    total.present += morning.present;
    total.late += morning.late;
    total.absent += morning.absent;
    total.permission += morning.permission;

    const afternoon = blockContribution(afternoonStatuses, preferPermissionOverAbsent);
    total.present += afternoon.present;
    total.late += afternoon.late;
    total.absent += afternoon.absent;
    total.permission += afternoon.permission;
  }

  return total;
}

/**
 * Count attendance totals for the print report.
 * - Missing half-day blocks (when the other half has records) are filled as ABSENT.
 * - If a day has both PERMISSION sessions and non-PERMISSION sessions (genuine half-day
 *   split), score each block at 0.5 independently.
 * - Otherwise (uniform day): combine AM+PM into 1 whole day with precedence
 *   PRESENT > ABSENT > LATE > PERMISSION (ABSENT absorbs LATE per school policy:
 *   missing morning + late afternoon = 1 absent).
 */
function countPrintReportTotals<T extends { status: string; date: Date; session: number }>(
  records: T[],
  entityKey: (r: T) => string,
  preferPermissionOverAbsent: boolean,
): { present: number; late: number; absent: number; permission: number } {
  const grouped = new Map<string, T[]>();
  for (const rec of records) {
    const key = `${entityKey(rec)}|${rec.date.toISOString().split('T')[0]}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rec);
  }

  const total = { present: 0, late: 0, absent: 0, permission: 0 };
  for (const dayRecords of grouped.values()) {
    const amRecs = dayRecords.filter(r => r.session === 1 || r.session === 2);
    const pmRecs = dayRecords.filter(r => r.session === 3 || r.session === 4);

    // Fill missing blocks as ABSENT when the student has other records that day
    const amStatuses = amRecs.length > 0 ? amRecs.map(r => r.status) : ['ABSENT'];
    const pmStatuses = pmRecs.length > 0 ? pmRecs.map(r => r.status) : ['ABSENT'];

    const hasPermission = [...amStatuses, ...pmStatuses].some(s => isDayOffStatus(s));
    const hasNonPermission = [...amStatuses, ...pmStatuses].some(s => !isDayOffStatus(s));

    if (hasPermission && hasNonPermission) {
      // Genuine half-day split: score each block at 0.5 independently
      const am = blockContribution(amStatuses, preferPermissionOverAbsent);
      const pm = blockContribution(pmStatuses, preferPermissionOverAbsent);
      total.present += am.present + pm.present;
      total.late += am.late + pm.late;
      total.absent += am.absent + pm.absent;
      total.permission += am.permission + pm.permission;
    } else {
      // Uniform day: combine both blocks into 1 whole-day result.
      // Precedence: PRESENT > ABSENT > LATE > PERMISSION
      // (ABSENT absorbs LATE: missing morning + late afternoon = 1 absent)
      const am = blockContribution(amStatuses, preferPermissionOverAbsent);
      const pm = blockContribution(pmStatuses, preferPermissionOverAbsent);
      const hasPresent = am.present > 0 || pm.present > 0;
      const hasAbsent = am.absent > 0 || pm.absent > 0;
      const hasLate = am.late > 0 || pm.late > 0;
      const hasPerm = am.permission > 0 || pm.permission > 0;

      if (hasPresent) total.present += 1;
      else if (hasAbsent) total.absent += 1;
      else if (hasLate) total.late += 1;
      else if (hasPerm) total.permission += 1;
    }
  }
  return total;
}

/**
 * Count whole-day attendance totals per person over a date range.
 * Groups by person+date, determines dominant status per day (same block precedence),
 * and sums 1 whole day per status. Works correctly for daily, weekly, monthly, yearly.
 */
function countWholeDayRangeTotals<T extends { status: string; date: Date; session: number }>(
  records: T[],
  entityKey: (r: T) => string,
  preferPermissionOverAbsent: boolean,
): { present: number; late: number; absent: number; permission: number } {
  const grouped = new Map<string, T[]>();
  for (const rec of records) {
    const key = `${entityKey(rec)}|${rec.date.toISOString().split('T')[0]}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rec);
  }

  const total = { present: 0, late: 0, absent: 0, permission: 0 };
  for (const dayRecords of grouped.values()) {
    const am = blockContribution(
      dayRecords.filter(r => r.session === 1 || r.session === 2).map(r => r.status),
      preferPermissionOverAbsent,
    );
    const pm = blockContribution(
      dayRecords.filter(r => r.session === 3 || r.session === 4).map(r => r.status),
      preferPermissionOverAbsent,
    );
    const hasPresent = am.present > 0 || pm.present > 0;
    const hasLate = am.late > 0 || pm.late > 0;
    const hasPerm = am.permission > 0 || pm.permission > 0;
    const hasAbsent = am.absent > 0 || pm.absent > 0;

    if (hasPresent) total.present += 1;
    else if (hasLate) total.late += 1;
    else if (hasPerm) total.permission += 1;
    else if (hasAbsent) total.absent += 1;
  }
  return total;
}

/**
 * Count unique entities by their dominant attendance status for the day (headcount).
 * Returns whole numbers (1 per person) — intended for the daily dashboard summary.
 * AM block + PM block are evaluated with blockContribution, then priority wins:
 * PRESENT > LATE > PERMISSION > ABSENT
 *
 * "Mostly Absent" override: if absentThreshold > 0 and a person has >= absentThreshold
 * raw ABSENT-status records in the day, they are counted as ABSENT regardless of any
 * PRESENT/LATE/PERMISSION sessions (e.g. absent 3 of 4 sessions → day = Absent).
 */
function countDailyHeadcount<T extends { status: string; date: Date; session: number }>(
  records: T[],
  entityKey: (r: T) => string,
  preferPermissionOverAbsent: boolean,
  absentThreshold: number = 0,
): { present: number; late: number; absent: number; permission: number } {
  const grouped = new Map<string, T[]>();
  for (const rec of records) {
    const key = entityKey(rec);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rec);
  }

  const total = { present: 0, late: 0, absent: 0, permission: 0 };
  for (const personRecords of grouped.values()) {
    // "Mostly Absent" override — applied before the priority cascade
    if (absentThreshold > 0) {
      const rawAbsent = personRecords.filter(r => r.status === 'ABSENT').length;
      if (rawAbsent >= absentThreshold) {
        total.absent += 1;
        continue;
      }
    }

    const am = blockContribution(
      personRecords.filter(r => r.session === 1 || r.session === 2).map(r => r.status),
      preferPermissionOverAbsent,
    );
    const pm = blockContribution(
      personRecords.filter(r => r.session === 3 || r.session === 4).map(r => r.status),
      preferPermissionOverAbsent,
    );
    const hasPresent = am.present > 0 || pm.present > 0;
    const hasLate = am.late > 0 || pm.late > 0;
    const hasPerm = am.permission > 0 || pm.permission > 0;
    const hasAbsent = am.absent > 0 || pm.absent > 0;

    if (hasPresent) total.present += 1;
    else if (hasLate) total.late += 1;
    else if (hasPerm) total.permission += 1;
    else if (hasAbsent) total.absent += 1;
  }
  return total;
}

function countPermissionPresence<T extends { status: string; date: Date }>(
  records: T[],
  entityKey: (r: T) => string,
): number {
  const groups = new Map<string, boolean>();
  for (const rec of records) {
    const key = `${entityKey(rec)}|${rec.date.toISOString().split('T')[0]}`;
    const hasPermission = isDayOffStatus(rec.status);
    groups.set(key, (groups.get(key) || false) || hasPermission);
  }

  let total = 0;
  for (const hasPerm of groups.values()) {
    if (hasPerm) total += 1;
  }
  return total;
}

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private sessionConfigService: SessionConfigService,
    private holidaysService: HolidaysService,
  ) {}

  /** Apply attendance format rules: convert accumulated lates/permissions into absences */
  private applyFormatRules(
    counts: { present: number; late: number; absent: number; dayOff: number },
    rule: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean } | null,
  ) {
    if (!rule || !rule.enabled) {
      return { ...counts, convertedAbsentFromPermission: 0, convertedAbsentHalfFromLate: 0 };
    }
    const convertedAbsentFromPermission = rule.permissionsPerAbsent > 0
      ? Math.floor(counts.dayOff / rule.permissionsPerAbsent)
      : 0;
    const convertedAbsentHalfFromLate = rule.latesPerAbsentHalf > 0
      ? Math.floor(counts.late / rule.latesPerAbsentHalf)
      : 0;
    // School policy: every N permissions = 1 full absent, every M lates = 1 half absent.
    // The converted absences are ADDED to the displayed absent total so admins see the
    // real penalty count. Original permission/late counts stay visible so it's clear
    // WHERE the extra absents came from. Metadata fields below remain for any UI that
    // wants to break the contribution down.
    return {
      ...counts,
      absent: counts.absent + convertedAbsentFromPermission + convertedAbsentHalfFromLate * 0.5,
      convertedAbsentFromPermission,
      convertedAbsentHalfFromLate,
    };
  }

  async getSystemStatus() {
    const [lastAttendance, lastStaffAttendance, lastUser] = await Promise.all([
      this.prisma.attendance.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      this.prisma.staffAttendance.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
      this.prisma.user.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    const totalStudents = await this.prisma.student.count();
    const totalClasses = await this.prisma.class.count();
    const totalUsers = await this.prisma.user.count();

    const dates = [lastAttendance?.timestamp, lastStaffAttendance?.timestamp, lastUser?.updatedAt].filter(Boolean) as Date[];
    const lastUpdated = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;

    return {
      lastUpdated: lastUpdated?.toISOString() || null,
      totalStudents,
      totalClasses,
      totalUsers,
    };
  }

  /**
   * Find students that share the same name inside the same class — strong
   * indicator of duplicate CSV imports. Returns groups with ≥ 2 members.
   */
  async getDuplicateStudents() {
    const students = await this.prisma.student.findMany({
      where: { classId: { not: null } },
      select: {
        id: true,
        studentNumber: true,
        classId: true,
        updatedAt: true,
        user: { select: { name: true, phone: true } },
        class: { select: { name: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });

    // Group by classId + normalised name
    const groups = new Map<string, typeof students>();
    for (const s of students) {
      const key = `${s.classId}||${(s.user.name ?? '').trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    const duplicates: Array<{
      className: string;
      name: string;
      students: Array<{ id: string; studentNumber: string | null; updatedAt: Date }>;
    }> = [];

    for (const members of groups.values()) {
      if (members.length < 2) continue;
      duplicates.push({
        className: members[0].class?.name ?? '',
        name: members[0].user.name ?? '',
        students: members.map(s => ({
          id: s.id,
          studentNumber: s.studentNumber,
          updatedAt: s.updatedAt,
        })),
      });
    }

    return { count: duplicates.length, groups: duplicates };
  }

  async getAttendanceSummary(classId?: string, date?: Date) {
    const where: any = {};
    if (classId) where.classId = classId;
    if (date) {
      const dayStart = toUTCMidnight(date);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      where.date = { gte: dayStart, lt: dayEnd };
    }

    const attendances = await this.prisma.attendance.findMany({
      where,
      include: { student: true },
    });

    const total = attendances.length;
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const permission = countPermissionDayEquivalents(attendances as any, (a: any) => a.studentId);

    return {
      total,
      present,
      absent,
      late,
      permission,
      attendanceRate: total > 0 ? (present / total) * 100 : 0,
    };
  }

  async getDashboardSummary(date?: Date, requesterUserId?: string) {
    const targetDate = date || new Date();
    const dayStart = toUTCMidnight(targetDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const organizationId = requesterUserId
      ? await this.sessionConfigService.getUserOrganizationId(requesterUserId)
      : null;

    // Parallelize independent queries
    const staffRoleFilter = { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } };
    const [studentAttendances, staffAttendances, allStudents, allStaffUsers] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { date: { gte: dayStart, lt: dayEnd } },
        include: {
          student: { include: { user: { select: { name: true } }, class: { select: { name: true } } } },
          class: { select: { name: true } },
        },
      }),
      this.prisma.staffAttendance.findMany({
        where: { date: { gte: dayStart, lt: dayEnd } },
        include: {
          user: { select: { id: true, name: true, role: true, department: { select: { name: true } } } },
        },
      }),
      this.prisma.student.findMany({
        select: {
          id: true,
          studentNumber: true,
          address: true,
          user: { select: { name: true } },
          class: { select: { name: true } },
        },
      }),
      this.prisma.user.findMany({
        where: staffRoleFilter,
        select: { id: true, name: true, role: true, department: { select: { name: true } } },
      }),
    ]);
    const totalStudents = allStudents.length;
    const totalStaff = allStaffUsers.length;

    // Student summary — headcount: each student counted once by dominant status for the day
    const classRule = await this.sessionConfigService.getFormatRules('CLASS', organizationId);
    const classAbsentThreshold = (classRule as any).enabled ? ((classRule as any).absentSessionsForDayAbsent ?? 0) : 0;
    const studentTotals = countDailyHeadcount(
      studentAttendances as any,
      (a: any) => a.studentId,
      classRule.caseStudyABEnabled ?? true,
      classAbsentThreshold,
    );
    const studentPresent = studentTotals.present;
    const studentLate = studentTotals.late;
    const studentPermission = studentTotals.permission;
    // Students with no record today are treated as absent (unrecorded = not present)
    const studentsWithRecords = new Set(studentAttendances.map(a => a.studentId));
    const studentsNoRecord = allStudents.filter(s => !studentsWithRecords.has(s.id));
    const studentAbsent = studentTotals.absent + studentsNoRecord.length;

    // Staff summary — headcount from actual records
    const staffRule = await this.sessionConfigService.getFormatRules('STAFF', organizationId);
    const staffAbsentThreshold = (staffRule as any).enabled ? ((staffRule as any).absentSessionsForDayAbsent ?? 0) : 0;
    const staffTotals = countDailyHeadcount(
      staffAttendances as any,
      (a: any) => a.userId,
      staffRule.caseStudyABEnabled ?? true,
      staffAbsentThreshold,
    );
    const staffPresent = staffTotals.present;
    const staffRecordedAbsent = staffTotals.absent;
    const staffLate = staffTotals.late;
    const staffPermission = staffTotals.permission;
    // Staff with no attendance record = absent (not recorded)
    const staffWithRecords = new Set(staffAttendances.map(a => a.userId));
    const staffNoRecord = allStaffUsers.filter(u => !staffWithRecords.has(u.id));
    const totalStaffAbsent = staffRecordedAbsent + staffNoRecord.length;

    // Build detail rows: unique students
    const studentMap = new Map<string, { id: string; name: string; role: string; className: string; address: string; present: number; absent: number; late: number; permission: number }>();
    for (const a of studentAttendances) {
      const key = a.studentId;
      if (!studentMap.has(key)) {
        studentMap.set(key, {
          id: a.student.studentNumber || a.studentId,
          name: a.student.user.name,
          role: 'Student',
          className: a.student.class?.name || a.class.name,
          address: (a.student as any).address || '',
          present: 0, absent: 0, late: 0, permission: 0,
        });
      }
      const row = studentMap.get(key)!;
      row.present = row.present;
      row.absent = row.absent;
      row.late = row.late;
    }

    // Build detail rows: unique staff (from attendance records)
    const staffMap = new Map<string, { id: string; name: string; role: string; department: string; present: number; absent: number; late: number; permission: number }>();
    for (const a of staffAttendances) {
      const key = a.userId;
      if (!staffMap.has(key)) {
        staffMap.set(key, {
          id: a.userId,
          name: a.user.name,
          role: a.user.role,
          department: a.user.department?.name || '',
          present: 0, absent: 0, late: 0, permission: 0,
        });
      }
      const row = staffMap.get(key)!;
      row.present = row.present;
      row.absent = row.absent;
      row.late = row.late;
    }

    // Add staff with NO attendance record (they are absent)
    for (const u of staffNoRecord) {
      staffMap.set(u.id, {
        id: u.id,
        name: u.name,
        role: u.role,
        department: u.department?.name || '',
        present: 0, absent: 1, late: 0, permission: 0,
      });
    }

    // Add students with NO attendance record (they are absent)
    for (const s of studentsNoRecord) {
      studentMap.set(s.id, {
        id: s.studentNumber || s.id,
        name: s.user.name,
        role: 'Student',
        className: s.class?.name || '',
        address: (s as any).address || '',
        present: 0, absent: 1, late: 0, permission: 0,
      });
    }

    // Headcount per individual for detail rows — single pass, not O(N²).
    // Group all student attendances by studentId first, then count once per student.
    const studentAttByPerson = new Map<string, any[]>();
    for (const a of studentAttendances) {
      if (!studentAttByPerson.has((a as any).studentId)) studentAttByPerson.set((a as any).studentId, []);
      studentAttByPerson.get((a as any).studentId)!.push(a);
    }
    for (const [studentId, row] of studentMap.entries()) {
      const recs = studentAttByPerson.get(studentId) || [];
      if (recs.length === 0) continue; // already marked absent:1 above — do not overwrite
      const totals = countDailyHeadcount(recs as any, (a: any) => a.studentId, classRule.caseStudyABEnabled ?? true, classAbsentThreshold);
      row.present = totals.present;
      row.absent = totals.absent;
      row.late = totals.late;
      row.permission = totals.permission;
    }

    const staffAttByPerson = new Map<string, any[]>();
    for (const a of staffAttendances) {
      if (!staffAttByPerson.has((a as any).userId)) staffAttByPerson.set((a as any).userId, []);
      staffAttByPerson.get((a as any).userId)!.push(a);
    }
    for (const [userId, row] of staffMap.entries()) {
      const recs = staffAttByPerson.get(userId) || [];
      if (recs.length === 0) continue; // already marked absent:1 above — do not overwrite
      const totals = countDailyHeadcount(recs as any, (a: any) => a.userId, staffRule.caseStudyABEnabled ?? true, staffAbsentThreshold);
      row.present = totals.present;
      row.absent = totals.absent;
      row.late = totals.late;
      row.permission = totals.permission;
    }

    // Get classes and departments for filter options
    const [classes, departments] = await Promise.all([
      this.prisma.class.findMany({ select: { id: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);

    return {
      students: {
        total: totalStudents,
        present: studentPresent,
        absent: studentAbsent,
        late: studentLate,
        permission: studentPermission,
        permissionBreakdown: buildPermissionTypeBreakdown(studentAttendances as any),
      },
      staff: {
        total: totalStaff,
        present: staffPresent,
        absent: totalStaffAbsent,
        late: staffLate,
        permission: staffPermission,
        permissionBreakdown: buildPermissionTypeBreakdown(staffAttendances as any),
      },
      details: [
        ...Array.from(studentMap.values()).map(s => ({ ...s, group: s.className })),
        ...Array.from(staffMap.values()).map(s => ({ ...s, group: s.department })),
      ],
      filters: { classes, departments },
    };
  }

  /**
   * Per-class attendance progress for a given date.
   * Returns one row per class with total students and headcount by status.
   * Used by the admin dashboard to show real-time progress bars per class.
   */
  async getClassAttendanceProgress(date?: Date, requesterUserId?: string) {
    const targetDate = date || new Date();
    const dayStart = toUTCMidnight(targetDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const organizationId = requesterUserId
      ? await this.sessionConfigService.getUserOrganizationId(requesterUserId)
      : null;

    const classRule = await this.sessionConfigService.getFormatRules('CLASS', organizationId);
    const classAbsentThreshold = (classRule as any).enabled
      ? ((classRule as any).absentSessionsForDayAbsent ?? 0)
      : 0;

    // All classes (we want even classes with zero records to appear)
    const classes = await this.prisma.class.findMany({
      select: {
        id: true,
        name: true,
        students: { select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });

    // All attendance records for the day, grouped by class
    const attendances = await this.prisma.attendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      select: {
        classId: true,
        studentId: true,
        status: true,
        date: true,
        session: true,
      },
    });
    const byClass = new Map<string, typeof attendances>();
    for (const a of attendances) {
      if (!byClass.has(a.classId)) byClass.set(a.classId, []);
      byClass.get(a.classId)!.push(a);
    }

    const rows = classes.map(c => {
      const total = c.students.length;
      const recs = byClass.get(c.id) || [];
      const totals = countDailyHeadcount(
        recs as any,
        (a: any) => a.studentId,
        classRule.caseStudyABEnabled ?? true,
        classAbsentThreshold,
      );
      // Students with no record at all → treat as absent
      const withRecord = new Set(recs.map(r => r.studentId));
      const noRecordAbsent = c.students.filter(s => !withRecord.has(s.id)).length;
      const present = totals.present;
      const late = totals.late;
      const permission = totals.permission;
      const absent = totals.absent + noRecordAbsent;
      const scanned = present + late; // students physically scanned in
      const pctPresent = total > 0 ? Math.round((present / total) * 100) : 0;
      const pctScanned = total > 0 ? Math.round((scanned / total) * 100) : 0;
      return {
        classId: c.id,
        className: c.name,
        total,
        present,
        late,
        absent,
        permission,
        scanned,
        pctPresent,
        pctScanned,
      };
    });

    return { date: dayStart.toISOString().split('T')[0], rows };
  }

  async getMonthlyTrend(year: number, month: number) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0)); // last day of month
    const endPlusOne = new Date(Date.UTC(year, month, 1));
    const daysInMonth = end.getUTCDate();

    const studentAttendances = await this.prisma.attendance.findMany({
      where: { date: { gte: start, lt: endPlusOne } },
      select: { date: true, status: true, studentId: true },
    });

    const staffAttendances = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: start, lt: endPlusOne } },
      select: { date: true, status: true, userId: true },
    });

    const result: { day: number; studentPresent: number; studentAbsent: number; staffPresent: number; staffAbsent: number }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStart = new Date(Date.UTC(year, month - 1, d));
      const dayEnd = new Date(Date.UTC(year, month - 1, d + 1));

      const stuDay = studentAttendances.filter(a => a.date >= dayStart && a.date < dayEnd);
      const stfDay = staffAttendances.filter(a => a.date >= dayStart && a.date < dayEnd);

      result.push({
        day: d,
        studentPresent: new Set(stuDay.filter(a => a.status === 'PRESENT' || a.status === 'LATE').map(a => a.studentId)).size,
        studentAbsent: new Set(stuDay.filter(a => a.status === 'ABSENT').map(a => a.studentId)).size,
        staffPresent: new Set(stfDay.filter(a => a.status === 'PRESENT' || a.status === 'LATE').map(a => a.userId)).size,
        staffAbsent: new Set(stfDay.filter(a => a.status === 'ABSENT').map(a => a.userId)).size,
      });
    }

    return { year, month, data: result };
  }

  async getStudentAttendance(studentId?: string, userId?: string) {
    let resolvedStudentId = studentId;
    if (!resolvedStudentId && userId) {
      const student = await this.prisma.student.findFirst({ where: { userId }, select: { id: true } });
      if (!student) return [];
      resolvedStudentId = student.id;
    }
    if (!resolvedStudentId) return [];

    const attendances = await this.prisma.attendance.findMany({
      where: { studentId: resolvedStudentId },
      orderBy: { date: 'desc' },
      include: { class: { select: { name: true, subject: true } } },
    });

    return attendances.map(a => ({
      id: a.id,
      date: a.date,
      status: a.status,
      permissionType: a.permissionType,
      permissionStartDate: a.permissionStartDate,
      permissionEndDate: a.permissionEndDate,
      classId: a.classId,
      className: a.class?.name ?? '',
      class: a.class ? { name: a.class.name, subject: a.class.subject } : { name: '', subject: '' },
      session: a.session,
      sessionLabel: SESSION_LABELS[a.session] || `Session ${a.session}`,
      checkInTime: toCambodiaTime(a.checkInTime),
      checkOutTime: toCambodiaTime(a.checkOutTime),
    }));
  }

  async getAuditLogs() {
    return this.prisma.attendance.findMany({
      include: { student: { include: { user: true } }, markedBy: true, class: true },
      orderBy: { timestamp: 'desc' },
    });
  }

  async getClassSummaries(teacherId: string, date?: Date, session?: number) {
    const classes = await this.prisma.class.findMany({
      where: { teacherId },
      include: { students: { include: { user: { select: { name: true } } } } },
    });

    const targetDate = date || new Date();
    const dayStart = toUTCMidnight(targetDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const results = [];
    for (const cls of classes) {
      const attWhere: any = {
        classId: cls.id,
        date: { gte: dayStart, lt: dayEnd },
      };
      if (session) attWhere.session = session;

      const attendances = await this.prisma.attendance.findMany({
        where: attWhere,
        include: { student: { include: { user: { select: { name: true } } } } },
      });

      const totalStudents = cls.students.length;
      const rule = await this.sessionConfigService.getFormatRules('CLASS', null);
      const threshold = (rule as any).enabled ? ((rule as any).absentSessionsForDayAbsent ?? 0) : 0;
      const headcount = countDailyHeadcount(
        attendances as any,
        (a: any) => a.studentId,
        rule.caseStudyABEnabled ?? true,
        threshold,
      );
      const present = headcount.present;
      const absent = headcount.absent;
      const late = headcount.late;
      const permission = headcount.permission;

      results.push({
        classId: cls.id,
        className: cls.name,
        subject: cls.subject,
        totalStudents,
        present,
        absent,
        late,
        permission,
        attendanceRate: totalStudents > 0 ? (present / totalStudents) * 100 : 0,
        students: cls.students.map(s => {
          const records = attendances.filter(a => a.studentId === s.id);
          const latestRecord = records.length > 0 ? records[records.length - 1] : null;
          return {
            id: s.id,
            name: s.user.name,
            status: latestRecord?.status || 'NOT_RECORDED',
            session: latestRecord?.session,
            sessionLabel: latestRecord ? (SESSION_LABELS[latestRecord.session] || `Session ${latestRecord.session}`) : null,
            checkInTime: toCambodiaTime(latestRecord?.checkInTime),
            checkOutTime: toCambodiaTime(latestRecord?.checkOutTime),
          };
        }),
      });
    }
    return results;
  }

  async getDailySummary(date?: Date) {
    const targetDate = date || new Date();
    const dayStart = toUTCMidnight(targetDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const attendances = await this.prisma.attendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      include: {
        student: { include: { user: { select: { name: true } } } },
        class: { select: { name: true } },
      },
    });

    const total = attendances.length;
    const present = attendances.filter(a => a.status === 'PRESENT').length;
    const absent = attendances.filter(a => a.status === 'ABSENT').length;
    const late = attendances.filter(a => a.status === 'LATE').length;
    const permission = countPermissionDayEquivalents(attendances as any, (a: any) => a.studentId);

    const byClass: Record<string, { className: string; present: number; absent: number; late: number; permission: number; total: number }> = {};
    for (const a of attendances) {
      if (!byClass[a.classId]) {
        byClass[a.classId] = { className: a.class.name, present: 0, absent: 0, late: 0, permission: 0, total: 0 };
      }
      byClass[a.classId].total++;
      if (a.status === 'PRESENT') byClass[a.classId].present++;
      else if (a.status === 'ABSENT') byClass[a.classId].absent++;
      else if (a.status === 'LATE') byClass[a.classId].late++;
    }

    // Permission in class summaries as day-equivalents per student/day
    for (const classId of Object.keys(byClass)) {
      byClass[classId].permission = countPermissionDayEquivalents(
        attendances.filter((a: any) => a.classId === classId) as any,
        (a: any) => a.studentId,
      );
    }

    return {
      date: dayStart.toISOString(),
      total,
      present,
      absent,
      late,
      permission,
      attendanceRate: total > 0 ? (present / total) * 100 : 0,
      classSummaries: Object.entries(byClass).map(([classId, data]) => ({
        classId,
        ...data,
        attendanceRate: data.total > 0 ? (data.present / data.total) * 100 : 0,
      })),
      absentStudents: attendances
        .filter(a => a.status === 'ABSENT')
        .map(a => ({ studentId: a.studentId, name: a.student.user.name, className: a.class.name })),
    };
  }

  /** Get individual student attendance detail for a class with all sessions and times */
  async getClassStudentDetail(classId: string, startDate: Date, endDate: Date) {
    const start = toUTCMidnight(startDate);
    const end = new Date(toUTCMidnight(endDate).getTime() + 24 * 60 * 60 * 1000);

    const attendances = await this.prisma.attendance.findMany({
      where: {
        classId,
        date: { gte: start, lt: end },
      },
      include: {
        student: { include: { user: { select: { name: true } } } },
      },
      orderBy: [{ date: 'asc' }, { session: 'asc' }],
    });

    return attendances.map(a => ({
      studentId: a.studentId,
      studentName: a.student.user.name,
      date: a.date.toISOString().split('T')[0],
      session: a.session,
      sessionLabel: SESSION_LABELS[a.session] || `Session ${a.session}`,
      status: a.status,
      permissionType: a.permissionType,
      permissionStartDate: a.permissionStartDate?.toISOString() || null,
      permissionEndDate: a.permissionEndDate?.toISOString() || null,
      checkInTime: toCambodiaTime(a.checkInTime),
      checkOutTime: toCambodiaTime(a.checkOutTime),
    }));
  }

  /** Get attendance grid: one row per student, all 4 sessions as columns */
  async getAttendanceGrid(classId: string, date: Date) {
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const isHoliday = await this.holidaysService.isHoliday(date);

    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: { students: { include: { user: { select: { name: true } } } } },
    });
    if (!cls) return [];

    // Honour the class's weekly schedule (e.g. SAT/SUN = day-off, or a weekend
    // class with MON–FRI = day-off). When today is a scheduled day-off we must
    // NOT auto-fill ABSENT for overtime sessions and we expose the flag so the
    // UI can render the day-off pill.
    const weeklySchedule = parseWeeklySchedule(cls.schedule);
    const todayIsScheduleDayOff = isScheduleDayOff(weeklySchedule, dayStart);

    const attendances = await this.prisma.attendance.findMany({
      where: { classId, date: { gte: dayStart, lt: dayEnd } },
    });

    // Load session configs to determine CHECK_IN / CHECK_OUT pairing
    const configs = await this.sessionConfigService.getConfigs(classId);
    const s2Cfg = configs.find((c: any) => c.session === 2);
    const s4Cfg = configs.find((c: any) => c.session === 4);
    // By default session 2 and 4 are CHECK_OUT, paired with session 1 and 3
    const s2IsCheckOut = !s2Cfg || s2Cfg.type === 'CHECK_OUT';
    const s4IsCheckOut = !s4Cfg || s4Cfg.type === 'CHECK_OUT';

    // Cambodia time for overtime detection
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);

    return cls.students.map((s, idx) => {
      const recs = attendances.filter(a => a.studentId === s.id);
      const s1 = recs.find(a => a.session === 1);
      const s2 = recs.find(a => a.session === 2);
      const s3 = recs.find(a => a.session === 3);
      const s4 = recs.find(a => a.session === 4);

      const allAbsent = recs.length === 0 || recs.every(a => a.status === 'ABSENT');
      const hasDayOff = recs.some(a => isDayOffStatus(a.status));

      // Compute session statuses
      // For CHECK_OUT paired sessions: if a record exists with an explicit status, always
      // respect it (handles admin edits). Only derive from checkOutTime when no record exists.
      let session1Status = s1?.status || null;
      let session2Status = s2IsCheckOut
        ? s2?.status ?? (s1?.checkOutTime ? (s1.status || 'PRESENT') : null)
        : (s2?.status || null);
      let session3Status = s3?.status || null;
      let session4Status = s4IsCheckOut
        ? s4?.status ?? (s3?.checkOutTime ? (s3.status || 'PRESENT') : null)
        : (s4?.status || null);

      // Mark overtime sessions as ABSENT (past sessions with no record)
      // Only apply to active sessions: inactive sessions have startTime === endTime (e.g. morning-only class)
      const isActiveSession = (sessionNum: number) => {
        const cfg = configs.find((c: any) => c.session === sessionNum);
        if (!cfg) return true;
        return cfg.startTime !== cfg.endTime;
      };
      if (!isHoliday && !todayIsScheduleDayOff) {
        if (!session1Status && isActiveSession(1) && isSessionOvertime(1, configs, dayStart, todayCambodia, cambodiaNowHHMM)) session1Status = 'ABSENT';
        if (!session2Status && isActiveSession(2) && isSessionOvertime(2, configs, dayStart, todayCambodia, cambodiaNowHHMM)) session2Status = 'ABSENT';
        if (!session3Status && isActiveSession(3) && isSessionOvertime(3, configs, dayStart, todayCambodia, cambodiaNowHHMM)) session3Status = 'ABSENT';
        if (!session4Status && isActiveSession(4) && isSessionOvertime(4, configs, dayStart, todayCambodia, cambodiaNowHHMM)) session4Status = 'ABSENT';
      }

      return {
        studentId: s.id,
        studentNumber: s.studentNumber || String(idx + 1).padStart(4, '0'),
        studentName: s.user.name,
        address: s.address || null,
        checkInMorning: s1 && s1.status !== 'ABSENT' && !isDayOffStatus(s1.status) ? toCambodiaTimeShort(s1.checkInTime) : null,
        checkOutMorning: s2IsCheckOut
          ? (s2 && s2.status && !isDayOffStatus(s2.status) && s2.status !== 'ABSENT'
              ? toCambodiaTimeShort(s2.checkInTime || s1?.checkOutTime)
              : (s1?.checkOutTime ? toCambodiaTimeShort(s1.checkOutTime) : null))
          : (s2 && s2.status !== 'ABSENT' && !isDayOffStatus(s2.status) ? toCambodiaTimeShort(s2.checkOutTime || s2.checkInTime) : null),
        checkInAfternoon: s3 && s3.status !== 'ABSENT' && !isDayOffStatus(s3.status) ? toCambodiaTimeShort(s3.checkInTime) : null,
        checkOutAfternoon: s4IsCheckOut
          ? (s4 && s4.status && !isDayOffStatus(s4.status) && s4.status !== 'ABSENT'
              ? toCambodiaTimeShort(s4.checkInTime || s3?.checkOutTime)
              : (s3?.checkOutTime ? toCambodiaTimeShort(s3.checkOutTime) : null))
          : (s4 && s4.status !== 'ABSENT' && !isDayOffStatus(s4.status) ? toCambodiaTimeShort(s4.checkOutTime || s4.checkInTime) : null),
        dayOff: hasDayOff || todayIsScheduleDayOff,
        isHoliday,
        isScheduleDayOff: todayIsScheduleDayOff,
        session1Status,
        session2Status,
        session3Status,
        session4Status,
        session1PermissionType: s1?.permissionType || null,
        session2PermissionType: s2?.permissionType || null,
        session3PermissionType: s3?.permissionType || null,
        session4PermissionType: s4?.permissionType || null,
        session1PermissionStartDate: s1?.permissionStartDate?.toISOString().split('T')[0] || null,
        session1PermissionEndDate: s1?.permissionEndDate?.toISOString().split('T')[0] || null,
        session2PermissionStartDate: s2?.permissionStartDate?.toISOString().split('T')[0] || null,
        session2PermissionEndDate: s2?.permissionEndDate?.toISOString().split('T')[0] || null,
        session3PermissionStartDate: s3?.permissionStartDate?.toISOString().split('T')[0] || null,
        session3PermissionEndDate: s3?.permissionEndDate?.toISOString().split('T')[0] || null,
        session4PermissionStartDate: s4?.permissionStartDate?.toISOString().split('T')[0] || null,
        session4PermissionEndDate: s4?.permissionEndDate?.toISOString().split('T')[0] || null,
      };
    });
  }

  /** Return study year date bounds for a calendar year, falling back to Jan 1 – Dec 31. */
  /**
   * Compute study year bounds using each date independently — no longer requires BOTH to be set.
   * yearStart = sy.startDate if available, else Jan 1 of calendarYear.
   * yearEnd   = sy.endDate + 1 day if available, else Jan 1 of calendarYear + 1.
   */
  private computeSyBounds(
    sy: { startDate?: Date | null; endDate?: Date | null } | null | undefined,
    calendarYear: number,
  ): { yearStart: Date; yearEnd: Date } {
    return {
      yearStart: sy?.startDate
        ? toUTCMidnight(sy.startDate)
        : new Date(Date.UTC(calendarYear, 0, 1)),
      yearEnd: sy?.endDate
        ? new Date(toUTCMidnight(sy.endDate).getTime() + 24 * 60 * 60 * 1000)
        : new Date(Date.UTC(calendarYear + 1, 0, 1)),
    };
  }

  private async getStudyYearBounds(calendarYear: number): Promise<{ yearStart: Date; yearEnd: Date }> {
    try {
      const sy = await this.prisma.studyYear.findFirst({ where: { year: calendarYear } });
      if (sy) return this.computeSyBounds(sy, calendarYear);
    } catch { /* ignore, fall back */ }
    return this.computeSyBounds(null, calendarYear);
  }

  /**
   * Compute the set of actual school/work days in a given period range.
   * A school day is a day that:
   *  - Falls within [periodStart, periodEnd)
   *  - Falls within [studyYearStart, studyYearEnd)
   *  - Is not a holiday
   *  - Is not in the future (relative to today UTC)
   *  - Is an operating day for the entity:
   *      * If `weeklySchedule` is provided → any day whose preset is not 'day-off'.
   *      * Otherwise → weekdays (Mon–Fri) only (legacy default).
   *
   * This is used to count absences for students/staff who have no scan records.
   */
  private computeSchoolDays(
    periodStart: Date,
    periodEnd: Date,
    studyYearStart: Date,
    studyYearEnd: Date,
    holidayDateSet: Set<string>,
    weeklySchedule?: Record<string, string> | null,
  ): Set<string> {
    const todayUTC = toUTCMidnight(new Date());
    // cutoff = beginning of tomorrow UTC so today is included
    const cutoff = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);
    const effectiveStart = new Date(Math.max(periodStart.getTime(), studyYearStart.getTime()));
    const effectiveEnd = new Date(Math.min(periodEnd.getTime(), studyYearEnd.getTime(), cutoff.getTime()));
    const days = new Set<string>();
    let cur = new Date(effectiveStart);
    while (cur < effectiveEnd) {
      const dow = cur.getUTCDay();
      let isOperatingDay: boolean;
      if (weeklySchedule) {
        const key = SCHEDULE_DAY_KEYS[dow];
        isOperatingDay = (weeklySchedule[key] || 'same') !== 'day-off';
      } else {
        isOperatingDay = dow >= 1 && dow <= 5; // Mon–Fri
      }
      if (isOperatingDay) {
        const d = cur.toISOString().split('T')[0];
        if (!holidayDateSet.has(d)) days.add(d);
      }
      cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
    }
    return days;
  }

  /** Get attendance totals per student for week, month, year */
  async getAttendanceTotals(classId: string, date: Date) {
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const dow = d.getUTCDay();

    // Week (Mon-Sun)
    const weekStart = new Date(Date.UTC(y, m, day - ((dow + 6) % 7)));
    const weekEnd = new Date(Date.UTC(y, m, day - ((dow + 6) % 7) + 7));

    // Month
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 1));

    // Fetch the class and its linked study year to determine the academic year bounds
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        studyYear: true,
        students: { include: { user: { select: { name: true } } } },
      },
    });
    if (!cls) return [];

    // Year — use the class's linked study year bounds (startDate and endDate used independently)
    const { yearStart, yearEnd } = this.computeSyBounds(cls.studyYear, cls.studyYear?.year ?? y);

    const [weekRecs, monthRecs, yearRecs] = await Promise.all([
      this.prisma.attendance.findMany({ where: { classId, date: { gte: weekStart, lt: weekEnd } } }),
      this.prisma.attendance.findMany({ where: { classId, date: { gte: monthStart, lt: monthEnd } } }),
      this.prisma.attendance.findMany({ where: { classId, date: { gte: yearStart, lt: yearEnd } } }),
    ]);

    // Fetch holidays for the year range to exclude from absent counts
    const yearHolidays = await this.holidaysService.getHolidaysInRange(yearStart, yearEnd);
    const holidayDateSet = new Set(yearHolidays.map(h => h.date.toISOString().split('T')[0]));

    // Fetch format rules for CLASS scope
    const formatRule = await this.sessionConfigService.getFormatRules('CLASS');

    // School days = operating days within the study year, not holidays, not future.
    // If the class has a weekly schedule (Class.schedule JSON), 'day-off' presets
    // (e.g. SAT/SUN by default, or MON–FRI for a weekend-only class) are excluded
    // so unrecorded scheduled-off days are NOT counted as absent.
    // Students with NO record on a school day are treated as absent (unrecorded = not present).
    const weeklySchedule = parseWeeklySchedule(cls.schedule);
    const weekSchoolDays = this.computeSchoolDays(weekStart, weekEnd, yearStart, yearEnd, holidayDateSet, weeklySchedule);
    const monthSchoolDays = this.computeSchoolDays(monthStart, monthEnd, yearStart, yearEnd, holidayDateSet, weeklySchedule);
    const yearSchoolDays = this.computeSchoolDays(yearStart, yearEnd, yearStart, yearEnd, holidayDateSet, weeklySchedule);

    const countFor = (recs: any[], studentId: string, schoolDays: Set<string>) => {
      const studentRecs = recs.filter(r => r.studentId === studentId);
      // Dates when this student has any record (any status)
      const studentDays = new Set(studentRecs.map((r: any) => r.date.toISOString().split('T')[0]));
      // School days with no record at all → count as absent
      const noRecordAbsent = [...schoolDays].filter(d => !studentDays.has(d)).length;
      const raw = countPrintReportTotals(
        studentRecs as any,
        (r: any) => r.studentId,
        formatRule.caseStudyABEnabled ?? true,
      );
      return this.applyFormatRules(
        { present: raw.present, late: raw.late, absent: raw.absent + noRecordAbsent, dayOff: raw.permission },
        formatRule as any,
      );
    };

    return cls.students.map((s, idx) => ({
      studentId: s.id,
      studentNumber: s.studentNumber || String(idx + 1).padStart(4, '0'),
      studentName: s.user.name,
      week: countFor(weekRecs, s.id, weekSchoolDays),
      month: countFor(monthRecs, s.id, monthSchoolDays),
      year: countFor(yearRecs, s.id, yearSchoolDays),
    }));
  }

  /** Get print report data: class info + student attendance totals for a custom date range */
  async getPrintReportData(classId: string, startDate: Date, endDate: Date) {
    const start = toUTCMidnight(startDate);
    const end = new Date(toUTCMidnight(endDate).getTime() + 24 * 60 * 60 * 1000);

    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        studyYear: true,
        teacher: { select: { name: true } },
        students: { include: { user: { select: { name: true } } } },
      },
    });
    if (!cls) return null;

    const records = await this.prisma.attendance.findMany({
      where: { classId, date: { gte: start, lt: end } },
    });

    let formatRule: any = { permissionsPerAbsent: 3, latesPerAbsentHalf: 3, caseStudyABEnabled: true, enabled: false };
    try {
      formatRule = await this.sessionConfigService.getFormatRules('CLASS');
    } catch (e) {
      console.warn('[reports/print-report-data] format-rules fallback:', e?.message || e);
    }

    // Fetch holidays in the range so we can identify true school days
    const rangeHolidays = await this.holidaysService.getHolidaysInRange(start, end);
    const rangeHolidaySet = new Set(rangeHolidays.map(h => h.date.toISOString().split('T')[0]));
    // Study year bounds from the class's linked study year (startDate and endDate used independently)
    const printSyBounds = this.computeSyBounds(cls.studyYear, cls.studyYear?.year ?? start.getUTCFullYear());
    // School days = operating days in the range constrained to study year, not holidays,
    // not future. Honours the class weekly schedule (e.g. SAT/SUN day-off, or weekend-only
    // classes) so scheduled non-operating days are NOT counted as absent.
    const printWeeklySchedule = parseWeeklySchedule(cls.schedule);
    const schoolDays = this.computeSchoolDays(start, end, printSyBounds.yearStart, printSyBounds.yearEnd, rangeHolidaySet, printWeeklySchedule);

    // Build set of dates that are scheduled day-off (e.g. SAT/SUN per weekly schedule).
    // Records on these dates must NOT be counted in permission/absent totals —
    // they are simply non-school days, not actual leave/permission absences.
    const scheduledDayOffDates = new Set<string>();
    if (printWeeklySchedule) {
      let cur = new Date(start);
      while (cur < end) {
        if (isScheduleDayOff(printWeeklySchedule, cur)) {
          scheduledDayOffDates.add(cur.toISOString().split('T')[0]);
        }
        cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    const students = cls.students.map((s, idx) => {
      const studentRecs = records.filter(r => r.studentId === s.id);
      // Exclude records on scheduled day-off dates before calculating totals
      const countableRecs = studentRecs.filter((r: any) => !scheduledDayOffDates.has(r.date.toISOString().split('T')[0]));
      const studentDays = new Set(countableRecs.map((r: any) => r.date.toISOString().split('T')[0]));
      const noRecordAbsent = [...schoolDays].filter(d => !studentDays.has(d)).length;
      const halfDayTotals = countPrintReportTotals(
        countableRecs as any,
        (r: any) => r.studentId,
        formatRule.caseStudyABEnabled ?? true,
      );
      const permissionBreakdown = buildPermissionTypeBreakdown(countableRecs as any);
      return {
        studentId: s.id,
        studentNumber: s.studentNumber || String(idx + 1).padStart(4, '0'),
        studentName: s.user.name,
        address: s.address || null,
        present: halfDayTotals.present,
        late: halfDayTotals.late,
        absent: halfDayTotals.absent + noRecordAbsent,
        dayOff: halfDayTotals.permission,
        permissionBreakdown,
      };
    });

    return {
      className: cls.name,
      subject: cls.subject,
      teacherName: cls.teacher?.name ?? '',
      startDate: start.toISOString().split('T')[0],
      endDate: toUTCMidnight(endDate).toISOString().split('T')[0],
      students,
    };
  }

  /** Get print report data for staff/officers: totals for a custom date range */
  async getStaffPrintReportData(startDate: Date, endDate: Date) {
    const start = toUTCMidnight(startDate);
    const end = new Date(toUTCMidnight(endDate).getTime() + 24 * 60 * 60 * 1000);

    const staff = await this.prisma.user.findMany({
      where: { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } },
      orderBy: { name: 'asc' },
    });

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: start, lt: end } },
    });

    let formatRule: any = { permissionsPerAbsent: 3, latesPerAbsentHalf: 3, caseStudyABEnabled: true, enabled: false };
    try {
      formatRule = await this.sessionConfigService.getFormatRules('STAFF');
    } catch (e) {
      console.warn('[reports/staff-print-report-data] format-rules fallback:', e?.message || e);
    }

    // Fetch holidays in the range to identify true work days
    const rangeHolidays = await this.holidaysService.getHolidaysInRange(start, end);
    const rangeHolidaySet = new Set(rangeHolidays.map(h => h.date.toISOString().split('T')[0]));
    // Study year bounds to constrain work days to the academic calendar
    const { yearStart: staffPrintSyStart, yearEnd: staffPrintSyEnd } = await this.getStudyYearBounds(start.getUTCFullYear());
    // Configured staff weekly schedule (admin → session-settings → STAFF tab).
    // Falls back to SAT+SUN day-off when nothing is configured.
    const staffPrintSchedule = (await this.sessionConfigService.getStaffWeeklySchedule()).schedule;
    // Work days = configured operating days in the range constrained to study year, not holidays, not future
    const workDays = this.computeSchoolDays(start, end, staffPrintSyStart, staffPrintSyEnd, rangeHolidaySet, staffPrintSchedule);

    const staffData = staff.map((u, idx) => {
      const userRecs = records.filter(r => r.userId === u.id);
      const staffDays = new Set(userRecs.map((r: any) => r.date.toISOString().split('T')[0]));
      const noRecordAbsent = [...workDays].filter(d => !staffDays.has(d)).length;
      const halfDayTotals = countPrintReportTotals(
        userRecs as any,
        (r: any) => r.userId,
        formatRule.caseStudyABEnabled ?? true,
      );
      const permissionBreakdown = buildPermissionTypeBreakdown(userRecs as any);
      return {
        userId: u.id,
        staffNumber: String(idx + 1).padStart(4, '0'),
        staffName: u.name,
        role: u.role,
        present: halfDayTotals.present,
        late: halfDayTotals.late,
        absent: halfDayTotals.absent + noRecordAbsent,
        dayOff: halfDayTotals.permission,
        permissionBreakdown,
      };
    });

    return {
      startDate: start.toISOString().split('T')[0],
      endDate: toUTCMidnight(endDate).toISOString().split('T')[0],
      staff: staffData,
    };
  }

  /** Export attendance data as CSV string for a class in a date range */
  async exportClassAttendance(classId: string, startDate: Date, endDate: Date): Promise<string> {
    const records = await this.getClassStudentDetail(classId, startDate, endDate);
    const header = 'Student Name,Date,Session,Status,Permission Type,Permission Start Date,Permission End Date,Check-In Time (GMT+7),Check-Out Time (GMT+7)';
    const rows = records.map(r =>
      `"${r.studentName}","${r.date}","${r.sessionLabel}","${r.status}","${(r as any).permissionType || ''}","${(r as any).permissionStartDate || ''}","${(r as any).permissionEndDate || ''}","${r.checkInTime || ''}","${r.checkOutTime || ''}"`,
    );
    return [header, ...rows].join('\n');
  }

  /** Export attendance grid as CSV for a single day — matches the report UI */
  async exportAttendanceGrid(classId: string, date: Date): Promise<string> {
    const grid = await this.getAttendanceGrid(classId, date);
    const totals = await this.getAttendanceTotals(classId, date);
    const configs = await this.sessionConfigService.getConfigs(classId);

    const d = toUTCMidnight(date);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];

    // Determine active sessions from configs
    const allSessions = [
      { session: 1, field: 'checkInMorning', statusField: 'session1Status', defaultLabel: 'CheckIn Morning' },
      { session: 2, field: 'checkOutMorning', statusField: 'session2Status', defaultLabel: 'CheckOut Morning' },
      { session: 3, field: 'checkInAfternoon', statusField: 'session3Status', defaultLabel: 'CheckIn Afternoon' },
      { session: 4, field: 'checkOutAfternoon', statusField: 'session4Status', defaultLabel: 'CheckOut Afternoon' },
    ];
    const active = configs.length > 0
      ? allSessions.filter(s => {
          const cfg = configs.find((c: any) => c.session === s.session);
          return cfg && cfg.startTime !== cfg.endTime;
        })
      : allSessions;

    const getLabel = (sessionNum: number, defaultLabel: string) => {
      const cfg = configs.find((c: any) => c.session === sessionNum);
      if (!cfg) return defaultLabel;
      const h = parseInt(cfg.startTime.split(':')[0]);
      const period = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
      return `${cfg.type === 'CHECK_OUT' ? 'CheckOut' : 'CheckIn'} ${period}`;
    };

    // --- Daily Attendance sheet ---
    const sessionHeaders = active.map(s => getLabel(s.session, s.defaultLabel)).join(',');
    const dailyHeader = `Day,ID,Student Name,${sessionHeaders},Permission`;
    const fmtCell = (time: string | null, status: string | null) => {
      if (!status || status === 'ABSENT') return 'Absent';
      if (isDayOffStatus(status)) return 'Day Off';
      if (status === 'LATE') return time ? `${time} (Late)` : 'Late';
      return time || 'Present';
    };
    const dailyRows = grid.map(r => {
      const sessionCells = active.map(s => `"${fmtCell((r as any)[s.field], (r as any)[s.statusField])}"`).join(',');
      return `"${dayName}","${r.studentNumber}","${r.studentName}",${sessionCells},"${r.dayOff ? 'Yes' : 'No'}"`;
    });

    const late = grid.filter(r => !r.dayOff && active.some(s => (r as any)[s.statusField] === 'LATE')).length;
    const present = grid.filter(r => !r.dayOff).length - late;
    const absent = grid.filter(r => r.dayOff).length;
    const dailySummary = `\n"Total Students: ${grid.length}","Present: ${present}","Late: ${late}","Absent / Permission: ${absent}"`;

    // --- Totals sheet ---
    const totalsHeader = '\nID,Student Name,Week Present,Week Late,Week Absent,Week Permission,Month Present,Month Late,Month Absent,Month Permission,Year Present,Year Late,Year Absent,Year Permission';
    const totalsRows = totals.map(r =>
      `"${r.studentNumber}","${r.studentName}","${r.week.present}","${r.week.late || 0}","${r.week.absent}","${r.week.dayOff || 0}","${r.month.present}","${r.month.late || 0}","${r.month.absent}","${r.month.dayOff || 0}","${r.year.present}","${r.year.late || 0}","${r.year.absent}","${r.year.dayOff || 0}"`,
    );
    const totalsFooter = `"Total","","${totals.reduce((s, r) => s + r.week.present, 0)}","${totals.reduce((s, r) => s + (r.week.late || 0), 0)}","${totals.reduce((s, r) => s + r.week.absent, 0)}","${totals.reduce((s, r) => s + (r.week.dayOff || 0), 0)}","${totals.reduce((s, r) => s + r.month.present, 0)}","${totals.reduce((s, r) => s + (r.month.late || 0), 0)}","${totals.reduce((s, r) => s + r.month.absent, 0)}","${totals.reduce((s, r) => s + (r.month.dayOff || 0), 0)}","${totals.reduce((s, r) => s + r.year.present, 0)}","${totals.reduce((s, r) => s + (r.year.late || 0), 0)}","${totals.reduce((s, r) => s + r.year.absent, 0)}","${totals.reduce((s, r) => s + (r.year.dayOff || 0), 0)}"`;

    return [
      dailyHeader, ...dailyRows, dailySummary,
      totalsHeader, ...totalsRows, totalsFooter,
    ].join('\n');
  }

  // ========== STAFF ATTENDANCE REPORTS ==========

  /** Get all staff attendance records for a given date (all sessions) */
  async getStaffAttendanceGrid(date: Date) {
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      include: { user: { select: { name: true, email: true, role: true } } },
    });

    return records.map(r => ({
      id: r.id,
      userId: r.userId,
      name: r.user.name,
      email: r.user.email,
      role: r.user.role,
      date: r.date,
      session: r.session,
      status: r.status,
      permissionType: r.permissionType,
      permissionStartDate: r.permissionStartDate?.toISOString() || null,
      permissionEndDate: r.permissionEndDate?.toISOString() || null,
      checkInTime: r.checkInTime?.toISOString() || null,
      checkOutTime: r.checkOutTime?.toISOString() || null,
    }));
  }

  /** Get staff attendance daily grid: one row per staff, 4 session columns */
  async getStaffAttendanceDailyGrid(date: Date) {
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const isHoliday = await this.holidaysService.isHoliday(date);

    const staff = await this.prisma.user.findMany({
      where: { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } },
      orderBy: { name: 'asc' },
    });

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
    });

    // Load staff session configs and Cambodia time for overtime detection
    const staffConfigs = await this.sessionConfigService.getStaffDefaults();
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);

    // Configured staff weekly schedule (admin → session-settings → STAFF tab).
    // Falls back to SAT+SUN day-off when nothing is configured.
    const staffSchedule = (await this.sessionConfigService.getStaffWeeklySchedule()).schedule;

    return staff.map((u, idx) => {
      const recs = records.filter(r => r.userId === u.id);
      const s1 = recs.find(r => r.session === 1);
      const s3 = recs.find(r => r.session === 3);

      // With auto-scan, CHECK_OUT updates the paired CHECK_IN record's checkOutTime
      // Session 1 holds both morning check-in and check-out times
      // Session 3 holds both afternoon check-in and check-out times
      // Collect location from whichever session has it (prefer session 1)
      const locRecord = s1?.scanLocation ? s1 : s3?.scanLocation ? s3 : s1 || s3;

      // Compute session statuses
      // For CHECK_OUT paired sessions, PERMISSION/DAY_OFF status on the actual record must override checkout logic
      const s2rec = recs.find(r => r.session === 2);
      const s4rec = recs.find(r => r.session === 4);
      let session1Status = s1?.status || null;
      let session2Status = (s2rec && isDayOffStatus(s2rec.status)) ? s2rec.status
        : s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
      let session3Status = s3?.status || null;
      let session4Status = (s4rec && isDayOffStatus(s4rec.status)) ? s4rec.status
        : s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

      // Mark overtime sessions as ABSENT (past sessions with no record).
      // Skip scheduled day-off weekdays (default SAT+SUN; admin-configurable) and
      // holidays — staff are not expected to scan on non-working days.
      const isStaffWeekend = isScheduleDayOff(staffSchedule, dayStart);
      if (!isHoliday && !isStaffWeekend) {
        if (!session1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session1Status = 'ABSENT';
        if (!session2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session2Status = 'ABSENT';
        if (!session3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session3Status = 'ABSENT';
        if (!session4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session4Status = 'ABSENT';
      }

      return {
        userId: u.id,
        staffNumber: String(idx + 1).padStart(4, '0'),
        staffName: u.name,
        role: u.role,
        checkInMorning: s1 && s1.status !== 'ABSENT' ? toCambodiaTimeShort(s1.checkInTime) : null,
        checkOutMorning: s1 ? toCambodiaTimeShort(s1.checkOutTime) : null,
        checkInAfternoon: s3 && s3.status !== 'ABSENT' ? toCambodiaTimeShort(s3.checkInTime) : null,
        checkOutAfternoon: s3 ? toCambodiaTimeShort(s3.checkOutTime) : null,
        session1Status,
        session2Status,
        session3Status,
        session4Status,
        session1PermissionType: s1?.permissionType || null,
        session2PermissionType: s2rec?.permissionType || null,
        session3PermissionType: s3?.permissionType || null,
        session4PermissionType: s4rec?.permissionType || null,
        session1PermissionStartDate: s1?.permissionStartDate?.toISOString().split('T')[0] || null,
        session1PermissionEndDate: s1?.permissionEndDate?.toISOString().split('T')[0] || null,
        session2PermissionStartDate: s2rec?.permissionStartDate?.toISOString().split('T')[0] || null,
        session2PermissionEndDate: s2rec?.permissionEndDate?.toISOString().split('T')[0] || null,
        session3PermissionStartDate: s3?.permissionStartDate?.toISOString().split('T')[0] || null,
        session3PermissionEndDate: s3?.permissionEndDate?.toISOString().split('T')[0] || null,
        session4PermissionStartDate: s4rec?.permissionStartDate?.toISOString().split('T')[0] || null,
        session4PermissionEndDate: s4rec?.permissionEndDate?.toISOString().split('T')[0] || null,
        isHoliday,
        isScheduleDayOff: isStaffWeekend,
        scanLatitude: locRecord?.scanLatitude || null,
        scanLongitude: locRecord?.scanLongitude || null,
        scanLocation: locRecord?.scanLocation || null,
      };
    });
  }

  /** Get staff attendance totals: week/month/year counts per staff */
  async getStaffAttendanceTotals(date: Date) {
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const dow = d.getUTCDay();

    const weekStart = new Date(Date.UTC(y, m, day - ((dow + 6) % 7)));
    const weekEnd = new Date(Date.UTC(y, m, day - ((dow + 6) % 7) + 7));
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 1));
    // Year — scoped to the study year's startDate/endDate if configured
    const { yearStart, yearEnd } = await this.getStudyYearBounds(y);

    const staff = await this.prisma.user.findMany({
      where: { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } },
      orderBy: { name: 'asc' },
    });

    const [weekRecs, monthRecs, yearRecs] = await Promise.all([
      this.prisma.staffAttendance.findMany({ where: { date: { gte: weekStart, lt: weekEnd } } }),
      this.prisma.staffAttendance.findMany({ where: { date: { gte: monthStart, lt: monthEnd } } }),
      this.prisma.staffAttendance.findMany({ where: { date: { gte: yearStart, lt: yearEnd } } }),
    ]);

    // Fetch holidays for the year range to exclude from absent counts
    const yearHolidays = await this.holidaysService.getHolidaysInRange(yearStart, yearEnd);
    const holidayDateSet = new Set(yearHolidays.map(h => h.date.toISOString().split('T')[0]));

    // Fetch format rules for STAFF scope
    const formatRule = await this.sessionConfigService.getFormatRules('STAFF');

    // Configured staff weekly schedule (admin → session-settings → STAFF tab).
    // Falls back to SAT+SUN day-off when nothing is configured.
    const staffSchedule = (await this.sessionConfigService.getStaffWeeklySchedule()).schedule;

    // Work days = configured operating days within the study year date range, not holidays, not future.
    // Staff with NO record on a work day are treated as absent (unrecorded = not present).
    // Using study year bounds means editing the study year's start/end date directly changes what counts.
    const weekWorkDays = this.computeSchoolDays(weekStart, weekEnd, yearStart, yearEnd, holidayDateSet, staffSchedule);
    const monthWorkDays = this.computeSchoolDays(monthStart, monthEnd, yearStart, yearEnd, holidayDateSet, staffSchedule);
    const yearWorkDays = this.computeSchoolDays(yearStart, yearEnd, yearStart, yearEnd, holidayDateSet, staffSchedule);

    const countFor = (recs: any[], userId: string, workDays: Set<string>) => {
      const userRecs = recs.filter(r => r.userId === userId);
      // Dates when this staff has any record
      const staffDays = new Set(userRecs.map((r: any) => r.date.toISOString().split('T')[0]));
      // Work days with no record at all → count as absent
      const noRecordAbsent = [...workDays].filter(d => !staffDays.has(d)).length;
      const raw = {
        present: userRecs.filter(r => r.status === 'PRESENT').length,
        late: userRecs.filter(r => r.status === 'LATE').length,
        absent: userRecs.filter(r => r.status === 'ABSENT' && !holidayDateSet.has(r.date.toISOString().split('T')[0])).length + noRecordAbsent,
        dayOff: countPermissionDayEquivalents(userRecs as any, (r: any) => r.userId),
      };
      return this.applyFormatRules(raw, formatRule as any);
    };

    return staff.map((u, idx) => ({
      userId: u.id,
      staffNumber: String(idx + 1).padStart(4, '0'),
      staffName: u.name,
      role: u.role,
      week: countFor(weekRecs, u.id, weekWorkDays),
      month: countFor(monthRecs, u.id, monthWorkDays),
      year: countFor(yearRecs, u.id, yearWorkDays),
    }));
  }

  /** Export staff attendance for a date range as CSV */
  async exportStaffPeriod(startDate: Date, endDate: Date): Promise<string> {
    const start = toUTCMidnight(startDate);
    const end = new Date(toUTCMidnight(endDate).getTime() + 24 * 60 * 60 * 1000);

    const staff = await this.prisma.user.findMany({
      where: { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } },
      orderBy: { name: 'asc' },
    });

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [{ date: 'asc' }, { session: 'asc' }],
    });

    const header = 'Staff Name,Role,Date,Session,Status,Permission Type,Permission Start Date,Permission End Date,Check-In Time (GMT+7),Check-Out Time (GMT+7)';
    const rows: string[] = [];
    for (const rec of records) {
      const u = staff.find(s => s.id === rec.userId);
      if (!u) continue;
      const sessionLabel = rec.session === 1 ? 'Morning' : rec.session === 3 ? 'Afternoon' : `Session ${rec.session}`;
      rows.push(
        `"${u.name}","${u.role}","${rec.date.toISOString().split('T')[0]}","${sessionLabel}","${rec.status}","${rec.permissionType || ''}","${rec.permissionStartDate?.toISOString().split('T')[0] || ''}","${rec.permissionEndDate?.toISOString().split('T')[0] || ''}","${toCambodiaTime(rec.checkInTime) || ''}","${toCambodiaTime(rec.checkOutTime) || ''}"`
      );
    }
    return [header, ...rows].join('\n');
  }

  // ========== ATTENDANCE STATUS DETERMINATION ==========

  /**
   * Determine the daily attendance status for a student based on session records.
   * Rules:
   * - Morning CheckIn-Out + Afternoon CheckIn-Out → Present
   * - Late twice in a day → Present (Late)
   * - Late three times → Absent (Exceeded Late Limit)
   * - Attend morning + miss afternoon → Half-Day Present (Morning Only)
   * - Miss morning + attend afternoon → Half-Day Present (Afternoon Only)
   * - No check-in/out → Absent
   */
  private determineDailyStatus(sessions: {
    session1Status: string | null;
    session2Status: string | null;
    session3Status: string | null;
    session4Status: string | null;
  }): string {
    const { session1Status, session2Status, session3Status, session4Status } = sessions;

    const morningIn = session1Status && session1Status !== 'ABSENT' && !isDayOffStatus(session1Status);
    const morningOut = session2Status && session2Status !== 'ABSENT' && !isDayOffStatus(session2Status);
    const afternoonIn = session3Status && session3Status !== 'ABSENT' && !isDayOffStatus(session3Status);
    const afternoonOut = session4Status && session4Status !== 'ABSENT' && !isDayOffStatus(session4Status);

    const hasMorning = morningIn || morningOut;
    const hasAfternoon = afternoonIn || afternoonOut;

    // No attendance at all
    if (!hasMorning && !hasAfternoon) return 'Absent';

    // LATE + 3 ABSENT = Absent (only LATE with no PRESENT and 3+ absent sessions)
    const allStatuses = [session1Status, session2Status, session3Status, session4Status];
    const hasPresent = allStatuses.some(s => s === 'PRESENT');
    const absentCount = allStatuses.filter(s => s === 'ABSENT').length;
    if (!hasPresent && absentCount >= 3) return 'Absent';

    // Check for DAY_OFF / PERMISSION
    if ([session1Status, session2Status, session3Status, session4Status].some(s => isDayOffStatus(s))) {
      return 'Day Off';
    }

    // Count late sessions
    const lateCount = [session1Status, session2Status, session3Status, session4Status]
      .filter(s => s === 'LATE').length;

    // Late three times → Absent (Exceeded Late Limit)
    if (lateCount >= 3) return 'Absent (Exceeded Late Limit)';

    // Full attendance (both morning and afternoon)
    if (hasMorning && hasAfternoon) {
      if (lateCount >= 2) return 'Present (Late)';
      if (lateCount === 1) return 'Present (Late)';
      return 'Present';
    }

    // Half-day
    if (hasMorning && !hasAfternoon) return 'Half-Day Present (Morning Only)';
    if (!hasMorning && hasAfternoon) return 'Half-Day Present (Afternoon Only)';

    return 'Absent';
  }

  // ========== XLSX EXPORT WITH 4 SHEETS ==========

  /** Helper: apply header styling to a worksheet row */
  private styleHeaderRow(row: ExcelJS.Row, bgColor: string = 'CFE2F3') {
    row.eachCell(cell => {
      cell.font = { bold: true, size: 10, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
  }

  /** Helper: apply data styling to a worksheet row */
  private styleDataRow(row: ExcelJS.Row) {
    row.eachCell(cell => {
      cell.font = { size: 10, name: 'Arial' };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
  }

  /** Export attendance as XLSX — filtered by period: daily, weekly, monthly, yearly, or all */
  async exportAttendanceXlsx(classId: string, date: Date, period?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const dow = d.getUTCDay();

    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: { students: { include: { user: { select: { name: true } } } } },
    });
    if (!cls) return Buffer.from('');

    const configs = await this.sessionConfigService.getConfigs(classId);

    // Fetch holidays using study year bounds so the yearly sheet and holiday set are consistent
    const { yearStart, yearEnd } = await this.getStudyYearBounds(y);
    const yearHolidays = await this.holidaysService.getHolidaysInRange(yearStart, yearEnd);
    const holidayDateSet = new Set(yearHolidays.map(h => h.date.toISOString().split('T')[0]));

    // Fetch format rules for CLASS scope
    const formatRule = await this.sessionConfigService.getFormatRules('CLASS');

    const p = (period || 'daily').toLowerCase();

    if (p === 'daily') {
      await this.buildDailySheet(workbook, cls, configs, d, holidayDateSet, formatRule as any);
    } else if (p === 'weekly') {
      await this.buildWeeklySheet(workbook, cls, d, holidayDateSet, formatRule as any);
    } else if (p === 'monthly') {
      await this.buildMonthlySheet(workbook, cls, d, holidayDateSet, formatRule as any);
    } else if (p === 'yearly') {
      await this.buildYearlySheet(workbook, cls, d, holidayDateSet, formatRule as any);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Build the Daily attendance sheet */
  private async buildDailySheet(
    workbook: ExcelJS.Workbook, cls: any, configs: any[], date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Daily');
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayStart.getUTCDay()];

    const attendances = await this.prisma.attendance.findMany({
      where: { classId: cls.id, date: { gte: dayStart, lt: dayEnd } },
    });

    // Session config for pairing
    const s2Cfg = configs.find((c: any) => c.session === 2);
    const s4Cfg = configs.find((c: any) => c.session === 4);
    const s2IsCheckOut = !s2Cfg || s2Cfg.type === 'CHECK_OUT';
    const s4IsCheckOut = !s4Cfg || s4Cfg.type === 'CHECK_OUT';

    // Row 1: Header merged cells
    // Day | ID | Student Name | CheckIn Morning | CheckOut Afternoon | CheckIn Afternoon | CheckOut Evening | Total(4 cols)
    const headerRow1 = ws.addRow([
      'Day', 'ID', 'Student Name',
      'CheckIn Morning', 'CheckOut Afternoon', 'CheckIn Afternoon', 'CheckOut Evening',
      'Total', '', '', '',
    ]);
    // Merge "Total" across H1:K1
    ws.mergeCells('A1:A2');
    ws.mergeCells('B1:B2');
    ws.mergeCells('C1:C2');
    ws.mergeCells('D1:D2');
    ws.mergeCells('E1:E2');
    ws.mergeCells('F1:F2');
    ws.mergeCells('G1:G2');
    ws.mergeCells('H1:K1');
    this.styleHeaderRow(headerRow1);

    // Row 2: Sub-headers for Total
    const headerRow2 = ws.addRow(['', '', '', '', '', '', '', 'Present', 'Absent', 'Late', 'Permission']);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    // Cambodia "today" for future-date blank logic
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);
    const isFutureDay = dayStart > todayCambodia;
    const isHoliday = holidayDateSet.has(dayStart.toISOString().split('T')[0]);

    // Data rows
    for (const [idx, student] of cls.students.entries()) {
      if (isFutureDay) {
        const row = ws.addRow([
          dayName,
          student.studentNumber || String(idx + 1).padStart(4, '0'),
          student.user.name,
          '', '', '', '', '', '', '', '',
        ]);
        this.styleDataRow(row);
        continue;
      }

      const recs = attendances.filter((a: any) => a.studentId === student.id);
      const s1 = recs.find((a: any) => a.session === 1);
      const s2 = recs.find((a: any) => a.session === 2);
      const s3 = recs.find((a: any) => a.session === 3);
      const s4 = recs.find((a: any) => a.session === 4);

      let s1Status = s1?.status || null;
      let s2Status = s2IsCheckOut ? (s1?.checkOutTime ? (s1.status || 'PRESENT') : null) : (s2?.status || null);
      let s3Status = s3?.status || null;
      let s4Status = s4IsCheckOut ? (s3?.checkOutTime ? (s3.status || 'PRESENT') : null) : (s4?.status || null);

      // Mark overtime sessions as ABSENT
      if (!isHoliday) {
        if (!s1Status && isSessionOvertime(1, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
        if (!s2Status && isSessionOvertime(2, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
        if (!s3Status && isSessionOvertime(3, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
        if (!s4Status && isSessionOvertime(4, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';
      }

      const fmtCell = (time: Date | null, status: string | null) => {
        if (!status) return '';
        if (status === 'ABSENT') return 'Absent';
        if (isDayOffStatus(status)) return 'Day Off';
        if (status === 'LATE') return time ? `${toCambodiaTimeShort(time)} (Late)` : 'Late';
        return time ? toCambodiaTimeShort(time) || 'Present' : 'Present';
      };

      const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

      // Count totals for this student this day
      const isPresent = dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day') ? 1 : 0;
      const isAbsent = dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)' ? 1 : 0;
      const isLate = dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded') ? 1 : 0;
      const isPermission = dailyStatus === 'Day Off' ? 1 : 0;

      const checkInMorning = s1 && s1.status !== 'ABSENT' && s1.status !== 'DAY_OFF' ? s1.checkInTime : null;
      const checkOutMorning = s2IsCheckOut ? (s1?.checkOutTime || null) : (s2 && s2.status !== 'ABSENT' ? (s2.checkOutTime || s2.checkInTime) : null);
      const checkInAfternoon = s3 && s3.status !== 'ABSENT' && s3.status !== 'DAY_OFF' ? s3.checkInTime : null;
      const checkOutAfternoon = s4IsCheckOut ? (s3?.checkOutTime || null) : (s4 && s4.status !== 'ABSENT' ? (s4.checkOutTime || s4.checkInTime) : null);

      const row = ws.addRow([
        dayName,
        student.studentNumber || String(idx + 1).padStart(4, '0'),
        student.user.name,
        fmtCell(checkInMorning, s1Status),
        fmtCell(checkOutMorning, s2Status),
        fmtCell(checkInAfternoon, s3Status),
        fmtCell(checkOutAfternoon, s4Status),
        isPresent, isAbsent, isLate, isPermission,
      ]);
      this.styleDataRow(row);
    }

    // Auto-fit column widths
    ws.columns = [
      { width: 12 }, { width: 10 }, { width: 20 },
      { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
      { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 },
    ];
  }

  /** Build the Weekly attendance sheet */
  private async buildWeeklySheet(
    workbook: ExcelJS.Workbook, cls: any, date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Weekly');
    const d = toUTCMidnight(date);
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    // Find Monday of the week (Mon-Sun)
    const mondayOffset = dow === 0 ? 6 : (dow - 1);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset));

    const configs = await this.sessionConfigService.getConfigs(cls.id);
    const s2Cfg = configs.find((c: any) => c.session === 2);
    const s4Cfg = configs.find((c: any) => c.session === 4);
    const s2IsCheckOut = !s2Cfg || s2Cfg.type === 'CHECK_OUT';
    const s4IsCheckOut = !s4Cfg || s4Cfg.type === 'CHECK_OUT';

    // Fetch the full week of attendance (Mon-Sun)
    const weekEnd = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
    const attendances = await this.prisma.attendance.findMany({
      where: { classId: cls.id, date: { gte: monday, lt: weekEnd } },
    });
    // Pre-build set of dates when any class attendance was recorded (skip days before tracking started)
    const activeDates = new Set<string>(attendances.map((a: any) => toUTCMidnight(new Date(a.date)).toISOString().split('T')[0]));

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Build day headers with actual dates: "Mon (YYYY-MM-DD)"
    const dayHeaders: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = dayDate.toISOString().split('T')[0];
      dayHeaders.push(`${dayNames[i]} (${dateStr})`);
    }

    // Row 1: ID | Student Name | Mon(4cols) | Tue(4cols) | ... | Sun(4cols) | Total(4cols) | [Converted(2cols)]
    const headerValues: any[] = ['ID', 'Student Name'];
    for (const dh of dayHeaders) headerValues.push(dh, '', '', '');
    headerValues.push('Total', '', '', '');
    if (formatRule?.enabled) headerValues.push('Converted Absence', '');
    const headerRow1 = ws.addRow(headerValues);

    // Merge day headers
    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2');
    let col = 3;
    for (let i = 0; i < 7; i++) {
      ws.mergeCells(1, col, 1, col + 3);
      col += 4;
    }
    ws.mergeCells(1, col, 1, col + 3); // Total
    if (formatRule?.enabled) {
      const convCol = col + 4;
      ws.mergeCells(1, convCol, 1, convCol + 1);
    }
    this.styleHeaderRow(headerRow1);

    // Row 2: Sub-headers
    const subValues: any[] = ['', ''];
    for (let i = 0; i < 8; i++) subValues.push('Present', 'Absent', 'Late', 'Permission');
    if (formatRule?.enabled) subValues.push(`${formatRule.permissionsPerAbsent} Perm=1 Absent`, `${formatRule.latesPerAbsentHalf} Late=½ Absent`);
    const headerRow2 = ws.addRow(subValues);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    // Cambodia "today" for future-date blank logic
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);

    // Data rows
    for (const [idx, student] of cls.students.entries()) {
      const rowVals: any[] = [
        student.studentNumber || String(idx + 1).padStart(4, '0'),
        student.user.name,
      ];
      let totalP = 0, totalA = 0, totalL = 0, totalPerm = 0;
      let hasPastDays = false;

      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayDate = new Date(monday.getTime() + dayIdx * 24 * 60 * 60 * 1000);
        const dayStart = toUTCMidnight(dayDate);
        const dayDateEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        if (dayStart > todayCambodia) {
          rowVals.push('', '', '', '');
          continue;
        }

        // Skip days when no attendance was taken for the class (before tracking started)
        if (!activeDates.has(dayStart.toISOString().split('T')[0])) {
          rowVals.push('', '', '', '');
          continue;
        }
        hasPastDays = true;

        const dayRecs = attendances.filter((a: any) =>
          a.studentId === student.id && a.date >= dayStart && a.date < dayDateEnd
        );

        const s1 = dayRecs.find((a: any) => a.session === 1);
        const s2 = dayRecs.find((a: any) => a.session === 2);
        const s3 = dayRecs.find((a: any) => a.session === 3);
        const s4 = dayRecs.find((a: any) => a.session === 4);

        let s1Status = s1?.status || null;
        let s2Status = s2IsCheckOut ? (s1?.checkOutTime ? (s1.status || 'PRESENT') : null) : (s2?.status || null);
        let s3Status = s3?.status || null;
        let s4Status = s4IsCheckOut ? (s3?.checkOutTime ? (s3.status || 'PRESENT') : null) : (s4?.status || null);

        const isHoliday = holidayDateSet.has(dayStart.toISOString().split('T')[0]);
        if (isHoliday) {
          rowVals.push(0, 0, 0, 0);
          continue;
        }

        // Mark overtime sessions as ABSENT
        if (!s1Status && isSessionOvertime(1, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
        if (!s2Status && isSessionOvertime(2, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
        if (!s3Status && isSessionOvertime(3, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
        if (!s4Status && isSessionOvertime(4, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';

        const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

        const p = dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day') ? 1 : 0;
        const a = dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)' ? 1 : 0;
        const l = dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded') ? 1 : 0;
        const perm = dailyStatus === 'Day Off' ? 1 : 0;

        rowVals.push(p, a, l, perm);
        totalP += p; totalA += a; totalL += l; totalPerm += perm;
      }

      rowVals.push(hasPastDays ? totalP : '', hasPastDays ? totalA : '', hasPastDays ? totalL : '', hasPastDays ? totalPerm : '');
      if (formatRule?.enabled && hasPastDays) {
        const convAbsent = formatRule.permissionsPerAbsent > 0 ? Math.floor(totalPerm / formatRule.permissionsPerAbsent) : 0;
        const convHalf = formatRule.latesPerAbsentHalf > 0 ? Math.floor(totalL / formatRule.latesPerAbsentHalf) : 0;
        rowVals.push(convAbsent, convHalf);
      } else if (formatRule?.enabled) {
        rowVals.push('', '');
      }
      const row = ws.addRow(rowVals);
      this.styleDataRow(row);
    }

    // Column widths
    const colWidths = [{ width: 10 }, { width: 20 }];
    for (let i = 0; i < 32; i++) colWidths.push({ width: 10 });
    if (formatRule?.enabled) { colWidths.push({ width: 18 }); colWidths.push({ width: 18 }); }
    ws.columns = colWidths;
  }

  /** Build the Monthly attendance sheet */
  private async buildMonthlySheet(
    workbook: ExcelJS.Workbook, cls: any, date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Monthly');
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 1));
    const monthName = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const configs = await this.sessionConfigService.getConfigs(cls.id);
    const s2Cfg = configs.find((c: any) => c.session === 2);
    const s4Cfg = configs.find((c: any) => c.session === 4);
    const s2IsCheckOut = !s2Cfg || s2Cfg.type === 'CHECK_OUT';
    const s4IsCheckOut = !s4Cfg || s4Cfg.type === 'CHECK_OUT';

    // Divide the month into weeks (Sun-Sat)
    const weeks: { start: Date; end: Date; label: string }[] = [];
    let cursor = new Date(monthStart);
    while (cursor < monthEnd) {
      const weekStart = new Date(cursor);
      const dayOfWeek = weekStart.getUTCDay(); // 0=Sun, 6=Sat
      const daysToSaturday = dayOfWeek === 6 ? 0 : (6 - dayOfWeek);
      const saturday = new Date(weekStart);
      saturday.setUTCDate(saturday.getUTCDate() + daysToSaturday);
      // Week end is exclusive (day after Saturday), clamped to month end
      const weekEnd = new Date(Math.min(saturday.getTime() + 24 * 60 * 60 * 1000, monthEnd.getTime()));
      const endDisplay = new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000);
      weeks.push({
        start: weekStart,
        end: weekEnd,
        label: `Week ${weeks.length + 1} (${weekStart.toISOString().split('T')[0]} to ${endDisplay.toISOString().split('T')[0]})`,
      });
      cursor = weekEnd;
    }

    // Fetch month attendance
    const attendances = await this.prisma.attendance.findMany({
      where: { classId: cls.id, date: { gte: monthStart, lt: monthEnd } },
    });
    // Pre-build set of dates when any class attendance was recorded (skip days before tracking started)
    const activeDates = new Set<string>(attendances.map((a: any) => toUTCMidnight(new Date(a.date)).toISOString().split('T')[0]));

    // Row 1 header
    const headerValues: any[] = ['Month', 'ID', 'Student Name'];
    for (const w of weeks) headerValues.push(w.label, '', '', '');
    headerValues.push('Total', '', '', '');
    if (formatRule?.enabled) headerValues.push('Converted Absence', '');
    const headerRow1 = ws.addRow(headerValues);

    // Merges
    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2'); ws.mergeCells('C1:C2');
    let col = 4;
    for (let i = 0; i < weeks.length; i++) {
      ws.mergeCells(1, col, 1, col + 3);
      col += 4;
    }
    ws.mergeCells(1, col, 1, col + 3);
    if (formatRule?.enabled) {
      const convCol = col + 4;
      ws.mergeCells(1, convCol, 1, convCol + 1);
    }
    this.styleHeaderRow(headerRow1);

    // Row 2 sub-headers
    const subValues: any[] = ['', '', ''];
    for (let i = 0; i < weeks.length + 1; i++) subValues.push('Present', 'Absent', 'Late', 'Permission');
    if (formatRule?.enabled) subValues.push(`${formatRule.permissionsPerAbsent} Perm=1 Absent`, `${formatRule.latesPerAbsentHalf} Late=½ Absent`);
    const headerRow2 = ws.addRow(subValues);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    // Cambodia "today" for future-date blank logic
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);

    // Data
    for (const [idx, student] of cls.students.entries()) {
      const rowVals: any[] = [
        monthName,
        student.studentNumber || String(idx + 1).padStart(4, '0'),
        student.user.name,
      ];
      let totalP = 0, totalA = 0, totalL = 0, totalPerm = 0;
      let hasPastDays = false;

      for (const week of weeks) {
        let wp = 0, wa = 0, wl = 0, wperm = 0;
        let weekHasPast = false;
        let cursor = new Date(week.start);
        while (cursor < week.end) {
          const dayStart = toUTCMidnight(cursor);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

          if (dayStart > todayCambodia) {
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
            continue;
          }

          // Skip days when no attendance was taken for the class (before tracking started)
          if (!activeDates.has(dayStart.toISOString().split('T')[0])) {
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
            continue;
          }
          weekHasPast = true;
          hasPastDays = true;

          const isHoliday = holidayDateSet.has(dayStart.toISOString().split('T')[0]);

          if (!isHoliday) {
            const dayRecs = attendances.filter((a: any) =>
              a.studentId === student.id && a.date >= dayStart && a.date < dayEnd
            );
            const s1 = dayRecs.find((a: any) => a.session === 1);
            const s2 = dayRecs.find((a: any) => a.session === 2);
            const s3 = dayRecs.find((a: any) => a.session === 3);
            const s4 = dayRecs.find((a: any) => a.session === 4);
            let s1Status = s1?.status || null;
            let s2Status = s2IsCheckOut ? (s1?.checkOutTime ? (s1.status || 'PRESENT') : null) : (s2?.status || null);
            let s3Status = s3?.status || null;
            let s4Status = s4IsCheckOut ? (s3?.checkOutTime ? (s3.status || 'PRESENT') : null) : (s4?.status || null);

            // Mark overtime sessions as ABSENT
            if (!s1Status && isSessionOvertime(1, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
            if (!s2Status && isSessionOvertime(2, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
            if (!s3Status && isSessionOvertime(3, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
            if (!s4Status && isSessionOvertime(4, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';

            const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

            if (dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day')) wp++;
            else if (dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)') wa++;
            if (dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded')) wl++;
            if (dailyStatus === 'Day Off') wperm++;
          }

          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        }
        rowVals.push(weekHasPast ? wp : '', weekHasPast ? wa : '', weekHasPast ? wl : '', weekHasPast ? wperm : '');
        if (weekHasPast) { totalP += wp; totalA += wa; totalL += wl; totalPerm += wperm; }
      }

      rowVals.push(hasPastDays ? totalP : '', hasPastDays ? totalA : '', hasPastDays ? totalL : '', hasPastDays ? totalPerm : '');
      if (formatRule?.enabled && hasPastDays) {
        const convAbsent = formatRule.permissionsPerAbsent > 0 ? Math.floor(totalPerm / formatRule.permissionsPerAbsent) : 0;
        const convHalf = formatRule.latesPerAbsentHalf > 0 ? Math.floor(totalL / formatRule.latesPerAbsentHalf) : 0;
        rowVals.push(convAbsent, convHalf);
      } else if (formatRule?.enabled) {
        rowVals.push('', '');
      }
      const row = ws.addRow(rowVals);
      this.styleDataRow(row);
    }

    // Column widths
    const colWidths = [{ width: 14 }, { width: 10 }, { width: 20 }];
    for (let i = 0; i < (weeks.length + 1) * 4; i++) colWidths.push({ width: 10 });
    if (formatRule?.enabled) { colWidths.push({ width: 18 }); colWidths.push({ width: 18 }); }
    ws.columns = colWidths;
  }

  /** Build the Yearly attendance sheet */
  private async buildYearlySheet(
    workbook: ExcelJS.Workbook, cls: any, date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Yearly');
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const { yearStart, yearEnd } = await this.getStudyYearBounds(y);

    const configs = await this.sessionConfigService.getConfigs(cls.id);
    const s2Cfg = configs.find((c: any) => c.session === 2);
    const s4Cfg = configs.find((c: any) => c.session === 4);
    const s2IsCheckOut = !s2Cfg || s2Cfg.type === 'CHECK_OUT';
    const s4IsCheckOut = !s4Cfg || s4Cfg.type === 'CHECK_OUT';

    // Fetch full year of attendance
    const attendances = await this.prisma.attendance.findMany({
      where: { classId: cls.id, date: { gte: yearStart, lt: yearEnd } },
    });
    // Pre-build set of dates when any class attendance was recorded (skip days before tracking started)
    const activeDates = new Set<string>(attendances.map((a: any) => toUTCMidnight(new Date(a.date)).toISOString().split('T')[0]));

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Row 1 header
    const headerValues: any[] = ['Year', 'ID', 'Student Name'];
    for (const mn of months) headerValues.push(mn, '', '', '');
    headerValues.push('Total', '', '', '');
    if (formatRule?.enabled) headerValues.push('Converted Absence', '');
    const headerRow1 = ws.addRow(headerValues);

    // Merges
    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2'); ws.mergeCells('C1:C2');
    let col = 4;
    for (let i = 0; i < 13; i++) { // 12 months + 1 total
      ws.mergeCells(1, col, 1, col + 3);
      col += 4;
    }
    if (formatRule?.enabled) {
      ws.mergeCells(1, col, 1, col + 1);
    }
    this.styleHeaderRow(headerRow1);

    // Row 2 sub-headers
    const subValues: any[] = ['', '', ''];
    for (let i = 0; i < 13; i++) subValues.push('Present', 'Absent', 'Late', 'Permission');
    if (formatRule?.enabled) subValues.push(`${formatRule.permissionsPerAbsent} Perm=1 Absent`, `${formatRule.latesPerAbsentHalf} Late=½ Absent`);
    const headerRow2 = ws.addRow(subValues);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    // Cambodia "today" for future-date blank logic
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);

    // Data
    for (const [idx, student] of cls.students.entries()) {
      const rowVals: any[] = [
        String(y),
        student.studentNumber || String(idx + 1).padStart(4, '0'),
        student.user.name,
      ];
      let totalP = 0, totalA = 0, totalL = 0, totalPerm = 0;
      let hasPastDays = false;

      for (let mi = 0; mi < 12; mi++) {
        const mStart = new Date(Date.UTC(y, mi, 1));
        const mEnd = new Date(Date.UTC(y, mi + 1, 1));
        let mp = 0, ma = 0, ml = 0, mperm = 0;

        let monthHasPast = false;
        let cursor = new Date(mStart);
        while (cursor < mEnd) {
          const dayStart = toUTCMidnight(cursor);
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

          if (dayStart > todayCambodia) {
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
            continue;
          }

          // Skip days when no attendance was taken for the class (before tracking started)
          if (!activeDates.has(dayStart.toISOString().split('T')[0])) {
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
            continue;
          }
          monthHasPast = true;
          hasPastDays = true;

          const isHoliday = holidayDateSet.has(dayStart.toISOString().split('T')[0]);

          if (!isHoliday) {
            const dayRecs = attendances.filter((a: any) =>
              a.studentId === student.id && a.date >= dayStart && a.date < dayEnd
            );
            const s1 = dayRecs.find((a: any) => a.session === 1);
            const s2 = dayRecs.find((a: any) => a.session === 2);
            const s3 = dayRecs.find((a: any) => a.session === 3);
            const s4 = dayRecs.find((a: any) => a.session === 4);
            let s1Status = s1?.status || null;
            let s2Status = s2IsCheckOut ? (s1?.checkOutTime ? (s1.status || 'PRESENT') : null) : (s2?.status || null);
            let s3Status = s3?.status || null;
            let s4Status = s4IsCheckOut ? (s3?.checkOutTime ? (s3.status || 'PRESENT') : null) : (s4?.status || null);

            // Mark overtime sessions as ABSENT
            if (!s1Status && isSessionOvertime(1, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
            if (!s2Status && isSessionOvertime(2, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
            if (!s3Status && isSessionOvertime(3, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
            if (!s4Status && isSessionOvertime(4, configs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';

            const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

            if (dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day')) mp++;
            else if (dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)') ma++;
            if (dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded')) ml++;
            if (dailyStatus === 'Day Off') mperm++;
          }

          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        }

        rowVals.push(monthHasPast ? mp : '', monthHasPast ? ma : '', monthHasPast ? ml : '', monthHasPast ? mperm : '');
        if (monthHasPast) { totalP += mp; totalA += ma; totalL += ml; totalPerm += mperm; }
      }

      rowVals.push(hasPastDays ? totalP : '', hasPastDays ? totalA : '', hasPastDays ? totalL : '', hasPastDays ? totalPerm : '');
      if (formatRule?.enabled && hasPastDays) {
        const convAbsent = formatRule.permissionsPerAbsent > 0 ? Math.floor(totalPerm / formatRule.permissionsPerAbsent) : 0;
        const convHalf = formatRule.latesPerAbsentHalf > 0 ? Math.floor(totalL / formatRule.latesPerAbsentHalf) : 0;
        rowVals.push(convAbsent, convHalf);
      } else if (formatRule?.enabled) {
        rowVals.push('', '');
      }
      const row = ws.addRow(rowVals);
      this.styleDataRow(row);
    }

    // Column widths
    const colWidths = [{ width: 10 }, { width: 10 }, { width: 20 }];
    for (let i = 0; i < 52; i++) colWidths.push({ width: 10 });
    if (formatRule?.enabled) { colWidths.push({ width: 18 }); colWidths.push({ width: 18 }); }
    ws.columns = colWidths;
  }

  /** Export staff attendance grid as CSV */
  async exportStaffAttendanceGrid(date: Date): Promise<string> {
    const grid = await this.getStaffAttendanceDailyGrid(date);
    const totals = await this.getStaffAttendanceTotals(date);

    const d = toUTCMidnight(date);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];

    const dailyHeader = 'Day,ID,Staff Name,Role,CheckIn Morning,CheckOut Morning,CheckIn Afternoon,CheckOut Afternoon,Location';
    const fmtCell = (time: string | null, status: string | null) => {
      if (!status) return '';
      if (status === 'ABSENT') return 'Absent';
      if (isDayOffStatus(status)) return 'Permission';
      if (status === 'LATE') return time ? `${time} (Late)` : 'Late';
      return time || 'Present';
    };
    const dailyRows = grid.map(r =>
      `"${dayName}","${r.staffNumber}","${r.staffName}","${r.role}","${fmtCell(r.checkInMorning, r.session1Status)}","${fmtCell(r.checkOutMorning, r.session2Status)}","${fmtCell(r.checkInAfternoon, r.session3Status)}","${fmtCell(r.checkOutAfternoon, r.session4Status)}","${r.scanLocation || ''}"`,
    );

    const hasAtt = (r: any) => [r.session1Status, r.session2Status, r.session3Status, r.session4Status].some((s: string) => s === 'PRESENT' || s === 'LATE');
    const isLate = (r: any) => [r.session1Status, r.session2Status, r.session3Status, r.session4Status].some((s: string) => s === 'LATE');
    const present = grid.filter(r => hasAtt(r) && !isLate(r)).length;
    const late = grid.filter(r => hasAtt(r) && isLate(r)).length;
    const permission = grid.filter(r => [r.session1Status, r.session2Status, r.session3Status, r.session4Status].some((s: string) => isDayOffStatus(s))).length;
    const absent = grid.length - present - late - permission;
    const dailySummary = `\n"Total Staff: ${grid.length}","Present: ${present}","Present (Late): ${late}","Absent: ${absent}","Permission: ${permission}"`;

    const totalsHeader = '\nID,Staff Name,Role,Week Present,Week Present (Late),Week Absent,Week Permission,Month Present,Month Present (Late),Month Absent,Month Permission,Year Present,Year Present (Late),Year Absent,Year Permission';
    const totalsRows = totals.map(r =>
      `"${r.staffNumber}","${r.staffName}","${r.role}","${r.week.present}","${r.week.late}","${r.week.absent}","${r.week.dayOff || 0}","${r.month.present}","${r.month.late}","${r.month.absent}","${r.month.dayOff || 0}","${r.year.present}","${r.year.late}","${r.year.absent}","${r.year.dayOff || 0}"`,
    );

    return [dailyHeader, ...dailyRows, dailySummary, totalsHeader, ...totalsRows].join('\n');
  }

  // ========== STAFF XLSX EXPORT ==========

  /** Export staff attendance as XLSX — filtered by period */
  async exportStaffAttendanceXlsx(date: Date, period?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();

    const staff = await this.prisma.user.findMany({
      where: { role: { notIn: ['STUDENT', 'PARENT', 'ADMIN', 'WATTAMAN_REPORTER'] } },
      orderBy: { name: 'asc' },
    });

    // Use study year bounds so the holiday set covers the actual academic year range
    const { yearStart, yearEnd } = await this.getStudyYearBounds(y);
    const yearHolidays = await this.holidaysService.getHolidaysInRange(yearStart, yearEnd);
    const holidayDateSet = new Set(yearHolidays.map(h => h.date.toISOString().split('T')[0]));

    // Fetch format rules for STAFF scope
    const formatRule = await this.sessionConfigService.getFormatRules('STAFF');

    const p = (period || 'daily').toLowerCase();

    if (p === 'daily') {
      await this.buildStaffDailySheet(workbook, staff, d, holidayDateSet, formatRule as any);
    } else if (p === 'weekly') {
      await this.buildStaffWeeklySheet(workbook, staff, d, holidayDateSet, formatRule as any);
    } else if (p === 'monthly') {
      await this.buildStaffMonthlySheet(workbook, staff, d, holidayDateSet, formatRule as any);
    } else if (p === 'yearly') {
      await this.buildStaffYearlySheet(workbook, staff, d, holidayDateSet, formatRule as any);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Staff Daily XLSX sheet */
  private async buildStaffDailySheet(
    workbook: ExcelJS.Workbook, staff: any[], date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Daily');
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayStart.getUTCDay()];

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
    });

    // Headers
    const headerRow1 = ws.addRow([
      'Day', 'ID', 'Staff Name', 'Role',
      'CheckIn Morning', 'CheckOut Afternoon', 'CheckIn Afternoon', 'CheckOut Evening',
      'Total', '', '', '',
    ]);
    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2'); ws.mergeCells('C1:C2'); ws.mergeCells('D1:D2');
    ws.mergeCells('E1:E2'); ws.mergeCells('F1:F2'); ws.mergeCells('G1:G2'); ws.mergeCells('H1:H2');
    ws.mergeCells('I1:L1');
    this.styleHeaderRow(headerRow1);

    const headerRow2 = ws.addRow(['', '', '', '', '', '', '', '', 'Present', 'Absent', 'Late', 'Permission']);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);
    const isFutureDay = dayStart > todayCambodia;
    const isHoliday = holidayDateSet.has(dayStart.toISOString().split('T')[0]);
    const staffConfigs = await this.sessionConfigService.getStaffDefaults();

    const fmtCell = (time: Date | null, status: string | null) => {
      if (!status) return '';
      if (status === 'ABSENT') return 'Absent';
      if (isDayOffStatus(status)) return 'Permission';
      if (status === 'LATE') return time ? `${toCambodiaTimeShort(time)} (Late)` : 'Late';
      return time ? toCambodiaTimeShort(time) || 'Present' : 'Present';
    };

    for (const [idx, user] of staff.entries()) {
      if (isFutureDay) {
        const row = ws.addRow([dayName, String(idx + 1).padStart(4, '0'), user.name, user.role, '', '', '', '', '', '', '', '']);
        this.styleDataRow(row);
        continue;
      }

      const recs = records.filter((r: any) => r.userId === user.id);
      const s1 = recs.find((r: any) => r.session === 1);
      const s3 = recs.find((r: any) => r.session === 3);

      let s1Status = s1?.status || null;
      let s2Status = s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
      let s3Status = s3?.status || null;
      let s4Status = s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

      // Mark overtime sessions as ABSENT
      if (!isHoliday) {
        if (!s1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
        if (!s2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
        if (!s3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
        if (!s4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';
      }

      const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

      const isPresent = dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day') ? 1 : 0;
      const isAbsent = dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)' ? 1 : 0;
      const isLate = dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded') ? 1 : 0;
      const isPermission = dailyStatus === 'Day Off' ? 1 : 0;

      const row = ws.addRow([
        dayName,
        String(idx + 1).padStart(4, '0'),
        user.name,
        user.role,
        fmtCell(s1?.checkInTime, s1Status),
        fmtCell(s1?.checkOutTime, s2Status),
        fmtCell(s3?.checkInTime, s3Status),
        fmtCell(s3?.checkOutTime, s4Status),
        isPresent, isAbsent, isLate, isPermission,
      ]);
      this.styleDataRow(row);
    }

    ws.columns = [
      { width: 12 }, { width: 10 }, { width: 20 }, { width: 12 },
      { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
      { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 },
    ];
  }

  /** Staff Weekly XLSX sheet */
  private async buildStaffWeeklySheet(
    workbook: ExcelJS.Workbook, staff: any[], date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Weekly');
    const d = toUTCMidnight(date);
    const dow = d.getUTCDay();
    const mondayOffset = dow === 0 ? 6 : (dow - 1);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset));

    const weekEnd = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: monday, lt: weekEnd } },
    });
    // Pre-build set of dates when any staff attendance was recorded (skip days before tracking started)
    const activeDates = new Set<string>(records.map((r: any) => toUTCMidnight(new Date(r.date)).toISOString().split('T')[0]));

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayHeaders: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
      dayHeaders.push(`${dayNames[i]} (${dayDate.toISOString().split('T')[0]})`);
    }

    const headerValues: any[] = ['ID', 'Staff Name'];
    for (const dh of dayHeaders) headerValues.push(dh, '', '', '');
    headerValues.push('Total', '', '', '');
    if (formatRule?.enabled) headerValues.push('Converted Absence', '');
    const headerRow1 = ws.addRow(headerValues);

    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2');
    let col = 3;
    for (let i = 0; i < 7; i++) { ws.mergeCells(1, col, 1, col + 3); col += 4; }
    ws.mergeCells(1, col, 1, col + 3);
    if (formatRule?.enabled) { const cc = col + 4; ws.mergeCells(1, cc, 1, cc + 1); }
    this.styleHeaderRow(headerRow1);

    const subValues: any[] = ['', ''];
    for (let i = 0; i < 8; i++) subValues.push('Present', 'Absent', 'Late', 'Permission');
    if (formatRule?.enabled) subValues.push(`${formatRule.permissionsPerAbsent} Perm=1 Absent`, `${formatRule.latesPerAbsentHalf} Late=½ Absent`);
    const headerRow2 = ws.addRow(subValues);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);
    const staffConfigs = await this.sessionConfigService.getStaffDefaults();

    for (const [idx, user] of staff.entries()) {
      const rowVals: any[] = [String(idx + 1).padStart(4, '0'), user.name];
      let totalP = 0, totalA = 0, totalL = 0, totalPerm = 0;
      let hasPastDays = false;

      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayDate = new Date(monday.getTime() + dayIdx * 24 * 60 * 60 * 1000);
        const dayStart = toUTCMidnight(dayDate);
        const dayDateEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        if (dayStart > todayCambodia) { rowVals.push('', '', '', ''); continue; }

        // Skip days when no attendance was taken for the staff (before tracking started)
        if (!activeDates.has(dayStart.toISOString().split('T')[0])) { rowVals.push('', '', '', ''); continue; }
        hasPastDays = true;

        if (holidayDateSet.has(dayStart.toISOString().split('T')[0])) { rowVals.push(0, 0, 0, 0); continue; }

        const dayRecs = records.filter((r: any) => r.userId === user.id && r.date >= dayStart && r.date < dayDateEnd);
        const s1 = dayRecs.find((r: any) => r.session === 1);
        const s3 = dayRecs.find((r: any) => r.session === 3);

        let s1Status = s1?.status || null;
        let s2Status = s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
        let s3Status = s3?.status || null;
        let s4Status = s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

        // Mark overtime sessions as ABSENT
        if (!s1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
        if (!s2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
        if (!s3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
        if (!s4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';

        const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

        const p = dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day') ? 1 : 0;
        const a = dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)' ? 1 : 0;
        const l = dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded') ? 1 : 0;
        const perm = dailyStatus === 'Day Off' ? 1 : 0;

        rowVals.push(p, a, l, perm);
        totalP += p; totalA += a; totalL += l; totalPerm += perm;
      }

      rowVals.push(hasPastDays ? totalP : '', hasPastDays ? totalA : '', hasPastDays ? totalL : '', hasPastDays ? totalPerm : '');
      if (formatRule?.enabled && hasPastDays) {
        const convAbsent = formatRule.permissionsPerAbsent > 0 ? Math.floor(totalPerm / formatRule.permissionsPerAbsent) : 0;
        const convHalf = formatRule.latesPerAbsentHalf > 0 ? Math.floor(totalL / formatRule.latesPerAbsentHalf) : 0;
        rowVals.push(convAbsent, convHalf);
      } else if (formatRule?.enabled) {
        rowVals.push('', '');
      }
      const row = ws.addRow(rowVals);
      this.styleDataRow(row);
    }

    const colWidths = [{ width: 10 }, { width: 20 }];
    for (let i = 0; i < 32; i++) colWidths.push({ width: 10 });
    if (formatRule?.enabled) { colWidths.push({ width: 18 }); colWidths.push({ width: 18 }); }
    ws.columns = colWidths;
  }

  /** Staff Monthly XLSX sheet */
  private async buildStaffMonthlySheet(
    workbook: ExcelJS.Workbook, staff: any[], date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Monthly');
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 1));
    const monthName = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: monthStart, lt: monthEnd } },
    });
    // Pre-build set of dates when any staff attendance was recorded (skip days before tracking started)
    const activeDates = new Set<string>(records.map((r: any) => toUTCMidnight(new Date(r.date)).toISOString().split('T')[0]));

    // Divide month into Sun-Sat weeks
    const weeks: { start: Date; end: Date; label: string }[] = [];
    let cur = new Date(monthStart);
    while (cur < monthEnd) {
      const wkStart = new Date(cur);
      const daysUntilSat = (6 - wkStart.getUTCDay() + 7) % 7;
      let wkEnd = new Date(Date.UTC(wkStart.getUTCFullYear(), wkStart.getUTCMonth(), wkStart.getUTCDate() + daysUntilSat));
      if (wkEnd >= monthEnd) wkEnd = new Date(monthEnd.getTime() - 24 * 60 * 60 * 1000);
      weeks.push({ start: wkStart, end: wkEnd, label: `${wkStart.toISOString().split('T')[0]} to ${wkEnd.toISOString().split('T')[0]}` });
      cur = new Date(wkEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    const headerValues: any[] = ['Month', 'ID', 'Staff Name'];
    for (let i = 0; i < weeks.length; i++) headerValues.push(`Week ${i + 1} (${weeks[i].label})`, '', '', '');
    headerValues.push('Total', '', '', '');
    if (formatRule?.enabled) headerValues.push('Converted Absence', '');
    const headerRow1 = ws.addRow(headerValues);

    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2'); ws.mergeCells('C1:C2');
    let col2 = 4;
    for (let i = 0; i < weeks.length; i++) { ws.mergeCells(1, col2, 1, col2 + 3); col2 += 4; }
    ws.mergeCells(1, col2, 1, col2 + 3);
    if (formatRule?.enabled) { const cc = col2 + 4; ws.mergeCells(1, cc, 1, cc + 1); }
    this.styleHeaderRow(headerRow1);

    const subValues: any[] = ['', '', ''];
    for (let i = 0; i < weeks.length + 1; i++) subValues.push('Present', 'Absent', 'Late', 'Permission');
    if (formatRule?.enabled) subValues.push(`${formatRule.permissionsPerAbsent} Perm=1 Absent`, `${formatRule.latesPerAbsentHalf} Late=½ Absent`);
    const headerRow2 = ws.addRow(subValues);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);
    const staffConfigs = await this.sessionConfigService.getStaffDefaults();

    for (const [idx, user] of staff.entries()) {
      const rowVals: any[] = [monthName, String(idx + 1).padStart(4, '0'), user.name];
      let totalP = 0, totalA = 0, totalL = 0, totalPerm = 0;
      let hasPastDays = false;

      for (const week of weeks) {
        let wP = 0, wA = 0, wL = 0, wPerm = 0;
        let daysCounted = 0;
        let curDay = new Date(week.start);
        const wkEndNext = new Date(week.end.getTime() + 24 * 60 * 60 * 1000);
        while (curDay < wkEndNext && curDay < monthEnd) {
          const dayStart = toUTCMidnight(curDay);
          if (dayStart > todayCambodia) { curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000); continue; }
          // Skip days when no attendance was taken for the staff (before tracking started)
          if (!activeDates.has(dayStart.toISOString().split('T')[0])) { curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000); continue; }
          if (holidayDateSet.has(dayStart.toISOString().split('T')[0])) { curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000); continue; }
          daysCounted++;
          hasPastDays = true;
          const dayDateEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const dayRecs = records.filter((r: any) => r.userId === user.id && r.date >= dayStart && r.date < dayDateEnd);
          const s1 = dayRecs.find((r: any) => r.session === 1);
          const s3 = dayRecs.find((r: any) => r.session === 3);

          let s1Status = s1?.status || null;
          let s2Status = s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
          let s3Status = s3?.status || null;
          let s4Status = s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

          // Mark overtime sessions as ABSENT
          if (!s1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
          if (!s2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
          if (!s3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
          if (!s4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';

          const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });
          if (dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day')) wP++;
          else if (dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)') wA++;
          if (dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded')) wL++;
          if (dailyStatus === 'Day Off') wPerm++;

          curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000);
        }
        rowVals.push(daysCounted > 0 ? wP : '', daysCounted > 0 ? wA : '', daysCounted > 0 ? wL : '', daysCounted > 0 ? wPerm : '');
        totalP += wP; totalA += wA; totalL += wL; totalPerm += wPerm;
      }

      rowVals.push(hasPastDays ? totalP : '', hasPastDays ? totalA : '', hasPastDays ? totalL : '', hasPastDays ? totalPerm : '');
      if (formatRule?.enabled && hasPastDays) {
        const convAbsent = formatRule.permissionsPerAbsent > 0 ? Math.floor(totalPerm / formatRule.permissionsPerAbsent) : 0;
        const convHalf = formatRule.latesPerAbsentHalf > 0 ? Math.floor(totalL / formatRule.latesPerAbsentHalf) : 0;
        rowVals.push(convAbsent, convHalf);
      } else if (formatRule?.enabled) {
        rowVals.push('', '');
      }
      const row = ws.addRow(rowVals);
      this.styleDataRow(row);
    }

    const colWidths = [{ width: 12 }, { width: 10 }, { width: 20 }];
    for (let i = 0; i < (weeks.length + 1) * 4; i++) colWidths.push({ width: 10 });
    if (formatRule?.enabled) { colWidths.push({ width: 18 }); colWidths.push({ width: 18 }); }
    ws.columns = colWidths;
  }

  /** Staff Yearly XLSX sheet */
  private async buildStaffYearlySheet(
    workbook: ExcelJS.Workbook, staff: any[], date: Date, holidayDateSet: Set<string>,
    formatRule?: { permissionsPerAbsent: number; latesPerAbsentHalf: number; enabled: boolean },
  ) {
    const ws = workbook.addWorksheet('Yearly');
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const { yearStart, yearEnd } = await this.getStudyYearBounds(y);

    const records = await this.prisma.staffAttendance.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
    });
    // Pre-build set of dates when any staff attendance was recorded (skip days before tracking started)
    const activeDates = new Set<string>(records.map((r: any) => toUTCMidnight(new Date(r.date)).toISOString().split('T')[0]));

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const headerValues: any[] = ['Year', 'ID', 'Staff Name'];
    for (const mn of monthNames) headerValues.push(mn, '', '', '');
    headerValues.push('Total', '', '', '');
    if (formatRule?.enabled) headerValues.push('Converted Absence', '');
    const headerRow1 = ws.addRow(headerValues);

    ws.mergeCells('A1:A2'); ws.mergeCells('B1:B2'); ws.mergeCells('C1:C2');
    let col3 = 4;
    for (let i = 0; i < 12; i++) { ws.mergeCells(1, col3, 1, col3 + 3); col3 += 4; }
    ws.mergeCells(1, col3, 1, col3 + 3);
    if (formatRule?.enabled) { const cc = col3 + 4; ws.mergeCells(1, cc, 1, cc + 1); }
    this.styleHeaderRow(headerRow1);

    const subValues: any[] = ['', '', ''];
    for (let i = 0; i < 13; i++) subValues.push('Present', 'Absent', 'Late', 'Permission');
    if (formatRule?.enabled) subValues.push(`${formatRule.permissionsPerAbsent} Perm=1 Absent`, `${formatRule.latesPerAbsentHalf} Late=½ Absent`);
    const headerRow2 = ws.addRow(subValues);
    this.styleHeaderRow(headerRow2, 'FFFFFF');

    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);
    const staffConfigs = await this.sessionConfigService.getStaffDefaults();

    for (const [idx, user] of staff.entries()) {
      const rowVals: any[] = [String(y), String(idx + 1).padStart(4, '0'), user.name];
      let totalP = 0, totalA = 0, totalL = 0, totalPerm = 0;
      let hasPastDays = false;

      for (let mi = 0; mi < 12; mi++) {
        const mStart = new Date(Date.UTC(y, mi, 1));
        const mEnd = new Date(Date.UTC(y, mi + 1, 1));

        if (mStart > todayCambodia) { rowVals.push('', '', '', ''); continue; }

        let mP = 0, mA = 0, mL = 0, mPerm = 0;
        let monthHasPast = false;
        let curDay = new Date(mStart);
        while (curDay < mEnd) {
          const dayStart = toUTCMidnight(curDay);
          if (dayStart > todayCambodia) { curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000); continue; }
          // Skip days when no attendance was taken for the staff (before tracking started)
          if (!activeDates.has(dayStart.toISOString().split('T')[0])) { curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000); continue; }
          monthHasPast = true;
          hasPastDays = true;
          if (holidayDateSet.has(dayStart.toISOString().split('T')[0])) { curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000); continue; }

          const dayDateEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          const dayRecs = records.filter((r: any) => r.userId === user.id && r.date >= dayStart && r.date < dayDateEnd);
          const s1 = dayRecs.find((r: any) => r.session === 1);
          const s3 = dayRecs.find((r: any) => r.session === 3);

          let s1Status = s1?.status || null;
          let s2Status = s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
          let s3Status = s3?.status || null;
          let s4Status = s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

          // Mark overtime sessions as ABSENT
          if (!s1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
          if (!s2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
          if (!s3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
          if (!s4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';

          const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });
          if (dailyStatus === 'Present' || dailyStatus.startsWith('Half-Day')) mP++;
          else if (dailyStatus === 'Absent' || dailyStatus === 'Absent (Exceeded Late Limit)') mA++;
          if (dailyStatus.includes('Late') && !dailyStatus.includes('Exceeded')) mL++;
          if (dailyStatus === 'Day Off') mPerm++;

          curDay = new Date(curDay.getTime() + 24 * 60 * 60 * 1000);
        }
        rowVals.push(monthHasPast ? mP : '', monthHasPast ? mA : '', monthHasPast ? mL : '', monthHasPast ? mPerm : '');
        if (monthHasPast) { totalP += mP; totalA += mA; totalL += mL; totalPerm += mPerm; }
      }

      rowVals.push(hasPastDays ? totalP : '', hasPastDays ? totalA : '', hasPastDays ? totalL : '', hasPastDays ? totalPerm : '');
      if (formatRule?.enabled && hasPastDays) {
        const convAbsent = formatRule.permissionsPerAbsent > 0 ? Math.floor(totalPerm / formatRule.permissionsPerAbsent) : 0;
        const convHalf = formatRule.latesPerAbsentHalf > 0 ? Math.floor(totalL / formatRule.latesPerAbsentHalf) : 0;
        rowVals.push(convAbsent, convHalf);
      } else if (formatRule?.enabled) {
        rowVals.push('', '');
      }
      const row = ws.addRow(rowVals);
      this.styleDataRow(row);
    }

    const colWidths = [{ width: 10 }, { width: 10 }, { width: 20 }];
    for (let i = 0; i < 52; i++) colWidths.push({ width: 10 });
    if (formatRule?.enabled) { colWidths.push({ width: 18 }); colWidths.push({ width: 18 }); }
    ws.columns = colWidths;
  }

  // ========== EMPLOYEE SELF-SERVICE REPORTS ==========

  /** Get daily grid for a single employee (same shape as staff grid, single row) */
  async getEmployeeDailyGrid(userId: string, date: Date) {
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const isHoliday = await this.holidaysService.isHoliday(date);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return [];

    const records = await this.prisma.staffAttendance.findMany({
      where: { userId, date: { gte: dayStart, lt: dayEnd } },
    });

    const staffConfigs = await this.sessionConfigService.getStaffDefaults();
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);

    const s1 = records.find(r => r.session === 1);
    const s3 = records.find(r => r.session === 3);

    const locRecord = s1?.scanLocation ? s1 : s3?.scanLocation ? s3 : s1 || s3;

    let session1Status = s1?.status || null;
    let session2Status = s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
    let session3Status = s3?.status || null;
    let session4Status = s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

    if (!isHoliday) {
      if (!session1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session1Status = 'ABSENT';
      if (!session2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session2Status = 'ABSENT';
      if (!session3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session3Status = 'ABSENT';
      if (!session4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) session4Status = 'ABSENT';
    }

    return [{
      userId: user.id,
      staffName: user.name,
      role: user.role,
      checkInMorning: s1 && s1.status !== 'ABSENT' ? toCambodiaTimeShort(s1.checkInTime) : null,
      checkOutMorning: s1 ? toCambodiaTimeShort(s1.checkOutTime) : null,
      checkInAfternoon: s3 && s3.status !== 'ABSENT' ? toCambodiaTimeShort(s3.checkInTime) : null,
      checkOutAfternoon: s3 ? toCambodiaTimeShort(s3.checkOutTime) : null,
      session1Status,
      session2Status,
      session3Status,
      session4Status,
      isHoliday,
      scanLatitude: locRecord?.scanLatitude || null,
      scanLongitude: locRecord?.scanLongitude || null,
      scanLocation: locRecord?.scanLocation || null,
    }];
  }

  /** Get attendance totals for a single employee: week/month/year */
  async getEmployeeTotals(userId: string, date: Date) {
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const dow = d.getUTCDay();

    const weekStart = new Date(Date.UTC(y, m, day - ((dow + 6) % 7)));
    const weekEnd = new Date(Date.UTC(y, m, day - ((dow + 6) % 7) + 7));
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 1));
    const yearStart = new Date(Date.UTC(y, 0, 1));
    const yearEnd = new Date(Date.UTC(y + 1, 0, 1));

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return [];

    const [weekRecs, monthRecs, yearRecs] = await Promise.all([
      this.prisma.staffAttendance.findMany({ where: { userId, date: { gte: weekStart, lt: weekEnd } } }),
      this.prisma.staffAttendance.findMany({ where: { userId, date: { gte: monthStart, lt: monthEnd } } }),
      this.prisma.staffAttendance.findMany({ where: { userId, date: { gte: yearStart, lt: yearEnd } } }),
    ]);

    const yearHolidays = await this.holidaysService.getHolidaysInRange(yearStart, yearEnd);
    const holidayDateSet = new Set(yearHolidays.map(h => h.date.toISOString().split('T')[0]));

    const countFor = (recs: any[]) => ({
      present: recs.filter(r => r.status === 'PRESENT').length,
      late: recs.filter(r => r.status === 'LATE').length,
      absent: recs.filter(r => r.status === 'ABSENT' && !holidayDateSet.has(r.date.toISOString().split('T')[0])).length,
      dayOff: countPermissionDayEquivalents(recs as any, (r: any) => r.userId),
    });

    return [{
      userId: user.id,
      staffName: user.name,
      role: user.role,
      week: countFor(weekRecs),
      month: countFor(monthRecs),
      year: countFor(yearRecs),
    }];
  }

  /** Export single employee attendance XLSX */
  async exportEmployeeXlsx(userId: string, date: Date, period?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const d = toUTCMidnight(date);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const y = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(y, 0, 1));
    const yearEnd = new Date(Date.UTC(y + 1, 0, 1));
    const yearHolidays = await this.holidaysService.getHolidaysInRange(yearStart, yearEnd);
    const holidayDateSet = new Set(yearHolidays.map(h => h.date.toISOString().split('T')[0]));

    const p = (period || 'daily').toLowerCase();

    if (p === 'daily') {
      await this.buildEmployeeDailySheet(workbook, user, d, holidayDateSet);
    } else if (p === 'weekly') {
      await this.buildEmployeePeriodSheet(workbook, user, d, holidayDateSet, 'weekly');
    } else if (p === 'monthly') {
      await this.buildEmployeePeriodSheet(workbook, user, d, holidayDateSet, 'monthly');
    } else if (p === 'yearly') {
      await this.buildEmployeePeriodSheet(workbook, user, d, holidayDateSet, 'yearly');
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async buildEmployeeDailySheet(
    workbook: ExcelJS.Workbook, user: any, date: Date, holidayDateSet: Set<string>,
  ) {
    const ws = workbook.addWorksheet('Daily');
    const dayStart = toUTCMidnight(date);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayStart.getUTCDay()];

    const headerRow = ws.addRow(['Day', 'Name', 'Role', 'Morning In', 'Morning Out', 'Afternoon In', 'Afternoon Out', 'Status']);
    this.styleHeaderRow(headerRow);

    const records = await this.prisma.staffAttendance.findMany({
      where: { userId: user.id, date: { gte: dayStart, lt: dayEnd } },
    });

    const s1 = records.find(r => r.session === 1);
    const s3 = records.find(r => r.session === 3);

    const staffConfigs = await this.sessionConfigService.getStaffDefaults();
    const now = new Date();
    const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayCambodia = new Date(Date.UTC(cambodiaNow.getUTCFullYear(), cambodiaNow.getUTCMonth(), cambodiaNow.getUTCDate()));
    const cambodiaNowHHMM = cambodiaNow.toISOString().slice(11, 16);
    const isHoliday = holidayDateSet.has(dayStart.toISOString().split('T')[0]);

    let s1Status = s1?.status || null;
    let s2Status = s1?.checkOutTime ? (s1.status || 'PRESENT') : null;
    let s3Status = s3?.status || null;
    let s4Status = s3?.checkOutTime ? (s3.status || 'PRESENT') : null;

    if (!isHoliday) {
      if (!s1Status && isSessionOvertime(1, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s1Status = 'ABSENT';
      if (!s2Status && isSessionOvertime(2, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s2Status = 'ABSENT';
      if (!s3Status && isSessionOvertime(3, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s3Status = 'ABSENT';
      if (!s4Status && isSessionOvertime(4, staffConfigs, dayStart, todayCambodia, cambodiaNowHHMM)) s4Status = 'ABSENT';
    }

    const fmtCell = (time: Date | null, status: string | null) => {
      if (!status) return '';
      if (status === 'ABSENT') return 'Absent';
      if (isDayOffStatus(status)) return 'Permission';
      if (status === 'LATE') return time ? `${toCambodiaTimeShort(time)} (Late)` : 'Late';
      return time ? toCambodiaTimeShort(time) || 'Present' : 'Present';
    };

    const dailyStatus = this.determineDailyStatus({ session1Status: s1Status, session2Status: s2Status, session3Status: s3Status, session4Status: s4Status });

    const row = ws.addRow([
      dayName, user.name, user.role,
      fmtCell(s1?.checkInTime, s1Status),
      fmtCell(s1?.checkOutTime, s2Status),
      fmtCell(s3?.checkInTime, s3Status),
      fmtCell(s3?.checkOutTime, s4Status),
      dailyStatus,
    ]);
    this.styleDataRow(row);

    ws.columns = [
      { width: 12 }, { width: 25 }, { width: 15 },
      { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 20 },
    ];
  }

  private async buildEmployeePeriodSheet(
    workbook: ExcelJS.Workbook, user: any, date: Date, holidayDateSet: Set<string>, period: string,
  ) {
    const ws = workbook.addWorksheet(period.charAt(0).toUpperCase() + period.slice(1));
    const d = toUTCMidnight(date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const dow = d.getUTCDay();

    let start: Date, end: Date, label: string;
    if (period === 'weekly') {
      start = new Date(Date.UTC(y, m, day - ((dow + 6) % 7)));
      end = new Date(Date.UTC(y, m, day - ((dow + 6) % 7) + 7));
      label = `Week of ${start.toISOString().split('T')[0]}`;
    } else if (period === 'monthly') {
      start = new Date(Date.UTC(y, m, 1));
      end = new Date(Date.UTC(y, m + 1, 1));
      label = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]} ${y}`;
    } else {
      start = new Date(Date.UTC(y, 0, 1));
      end = new Date(Date.UTC(y + 1, 0, 1));
      label = `Year ${y}`;
    }

    const headerRow = ws.addRow(['Period', 'Name', 'Role', 'Present', 'Late', 'Absent', 'Permission']);
    this.styleHeaderRow(headerRow);

    const recs = await this.prisma.staffAttendance.findMany({
      where: { userId: user.id, date: { gte: start, lt: end } },
    });

    const present = recs.filter(r => r.status === 'PRESENT').length;
    const late = recs.filter(r => r.status === 'LATE').length;
    const absent = recs.filter(r => r.status === 'ABSENT' && !holidayDateSet.has(r.date.toISOString().split('T')[0])).length;
    const dayOff = recs.filter(r => isDayOffStatus(r.status)).length;

    const row = ws.addRow([label, user.name, user.role, present, late, absent, dayOff]);
    this.styleDataRow(row);

    ws.columns = [
      { width: 25 }, { width: 25 }, { width: 15 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
    ];
  }
}
