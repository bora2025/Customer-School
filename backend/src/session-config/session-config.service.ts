import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DirectoryService } from '../directory/directory.service';

const DEFAULT_CONFIGS = [
  { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
  { session: 2, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:15' },
  { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
  { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:15' },
];

const STAFF_DEFAULT_CONFIGS = [
  { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:30' },
  { session: 2, type: 'CHECK_OUT', startTime: '11:30', endTime: '12:00' },
  { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:30' },
  { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:30' },
];

@Injectable()
export class SessionConfigService {
  constructor(private prisma: PrismaService, private readonly directory: DirectoryService) {}

  /** Deduplicate configs by session number — keeps the last (most recent) entry per session */
  private dedup(configs: any[]): any[] {
    const map = new Map<number, any>();
    for (const c of configs) map.set(c.session, c);
    return Array.from(map.values()).sort((a, b) => a.session - b.session);
  }

  /** Get session configs for a class.
   *  Class-specific configs override global per session; missing sessions are filled from global.
   *  This guarantees all 4 session slots are always present so CHECK_OUT sessions
   *  are never silently dropped when a class only has partial overrides.
   */
  async getConfigs(classId?: string): Promise<any[]> {
    // Resolve global base (DB globals → hardcoded defaults)
    const globalConfigs = await this.prisma.sessionConfig.findMany({
      where: { classId: null, scope: 'CLASS' },
      orderBy: { session: 'asc' },
    });
    const globalBase: any[] = globalConfigs.length > 0
      ? this.dedup(globalConfigs)
      : DEFAULT_CONFIGS.map((d, i) => ({ id: `default-${i}`, classId: null, scope: 'CLASS', ...d }));

    // If no classId, just return global
    if (!classId) return globalBase;

    // Fetch class-specific overrides
    const classConfigs = await this.prisma.sessionConfig.findMany({
      where: { classId, scope: 'CLASS' },
      orderBy: { session: 'asc' },
    });

    // No class-specific overrides → use global as-is
    if (classConfigs.length === 0) return globalBase;

    // Merge: class-specific overrides global per session; global fills any gaps
    const classMap = new Map<number, any>(classConfigs.map(c => [c.session, c]));
    const merged = globalBase.map(g => classMap.has(g.session) ? classMap.get(g.session) : g);
    // Also include any class-specific sessions not in globalBase (unusual but safe)
    for (const cc of classConfigs) {
      if (!merged.find((m: any) => m.session === cc.session)) merged.push(cc);
    }
    return merged.sort((a: any, b: any) => a.session - b.session);
  }

  /** Get global defaults only */
  async getGlobalDefaults(): Promise<any[]> {
    const configs = await this.prisma.sessionConfig.findMany({
      where: { classId: null, scope: 'CLASS' },
      orderBy: { session: 'asc' },
    });
    if (configs.length > 0) return this.dedup(configs);
    return DEFAULT_CONFIGS.map((d, i) => ({ id: `default-${i}`, classId: null, scope: 'CLASS', ...d }));
  }

  /** Get staff session defaults */
  async getStaffDefaults(): Promise<any[]> {
    const configs = await this.prisma.sessionConfig.findMany({
      where: { classId: null, scope: 'STAFF' },
      orderBy: { session: 'asc' },
    });
    if (configs.length > 0) return this.dedup(configs);
    return STAFF_DEFAULT_CONFIGS.map((d, i) => ({ id: `staff-default-${i}`, classId: null, scope: 'STAFF', ...d }));
  }

  /** Upsert session config (global or per-class) */
  async upsertConfig(data: {
    classId?: string | null;
    session: number;
    type: string;
    startTime: string;
    endTime: string;
    scope?: string;
  }) {
    const classId = data.classId || null;
    const scope = data.scope || 'CLASS';

    // Prisma compound unique doesn't support null in where, so use findFirst + update/create
    const existing = await this.prisma.sessionConfig.findFirst({
      where: { classId, session: data.session, scope },
    });

    if (existing) {
      return this.prisma.sessionConfig.update({
        where: { id: existing.id },
        data: {
          type: data.type,
          startTime: data.startTime,
          endTime: data.endTime,
        },
      });
    }

    return this.prisma.sessionConfig.create({
      data: {
        classId,
        session: data.session,
        type: data.type,
        startTime: data.startTime,
        endTime: data.endTime,
        scope,
      },
    });
  }

  /** Save all 4 sessions at once — delete old rows first to prevent duplicates */
  async saveAllConfigs(
    configs: Array<{ session: number; type: string; startTime: string; endTime: string }>,
    classId?: string | null,
    scope?: string,
  ) {
    const cid = classId || null;
    const sc = scope || 'CLASS';

    // Delete all existing configs for this classId + scope to avoid duplicates
    await this.prisma.sessionConfig.deleteMany({
      where: { classId: cid, scope: sc },
    });

    // Create fresh rows in a single batch
    await this.prisma.sessionConfig.createMany({
      data: configs.map(cfg => ({
        classId: cid,
        session: cfg.session,
        type: cfg.type,
        startTime: cfg.startTime,
        endTime: cfg.endTime,
        scope: sc,
      })),
    });
    return this.prisma.sessionConfig.findMany({ where: { classId: cid, scope: sc }, orderBy: { session: 'asc' } });
  }

  /** Delete class-specific overrides (revert to global) */
  async deleteClassConfigs(classId: string) {
    return this.prisma.sessionConfig.deleteMany({ where: { classId } });
  }

  // ========== ATTENDANCE FORMAT RULES ==========

  async getUserOrganizationId(userId: string): Promise<string | null> {
    return this.directory.departmentForUser(userId);
  }

  /** Get attendance format rules for a scope (CLASS or STAFF) */
  async getFormatRules(scope: string, organizationId?: string | null) {
    const orgId = organizationId || null;

    // Use findFirst to handle nullable organizationId (PostgreSQL NULL != NULL in unique indexes)
    const rule = await this.prisma.attendanceFormatRule.findFirst({
      where: { scope, organizationId: orgId },
    });
    if (rule) return rule;

    // Fallback to global scope defaults when organization-specific record does not exist.
    if (orgId) {
      const globalRule = await this.prisma.attendanceFormatRule.findFirst({
        where: { scope, organizationId: null },
      });
      if (globalRule) return globalRule;
    }

    // Return defaults
    return {
      id: null,
      scope,
      organizationId: orgId,
      permissionsPerAbsent: 3,
      latesPerAbsentHalf: 3,
      absentSessionsForDayAbsent: 3,
      teacherLateGraceMinutes: 20,
      caseStudyABEnabled: true,
      enabled: false,
    };
  }

  /** Get all format rules (both CLASS and STAFF) */
  async getAllFormatRules(organizationId?: string | null) {
    const [classRule, staffRule] = await Promise.all([
      this.getFormatRules('CLASS', organizationId),
      this.getFormatRules('STAFF', organizationId),
    ]);
    return { CLASS: classRule, STAFF: staffRule };
  }

  /** Upsert attendance format rules for a scope */
  async saveFormatRules(data: {
    scope: string;
    organizationId?: string | null;
    permissionsPerAbsent: number;
    latesPerAbsentHalf: number;
    absentSessionsForDayAbsent?: number;
    teacherLateGraceMinutes?: number;
    caseStudyABEnabled: boolean;
    enabled: boolean;
  }) {
    const orgId = data.organizationId || null;
    // Use findFirst + update/create to handle nullable organizationId (PostgreSQL NULL != NULL in unique indexes)
    const existing = await this.prisma.attendanceFormatRule.findFirst({
      where: { scope: data.scope, organizationId: orgId },
    });
    const payload = {
      permissionsPerAbsent: data.permissionsPerAbsent,
      latesPerAbsentHalf: data.latesPerAbsentHalf,
      absentSessionsForDayAbsent: data.absentSessionsForDayAbsent ?? 3,
      teacherLateGraceMinutes: data.teacherLateGraceMinutes ?? 20,
      caseStudyABEnabled: data.caseStudyABEnabled,
      enabled: data.enabled,
    };
    if (existing) {
      return this.prisma.attendanceFormatRule.update({
        where: { id: existing.id },
        data: payload,
      });
    }
    return this.prisma.attendanceFormatRule.create({
      data: { scope: data.scope, organizationId: orgId, ...payload },
    });
  }

  // ─── Staff weekly schedule (global) ────────────────────────────────────────
  // Single-row config controlling which weekdays count as working days for staff
  // attendance reports. Defaults to SAT/SUN as 'day-off' when no row exists.
  private static readonly STAFF_SCHEDULE_DEFAULT: Record<string, string> = {
    MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'day-off', SUN: 'day-off',
  };
  private static readonly STAFF_SCHEDULE_ID = 'default';

  async getStaffWeeklySchedule(): Promise<{ schedule: Record<string, string>; isDefault: boolean }> {
    const row = await this.prisma.staffWeeklySchedule.findUnique({
      where: { id: SessionConfigService.STAFF_SCHEDULE_ID },
    });
    if (!row) {
      return { schedule: { ...SessionConfigService.STAFF_SCHEDULE_DEFAULT }, isDefault: true };
    }
    try {
      const parsed = JSON.parse(row.schedule);
      if (parsed && typeof parsed === 'object') {
        // Merge over default so missing keys fall back gracefully
        return { schedule: { ...SessionConfigService.STAFF_SCHEDULE_DEFAULT, ...parsed }, isDefault: false };
      }
    } catch { /* fall through */ }
    return { schedule: { ...SessionConfigService.STAFF_SCHEDULE_DEFAULT }, isDefault: true };
  }

  async saveStaffWeeklySchedule(schedule: Record<string, string>) {
    // Whitelist keys + values to keep storage clean.
    const allowedDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const allowedValues = new Set(['same', 'day-off', 'full-day', 'morning-only', 'afternoon-only', 'evening', 'night-shift']);
    const cleaned: Record<string, string> = { ...SessionConfigService.STAFF_SCHEDULE_DEFAULT };
    for (const day of allowedDays) {
      const v = schedule?.[day];
      if (typeof v === 'string' && allowedValues.has(v)) cleaned[day] = v;
    }
    const json = JSON.stringify(cleaned);
    await this.prisma.staffWeeklySchedule.upsert({
      where: { id: SessionConfigService.STAFF_SCHEDULE_ID },
      update: { schedule: json },
      create: { id: SessionConfigService.STAFF_SCHEDULE_ID, schedule: json },
    });
    return { schedule: cleaned, isDefault: false };
  }
}
