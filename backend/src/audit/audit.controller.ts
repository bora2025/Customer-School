import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards, Res, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../database/prisma.service';
import { getDistribution } from '../config/environment';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  // In-memory cache for the heavy aggregate endpoints. Audit data is
  // append-only and the UI doesn't need millisecond freshness here.
  private facetsCache: { at: number; data: any } | null = null;
  private statsCache: { at: number; data: any } | null = null;
  private static readonly AGG_TTL_MS = 60_000; // 1 min

  /** Paginated, filtered list of audit log entries. */
  @Get('logs')
  async list(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('resourceId') resourceId?: string,
    @Query('success') success?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    const where = this.buildWhere({ actorId, action, resource, resourceId, success, from, to, q });
    const take = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pageNum - 1) * take;
    const hasFilters = Object.keys(where).length > 0;
    const [rawItems, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        // Exclude heavy JSON columns (changes, metadata) and userAgent from
        // the list view — they're only shown in the per-row expanded panel.
        // Loading them for every row blew up the response from ~50KB to MBs.
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          actorRole: true,
          actorName: true,
          actorEmail: true,
          action: true,
          resource: true,
          resourceId: true,
          resourceLabel: true,
          method: true,
          path: true,
          statusCode: true,
          ip: true,
          success: true,
          errorMessage: true,
        },
      }),
      hasFilters ? this.prisma.auditLog.count({ where }) : this.estimatedCount('AuditLog'),
    ]);
    const items = await this.enrichLabels(rawItems as any);
    return { items, total, page: pageNum, pageSize: take, pages: Math.ceil(total / take) };
  }

  /** Full detail for a single log entry (includes heavy JSON columns). */
  @Get('logs/:id')
  async getOne(@Param('id') id: string) {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }

  /** Cheap row-count estimate from pg_class. Falls back to a real count on error. */
  private async estimatedCount(table: string): Promise<number> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ estimate: bigint | number }>>(
        `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
        table,
      );
      const v = rows?.[0]?.estimate;
      if (v !== undefined && v !== null) return Number(v);
    } catch { /* ignore */ }
    return this.prisma.auditLog.count();
  }

  /** Distinct values for filter dropdowns. */
  @Get('logs/facets')
  async facets() {
    if (this.facetsCache && Date.now() - this.facetsCache.at < AuditController.AGG_TTL_MS) {
      return this.facetsCache.data;
    }
    // Scope to the last 30 days so DISTINCT uses the createdAt index and
    // doesn't scan the entire table on every page load.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = { createdAt: { gte: since } };
    const [actions, resources, actors] = await Promise.all([
      this.prisma.auditLog.findMany({ where: recent, select: { action: true }, distinct: ['action'], orderBy: { action: 'asc' } }),
      this.prisma.auditLog.findMany({ where: recent, select: { resource: true }, distinct: ['resource'], orderBy: { resource: 'asc' } }),
      this.prisma.auditLog.findMany({
        where: { ...recent, actorId: { not: null } },
        select: { actorId: true, actorName: true, actorEmail: true, actorRole: true },
        distinct: ['actorId'],
        orderBy: { actorName: 'asc' },
        take: 500,
      }),
    ]);
    const data = {
      actions: actions.map((r) => r.action),
      resources: resources.map((r) => r.resource),
      actors,
    };
    this.facetsCache = { at: Date.now(), data };
    return data;
  }

  /** Stream a CSV of the current filter set (max 50k rows). */
  @Get('logs/export.csv')
  async exportCsv(
    @Res() res: Response,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('resourceId') resourceId?: string,
    @Query('success') success?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    const where = this.buildWhere({ actorId, action, resource, resourceId, success, from, to, q });
    const rawRows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50000,
    });
    const rows = await this.enrichLabels(rawRows);
    const header = [
      'Timestamp', 'Actor', 'Email', 'Role', 'Action', 'Resource', 'Resource ID',
      'Resource Label', 'Method', 'Path', 'Status', 'Success', 'IP', 'Error',
    ].join(',');
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = rows.map((r) => [
      r.createdAt.toISOString(), esc(r.actorName), esc(r.actorEmail), esc(r.actorRole),
      esc(r.action), esc(r.resource), esc(r.resourceId), esc(r.resourceLabel),
      esc(r.method), esc(r.path), esc(r.statusCode), r.success ? 'true' : 'false',
      esc(r.ip), esc(r.errorMessage),
    ].join(','));
    const csv = '\uFEFF' + [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
    res.send(csv);
  }

  /** Aggregate stats for the dashboard card. */
  @Get('logs/stats')
  async stats() {
    if (this.statsCache && Date.now() - this.statsCache.at < AuditController.AGG_TTL_MS) {
      return this.statsCache.data;
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sinceWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [last24h, last7d, failures24h, byAction] = await Promise.all([
      this.prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: sinceWeek } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: since }, success: false } }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where: { createdAt: { gte: sinceWeek } },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
    ]);
    const data = {
      last24h,
      last7d,
      failures24h,
      byAction: byAction.map((b) => ({ action: b.action, count: b._count.action })),
    };
    this.statsCache = { at: Date.now(), data };
    return data;
  }

  /**
   * Portal activity monitor — gives Admins a per-portal (TEACHER / STUDENT /
   * PARENT / CLASS) overview of what's happening across the system using the
   * existing audit log as the source of truth.
   *
   * Returns event counts, distinct actor counts, top actions/resources, a
   * health badge, and the last N events for each portal.
   */
  @Get('portal-activity')
  async portalActivity(@Query('window') window = '24h') {
    const hours = window === '7d' ? 24 * 7 : window === '1h' ? 1 : 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Each portal is defined by (a) the actor roles that own it and
    // (b) the resources users in that portal typically act on. We OR them
    // together so we capture both teacher-as-actor and a teacher-resource
    // touched by an admin assist.
    const portals: {
      key: string; label: string; icon: string;
      roles: string[]; resources: string[];
    }[] = [
      {
        key: 'TEACHER', label: 'Teachers', icon: '📚',
        roles: ['TEACHER'],
        resources: ['ASSIGNMENTS', 'COURSES', 'EXAM', 'EXAMS', 'SCORING'],
      },
      {
        key: 'STUDENT', label: 'Students', icon: '🎓',
        roles: ['STUDENT'],
        resources: ['ASSIGNMENTS', 'COURSES', 'STUDENTS'],
      },
      {
        key: 'PARENT', label: 'Parents', icon: '👪',
        roles: ['PARENT'],
        resources: ['FEES', 'PARENT', 'PARENTS', 'NOTIFICATION-PREFERENCE'],
      },
    ];

    const result = await Promise.all(
      portals.map(async (p) => {
        const where: any = { createdAt: { gte: since } };
        const or: any[] = [];
        if (p.roles.length) or.push({ actorRole: { in: p.roles } });
        if (p.resources.length) or.push({ resource: { in: p.resources } });
        if (or.length) where.OR = or;

        const [eventCount, failureCount, distinctActors, byAction, byResource, recent] = await Promise.all([
          this.prisma.auditLog.count({ where }),
          this.prisma.auditLog.count({ where: { ...where, success: false } }),
          this.prisma.auditLog.findMany({
            where: { ...where, actorId: { not: null } },
            select: { actorId: true },
            distinct: ['actorId'],
            take: 1000,
          }),
          this.prisma.auditLog.groupBy({
            by: ['action'],
            where,
            _count: { action: true },
            orderBy: { _count: { action: 'desc' } },
            take: 5,
          }),
          this.prisma.auditLog.groupBy({
            by: ['resource'],
            where,
            _count: { resource: true },
            orderBy: { _count: { resource: 'desc' } },
            take: 5,
          }),
          this.prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true, createdAt: true,
              actorName: true, actorRole: true,
              action: true, resource: true, resourceLabel: true, resourceId: true,
              success: true, statusCode: true, errorMessage: true,
            },
          }),
        ]);

        // Status heuristic:
        //   healthy : has activity and < 10% failures
        //   warning : has activity but high failure rate
        //   quiet   : no activity in the window
        let status: 'healthy' | 'warning' | 'quiet' = 'quiet';
        if (eventCount > 0) {
          const failRate = failureCount / eventCount;
          status = failRate >= 0.1 ? 'warning' : 'healthy';
        }

        const enrichedRecent = await this.enrichLabels(recent as any);

        return {
          key: p.key,
          label: p.label,
          icon: p.icon,
          status,
          eventCount,
          failureCount,
          actorCount: distinctActors.length,
          byAction: byAction.map((b) => ({ action: b.action, count: b._count.action })),
          byResource: byResource.map((b) => ({ resource: b.resource, count: b._count.resource })),
          recent: enrichedRecent,
        };
      }),
    );

    return {
      window,
      windowHours: hours,
      since: since.toISOString(),
      portals: result,
    };
  }

  private buildWhere(f: {
    actorId?: string; action?: string; resource?: string; resourceId?: string;
    success?: string; from?: string; to?: string; q?: string;
  }) {
    const where: any = {};
    if (f.actorId) where.actorId = f.actorId;
    if (f.action) where.action = f.action;
    if (f.resource) where.resource = f.resource;
    if (f.resourceId) where.resourceId = f.resourceId;
    if (f.success === 'true') where.success = true;
    if (f.success === 'false') where.success = false;
    if (f.from || f.to) {
      where.createdAt = {};
      if (f.from) {
        const d = new Date(f.from);
        if (Number.isNaN(d.getTime())) throw new HttpException('Invalid "from" date', HttpStatus.BAD_REQUEST);
        where.createdAt.gte = d;
      }
      if (f.to) {
        const d = new Date(f.to);
        if (Number.isNaN(d.getTime())) throw new HttpException('Invalid "to" date', HttpStatus.BAD_REQUEST);
        where.createdAt.lte = d;
      }
    }
    if (f.q) {
      const q = f.q;
      where.OR = [
        { actorName: { contains: q, mode: 'insensitive' } },
        { actorEmail: { contains: q, mode: 'insensitive' } },
        { resourceLabel: { contains: q, mode: 'insensitive' } },
        { resourceId: { contains: q, mode: 'insensitive' } },
        { path: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /**
   * Backfill a human-friendly `resourceLabel` for rows whose label was never
   * captured at write time. Looks up the matching record by id in the
   * appropriate table based on the audit row's `resource` string, and falls
   * back to a User lookup so that cryptic ids like "cmov3l7zl…" become
   * "Bora Sok (ADMIN)" in the UI.
   */
  private async enrichLabels<T extends { resource: string; resourceId: string | null; resourceLabel: string | null }>(
    items: T[],
  ): Promise<T[]> {
    const need = items.filter((r) => !r.resourceLabel && r.resourceId);
    if (need.length === 0) return items;

    // Group ids by resource for batched lookups.
    const idsByResource = new Map<string, Set<string>>();
    for (const r of need) {
      const set = idsByResource.get(r.resource) ?? new Set<string>();
      set.add(r.resourceId!);
      idsByResource.set(r.resource, set);
    }

    const labels = new Map<string, string>(); // key = `${resource}:${id}`
    const remember = (resource: string, id: string, label: string) => {
      labels.set(`${resource}:${id}`, label);
    };

    await Promise.all(
      [...idsByResource.entries()].map(async ([resource, idSet]) => {
        const ids = [...idSet];
        try {
          if (getDistribution() === 'core' && !['USERS', 'AUTH', 'PARENT', 'PARENTS', 'NOTIFICATION-PREFERENCE'].includes(resource)) return;
          switch (resource) {
            case 'USERS':
            case 'AUTH':
            case 'PARENT':
            case 'PARENTS':
            case 'NOTIFICATION-PREFERENCE': {
              const rows = await this.prisma.user.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true, email: true, role: true },
              });
              for (const u of rows) {
                remember(resource, u.id, `${u.name || u.email || u.id} (${u.role})`);
              }
              break;
            }
            case 'CLASSES': {
              const rows = await this.prisma.class.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
              });
              for (const r of rows) remember(resource, r.id, r.name);
              break;
            }
            case 'STUDENTS': {
              const rows = await this.prisma.student.findMany({
                where: { id: { in: ids } },
                select: { id: true, user: { select: { name: true, email: true } } },
              });
              for (const r of rows) remember(resource, r.id, r.user?.name || r.user?.email || r.id);
              break;
            }
            case 'ANNOUNCEMENTS': {
              const rows = await this.prisma.announcement.findMany({
                where: { id: { in: ids } },
                select: { id: true, title: true },
              });
              for (const r of rows) remember(resource, r.id, r.title);
              break;
            }
            case 'DEPARTMENTS': {
              const rows = await this.prisma.department.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
              });
              for (const r of rows) remember(resource, r.id, r.name);
              break;
            }
            case 'HOLIDAYS': {
              const rows = await this.prisma.holiday.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
              });
              for (const r of rows) remember(resource, r.id, r.name);
              break;
            }
            case 'EXAM':
            case 'EXAMS': {
              const rows = await this.prisma.exam.findMany({
                where: { id: { in: ids } },
                select: { id: true, title: true },
              });
              for (const r of rows) remember(resource, r.id, r.title);
              break;
            }
            case 'ASSIGNMENTS': {
              const rows = await this.prisma.assignment.findMany({
                where: { id: { in: ids } },
                select: { id: true, title: true },
              });
              for (const r of rows) remember(resource, r.id, r.title);
              break;
            }
            case 'STUDY-YEARS': {
              const rows = await this.prisma.studyYear.findMany({
                where: { id: { in: ids } },
                select: { id: true, label: true },
              });
              for (const r of rows) remember(resource, r.id, r.label);
              break;
            }
          }
        } catch {
          // best-effort
        }

        // Fallback: try the User table for anything still unresolved.
        const stillMissing = ids.filter((id) => !labels.has(`${resource}:${id}`));
        if (stillMissing.length > 0) {
          try {
            const rows = await this.prisma.user.findMany({
              where: { id: { in: stillMissing } },
              select: { id: true, name: true, email: true, role: true },
            });
            for (const u of rows) {
              remember(resource, u.id, `${u.name || u.email || u.id} (${u.role})`);
            }
          } catch {
            // ignore
          }
        }
      }),
    );

    return items.map((r) => {
      if (r.resourceLabel || !r.resourceId) return r;
      const lbl = labels.get(`${r.resource}:${r.resourceId}`);
      return lbl ? { ...r, resourceLabel: lbl } : r;
    });
  }

  // ── Audit Log Cleanup Schedules ──────────────────────────────────────────

  private static readonly VALID_FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];

  /** List all cleanup schedules. */
  @Get('cleanup-schedules')
  listCleanupSchedules() {
    return this.prisma.auditCleanupSchedule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /** Create a new cleanup schedule. */
  @Post('cleanup-schedules')
  async createCleanupSchedule(
    @Body() body: { label?: string; frequency: string; retainDays: number; enabled?: boolean },
  ) {
    const freq = (body.frequency ?? '').toUpperCase();
    if (!AuditController.VALID_FREQUENCIES.includes(freq)) {
      throw new BadRequestException(`frequency must be one of: ${AuditController.VALID_FREQUENCIES.join(', ')}`);
    }
    const retain = Number(body.retainDays);
    if (!retain || retain < 1) throw new BadRequestException('retainDays must be a positive integer');
    return this.prisma.auditCleanupSchedule.create({
      data: {
        label: body.label?.trim() || `${freq} – keep ${retain} days`,
        frequency: freq,
        retainDays: retain,
        enabled: body.enabled !== false,
      },
    });
  }

  /** Toggle enabled/disabled or update a schedule. */
  @Post('cleanup-schedules/:id/toggle')
  async toggleCleanupSchedule(@Param('id') id: string) {
    const existing = await this.prisma.auditCleanupSchedule.findUnique({ where: { id } });
    if (!existing) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return this.prisma.auditCleanupSchedule.update({
      where: { id },
      data: { enabled: !existing.enabled },
    });
  }

  /** Delete a cleanup schedule. */
  @Delete('cleanup-schedules/:id')
  async deleteCleanupSchedule(@Param('id') id: string) {
    await this.prisma.auditCleanupSchedule.delete({ where: { id } });
    return { ok: true };
  }

  /** Manually trigger a cleanup run for a specific schedule now. */
  @Post('cleanup-schedules/:id/run-now')
  async runCleanupNow(@Param('id') id: string) {
    const schedule = await this.prisma.auditCleanupSchedule.findUnique({ where: { id } });
    if (!schedule) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    const cutoff = new Date(Date.now() - schedule.retainDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await this.prisma.auditCleanupSchedule.update({
      where: { id },
      data: { lastRunAt: new Date(), lastDeletedCount: result.count },
    });
    return { deleted: result.count, cutoff };
  }
}
