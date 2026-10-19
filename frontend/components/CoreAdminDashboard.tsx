'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminNav } from '../lib/admin-nav';
import { apiFetch } from '../lib/api';
import { DashboardExtensionCard, marketplaceOnboarding, pluginDashboardCards } from '../lib/dashboard-extensions';
import Sidebar from './Sidebar';

interface BillingControl {
  access?: string;
  reason?: string | null;
  billing?: { currency?: string; outstandingMinor?: number };
}
interface MarketplaceLinkStatus { linked?: boolean }

const coreCards = [
  { label: 'Manage users', href: '/admin/users', description: 'Accounts, roles and access.' },
  { label: 'Manage plugins', href: '/admin/plugins', description: 'Install, activate and update features.' },
  { label: 'System health', href: '/admin/system', description: 'Runtime, database, migrations and updates.' },
  { label: 'Backup & restore', href: '/admin/backup', description: 'Review operational recovery status.' },
];

export default function CoreAdminDashboard() {
  const [pluginCards, setPluginCards] = useState<DashboardExtensionCard[]>([]);
  const [billing, setBilling] = useState<BillingControl | null>(null);
  const [linkStatus, setLinkStatus] = useState<MarketplaceLinkStatus | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/plugin-api/my-extensions'),
      apiFetch('/api/admin/marketplace/billing-control'),
      apiFetch('/api/admin/marketplace/link/status'),
    ]).then(async ([extensionsResponse, billingResponse, linkResponse]) => {
      if (extensionsResponse.ok) {
        const extensions = await extensionsResponse.json();
        setPluginCards(pluginDashboardCards(extensions?.navigation));
      }
      if (billingResponse.ok) setBilling(await billingResponse.json());
      if (linkResponse.ok) setLinkStatus(await linkResponse.json());
    }).catch(() => undefined);
  }, []);

  const outstanding = billing?.billing?.outstandingMinor || 0;
  const currency = billing?.billing?.currency || 'USD';
  const onboarding = marketplaceOnboarding(Boolean(linkStatus?.linked), pluginCards.length);

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanam Core" navItems={adminNav} accentColor="indigo" />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <header className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">School dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Core operations and features supplied by active plugins.</p>
        </header>
        <div className="page-body space-y-8">
          {(billing?.access === 'SUSPENDED' || outstanding > 0) && (
            <Link href="/admin/platform-billing" className={`block rounded-xl border p-4 ${billing?.access === 'SUSPENDED' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <strong>{billing?.access === 'SUSPENDED' ? 'School access suspended' : 'Platform invoice outstanding'}</strong>
              <p className="mt-1 text-sm">{billing?.reason || `${(outstanding / 100).toFixed(2)} ${currency} outstanding. Open Platform Billing for details.`}</p>
            </Link>
          )}

          <section>
            <h2 className="text-lg font-semibold text-slate-800">Core operations</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {coreCards.map((card) => <DashboardCard key={card.href} {...card} />)}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-4">
              <div><h2 className="text-lg font-semibold text-slate-800">Installed features</h2><p className="mt-1 text-sm text-slate-500">Visible cards come from active plugins and your granted permissions.</p></div>
              <Link href="/admin/plugins" className="btn btn-primary">Add features</Link>
            </div>
            {pluginCards.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pluginCards.map((card) => <DashboardCard key={`${card.pluginId}:${card.id}`} {...card} />)}
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

function DashboardCard({ label, href, description }: { label: string; href: string; description: string }) {
  return <Link href={href} className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-md"><h3 className="font-semibold text-slate-800">{label}</h3><p className="mt-2 text-sm text-slate-500">{description}</p><span className="mt-4 inline-block text-sm font-semibold text-indigo-600">Open →</span></Link>;
}
