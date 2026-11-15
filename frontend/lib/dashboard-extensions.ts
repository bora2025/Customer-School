/** "wattanam.academic-management" → "Academic Management". */
export function pluginLabel(pluginId: string): string {
  const last = pluginId.split('.').pop() || pluginId;
  return last.split(/[-_]/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export interface PluginDashboardContribution {
  pluginId: string;
  id: string;
  label: string;
  href: string;
  dashboard?: { title?: string; description: string; priority?: number } | false;
}

export interface DashboardExtensionCard extends PluginDashboardContribution {
  description: string;
  priority: number;
}

export interface MarketplaceOnboardingStep {
  id: 'link' | 'browse' | 'activate';
  title: string;
  description: string;
  href: '/admin/plugins';
  complete: boolean;
}

/**
 * Transitional LC-2 adapter: every active, permission-filtered plugin navigation contribution is
 * also discoverable from the core dashboard. LC-3 replaces this with the richer UI v2 card schema.
 */
export function pluginDashboardCards(value: unknown): DashboardExtensionCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DashboardExtensionCard[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Partial<PluginDashboardContribution>;
    if (!item.pluginId || !item.id || !item.label || !item.href) return [];
    if (!item.href.startsWith(`/plugins/${item.pluginId}/`) || item.href.includes('..')) return [];
    if (item.dashboard === false) return [];
    const dashboard = item.dashboard && typeof item.dashboard === 'object' ? item.dashboard : undefined;
    return [{
      pluginId: item.pluginId,
      id: item.id,
      label: dashboard?.title?.trim() || item.label,
      href: item.href,
      description: dashboard?.description?.trim() || pluginLabel(item.pluginId),
      priority: Number.isInteger(dashboard?.priority) ? dashboard!.priority! : 500,
    }];
  }).sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
}

export type PluginDashboardTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
export interface PluginDashboardWidget {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
  href?: string;
  priority: number;
  stats: Array<{ id: string; label: string; value: string; hint?: string; tone: PluginDashboardTone; href?: string }>;
  segments?: Array<{ label: string; value: number; tone: PluginDashboardTone }>;
  items?: Array<{ label: string; value: string; hint?: string; tone: PluginDashboardTone; href?: string }>;
  itemsTitle?: string;
  updatedAt?: string;
}

const TONES: PluginDashboardTone[] = ['neutral', 'good', 'warn', 'bad', 'info'];
/**
 * Key-figure widgets from GET /api/plugin-api/dashboard. The server already validates them; this keeps
 * the page safe from an older server or a malformed answer (unknown tones, links outside the plugin).
 */
export function pluginDashboardWidgets(value: unknown): PluginDashboardWidget[] {
  if (!Array.isArray(value)) return [];
  const tone = (t: unknown): PluginDashboardTone => (TONES.includes(t as PluginDashboardTone) ? t as PluginDashboardTone : 'neutral');
  return value.flatMap((entry): PluginDashboardWidget[] => {
    if (!entry || typeof entry !== 'object') return [];
    const widget = entry as PluginDashboardWidget;
    if (!widget.pluginId || !widget.id || !widget.title || !Array.isArray(widget.stats)) return [];
    const inside = (href?: string) => (href && href.startsWith(`/plugins/${widget.pluginId}/`) && !href.includes('..') ? href : undefined);
    return [{
      ...widget,
      href: inside(widget.href),
      stats: widget.stats.filter((s) => s && s.id && s.label && s.value !== undefined).map((s) => ({ ...s, value: String(s.value), tone: tone(s.tone), href: inside(s.href) })),
      segments: Array.isArray(widget.segments) ? widget.segments.filter((s) => s && Number.isFinite(Number(s.value))).map((s) => ({ ...s, value: Number(s.value), tone: tone(s.tone) })) : undefined,
      items: Array.isArray(widget.items) ? widget.items.filter((i) => i && i.label).map((i) => ({ ...i, value: String(i.value), tone: tone(i.tone), href: inside(i.href) })) : undefined,
    }];
  });
}

export function marketplaceOnboarding(linked: boolean, activePluginCount: number): MarketplaceOnboardingStep[] {
  return [
    {
      id: 'link', title: 'Link your marketplace account',
      description: 'Connect this installation securely so your school can acquire licensed plugins.',
      href: '/admin/plugins', complete: linked,
    },
    {
      id: 'browse', title: 'Choose the features you need',
      description: 'Browse verified free and paid plugins without adding unused school modules.',
      href: '/admin/plugins', complete: activePluginCount > 0,
    },
    {
      id: 'activate', title: 'Install and activate plugins',
      description: 'Return to Plugin Manager to verify, install and activate each selected feature.',
      href: '/admin/plugins', complete: activePluginCount > 0,
    },
  ];
}
