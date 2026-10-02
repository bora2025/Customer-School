import { timingSafeEqual } from 'node:crypto';

/**
 * Deliberately independent of environment.ts's readRuntimeConfig(), matching the existing
 * precedent of marketplace-identity-config.ts / entitlement-config.ts: a scraper (Prometheus)
 * cannot do interactive JWT login, so /metrics needs its own static-bearer-token gate, the
 * same shape as apps/marketplace-api's admin token guard.
 */
export function readMetricsTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = env.METRICS_TOKEN?.trim();
  if (!primary) return [];
  if (primary.length < 32) throw new Error('METRICS_TOKEN must be at least 32 characters');
  return [primary, ...parseSecondaryMetricsTokens(env.METRICS_SECONDARY_TOKENS_JSON)];
}

function parseSecondaryMetricsTokens(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('METRICS_SECONDARY_TOKENS_JSON must be valid JSON'); }
  if (!Array.isArray(value) || value.some((token) => typeof token !== 'string' || token.length < 32)) {
    throw new Error('METRICS_SECONDARY_TOKENS_JSON must be a JSON array of strings at least 32 characters long');
  }
  return value as string[];
}

/** Timing-safe membership check -- rotating METRICS_TOKEN doesn't instantly break a scrape
 * config still presenting the retiring value, as long as it's listed in METRICS_SECONDARY_TOKENS_JSON. */
export function matchesAnyToken(authorizationHeader: string, tokens: string[]): boolean {
  const supplied = authorizationHeader.startsWith('Bearer ') ? Buffer.from(authorizationHeader.slice(7)) : Buffer.alloc(0);
  return tokens.some((token) => {
    const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
