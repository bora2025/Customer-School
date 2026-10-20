import { BadRequestException } from '@nestjs/common';
import semver from 'semver';

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
export const PLUGIN_CAPABILITIES_V1_2 = ['accounts.staff.create'] as const;
export const PLUGIN_CAPABILITIES_V1_3 = ['database.transaction'] as const;
export const PLUGIN_SUPPORTED_CAPABILITIES = [...PLUGIN_CAPABILITIES, ...PLUGIN_CAPABILITIES_V1_1, ...PLUGIN_CAPABILITIES_V1_2, ...PLUGIN_CAPABILITIES_V1_3] as const;
export const PLUGIN_SDK_VERSION = '1.3.0';
export const PLUGIN_RUNTIME_VERSION = '1.0.0';
export const PLUGIN_HOST_CONTRACTS = [
  'wattanam.academic.directory.v1',
  'wattanam.academic.identity.v1',
] as const;

export const PLUGIN_DATA_CLASSIFICATIONS = [
  'education-records',
  'personal-data',
  'communications',
  'financial-records',
  'employment-records',
  'location-data',
  'generated-documents',
] as const;

export interface PluginOperationalContract {
  healthCheck: 'runtime';
  dataClassification: string[];
  backup: { database: 'required' | 'none'; files: 'required' | 'none'; restore: 'required' };
  uninstall: { dataRetention: 'preserve' };
  pricing: 'marketplace';
}

export interface PluginDataContracts {
  schemaVersion: 1;
  deprecationNoticeDays: number;
  events: { publishes: Record<string, number[]>; subscribes: Record<string, number[]> };
  readModels: { publishes: Record<string, number[]>; reads: Record<string, number[]> };
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
  executionMode?: 'declarative' | 'in-process' | 'isolated';
  frontendEntry?: string;
  capabilities: string[];
  permissions: string[];
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  hostContracts: string[];
  sdkVersion?: string;
  runtimeVersion?: string;
  migrations: Array<{ id: string; path: string; checksum: string; destructive: boolean }>;
  navigation: Array<{ id: string; label: string; href: string; permission?: string }>;
  supportedLanguages: string[];
  supportUrl?: string;
  privacyUrl?: string;
  operational?: PluginOperationalContract;
  contracts?: PluginDataContracts;
}

function text(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new BadRequestException(`${field} must be a non-empty string no longer than ${maximum} characters`);
  }
  return value.trim();
}

function safeEntry(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  const entry = text(value, field, 240);
  if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..')) {
    throw new BadRequestException(`${field} must be a safe relative package path`);
  }
  return entry;
}

