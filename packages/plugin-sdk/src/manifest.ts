import semver from 'semver';

/**
 * Frozen SDK 1.0 capability list. Kept identical to
 * backend/src/plugins/plugin-manifest.ts's PLUGIN_CAPABILITIES by a "twin
 * pinning" test in each repo (this package's manifest.spec.ts and the
 * backend's plugin-sdk-contract.spec.ts) rather than a runtime dependency
 * between them -- see docs/plugins/package-and-runtime.md.
 */
export const PLUGIN_CAPABILITIES = [
  'api.routes',
  'database.read',
  'database.write',
  'directory.read',
  'events.publish',
  'events.subscribe',
  'jobs.schedule',
  'navigation.register',
  'notifications.send',
  'permissions.register',
  'realtime.notify',
  'settings.read',
  'settings.write',
  'storage.read',
  'storage.write',
  'ui.pages',
] as const;
export const PLUGIN_CAPABILITIES_V1_1 = ['accounts.guardian.assign', 'accounts.parent.resolve', 'accounts.student.create', 'accounts.student.update', 'crypto.hash', 'events.durable', 'readmodels.publish', 'readmodels.read'] as const;
export const PLUGIN_SUPPORTED_CAPABILITIES = [...PLUGIN_CAPABILITIES, ...PLUGIN_CAPABILITIES_V1_1] as const;
export const PLUGIN_SDK_VERSION = '1.1.0';
export const PLUGIN_RUNTIME_VERSION = '1.0.0';
export const PLUGIN_DATA_CLASSIFICATIONS = [
  'education-records', 'personal-data', 'communications', 'financial-records',
  'employment-records', 'location-data', 'generated-documents',
] as const;

export interface PluginOperationalContract {
  healthCheck: 'runtime';
  dataClassification: string[];
  backup: { database: 'required' | 'none'; files: 'required' | 'none'; restore: 'required' };
  uninstall: { dataRetention: 'preserve' };
  pricing: 'marketplace';
}

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  requiresCore: string;
  publisher: string;
  license: string;
  backendEntry?: string;
  frontendEntry?: string;
  capabilities: string[];
  permissions: string[];
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  sdkVersion?: string;
  runtimeVersion?: string;
  migrations: Array<{ id: string; path: string; checksum: string; destructive: boolean }>;
  navigation: Array<{ id: string; label: string; href: string; permission?: string }>;
  supportedLanguages: string[];
  supportUrl?: string;
  privacyUrl?: string;
  operational?: PluginOperationalContract;
}

