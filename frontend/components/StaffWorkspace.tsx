'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../lib/api';
import { DashboardExtensionCard, pluginDashboardCards, PluginDashboardWidget, pluginDashboardWidgets } from '../lib/dashboard-extensions';
import { storedRole } from '../lib/school-lock';
import { ROLE_INFO, workspaceNav, workspaceTitle } from '../lib/workspace-nav';
import { FeatureCard, WidgetCard } from './CoreAdminDashboard';
import GlobalSearchBox from './GlobalSearchBox';
import Sidebar from './Sidebar';

/**
 * Home of the staff roles (Wattaman, Receptionist) in a core installation: their tasks are the plugin
 * pages granted to their role on Roles & access; the Receptionist also searches from here.
 */
export default function StaffWorkspace() {
  const [role, setRole] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tasks, setTasks] = useState<DashboardExtensionCard[] | null>(null);
  const [widgets, setWidgets] = useState<PluginDashboardWidget[]>([]);

  useEffect(() => {
    setRole(storedRole());
    getCurrentUser().then((user) => { if (user) { setName(user.name || ''); setRole(user.role); } }).catch(() => undefined);
    apiFetch('/api/plugin-api/my-extensions')
      .then(async (response) => setTasks(response.ok ? pluginDashboardCards((await response.json())?.navigation) : []))
      .catch(() => setTasks([]));
    const loadWidgets = () => apiFetch('/api/plugin-api/dashboard')
      .then(async (response) => { if (response.ok) setWidgets(pluginDashboardWidgets(await response.json())); })
      .catch(() => undefined);
    loadWidgets();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') loadWidgets(); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const info = ROLE_INFO[role || ''];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // The scanning role's first tasks are its scanners; keep them first.
  // The scanning role's first tasks are its scanners; a teacher's are the class's daily work.
  const weight = (card: DashboardExtensionCard) => {
    const text = card.label + ' ' + card.href;
    if (/scan|take attendance|\/attendance$/i.test(text)) return 5;
    if (role === 'TEACHER' && /permission/i.test(text)) return 4;
    if (role === 'TEACHER' && /enter scores|score sheet/i.test(text)) return 3;
    if (role === 'TEACHER' && /^classes|\/classes$/i.test(text)) return 2;
    return /attendance/i.test(text) ? 1 : 0;
  };
  const ordered = (tasks || []).slice().sort((a, b) => weight(b) - weight(a));
  const primary = role === 'WATTAMAN' || role === 'TEACHER' ? ordered : tasks || [];

  return (
    <div className="page-shell">
      <Sidebar title={workspaceTitle(role)} subtitle={info?.label || 'Wattanam'} navItems={workspaceNav(role)} accentColor={role === 'TEACHER' ? 'emerald' : 'indigo'} />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-body space-y-6">
          <section className="rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-5 text-white shadow-lg sm:p-7">
            <p className="text-sm font-medium text-indigo-100">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{greeting}{name ? `, ${name}` : ''}</h1>
            {info && <p className="mt-2 inline-flex flex-wrap items-center gap-2 text-sm text-indigo-100"><span className="rounded-full bg-white/20 px-3 py-0.5 font-semibold text-white">{info.label} · {info.kh}</span>{info.description}</p>}
            {role === 'RECEPTIONIST' && <div className="mt-5 max-w-3xl"><GlobalSearchBox searchPath="/workspace/search" placeholder="Find a student or teacher — name, ID, phone…" /></div>}
          </section>

          <section aria-labelledby="tasks-title">
            <h2 id="tasks-title" className="text-lg font-bold text-slate-800">Your work</h2>
            {tasks === null ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((key) => <div key={key} className="card h-20 animate-pulse bg-slate-50" />)}</div>
            ) : primary.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {primary.map((card) => <FeatureCard key={`${card.pluginId}:${card.id}`} {...card} />)}
              </div>
            ) : (
              <div className="card mt-4 p-6">
                <p className="font-semibold text-slate-800">Nothing is open to your role yet.</p>
                <p className="mt-1 text-sm text-slate-500">Ask your school administrator to give the {info?.label || 'staff'} role access on <b>Roles &amp; access</b>.</p>
              </div>
            )}
          </section>

          {widgets.length > 0 && (
            <section aria-labelledby="today-title" className="space-y-4">
              <h2 id="today-title" className="text-lg font-bold text-slate-800">Today</h2>
              <div className="grid gap-4 xl:grid-cols-2">{widgets.map((widget) => <WidgetCard key={`${widget.pluginId}:${widget.id}`} widget={widget} />)}</div>
            </section>
          )}
          <p className="text-xs text-slate-400">Need a different page? Your administrator decides what your role can open. <Link href="/settings/notifications" className="underline">Notification settings</Link></p>
        </div>
      </main>
    </div>
  );
}
