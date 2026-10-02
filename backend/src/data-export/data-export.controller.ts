import { Controller, Get, Request, Res, UseGuards } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DataExportService, ExportName } from './data-export.service';

type AuthenticatedRequest = ExpressRequest & { user?: { userId: string; role: string; email?: string } };

/**
 * The school's records as CSV, for the SUPER_ADMIN and nobody else -- not even ADMIN, and the role
 * hierarchy grants SUPER_ADMIN to no other role. The prefix is on the billing lock's allow-list so
 * that a locked school can still take its records out; the lock only lets the request through, and
 * the role check here still decides who gets in.
 */
@Controller('admin/data-export')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class DataExportController {
  constructor(private readonly exports: DataExportService, private readonly audit: AuditService) {}

  @Get('students.csv')
  students(@Request() req: AuthenticatedRequest, @Res() res: Response) {
    return this.send('students', req, res);
  }

  @Get('attendance.csv')
  attendance(@Request() req: AuthenticatedRequest, @Res() res: Response) {
    return this.send('attendance', req, res);
  }

  @Get('grades.csv')
  grades(@Request() req: AuthenticatedRequest, @Res() res: Response) {
    return this.send('grades', req, res);
  }

  /**
   * Streams the file and then records the download: who took which records, how many, and when. A
   * whole-school export of children's records is exactly the kind of event the audit log exists for.
   */
  private async send(name: ExportName, req: AuthenticatedRequest, res: Response) {
    const fileName = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    const entry = {
      actorId: req.user?.userId ?? null, actorRole: req.user?.role ?? null, actorEmail: req.user?.email ?? null,
      action: 'EXPORT', resource: 'school_records', resourceLabel: fileName, method: 'GET',
      path: req.originalUrl ?? req.url, ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null,
    };
    let lines = 0;
    try {
      await write(res, '﻿'); // lets Excel read the Khmer names as UTF-8
      for await (const line of this.exports.lines(name)) {
        await write(res, line);
        lines += 1;
      }
      res.end();
    } catch (error) {
      // The headers are already sent. All that is left is to cut the download short, so that a
      // partial file cannot be mistaken for a complete one.
      const message = error instanceof Error ? error.message : String(error);
      res.destroy(error instanceof Error ? error : new Error(message));
      await this.audit.log({ ...entry, metadata: { export: name, rows: Math.max(lines - 1, 0) }, success: false, errorMessage: message });
      return;
    }
    await this.audit.log({ ...entry, metadata: { export: name, rows: Math.max(lines - 1, 0) }, success: true });
  }
}

/** Writes one chunk, waiting when the client is slower than the database. A client that goes away rejects. */
function write(res: Response, chunk: string): Promise<void> {
  if (res.destroyed) return Promise.reject(new Error('The download was cancelled'));
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const drained = () => { res.off('close', closed); resolve(); };
    const closed = () => { res.off('drain', drained); reject(new Error('The download was cancelled')); };
    res.once('drain', drained);
    res.once('close', closed);
  });
}
