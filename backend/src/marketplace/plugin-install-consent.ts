import { createHash } from 'crypto';

export interface PluginInstallDisclosure {
  capabilities: string[];
  permissions: string[];
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  migrationSummary: { count: number; destructive: boolean };
  dataRetention: { onDeactivate: 'preserve'; onRemove: 'preserve'; onReinstall: 'adopt' };
}

/** Produces the exact public disclosure bound to a customer install decision. */
export function pluginInstallDisclosure(value: unknown): PluginInstallDisclosure {
  const manifest = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (candidate: unknown) => Array.isArray(candidate)
    ? [...new Set(candidate.filter((item): item is string => typeof item === 'string'))].sort()
    : [];
  const ranges = (candidate: unknown) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right)))
    : {};
  const migrations = Array.isArray(manifest.migrations) ? manifest.migrations : [];
  return {
    capabilities: strings(manifest.capabilities),
    permissions: strings(manifest.permissions),
    dependencies: ranges(manifest.dependencies),
    optionalDependencies: ranges(manifest.optionalDependencies),
    migrationSummary: {
      count: migrations.length,
      destructive: migrations.some((item) => !!item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).destructive === true),
    },
    dataRetention: { onDeactivate: 'preserve', onRemove: 'preserve', onReinstall: 'adopt' },
  };
}

export function pluginInstallConsentDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(pluginInstallDisclosure(value))).digest('hex');
}
