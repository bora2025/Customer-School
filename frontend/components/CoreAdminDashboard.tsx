'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminNav } from '../lib/admin-nav';
import { apiFetch, getCurrentUser } from '../lib/api';
import { DashboardExtensionCard, marketplaceOnboarding, pluginDashboardCards, PluginDashboardWidget, pluginDashboardWidgets } from '../lib/dashboard-extensions';
import { pluginLabel } from '../lib/plugin-search';
import GlobalSearchBox from './GlobalSearchBox';
import Sidebar from './Sidebar';

interface BillingControl {
  access?: string;
  reason?: string | null;
  billing?: { currency?: string; outstandingMinor?: number };
}
interface MarketplaceLinkStatus { linked?: boolean }

const coreLinks = [
  { label: 'Users', href: '/admin/users', icon: '👥' },
  { label: 'Plugins', href: '/admin/plugins', icon: '🧩' },
  { label: 'System health', href: '/admin/system', icon: '🩺' },
  { label: 'Backup', href: '/admin/backup', icon: '💾' },
  { label: 'Settings', href: '/admin/settings', icon: '⚙️' },
];

const REFRESH_MS = 60_000;
const FEATURE_LIMIT = 8;

export default function CoreAdminDashboard() {
  const [pluginCards, setPluginCards] = useState<DashboardExtensionCard[]>([]);
  const [widgets, setWidgets] = useState<PluginDashboardWidget[]>([]);
  const [widgetsLoaded, setWidgetsLoaded] = useState(false);
  const [billing, setBilling] = useState<BillingControl | null>(null);
  const [linkStatus, setLinkStatus] = useState<MarketplaceLinkStatus | null>(null);
  const [name, setName] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  const loadWidgets = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await apiFetch('/api/plugin-api/dashboard');
      if (response.ok) setWidgets(pluginDashboardWidgets(await response.json()));
      setUpdatedAt(new Date());
    } catch { /* keep the last figures */ } finally { setRefreshing(false); setWidgetsLoaded(true); }
  }, []);

  useEffect(() => {
    getCurrentUser().then((user) => setName(user?.name || '')).catch(() => undefined);
    Promise.all([
      apiFetch('/api/plugin-api/my-extensions'),
      apiFetch('/api/admin/marketplace/billing-control'),
      apiFetch('/api/admin/marketplace/link/status'),
    ]).then(async ([extensionsResponse, billingResponse, linkResponse]) => {
      if (extensionsResponse.ok) setPluginCards(pluginDashboardCards((await extensionsResponse.json())?.navigation));
      if (billingResponse.ok) setBilling(await billingResponse.json());
      if (linkResponse.ok) setLinkStatus(await linkResponse.json());
    }).catch(() => undefined);
    loadWidgets();
    // Live figures: refresh every minute while the page is visible, and on coming back to it.
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') loadWidgets(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') loadWidgets(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadWidgets]);

  const outstanding = billing?.billing?.outstandingMinor || 0;
  const currency = billing?.billing?.currency || 'USD';
  const onboarding = marketplaceOnboarding(Boolean(linkStatus?.linked), pluginCards.length);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const featureGroups = useMemo(() => {
    const groups = new Map<string, DashboardExtensionCard[]>();
    pluginCards.forEach((card) => { if (!groups.has(card.pluginId)) groups.set(card.pluginId, []); groups.get(card.pluginId)!.push(card); });
    return [...groups.entries()];
  }, [pluginCards]);

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanam Core" navItems={adminNav} accentColor="indigo" />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-body space-y-6">
          {/* greeting, date, quick links and search */}
          <section className="rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-5 text-white shadow-lg sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-indigo-100">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{greeting}{name ? `, ${name}` : ''}</h1>
                <p className="mt-1 text-sm text-indigo-100">Here is your school today.</p>
              </div>
              <nav aria-label="Core" className="flex flex-wrap gap-2">
                {coreLinks.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/25">
                    <span aria-hidden="true" className="mr-1.5">{link.icon}</span>{link.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="mt-5 max-w-3xl"><GlobalSearchBox /></div>
          </section>

          {(billing?.access === 'SUSPENDED' || outstanding > 0) && (
            <Link href="/admin/platform-billing" className={`block rounded-2xl border p-4 ${billing?.access === 'SUSPENDED' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <strong>{billing?.access === 'SUSPENDED' ? 'School access suspended' : 'Platform invoice outstanding'}</strong>
              <p className="mt-1 text-sm">{billing?.reason || `${(outstanding / 100).toFixed(2)} ${currency} outstanding. Open Platform Billing for details.`}</p>
            </Link>
          )}

          {/* key figures supplied by the plugins (GET dashboard/summary) */}
          {(!widgetsLoaded || widgets.length > 0) && (
            <section aria-labelledby="figures-title" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="figures-title" className="text-lg font-bold text-slate-800">At a glance</h2>
                <button type="button" onClick={loadWidgets} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-60">
                  <span className={refreshing ? 'animate-spin' : ''} aria-hidden="true">↻</span>
                  {updatedAt ? `Updated ${updatedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
                </button>
              </div>
              {!widgetsLoaded ? (
                <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((key) => <div key={key} className="card h-56 animate-pulse bg-slate-50" />)}</div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">{widgets.map((widget) => <WidgetCard key={`${widget.pluginId}:${widget.id}`} widget={widget} />)}</div>
              )}
            </section>
          )}

          {/* features */}
          <section aria-labelledby="features-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 id="features-title" className="text-lg font-bold text-slate-800">Your features</h2><p className="mt-0.5 text-sm text-slate-500">From your active plugins, as far as your role allows.</p></div>
              <Link href="/admin/plugins" className="btn btn-secondary">＋ Add features</Link>
            </div>
            {pluginCards.length > 0 ? (
              <div className="mt-4 space-y-5">
                {featureGroups.map(([pluginId, cards]) => {
                  const shown = showAllFeatures ? cards : cards.slice(0, FEATURE_LIMIT);
                  return (
                    <div key={pluginId}>
                      {featureGroups.length > 1 && <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{pluginLabel(pluginId)}</h3>}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {shown.map((card) => <FeatureCard key={`${card.pluginId}:${card.id}`} {...card} />)}
                      </div>
                      {cards.length > FEATURE_LIMIT && (
                        <button type="button" onClick={() => setShowAllFeatures((value) => !value)} className="mt-3 text-sm font-semibold text-indigo-600 hover:text-indigo-800">
                          {showAllFeatures ? 'Show fewer' : `Show all ${cards.length} features`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card mt-4 overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50 p-6"><h3 className="text-lg font-semibold text-slate-800">Build your school with plugins</h3><p className="mt-2 text-sm text-slate-500">This clean installation intentionally starts without attendance, classes, finance, transport, or other optional modules. Add only what your school needs.</p></div>
                <ol className="divide-y divide-slate-100">{onboarding.map((step, index) => (
                  <li key={step.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>{step.complete ? '✓' : index + 1}</span>
                    <div className="flex-1"><h4 className="font-semibold text-slate-800">{step.title}</h4><p className="mt-1 text-sm text-slate-500">{step.description}</p></div>
                    <Link href={step.href} className="btn btn-secondary">{step.complete ? 'Review' : step.id === 'link' ? 'Link marketplace' : step.id === 'browse' ? 'Browse plugins' : 'Open Plugin Manager'}</Link>
                  </li>
                ))}</ol>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

const TONE = {
  good: { text: 'text-emerald-700', soft: 'bg-emerald-50', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  warn: { text: 'text-amber-700', soft: 'bg-amber-50', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  bad: { text: 'text-rose-700', soft: 'bg-rose-50', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  info: { text: 'text-indigo-700', soft: 'bg-indigo-50', bar: 'bg-indigo-500', dot: 'bg-indigo-500' },
  neutral: { text: 'text-slate-800', soft: 'bg-slate-50', bar: 'bg-slate-300', dot: 'bg-slate-400' },
} as const;

export function WidgetCard({ widget }: { widget: PluginDashboardWidget }) {
  const segments = widget.segments || [];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <article className="card flex flex-col p-5" data-widget={widget.id}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{pluginLabel(widget.pluginId)}</p>
          <h3 className="text-base font-bold text-slate-800">{widget.title}</h3>
          {widget.description && <p className="mt-0.5 text-sm text-slate-500">{widget.description}</p>}
        </div>
        {widget.href && <Link href={widget.href} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">Open →</Link>}
      </header>
      {widget.stats.length > 0 && (
        <div className="mt-4 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))' }}>
          {widget.stats.map((stat) => {
            const tone = TONE[stat.tone] || TONE.neutral;
            const body = (
              <>
                <span className="block text-xs font-semibold leading-tight text-slate-500">{stat.label}</span>
                <span className={`mt-1 block font-bold tabular-nums ${stat.value.length > 10 ? 'break-words text-base leading-snug' : stat.value.length > 6 ? 'truncate text-lg' : 'truncate text-2xl'} ${tone.text}`} title={stat.value}>{stat.value}</span>
                {stat.hint && <span className="mt-0.5 block text-xs leading-snug text-slate-500">{stat.hint}</span>}
              </>
            );
            return stat.href
              ? <Link key={stat.id} href={stat.href} data-stat={stat.id} className={`block rounded-xl ${tone.soft} p-3 transition hover:ring-2 hover:ring-indigo-200`}>{body}</Link>
              : <div key={stat.id} data-stat={stat.id} className={`rounded-xl ${tone.soft} p-3`}>{body}</div>;
          })}
        </div>
      )}
      {total > 0 && (
        <div className="mt-4">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
            {segments.filter((s) => s.value > 0).map((segment) => (
              <span key={segment.label} className={TONE[segment.tone].bar} style={{ width: `${(segment.value / total) * 100}%` }} title={`${segment.label}: ${segment.value}`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {segments.map((segment) => (
              <span key={segment.label} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${TONE[segment.tone].dot}`} />{segment.label} <b className="font-semibold text-slate-700">{segment.value}</b></span>
            ))}
          </div>
        </div>
      )}
      {widget.items && widget.items.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {widget.itemsTitle && <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">{widget.itemsTitle}</p>}
          <ul className="divide-y divide-slate-50">
            {widget.items.map((item, index) => {
              const row = (
                <>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[item.tone].dot}`} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-700">{item.label}</span>{item.hint && <span className="block truncate text-xs text-slate-500">{item.hint}</span>}</span>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${TONE[item.tone].text}`}>{item.value}</span>
                </>
              );
              return <li key={`${item.label}:${index}`}>{item.href
                ? <Link href={item.href} className="flex items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-slate-50">{row}</Link>
                : <div className="flex items-center gap-3 px-1 py-1.5">{row}</div>}</li>;
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

export function FeatureCard({ label, href, description }: { label: string; href: string; description: string }) {
  return (
    <Link href={href} className="card group flex items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-sm font-bold text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white">{label.charAt(0)}</span>
      <span className="min-w-0"><span className="block font-semibold text-slate-800">{label}</span><span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{description}</span></span>
    </Link>
  );
}
