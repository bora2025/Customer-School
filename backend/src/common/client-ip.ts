/**
 * The client address for audit and rate limiting. Express derives `req.ip` from X-Forwarded-For
 * using the configured `trust proxy` hop count (TRUST_PROXY_HOPS), so only entries appended by
 * our own proxies are trusted. Never read X-Forwarded-For directly: its leftmost entries are
 * whatever the client sent.
 */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } } | null | undefined): string | null {
  return req?.ip ?? req?.socket?.remoteAddress ?? null;
}
