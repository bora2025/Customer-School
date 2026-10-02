const DEVELOPMENT_JWT_SECRET = 'wattanam-development-only-secret-do-not-use-in-production';
const INSECURE_JWT_SECRETS = new Set([
  DEVELOPMENT_JWT_SECRET,
  'change-me-in-production-use-a-strong-random-key',
  'secret',
]);

export type NodeEnvironment = 'development' | 'test' | 'production';
export type ProcessRole = 'combined' | 'api' | 'worker';
export type Distribution = 'core' | 'legacy-full';

export interface RuntimeConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  appVersion: string;
  gitCommit: string | null;
  cookieSecure: boolean;
  jwtAccessExpiry: string;
  jwtRefreshExpiryDays: number;
  jwtKeyId: string;
  jwtSecondarySecrets: ReadonlyMap<string, string>;
  backupDir: string;
  backupRetentionDays: number;
  pluginDir: string;
  pluginDataDir: string;
  pluginSafeMode: boolean;
  pluginMaxPackageBytes: number;
  pluginMaxUnpackedBytes: number;
  pluginStorageMaxFileBytes: number;
  processRole: ProcessRole;
  workerPort: number;
  distribution: Distribution;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnv = value || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  return nodeEnv as NodeEnvironment;
}

function parsePort(value: string | undefined): number {
  const port = Number(value || '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function productionPath(env: NodeJS.ProcessEnv, name: string, fallback: string, nodeEnv: NodeEnvironment): string {
  const value = env[name]?.trim() || fallback;
  if (nodeEnv === 'production' && !value.startsWith('/')) {
    throw new Error(`${name} must be an absolute path in production`);
  }
  return value;
}

function duration(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  if (!/^\d+(s|m|h|d)$/.test(value)) throw new Error(`${name} must be a duration such as 15m, 2h, or 7d`);
  return value;
}

export function getProcessRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const value = env.PROCESS_ROLE?.trim().toLowerCase() || 'combined';
  if (!['combined', 'api', 'worker'].includes(value)) throw new Error('PROCESS_ROLE must be combined, api, or worker');
  return value as ProcessRole;
}

export function runsBackgroundJobs(env: NodeJS.ProcessEnv = process.env): boolean {
  return getProcessRole(env) !== 'api';
}

/**
 * The feature set this installation composes (lean-core checklist LC2-001). `legacy-full` is every
 * built-in module and stays the default, so an upgraded school, which never sets the variable, keeps
 * what it has until it is explicitly migrated (LC2-002). `core` is the lean core alone.
 */
export function getDistribution(env: NodeJS.ProcessEnv = process.env): Distribution {
  const value = env.WATTANAM_DISTRIBUTION?.trim().toLowerCase() || 'legacy-full';
  if (!['core', 'legacy-full'].includes(value)) throw new Error(`WATTANAM_DISTRIBUTION must be core or legacy-full (got "${value}")`);
  return value as Distribution;
}

export function parseCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  return value.split(',').map((item) => {
    const origin = item.trim();
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`CORS_ORIGINS must contain HTTP(S) origins without paths: ${origin}`);
    }
    return origin;
  });
}

export function getCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const nodeEnv = parseNodeEnvironment(env.NODE_ENV);
  const origins = parseCorsOrigins(env.CORS_ORIGINS);
  if (origins.length > 0) return origins;
  if (nodeEnv === 'production') throw new Error('CORS_ORIGINS is required in production');
  return ['http://localhost:3000', 'http://localhost:3004'];
}

/**
 * The same allow-list, for `@WebSocketGateway` decorators only.
 *
 * Decorator arguments are evaluated while the module graph loads — `main.ts` and `worker.ts` both
 * `import { AppModule }` before their `bootstrap()` can call `readRuntimeConfig()`. Throwing from
 * there means a missing `CORS_ORIGINS` is reported as a stack trace inside whichever gateway
 * happened to be imported first (`dist/attendance/attendance.gateway.js`, say), naming a feature
 * that has nothing to do with the problem.
 *
 * Returning an empty allow-list instead weakens nothing: `readRuntimeConfig()` still refuses to
 * start a production process without `CORS_ORIGINS`, so this value is unreachable in the case it
 * covers — it exists purely so the startup validation gets to report the error itself.
 */
export function getCorsOriginsForGateway(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    return getCorsOrigins(env);
  } catch {
    return [];
  }
}

