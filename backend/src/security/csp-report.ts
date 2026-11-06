/**
 * Content-Security-Policy violation reports (the gateway sends a report-only policy). Browsers post
 * either the legacy `report-uri` shape `{"csp-report": {...}}` or the Reporting API shape
 * `[{"type": "csp-violation", "body": {...}}]`. Reports are attacker-controllable input, so only a
 * minimized, length-bounded summary is kept: the page path (no query: it can carry tokens), the
 * directive, and the blocked origin or keyword. Never the full blocked URL or script sample.
 */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  disposition: string;
}

const MAX_REPORTS_PER_REQUEST = 20;
const KEYWORDS = new Set(['inline', 'eval', 'data', 'blob', 'self', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);

function clip(value: unknown, length: number): string {
  return typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').slice(0, length) : '';
}

/** Origin for URLs, the bare keyword for 'inline'/'eval'/scheme-only sources, else "other". */
function blockedSource(value: unknown): string {
  const raw = clip(value, 2048).trim();
  if (!raw) return 'unknown';
  if (KEYWORDS.has(raw)) return raw;
  if (/^(data|blob|filesystem|mediastream):?$/i.test(raw)) return raw.replace(/:$/, '').toLowerCase();
  try {
    const url = new URL(raw);
    if (['data:', 'blob:'].includes(url.protocol)) return url.protocol.slice(0, -1);
    return url.origin === 'null' ? url.protocol.slice(0, -1) : url.origin;
  } catch {
    return 'other';
  }
}

function pagePath(value: unknown): string {
  const raw = clip(value, 2048);
  try { return new URL(raw).pathname.slice(0, 200) || '/'; } catch { return 'unknown'; }
}

function normalize(entry: Record<string, unknown>): CspViolation {
  const directive = clip(entry['effective-directive'] ?? entry.effectiveDirective ?? entry['violated-directive'] ?? entry.violatedDirective, 64)
    .split(' ')[0] || 'unknown';
  return {
    directive,
    blocked: blockedSource(entry['blocked-uri'] ?? entry.blockedURL ?? entry.blockedUri),
    page: pagePath(entry['document-uri'] ?? entry.documentURL ?? entry.documentUri),
    disposition: clip(entry.disposition, 16) || 'report',
  };
}

export function summarizeCspReports(body: unknown): CspViolation[] {
  const items: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const report of body.slice(0, MAX_REPORTS_PER_REQUEST)) {
      if (report && typeof report === 'object' && (report as any).type === 'csp-violation' && (report as any).body && typeof (report as any).body === 'object') {
        items.push((report as any).body);
      }
    }
  } else if (body && typeof body === 'object' && (body as any)['csp-report'] && typeof (body as any)['csp-report'] === 'object') {
    items.push((body as any)['csp-report']);
  }
  return items.map(normalize);
}

/** Logs each distinct violation at most once per window, with the count seen since, so a policy
 * that every page view trips does not flood the logs. */
export class CspViolationAggregator {
  private readonly seen = new Map<string, { lastLogged: number; suppressed: number }>();
  constructor(private readonly windowMs = 10 * 60 * 1000, private readonly maxKeys = 500) {}

  record(violation: CspViolation, now = Date.now()): { log: boolean; count: number } {
    const key = `${violation.directive}|${violation.blocked}|${violation.page}`;
    const entry = this.seen.get(key);
    if (entry && now - entry.lastLogged < this.windowMs) {
      entry.suppressed += 1;
      return { log: false, count: 0 };
    }
    if (!entry && this.seen.size >= this.maxKeys) this.seen.delete(this.seen.keys().next().value as string);
    const count = (entry?.suppressed ?? 0) + 1;
    this.seen.set(key, { lastLogged: now, suppressed: 0 });
    return { log: true, count };
  }
}