function text(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${field} must be a non-empty string no longer than ${maximum} characters`);
  }
  return value.trim();
}

function safeEntry(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const entry = text(value, field, 240);
  if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
    throw new Error(`${field} must be a safe relative package path`);
  }
  return entry;
}

/**
 * Validates plugin.json against the same rules the real backend verifier
 * enforces (backend/src/plugins/plugin-manifest.ts). Framework-independent
 * (plain Error, not a NestJS exception) so it can run in the CLI, in a
 * plugin author's own test suite, or anywhere else outside the backend.
 */
export function parsePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('plugin.json must contain an object');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error('Unsupported plugin manifest schemaVersion');

  const id = text(input.id, 'id', 100);
  const publisher = text(input.publisher, 'publisher', 100);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw new Error('Plugin id must use lowercase dot/dash notation');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(publisher)) throw new Error('Publisher must use lowercase dot/dash notation');
  if (id !== publisher && !id.startsWith(`${publisher}.`) && !id.startsWith(`${publisher}-`)) {
    throw new Error('Plugin id must be namespaced by its publisher');
  }

  const version = text(input.version, 'version', 40);
  const requiresCore = text(input.requiresCore, 'requiresCore', 100);
  if (!semver.valid(version)) throw new Error('Plugin version must be valid semantic versioning');
  if (!semver.validRange(requiresCore)) throw new Error('requiresCore must be a valid semantic-version range');

  const capabilities = input.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.some((item) => typeof item !== 'string' || !(PLUGIN_SUPPORTED_CAPABILITIES as readonly string[]).includes(item))) {
    throw new Error('Plugin contains an unsupported capability');
  }
  const permissions = input.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== 'string' || !item.startsWith(`${id}.`) || !/^[a-z0-9.-]+$/.test(item))) {
    throw new Error('Plugin permissions must be lowercase and namespaced by plugin id');
  }
  const dependencies = input.dependencies ?? {};
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new Error('dependencies must be an object');
  for (const [dependency, range] of Object.entries(dependencies as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(dependency) || typeof range !== 'string' || !semver.validRange(range)) {
      throw new Error(`Invalid plugin dependency: ${dependency}`);
    }
  }
  const optionalDependencies = input.optionalDependencies ?? {};
  if (!optionalDependencies || typeof optionalDependencies !== 'object' || Array.isArray(optionalDependencies)) throw new Error('optionalDependencies must be an object');
  for (const [dependency, range] of Object.entries(optionalDependencies as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(dependency) || typeof range !== 'string' || !semver.validRange(range) || dependency in (dependencies as Record<string, unknown>)) throw new Error(`Invalid optional plugin dependency: ${dependency}`);
  }

  const migrations = input.migrations ?? [];
  if (!Array.isArray(migrations)) throw new Error('migrations must be an array');
  const parsedMigrations = migrations.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`migrations[${index}] must be an object`);
    const migration = item as Record<string, unknown>;
    const migrationId = text(migration.id, `migrations[${index}].id`, 100);
    const migrationPath = safeEntry(migration.path, `migrations[${index}].path`);
    const checksum = text(migration.checksum, `migrations[${index}].checksum`, 64);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(migrationId)) throw new Error(`migrations[${index}].id is invalid`);
    if (!migrationPath?.startsWith('migrations/') || !migrationPath.endsWith('.sql')) throw new Error(`migrations[${index}].path must be a migrations/*.sql path`);
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error(`migrations[${index}].checksum must be SHA-256`);
    if (migration.destructive !== undefined && typeof migration.destructive !== 'boolean') throw new Error(`migrations[${index}].destructive must be boolean`);
    return { id: migrationId, path: migrationPath, checksum, destructive: migration.destructive === true };
  });
  if (new Set(parsedMigrations.map((migration) => migration.id)).size !== parsedMigrations.length) throw new Error('Migration ids must be unique');

  const navigation = input.navigation ?? [];
  if (!Array.isArray(navigation)) throw new Error('navigation must be an array');
  const parsedNavigation = navigation.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`navigation[${index}] must be an object`);
    const entry = item as Record<string, unknown>;
    const entryId = text(entry.id, `navigation[${index}].id`, 100);
    const href = text(entry.href, `navigation[${index}].href`, 240);
    const permission = entry.permission === undefined ? undefined : text(entry.permission, `navigation[${index}].permission`, 200);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(entryId) || !href.startsWith(`/plugins/${id}/`) || href.includes('..')) throw new Error(`navigation[${index}] is not namespaced by plugin id`);
    if (permission && !permissions.includes(permission)) throw new Error(`navigation[${index}].permission is not declared`);
    return { id: entryId, label: text(entry.label, `navigation[${index}].label`, 120), href, permission };
  });

  const supportedLanguages = input.supportedLanguages ?? [];
  if (!Array.isArray(supportedLanguages) || supportedLanguages.some((language) => typeof language !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))) {
    throw new Error('supportedLanguages must contain language tags');
  }

  const optionalUrl = (value: unknown, field: string) => {
    if (value === undefined) return undefined;
    const result = text(value, field, 500);
    try { if (new URL(result).protocol !== 'https:') throw new Error(); }
    catch { throw new Error(`${field} must be an HTTPS URL`); }
    return result;
  };
  const sdkVersion = input.sdkVersion === undefined ? undefined : text(input.sdkVersion, 'sdkVersion', 40);
  const runtimeVersion = input.runtimeVersion === undefined ? undefined : text(input.runtimeVersion, 'runtimeVersion', 40);
  const sdkSupported = !sdkVersion || (semver.valid(sdkVersion)
    ? semver.major(sdkVersion) === semver.major(PLUGIN_SDK_VERSION) && semver.lte(sdkVersion, PLUGIN_SDK_VERSION)
    : !!semver.validRange(sdkVersion) && semver.satisfies(PLUGIN_SDK_VERSION, sdkVersion));
  if (!sdkSupported) throw new Error(`Plugin requires unsupported SDK version: ${sdkVersion}`);
  if (runtimeVersion && (!semver.validRange(runtimeVersion) || !semver.satisfies(PLUGIN_RUNTIME_VERSION, runtimeVersion))) throw new Error(`Plugin requires unsupported runtime version: ${runtimeVersion}`);
  if (parsedNavigation.length && !capabilities.includes('navigation.register')) throw new Error('navigation entries require navigation.register capability');
  if (input.frontendEntry !== undefined && !capabilities.includes('ui.pages')) throw new Error('frontendEntry requires ui.pages capability');

  let operational: PluginOperationalContract | undefined;
  if (input.operational !== undefined) {
    if (!input.operational || typeof input.operational !== 'object' || Array.isArray(input.operational)) throw new Error('operational must be an object');
    const value = input.operational as Record<string, unknown>;
    if (value.healthCheck !== 'runtime') throw new Error('operational.healthCheck must be runtime');
    if (!Array.isArray(value.dataClassification) || value.dataClassification.length === 0
      || value.dataClassification.some((item) => typeof item !== 'string' || !(PLUGIN_DATA_CLASSIFICATIONS as readonly string[]).includes(item))) {
      throw new Error('operational.dataClassification must contain supported classifications');
    }
    const backup = value.backup;
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('operational.backup must be an object');
    const backupValue = backup as Record<string, unknown>;
    if (!['required', 'none'].includes(String(backupValue.database)) || !['required', 'none'].includes(String(backupValue.files)) || backupValue.restore !== 'required') {
      throw new Error('operational.backup must declare database/files participation and required restore verification');
    }
    const uninstall = value.uninstall;
    if (!uninstall || typeof uninstall !== 'object' || Array.isArray(uninstall)
      || (uninstall as Record<string, unknown>).dataRetention !== 'preserve') throw new Error('operational.uninstall.dataRetention must be preserve');
    if (value.pricing !== 'marketplace') throw new Error('operational.pricing must be marketplace');
    operational = {
      healthCheck: 'runtime',
      dataClassification: [...new Set(value.dataClassification as string[])],
      backup: { database: backupValue.database as 'required' | 'none', files: backupValue.files as 'required' | 'none', restore: 'required' },
      uninstall: { dataRetention: 'preserve' },
      pricing: 'marketplace',
    };
  }

  return {
    schemaVersion: 1,
    id,
    name: text(input.name, 'name', 120),
    description: text(input.description, 'description', 500),
    version,
    requiresCore,
    publisher,
    license: text(input.license, 'license', 80),
    backendEntry: safeEntry(input.backendEntry, 'backendEntry'),
    frontendEntry: safeEntry(input.frontendEntry, 'frontendEntry'),
    capabilities: [...new Set(capabilities as string[])],
    permissions: [...new Set(permissions as string[])],
    dependencies: dependencies as Record<string, string>,
    optionalDependencies: optionalDependencies as Record<string, string>,
    sdkVersion,
    runtimeVersion,
    migrations: parsedMigrations,
    navigation: parsedNavigation,
    supportedLanguages: [...new Set(supportedLanguages as string[])],
    supportUrl: optionalUrl(input.supportUrl, 'supportUrl'),
    privacyUrl: optionalUrl(input.privacyUrl, 'privacyUrl'),
    operational,
  };
}
