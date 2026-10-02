import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditService } from './audit.service';

/**
 * Auto-records every mutating HTTP request (POST/PUT/PATCH/DELETE) made by an
 * authenticated user. The hand-tagged `auditService.log()` calls add richer
 * detail for specific actions; this interceptor is the safety net that
 * guarantees nothing slips through unobserved.
 *
 * Request bodies are persisted as `metadata` with sensitive fields stripped.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  private static readonly TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'currentPassword',
    'newPassword',
    'token',
    'accessToken',
    'refreshToken',
    'access_token',
    'refresh_token',
  ]);

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    if (!req || !AuditInterceptor.TRACKED_METHODS.has(req.method)) {
      return next.handle();
    }

    const user = req.user;
    // Skip un-authenticated mutations (handled by the AuthInterceptor in
    // auth.service: failed logins are explicitly logged there).
    if (!user?.userId) {
      return next.handle();
    }

    const startedAt = Date.now();
    const { resource, resourceId, action } = this.classify(req);
    const meta = {
      body: this.sanitize(req.body),
      params: req.params,
      query: req.query,
      durationMs: 0 as number,
    };

    return next.handle().pipe(
      tap((response) => {
        meta.durationMs = Date.now() - startedAt;
        const inferredId =
          resourceId ?? (response && typeof response === 'object' ? (response.id ?? response?.user?.id ?? null) : null);
        this.audit.log({
          actorId: user.userId,
          actorRole: user.role,
          actorName: user.name,
          actorEmail: user.email,
          action,
          resource,
          resourceId: inferredId,
          method: req.method,
          path: req.originalUrl ?? req.url,
          statusCode: res?.statusCode ?? null,
          ip: this.clientIp(req),
          userAgent: req.headers?.['user-agent'] ?? null,
          metadata: meta,
          success: true,
        });
      }),
      catchError((err) => {
        meta.durationMs = Date.now() - startedAt;
        this.audit.log({
          actorId: user.userId,
          actorRole: user.role,
          actorName: user.name,
          actorEmail: user.email,
          action,
          resource,
          resourceId,
          method: req.method,
          path: req.originalUrl ?? req.url,
          statusCode: err?.status ?? 500,
          ip: this.clientIp(req),
          userAgent: req.headers?.['user-agent'] ?? null,
          metadata: meta,
          success: false,
          errorMessage: err?.message ?? String(err),
        });
        return throwError(() => err);
      }),
    );
  }

  /** Infer (resource, action) from URL + HTTP verb. */
  private classify(req: any): { resource: string; action: string; resourceId: string | null } {
    const method: string = req.method;
    const path: string = req.path || req.url || '';
    // Strip leading /api and trailing query/segments
    const cleaned = path.replace(/^\/api/, '').split('?')[0].replace(/^\//, '');
    const parts = cleaned.split('/').filter(Boolean);
    const resource = (parts[0] ?? 'unknown').toUpperCase();
    // Heuristic: a path segment that looks like a cuid / uuid / number is the id.
    const idLike = parts.find((p) => /^(c[a-z0-9]{20,}|[0-9a-f]{8}-|\d+)$/i.test(p));
    const action =
      method === 'POST'
        ? 'CREATE'
        : method === 'PUT' || method === 'PATCH'
          ? 'UPDATE'
          : method === 'DELETE'
            ? 'DELETE'
            : method;
    return { resource, action, resourceId: idLike ?? null };
  }

  private clientIp(req: any): string | null {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }

  private sanitize(value: any): any {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v));
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (AuditInterceptor.SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else if (v && typeof v === 'object') {
        out[k] = this.sanitize(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
