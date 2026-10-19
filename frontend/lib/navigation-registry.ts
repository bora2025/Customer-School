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

/**
 * Select a semantic icon for plugin navigation without requiring plugins to
 * understand the host application's icon component registry. Keep the most
 * specific routes first so, for example, ID-card and report pages do not fall
 * back to the broader student/staff icons.
 */
function pluginNavigationIcon(entry: PluginNavigationExtension): string {
  const value = `${entry.label} ${entry.href}`.toLowerCase();

  if (/dashboard|overview/.test(value)) return 'dashboard';
  if (/id[ -]?cards?|identity/.test(value)) return 'id-card';
  if (/scanner|scan attendance|attendance scan/.test(value)) return 'scan';
  if (/qr|self[ -]?attendance/.test(value)) return 'qr-code';
  if (/correction|review/.test(value)) return 'edit';
  if (/alerts?|notification/.test(value)) return 'bell';
  if (/reports?|analytics/.test(value)) return 'bar-chart';
  if (/settings?|configuration|windows?/.test(value)) return 'settings';
  if (/registrations?|admissions?|enrol+l?ment/.test(value)) return 'clipboard';
  if (/study[ -]?years?|calendar|schedule/.test(value)) return 'calendar';
  if (/departments?|campus|organization/.test(value)) return 'building';
  if (/subjects?|courses?/.test(value)) return 'book';
  if (/classes?|classrooms?/.test(value)) return 'graduation';
  if (/teachers?|students?/.test(value)) return 'users';
  if (/officers?|staff|employees?/.test(value)) return 'briefcase';
  if (/attendance/.test(value)) return 'check-square';

  return 'layers';
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
      icon: pluginNavigationIcon(entry),
      ...(first ? { section: pluginSectionLabel(entry.pluginId) } : {}),
      nested: true,
      source: 'plugin' as const,
      pluginId: entry.pluginId,
    };
  });
}

const CORE_ADMIN_NAVIGATION_HREFS = new Set([
  '/admin',
  '/admin/search',
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
