import type { NextFunction, Request, Response } from 'express';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Second CSRF layer behind SameSite=Lax cookies: refuses state-changing requests that a browser
 * reports as coming from another site. Browsers always send Origin on cross-origin POST/PUT/PATCH/
 * DELETE (and Sec-Fetch-Site on modern ones), and a page cannot forge either. Requests with neither
 * header come from non-browser clients (mobile app, server-to-server, CLI); those authenticate with
 * bearer tokens, cannot carry a victim's cookies, and pass through.
 */
export function originGuard(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => origin.replace(/\/$/, '')));
  return (request: Request, response: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(request.method)) return next();
    const origin = request.header('origin');
    if (origin && origin !== 'null') {
      if (allowed.has(origin.replace(/\/$/, ''))) return next();
      return reject(response, 'Cross-origin request refused');
    }
    if (origin === 'null') return reject(response, 'Opaque-origin request refused');
    const fetchSite = request.header('sec-fetch-site');
    if (fetchSite === 'cross-site') return reject(response, 'Cross-site request refused');
    return next();
  };
}

function reject(response: Response, message: string) {
  response.status(403).json({ statusCode: 403, message });
}
