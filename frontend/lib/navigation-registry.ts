export type FrontendDistribution = 'core' | 'legacy-full';
export type NavigationSource = 'core' | 'legacy-business' | 'plugin';

export interface NavigationItem {
  label: string;
  href: string;
  icon: string;
  section?: string;
  /** Render this entry as a child of its section instead of a top-level feature. */
  nested?: boolean;
  badgeKey?: 'messages' | 'announcements' | 'class-registrations' | 'platform-billing';
}

export interface NavigationRegistration extends NavigationItem {
  source: NavigationSource;
  pluginId?: string;
}

export interface PluginNavigationExtension {
  pluginId: string;
  label: string;
  href: string;
}

function pluginSectionLabel(pluginId: string): string {
  const slug = pluginId.split('.').pop() || pluginId;
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Groups each plugin's contributed routes under a readable plugin heading. */
export function pluginNavigation(entries: readonly PluginNavigationExtension[]): NavigationRegistration[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    const first = !seen.has(entry.pluginId);
    seen.add(entry.pluginId);
    return {
      label: entry.label,
      href: entry.href,
      icon: '🧩',
      ...(first ? { section: pluginSectionLabel(entry.pluginId) } : {}),
      nested: true,
      source: 'plugin' as const,
      pluginId: entry.pluginId,
    };
  });
}

const CORE_ADMIN_NAVIGATION_HREFS = new Set([
  '/admin',
  '/admin/users',
  '/admin/plugins',
  '/admin/settings',
  '/admin/backup',
  '/admin/system',
  '/admin/platform-billing',
  '/admin/audit',
  '/admin/profile',
  '/admin/licensing',
  '/admin/appearance',
]);

export function isCoreNavigationHref(href: string): boolean {
  return CORE_ADMIN_NAVIGATION_HREFS.has(href);
}

export function frontendDistribution(value = process.env.NEXT_PUBLIC_WATTANAM_DISTRIBUTION): FrontendDistribution {
  const normalized = value?.trim().toLowerCase() || 'legacy-full';
  if (normalized !== 'core' && normalized !== 'legacy-full') {
    throw new Error(`NEXT_PUBLIC_WATTANAM_DISTRIBUTION must be core or legacy-full (got "${normalized}")`);
  }
  return normalized;
}

export function composeNavigation(
  registry: readonly NavigationRegistration[],
  distribution: FrontendDistribution,
  pluginContributions: readonly NavigationRegistration[] = [],
): NavigationItem[] {
  const staticEntries = registry.filter((entry) =>
    entry.source === 'core' || (entry.source === 'legacy-business' && distribution === 'legacy-full'),
  );
  const plugins = pluginContributions.filter((entry) => entry.source === 'plugin' && Boolean(entry.pluginId));
  return [...staticEntries, ...plugins].map(({ source: _source, pluginId: _pluginId, ...item }) => item);
}
