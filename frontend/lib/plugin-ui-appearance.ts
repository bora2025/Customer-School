// Maps the allow-listed plugin `appearance` vocabulary (validated by the backend in
// backend/src/plugins/plugin-ui-appearance.ts) to Tailwind classes that live in THIS build.
// Every class is written out in full so Tailwind's scanner compiles it: never assemble class
// names from strings (`bg-${tone}-50`) here, or the class silently disappears from the CSS.

export type PluginUiTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
export type PluginUiPageAppearance = { theme?: 'standard' | 'company'; layout?: 'stack' | 'grid'; accent?: PluginUiTone };
export type PluginUiComponentAppearance = { width?: 'full' | 'half' | 'third' | 'two-thirds'; tone?: PluginUiTone; surface?: 'default' | 'plain' | 'card' | 'tinted' };

const ACCENT_BAR: Record<PluginUiTone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-teal-500',
  info: 'bg-blue-600',
  success: 'bg-emerald-600',
  warning: 'bg-amber-500',
  danger: 'bg-red-600',
};

const TINTED: Record<PluginUiTone, string> = {
  neutral: 'rounded-2xl border border-slate-200 bg-slate-50 p-4',
  brand: 'rounded-2xl border border-teal-200 bg-teal-50/70 p-4',
  info: 'rounded-2xl border border-blue-200 bg-blue-50/70 p-4',
  success: 'rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4',
  warning: 'rounded-2xl border border-amber-200 bg-amber-50/70 p-4',
  danger: 'rounded-2xl border border-red-200 bg-red-50/70 p-4',
};

const CARD: Record<PluginUiTone, string> = {
  neutral: 'card p-5',
  brand: 'card p-5 border-l-4 border-l-teal-500',
  info: 'card p-5 border-l-4 border-l-blue-600',
  success: 'card p-5 border-l-4 border-l-emerald-600',
  warning: 'card p-5 border-l-4 border-l-amber-500',
  danger: 'card p-5 border-l-4 border-l-red-600',
};

const WIDTH: Record<NonNullable<PluginUiComponentAppearance['width']>, string> = {
  full: 'col-span-12',
  half: 'col-span-12 lg:col-span-6',
  third: 'col-span-12 md:col-span-6 xl:col-span-4',
  'two-thirds': 'col-span-12 xl:col-span-8',
};

export function pageContainerClass(appearance: PluginUiPageAppearance | undefined, company: boolean): string {
  const grid = appearance?.layout === 'grid';
  if (company) return grid ? 'grid grid-cols-12 gap-6 rounded-[2rem] bg-slate-50/70 p-3 sm:p-5' : 'space-y-6 rounded-[2rem] bg-slate-50/70 p-3 sm:p-5';
  return grid ? 'grid grid-cols-12 gap-5' : 'space-y-5';
}

/** The heading accent bar, or null when the page asks for none. */
export function headingAccentClass(appearance: PluginUiPageAppearance | undefined, company: boolean): string | null {
  if (appearance?.accent) return `h-7 w-1 rounded-full ${ACCENT_BAR[appearance.accent]}`;
  return company ? 'h-7 w-1 rounded-full bg-blue-600' : null;
}

/** Wrapper classes for one component, or null when it needs no wrapper. */
export function componentWrapperClass(appearance: PluginUiComponentAppearance | undefined, pageAppearance: PluginUiPageAppearance | undefined): string | null {
  const classes: string[] = [];
  if (pageAppearance?.layout === 'grid') classes.push(WIDTH[appearance?.width || 'full']);
  const tone = appearance?.tone || 'neutral';
  if (appearance?.surface === 'tinted') classes.push(TINTED[tone]);
  if (appearance?.surface === 'card') classes.push(CARD[tone]);
  return classes.length ? classes.join(' ') : null;
}
