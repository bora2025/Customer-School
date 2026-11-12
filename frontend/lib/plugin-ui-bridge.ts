// Host side of the plugin UI bridge (protocol "wattanam.plugin-ui/1").
//
// A plugin-owned screen runs in <iframe sandbox="allow-scripts ..."> (opaque origin, no cookies, no
// network: its CSP has connect-src 'none'). It asks the host page for everything through postMessage.
// This module holds the pure validation so it can be reasoned about and tested on its own:
//   - requests may only target the plugin's OWN API (/api/plugin-api/<pluginId>/<path>);
//   - paths are plain relative segments (no "..", no scheme, no other plugin);
//   - only JSON bodies up to 256 KiB, a fixed method set, and a rate limit per frame.
// The plugin's API still authorizes every call with the signed-in user's permissions, so the bridge
// never grants more than the plugin's own routes already allow for this user.

export const PLUGIN_UI_PROTOCOL = 'wattanam.plugin-ui/1';
export const PLUGIN_UI_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const PLUGIN_UI_MAX_BODY_BYTES = 256 * 1024;
export const PLUGIN_UI_MAX_REQUESTS_PER_SECOND = 20;

/**
 * Device services a screen may use, and only when its page declares them (`options.devices`).
 * The HOST runs the device: a sandboxed screen never receives camera frames or a media stream,
 * only the text of each code the school page decoded, or one location fix per request.
 */
export const PLUGIN_UI_DEVICES = ['scanner', 'location'] as const;
export type PluginUiDevice = (typeof PLUGIN_UI_DEVICES)[number];
export const PLUGIN_UI_MAX_SCAN_TEXT = 2000;

export type PluginUiRequest = { type: 'request'; id: string; method: (typeof PLUGIN_UI_METHODS)[number]; path: string; query?: Record<string, string>; body?: unknown };
export type PluginUiMessage =
  | { type: 'ready' }
  | PluginUiRequest
  | { type: 'resize'; height: number }
  | { type: 'navigate'; routePath: string }
  | { type: 'scan-start' }
  | { type: 'scan-stop' }
  | { type: 'location'; id: string };

/** The declared devices of an `app` component, reduced to the ones the host knows. */
export function pluginUiDevices(value: unknown): PluginUiDevice[] {
  return Array.isArray(value) ? PLUGIN_UI_DEVICES.filter((device) => value.includes(device)) : [];
}

const SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const ROUTE_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

/** Plugin-relative API path such as "classes/42/students"; null when unsafe. */
export function safePluginApiPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 500) return null;
  const segments = value.split('/');
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === '.' || segment === '..')) return null;
  if (segments.some((segment) => { try { return /[/\\]|^\.\.?$/.test(decodeURIComponent(segment)); } catch { return true; } })) return null;
  return segments.join('/');
}

/** Turns an untrusted message into a validated bridge message, or null to ignore it. */
export function parsePluginUiMessage(data: unknown): PluginUiMessage | null {
  if (!data || typeof data !== 'object' || (data as any).protocol !== PLUGIN_UI_PROTOCOL) return null;
  const message = data as Record<string, unknown>;
  if (message.type === 'ready') return { type: 'ready' };
  if (message.type === 'resize') {
    const height = Number(message.height);
    return Number.isFinite(height) ? { type: 'resize', height: Math.min(10_000, Math.max(80, Math.round(height))) } : null;
  }
  if (message.type === 'navigate') {
    const routePath = typeof message.routePath === 'string' ? message.routePath : '';
    return routePath.length <= 200 && routePath.split('/').every((segment) => ROUTE_SEGMENT.test(segment)) ? { type: 'navigate', routePath } : null;
  }
  if (message.type === 'scan-start') return { type: 'scan-start' };
  if (message.type === 'scan-stop') return { type: 'scan-stop' };
  if (message.type === 'location') {
    return typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id) ? { type: 'location', id: message.id } : null;
  }
  if (message.type === 'request') {
    const id = typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id) ? message.id : null;
    const method = String(message.method || 'GET').toUpperCase() as PluginUiRequest['method'];
    const path = safePluginApiPath(message.path);
    if (!id || !path || !PLUGIN_UI_METHODS.includes(method)) return null;
    let query: Record<string, string> | undefined;
    if (message.query !== undefined) {
      if (!message.query || typeof message.query !== 'object' || Array.isArray(message.query)) return null;
      const entries = Object.entries(message.query as Record<string, unknown>);
      if (entries.length > 30 || entries.some(([key, value]) => !/^[A-Za-z0-9_.-]{1,60}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value))) return null;
      query = Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
    }
    if (message.body !== undefined && (method === 'GET' || new TextEncoder().encode(JSON.stringify(message.body)).length > PLUGIN_UI_MAX_BODY_BYTES)) return null;
    return { type: 'request', id, method, path, ...(query ? { query } : {}), ...(message.body !== undefined ? { body: message.body } : {}) };
  }
  return null;
}

/** Sliding one-second window; returns false when the frame is over its budget. */
export function createRateLimiter(limit = PLUGIN_UI_MAX_REQUESTS_PER_SECOND, now: () => number = Date.now) {
  const recent: number[] = [];
  return () => {
    const time = now();
    while (recent.length && time - recent[0] >= 1000) recent.shift();
    if (recent.length >= limit) return false;
    recent.push(time);
    return true;
  };
}

/** URL of a plugin UI file served by the core (version-pinned, immutable). */
export function pluginUiAssetUrl(pluginId: string, version: string, entry: string) {
  return `/api/plugin-ui/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}
