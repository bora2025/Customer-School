import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Static files of a plugin-owned screen (`app` component), served from the plugin's signed, installed
 * package. Every response is locked down so plugin code can never touch the school's session or DOM:
 *
 *  - CSP `sandbox allow-scripts ...` without `allow-same-origin`: the document always runs in an
 *    opaque origin (no cookies, no storage, no school DOM), even if someone opens the URL directly.
 *  - `connect-src 'none'`: the plugin cannot call any server itself; it asks the host page through
 *    postMessage, and the host only forwards calls to the plugin's own API as the current user.
 *  - `frame-ancestors 'self'`: only school pages can frame it.
 *  - Files are re-hashed against the package's signed checksums.json on every read.
 */

export const PLUGIN_UI_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const PLUGIN_UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts allow-forms allow-modals allow-downloads',
].join('; ');

export function pluginUiResponseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': PLUGIN_UI_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The sandboxed (opaque-origin) document loads its own scripts from this origin; same-origin
    // resource policy would block that. The files are public plugin code, never user data.
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // The URL contains the exact plugin version, so a published file never changes.
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
}

/** Validates a requested file path; returns the package-relative path or null. */
export function pluginUiAssetPath(requested: string): string | null {
  if (!requested || requested.length > 300 || requested.includes('\\') || requested.includes('\0')) return null;
  const segments = requested.split('/');
  if (segments[0] !== 'ui' || segments.length < 2) return null;
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.') || !/^[A-Za-z0-9_.-]+$/.test(segment))) return null;
  if (!PLUGIN_UI_CONTENT_TYPES[path.extname(requested).toLowerCase()]) return null;
  return segments.join('/');
}

/** Reads one ui/ file of an installed package and proves it matches the signed checksums. */
export async function readVerifiedPluginUiAsset(installedPath: string, relative: string) {
  const root = path.resolve(installedPath);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) return null;
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat || !stat.isFile()) return null;
  const checksums = JSON.parse(await fs.readFile(path.join(root, 'checksums.json'), 'utf8')) as { files?: Record<string, string> };
  const expected = checksums.files?.[relative];
  if (!expected) return null;
  const body = await fs.readFile(absolute);
  if (createHash('sha256').update(body).digest('hex') !== expected) throw new Error(`Plugin UI file ${relative} does not match its signed checksum`);
  return { body, contentType: PLUGIN_UI_CONTENT_TYPES[path.extname(relative).toLowerCase()] };
}