function resolveJwtSecret(env: NodeJS.ProcessEnv, nodeEnv: NodeEnvironment): string {
  const secret = env.JWT_SECRET?.trim() || DEVELOPMENT_JWT_SECRET;
  if (nodeEnv === 'production' && (secret.length < 32 || INSECURE_JWT_SECRETS.has(secret))) {
    throw new Error('JWT_SECRET must be a unique production secret of at least 32 characters');
  }
  return secret;
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = parseNodeEnvironment(env.NODE_ENV);
  const corsOrigins = getCorsOrigins(env);

  return {
    nodeEnv,
    port: parsePort(env.PORT),
    databaseUrl: required(env, 'DATABASE_URL'),
    jwtSecret: resolveJwtSecret(env, nodeEnv),
    corsOrigins,
    appVersion: env.APP_VERSION?.trim() || '0.1.0-dev',
    gitCommit: env.GIT_COMMIT?.trim() || env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
    cookieSecure: boolean(env, 'COOKIE_SECURE', nodeEnv === 'production'),
    jwtAccessExpiry: duration(env, 'JWT_ACCESS_EXPIRY', '2h'),
    jwtRefreshExpiryDays: integer(env, 'JWT_REFRESH_EXPIRY', 7, 1, 365),
    jwtKeyId: env.JWT_KEY_ID?.trim() || 'jwt-v1',
    jwtSecondarySecrets: parseJwtSecondarySecrets(env.JWT_SECONDARY_SECRETS_JSON),
    backupDir: productionPath(env, 'BACKUP_DIR', nodeEnv === 'production' ? '/data/backups' : './backups', nodeEnv),
    backupRetentionDays: integer(env, 'BACKUP_RETENTION_DAYS', 30, 0, 3650),
    pluginDir: productionPath(env, 'PLUGIN_DIR', nodeEnv === 'production' ? '/data/plugins' : './plugins-installed', nodeEnv),
    pluginDataDir: productionPath(env, 'PLUGIN_DATA_DIR', nodeEnv === 'production' ? '/data/plugin-data' : './plugin-data', nodeEnv),
    pluginSafeMode: boolean(env, 'PLUGIN_SAFE_MODE', false),
    pluginMaxPackageBytes: integer(env, 'PLUGIN_MAX_PACKAGE_BYTES', 50 * 1024 * 1024, 1024, 250 * 1024 * 1024),
    pluginMaxUnpackedBytes: integer(env, 'PLUGIN_MAX_UNPACKED_BYTES', 50 * 1024 * 1024, 1024, 500 * 1024 * 1024),
    pluginStorageMaxFileBytes: integer(env, 'PLUGIN_STORAGE_MAX_FILE_BYTES', 1024 * 1024, 1, 100 * 1024 * 1024),
    processRole: getProcessRole(env),
    workerPort: parsePort(env.WORKER_PORT || '3002'),
    distribution: getDistribution(env),
  };
}

export function getJwtSecret(): string {
  return resolveJwtSecret(process.env, parseNodeEnvironment(process.env.NODE_ENV));
}

/**
 * Overlap-capable rotation for JWT_SECRET (docs/operations/secret-rotation-runbooks.md): the
 * active secret always signs new tokens, tagged with its key id in the JWT header (`kid`), so a
 * verifier can trust an old secret for tokens still in flight without accepting new tokens
 * signed by it. Mirrors the shape already used for the repository/entitlement signing keys
 * (an id-keyed JSON map of secondary trusted material), not something new invented for JWTs.
 */
export function getJwtKeyId(): string {
  return process.env.JWT_KEY_ID?.trim() || 'jwt-v1';
}

export function parseJwtSecondarySecrets(raw: string | undefined): ReadonlyMap<string, string> {
  if (!raw?.trim()) return new Map();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('JWT_SECONDARY_SECRETS_JSON must be valid JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JWT_SECONDARY_SECRETS_JSON must be a JSON object mapping key id to secret');
  }
  const map = new Map<string, string>();
  for (const [keyId, secret] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(keyId)) throw new Error(`JWT_SECONDARY_SECRETS_JSON key id is invalid: ${keyId}`);
    if (typeof secret !== 'string' || !secret.trim()) throw new Error(`JWT_SECONDARY_SECRETS_JSON secret for "${keyId}" must be a non-empty string`);
    map.set(keyId, secret);
  }
  return map;
}

export function getJwtSecondarySecrets(): ReadonlyMap<string, string> {
  return parseJwtSecondarySecrets(process.env.JWT_SECONDARY_SECRETS_JSON);
}
