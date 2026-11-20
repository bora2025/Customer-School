// Host side of the plugin UI bridge (protocol "wattanam.plugin-ui/1").
//
// A plugin-owned screen runs in <iframe sandbox="allow-scripts ..."> (opaque origin, no cookies, no
// network: its CSP has connect-src 'none'). It asks the host page for everything through postMessage.
// This module holds the pure validation so it can be reasoned about and tested on its own:
//   - requests target the plugin's OWN API (/api/plugin-api/<pluginId>/<path>), or a partner plugin the
//     screen declared (options.apis) whose route lists the plugin as a caller;
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
 * `device-id` is a random identifier this browser keeps for ONE plugin (so a plugin can recognise a
 * registered device); it is different for every plugin and reveals nothing about the school page.
 * `face`: the school page runs the camera and a face model and returns face VECTORS (128 numbers per
 * capture) and quality / liveness scores — never an image. `nfc`: Web NFC card serial numbers (Chrome
 * on Android). `storage`: small JSON values kept on this device under a per-plugin key.
 */
export const PLUGIN_UI_DEVICES = ['scanner', 'location', 'device-id', 'face', 'nfc', 'storage'] as const;
export const PLUGIN_UI_STORAGE_MAX_VALUE_BYTES = 256 * 1024;
export const PLUGIN_UI_STORAGE_MAX_TOTAL_BYTES = 1024 * 1024;
export type PluginUiDevice = (typeof PLUGIN_UI_DEVICES)[number];
export const PLUGIN_UI_MAX_SCAN_TEXT = 2000;

export type PluginUiRequest = { type: 'request'; id: string; method: (typeof PLUGIN_UI_METHODS)[number]; path: string; query?: Record<string, string>; body?: unknown; plugin?: string };
export type PluginUiMessage =
  | { type: 'ready' }
  | PluginUiRequest
  | { type: 'resize'; height: number }
  | { type: 'navigate'; routePath: string; query?: Record<string, string>; plugin?: string }
  | { type: 'scan-start'; layout?: 'panel' | 'station'; title?: string }
  | { type: 'scan-feedback'; tone: PluginUiTone; message: string }
  | { type: 'scan-activity'; title?: string; items: PluginUiActivity[] }
  | { type: 'scan-stop' }
  | { type: 'location'; id: string }
  | { type: 'device-id'; id: string; plugin?: string }
  | { type: 'face-start'; mode: 'identify' | 'enroll'; title?: string; liveness: boolean; samples: number }
  | { type: 'face-stop' }
  | { type: 'nfc-start' }
  | { type: 'nfc-stop' }
  | { type: 'storage'; id: string; op: 'get' | 'set' | 'remove' | 'keys'; key?: string; value?: unknown };

export type PluginUiTone = 'info' | 'success' | 'warning' | 'error';
export type PluginUiActivity = { title: string; detail?: string; tone: PluginUiTone; initials?: string };
const TONES: PluginUiTone[] = ['info', 'success', 'warning', 'error'];
const plain = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** The declared devices of an `app` component, reduced to the ones the host knows. */
export function pluginUiDevices(value: unknown): PluginUiDevice[] {
  return Array.isArray(value) ? PLUGIN_UI_DEVICES.filter((device) => value.includes(device)) : [];
}

const SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
/** A partner plugin id named by the screen, or undefined; null when malformed. */
const partnerOf = (value: unknown): string | null | undefined => value === undefined ? undefined : typeof value === 'string' && value.length <= 120 && PLUGIN_ID.test(value) ? value : null;
const ROUTE_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

/** Plugin-relative API path such as "classes/42/students"; null when unsafe. */
export function safePluginApiPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 500) return null;
  const segments = value.split('/');
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === '.' || segment === '..')) return null;
  if (segments.some((segment) => { try { return /[/\\]|^\.\.?$/.test(decodeURIComponent(segment)); } catch { return true; } })) return null;
  return segments.join('/');
}

/** Plain query values (at most 30 short keys); null when the shape is not acceptable. */
export function safePluginUiQuery(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 30 || entries.some(([key, item]) => !/^[A-Za-z0-9_.-]{1,60}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof item) || String(item).length > 500)) return null;
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
}