export function parsePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('plugin.json must contain an object');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new BadRequestException('Unsupported plugin manifest schemaVersion');

  const id = text(input.id, 'id', 100);
  const publisher = text(input.publisher, 'publisher', 100);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw new BadRequestException('Plugin id must use lowercase dot/dash notation');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(publisher)) throw new BadRequestException('Publisher must use lowercase dot/dash notation');
  if (id !== publisher && !id.startsWith(`${publisher}.`) && !id.startsWith(`${publisher}-`)) {
    throw new BadRequestException('Plugin id must be namespaced by its publisher');
  }

  const version = text(input.version, 'version', 40);
  const requiresCore = text(input.requiresCore, 'requiresCore', 100);
  if (!semver.valid(version)) throw new BadRequestException('Plugin version must be valid semantic versioning');
  if (!semver.validRange(requiresCore)) throw new BadRequestException('requiresCore must be a valid semantic-version range');

  const capabilities = input.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.some((item) => typeof item !== 'string' || !PLUGIN_SUPPORTED_CAPABILITIES.includes(item as any))) {
    throw new BadRequestException('Plugin contains an unsupported capability');
  }
  const permissions = input.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== 'string' || !item.startsWith(`${id}.`) || !/^[a-z0-9.-]+$/.test(item))) {
    throw new BadRequestException('Plugin permissions must be lowercase and namespaced by plugin id');
  }
  const dependencies = input.dependencies ?? {};
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new BadRequestException('dependencies must be an object');
  for (const [dependency, range] of Object.entries(dependencies as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(dependency) || typeof range !== 'string' || !semver.validRange(range)) {
      throw new BadRequestException(`Invalid plugin dependency: ${dependency}`);
    }
  }
  const optionalDependencies = input.optionalDependencies ?? {};
  if (!optionalDependencies || typeof optionalDependencies !== 'object' || Array.isArray(optionalDependencies)) throw new BadRequestException('optionalDependencies must be an object');
  for (const [dependency, range] of Object.entries(optionalDependencies as Record<string, unknown>)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(dependency) || typeof range !== 'string' || !semver.validRange(range) || dependency in (dependencies as Record<string, unknown>)) throw new BadRequestException(`Invalid optional plugin dependency: ${dependency}`);
  }
  const hostContracts = input.hostContracts ?? [];
  if (!Array.isArray(hostContracts) || hostContracts.some((contract) => typeof contract !== 'string' || !PLUGIN_HOST_CONTRACTS.includes(contract as any))) {
    throw new BadRequestException('hostContracts must contain supported host contract identifiers');
  }

  const migrations = input.migrations ?? [];
  if (!Array.isArray(migrations)) throw new BadRequestException('migrations must be an array');
  const parsedMigrations = migrations.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException(`migrations[${index}] must be an object`);
    const migration = item as Record<string, unknown>;
    const id = text(migration.id, `migrations[${index}].id`, 100);
    const migrationPath = safeEntry(migration.path, `migrations[${index}].path`);
    const checksum = text(migration.checksum, `migrations[${index}].checksum`, 64);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new BadRequestException(`migrations[${index}].id is invalid`);
    if (!migrationPath?.startsWith('migrations/') || !migrationPath.endsWith('.sql')) throw new BadRequestException(`migrations[${index}].path must be a migrations/*.sql path`);
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new BadRequestException(`migrations[${index}].checksum must be SHA-256`);
    if (migration.destructive !== undefined && typeof migration.destructive !== 'boolean') throw new BadRequestException(`migrations[${index}].destructive must be boolean`);
    return { id, path: migrationPath, checksum, destructive: migration.destructive === true };
  });
  if (new Set(parsedMigrations.map((migration) => migration.id)).size !== parsedMigrations.length) throw new BadRequestException('Migration ids must be unique');

  const navigation = input.navigation ?? [];
  if (!Array.isArray(navigation)) throw new BadRequestException('navigation must be an array');
  const parsedNavigation = navigation.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException(`navigation[${index}] must be an object`);
    const entry = item as Record<string, unknown>;
    const entryId = text(entry.id, `navigation[${index}].id`, 100);
    const href = text(entry.href, `navigation[${index}].href`, 240);
    const permission = entry.permission === undefined ? undefined : text(entry.permission, `navigation[${index}].permission`, 200);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(entryId) || !href.startsWith(`/plugins/${id}/`) || href.includes('..')) throw new BadRequestException(`navigation[${index}] is not namespaced by plugin id`);
    if (permission && !permissions.includes(permission)) throw new BadRequestException(`navigation[${index}].permission is not declared`);
    return { id: entryId, label: text(entry.label, `navigation[${index}].label`, 120), href, permission };
  });

  const supportedLanguages = input.supportedLanguages ?? [];
  if (!Array.isArray(supportedLanguages) || supportedLanguages.some((language) => typeof language !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))) {
    throw new BadRequestException('supportedLanguages must contain language tags');
  }

  const optionalUrl = (value: unknown, field: string) => {
    if (value === undefined) return undefined;
    const result = text(value, field, 500);
    try { if (new URL(result).protocol !== 'https:') throw new Error(); }
    catch { throw new BadRequestException(`${field} must be an HTTPS URL`); }
    return result;
  };
  const sdkVersion = input.sdkVersion === undefined ? undefined : text(input.sdkVersion, 'sdkVersion', 40);
  const runtimeVersion = input.runtimeVersion === undefined ? undefined : text(input.runtimeVersion, 'runtimeVersion', 40);
  const sdkSupported = !sdkVersion || (semver.valid(sdkVersion)
    ? semver.major(sdkVersion) === semver.major(PLUGIN_SDK_VERSION) && semver.lte(sdkVersion, PLUGIN_SDK_VERSION)
    : !!semver.validRange(sdkVersion) && semver.satisfies(PLUGIN_SDK_VERSION, sdkVersion));
  if (!sdkSupported) throw new BadRequestException(`Plugin requires unsupported SDK version: ${sdkVersion}`);
  if (runtimeVersion && (!semver.validRange(runtimeVersion) || !semver.satisfies(PLUGIN_RUNTIME_VERSION, runtimeVersion))) throw new BadRequestException(`Plugin requires unsupported runtime version: ${runtimeVersion}`);
  if (parsedNavigation.length && !capabilities.includes('navigation.register')) throw new BadRequestException('navigation entries require navigation.register capability');
  if (input.frontendEntry !== undefined && !capabilities.includes('ui.pages')) throw new BadRequestException('frontendEntry requires ui.pages capability');

  let operational: PluginOperationalContract | undefined;
  if (input.operational !== undefined) {
    if (!input.operational || typeof input.operational !== 'object' || Array.isArray(input.operational)) throw new BadRequestException('operational must be an object');
    const value = input.operational as Record<string, unknown>;
    if (value.healthCheck !== 'runtime') throw new BadRequestException('operational.healthCheck must be runtime');
    if (!Array.isArray(value.dataClassification) || value.dataClassification.length === 0
      || value.dataClassification.some((item) => typeof item !== 'string' || !PLUGIN_DATA_CLASSIFICATIONS.includes(item as any))) {
      throw new BadRequestException('operational.dataClassification must contain supported classifications');
    }
    const backup = value.backup;
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new BadRequestException('operational.backup must be an object');
    const backupValue = backup as Record<string, unknown>;
    if (!['required', 'none'].includes(String(backupValue.database)) || !['required', 'none'].includes(String(backupValue.files)) || backupValue.restore !== 'required') {
      throw new BadRequestException('operational.backup must declare database/files participation and required restore verification');
    }
    const uninstall = value.uninstall;
    if (!uninstall || typeof uninstall !== 'object' || Array.isArray(uninstall)
      || (uninstall as Record<string, unknown>).dataRetention !== 'preserve') {
      throw new BadRequestException('operational.uninstall.dataRetention must be preserve');
    }
    if (value.pricing !== 'marketplace') throw new BadRequestException('operational.pricing must be marketplace');
    operational = {
      healthCheck: 'runtime',
      dataClassification: [...new Set(value.dataClassification as string[])],
      backup: { database: backupValue.database as 'required' | 'none', files: backupValue.files as 'required' | 'none', restore: 'required' },
      uninstall: { dataRetention: 'preserve' },
      pricing: 'marketplace',
    };
  }

  let contracts: PluginDataContracts | undefined;
  if (input.contracts !== undefined) {
    if (!input.contracts || typeof input.contracts !== 'object' || Array.isArray(input.contracts)) throw new BadRequestException('contracts must be an object');
    const value = input.contracts as Record<string, unknown>;
    if (value.schemaVersion !== 1) throw new BadRequestException('contracts.schemaVersion must be 1');
    const deprecationNoticeDays = Number(value.deprecationNoticeDays);
    if (!Number.isInteger(deprecationNoticeDays) || deprecationNoticeDays < 30 || deprecationNoticeDays > 3650) throw new BadRequestException('contracts.deprecationNoticeDays must be between 30 and 3650');
    const parseGroup = (container: unknown, field: string, ownNamespace: boolean, qualified = true) => {
      if (!container || typeof container !== 'object' || Array.isArray(container)) throw new BadRequestException(`${field} must be an object`);
      const parsed: Record<string, number[]> = {};
      for (const [name, versions] of Object.entries(container as Record<string, unknown>)) {
        const validName = qualified ? /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(name) : /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name);
        if (!validName || (ownNamespace && !name.startsWith(`${id}.`))) throw new BadRequestException(`${field} contains an invalid or unowned contract name: ${name}`);
        if (!Array.isArray(versions) || !versions.length || versions.some((version) => !Number.isInteger(version) || Number(version) < 1)) throw new BadRequestException(`${field}.${name} must contain positive integer versions`);
        parsed[name] = [...new Set(versions as number[])].sort((a, b) => a - b);
      }
      return parsed;
    };
    const events = value.events as Record<string, unknown> | undefined;
    const readModels = value.readModels as Record<string, unknown> | undefined;
    if (!events || !readModels) throw new BadRequestException('contracts must declare events and readModels');
    contracts = {
      schemaVersion: 1, deprecationNoticeDays,
      events: { publishes: parseGroup(events.publishes || {}, 'contracts.events.publishes', true), subscribes: parseGroup(events.subscribes || {}, 'contracts.events.subscribes', false) },
      readModels: { publishes: parseGroup(readModels.publishes || {}, 'contracts.readModels.publishes', false, false), reads: parseGroup(readModels.reads || {}, 'contracts.readModels.reads', false) },
    };
  }
  const requiresContract = (capability: string, count: number, label: string) => {
    if (capabilities.includes(capability) && count === 0) throw new BadRequestException(`${capability} requires at least one ${label} contract declaration`);
    if (!capabilities.includes(capability) && count > 0) throw new BadRequestException(`${label} contract declarations require ${capability}`);
  };
  requiresContract('events.durable', Object.keys(contracts?.events.publishes || {}).length + Object.keys(contracts?.events.subscribes || {}).length, 'durable event');
  requiresContract('readmodels.publish', Object.keys(contracts?.readModels.publishes || {}).length, 'published read-model');
  requiresContract('readmodels.read', Object.keys(contracts?.readModels.reads || {}).length, 'consumed read-model');

  const backendEntry = safeEntry(input.backendEntry, 'backendEntry');
  const executionMode = input.executionMode === undefined ? (backendEntry ? 'in-process' : 'declarative') : String(input.executionMode);
  if (!['declarative', 'in-process', 'isolated'].includes(executionMode)) throw new BadRequestException('executionMode is invalid');
  if (!backendEntry && executionMode !== 'declarative') throw new BadRequestException('Plugins without backendEntry must use declarative executionMode');
  if (backendEntry && executionMode === 'declarative') throw new BadRequestException('Plugins with backendEntry cannot use declarative executionMode');
  return {
    schemaVersion: 1,
    id,
    name: text(input.name, 'name', 120),
    description: text(input.description, 'description', 500),
    version,
    requiresCore,
    publisher,
    license: text(input.license, 'license', 80),
    backendEntry,
    executionMode: executionMode as PluginManifest['executionMode'],
    frontendEntry: safeEntry(input.frontendEntry, 'frontendEntry'),
    capabilities: [...new Set(capabilities as string[])],
    permissions: [...new Set(permissions as string[])],
    dependencies: dependencies as Record<string, string>,
    optionalDependencies: optionalDependencies as Record<string, string>,
    hostContracts: [...new Set(hostContracts as string[])],
    sdkVersion,
    runtimeVersion,
    migrations: parsedMigrations,
    navigation: parsedNavigation,
    supportedLanguages: [...new Set(supportedLanguages as string[])],
    supportUrl: optionalUrl(input.supportUrl, 'supportUrl'),
    privacyUrl: optionalUrl(input.privacyUrl, 'privacyUrl'),
    operational,
    contracts,
  };
}