/** The page's own query string as the screen may see it: well-formed keys only, first value each. */
export function pluginUiPageQuery(search: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (Object.keys(result).length >= 30) break;
    if (/^[A-Za-z0-9_.-]{1,60}$/.test(key) && value.length <= 500 && !(key in result)) result[key] = value;
  }
  return result;
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
    if (routePath.length > 200 || !routePath.split('/').every((segment) => ROUTE_SEGMENT.test(segment))) return null;
    const plugin = partnerOf(message.plugin);
    if (plugin === null) return null;
    const target = plugin ? { plugin } : {};
    if (message.query === undefined) return { type: 'navigate', routePath, ...target };
    const query = safePluginUiQuery(message.query);
    return query ? { type: 'navigate', routePath, query, ...target } : null;
  }
  if (message.type === 'scan-start') {
    const title = plain(message.title, 80);
    return { type: 'scan-start', layout: message.layout === 'station' ? 'station' : 'panel', ...(title ? { title } : {}) };
  }
  if (message.type === 'scan-feedback') {
    const tone = TONES.includes(message.tone as PluginUiTone) ? (message.tone as PluginUiTone) : 'info';
    return { type: 'scan-feedback', tone, message: plain(message.message, 200) };
  }
  if (message.type === 'scan-activity') {
    if (!Array.isArray(message.items)) return null;
    const items = message.items.slice(0, 50).map((item: any) => ({
      title: plain(item?.title, 80), detail: plain(item?.detail, 140) || undefined,
      tone: TONES.includes(item?.tone) ? item.tone : 'info', initials: plain(item?.initials, 3) || undefined,
    })).filter((item) => item.title);
    const title = plain(message.title, 60);
    return { type: 'scan-activity', items, ...(title ? { title } : {}) };
  }
  if (message.type === 'scan-stop') return { type: 'scan-stop' };
  if (message.type === 'location') {
    return typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id) ? { type: 'location', id: message.id } : null;
  }
  if (message.type === 'device-id') {
    // plugin: a partner's identifier for this browser (a screen that moved from that plugin keeps its devices)
    const plugin = partnerOf(message.plugin);
    if (plugin === null) return null;
    return typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id) ? { type: 'device-id', id: message.id, ...(plugin ? { plugin } : {}) } : null;
  }
  if (message.type === 'face-start') {
    const title = plain(message.title, 80);
    const samples = Math.min(5, Math.max(1, Math.round(Number(message.samples) || 3)));
    return { type: 'face-start', mode: message.mode === 'enroll' ? 'enroll' : 'identify', liveness: message.liveness !== false, samples, ...(title ? { title } : {}) };
  }
  if (message.type === 'face-stop') return { type: 'face-stop' };
  if (message.type === 'nfc-start') return { type: 'nfc-start' };
  if (message.type === 'nfc-stop') return { type: 'nfc-stop' };
  if (message.type === 'storage') {
    const id = typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id) ? message.id : null;
    const op = ['get', 'set', 'remove', 'keys'].includes(message.op as string) ? (message.op as 'get' | 'set' | 'remove' | 'keys') : null;
    if (!id || !op) return null;
    if (op === 'keys') return { type: 'storage', id, op };
    const key = typeof message.key === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(message.key) ? message.key : null;
    if (!key) return null;
    if (op !== 'set') return { type: 'storage', id, op, key };
    if (message.value === undefined) return null;
    let size = 0;
    try { size = new TextEncoder().encode(JSON.stringify(message.value)).length; } catch { return null; }
    return size <= PLUGIN_UI_STORAGE_MAX_VALUE_BYTES ? { type: 'storage', id, op, key, value: message.value } : null;
  }
  if (message.type === 'request') {
    const id = typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id) ? message.id : null;
    const method = String(message.method || 'GET').toUpperCase() as PluginUiRequest['method'];
    const path = safePluginApiPath(message.path);
    const plugin = partnerOf(message.plugin);
    if (!id || !path || !PLUGIN_UI_METHODS.includes(method) || plugin === null) return null;
    let query: Record<string, string> | undefined;
    if (message.query !== undefined) {
      const safe = safePluginUiQuery(message.query);
      if (!safe) return null;
      query = safe;
    }
    if (message.body !== undefined && (method === 'GET' || new TextEncoder().encode(JSON.stringify(message.body)).length > PLUGIN_UI_MAX_BODY_BYTES)) return null;
    return { type: 'request', id, method, path, ...(query ? { query } : {}), ...(message.body !== undefined ? { body: message.body } : {}), ...(plugin ? { plugin } : {}) };
  }
  return null;
}

/**
 * This browser's identifier for one plugin: random, created on first use and kept in the school
 * page's storage under a per-plugin key. Returns null when storage is unavailable (private mode).
 */
export function pluginDeviceId(pluginId: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null, random: () => string): string | null {
  if (!storage) return null;
  const key = `wattanam-plugin-device:${pluginId}`;
  try {
    const existing = storage.getItem(key);
    if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return existing;
    const created = random();
    storage.setItem(key, created);
    return storage.getItem(key) === created ? created : null;
  } catch {
    return null;
  }
}

/**
 * The device store of one plugin (the "storage" device): JSON values under
 * `wattanam-plugin-storage:<pluginId>:<key>`, at most 1 MiB per plugin. Returns the HTTP-like answer.
 */
export function pluginStorage(pluginId: string, storage: Storage | null, op: 'get' | 'set' | 'remove' | 'keys', key?: string, value?: unknown): { status: number; body: unknown } {
  if (!storage) return { status: 503, body: { message: 'This browser does not keep data for this screen (private browsing?).' } };
  const prefix = `wattanam-plugin-storage:${pluginId}:`;
  try {
    const own = () => { const keys: string[] = []; for (let i = 0; i < storage.length; i += 1) { const k = storage.key(i); if (k && k.startsWith(prefix)) keys.push(k); } return keys; };
    if (op === 'keys') return { status: 200, body: { value: own().map((k) => k.slice(prefix.length)).sort() } };
    const full = prefix + key;
    if (op === 'get') { const raw = storage.getItem(full); return { status: 200, body: { value: raw === null ? null : JSON.parse(raw) } }; }
    if (op === 'remove') { storage.removeItem(full); return { status: 200, body: { value: null } }; }
    const text = JSON.stringify(value);
    const used = own().filter((k) => k !== full).reduce((sum, k) => sum + (storage.getItem(k) || '').length, 0);
    if (used + text.length > PLUGIN_UI_STORAGE_MAX_TOTAL_BYTES) return { status: 413, body: { message: 'This screen has used all of its storage on this device.' } };
    storage.setItem(full, text);
    return { status: 200, body: { value: null } };
  } catch {
    return { status: 503, body: { message: 'Storage on this device is unavailable.' } };
  }
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
