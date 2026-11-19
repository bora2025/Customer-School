'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { PluginDashboardWidget, pluginDashboardWidgets } from '../lib/dashboard-extensions';
import { storedRole } from '../lib/school-lock';
import { ROLE_INFO, workspaceNav, workspaceTitle } from '../lib/workspace-nav';
import { WidgetCard } from './CoreAdminDashboard';
import { AvatarPicker, PasswordForm, useMyAccount } from './ProfileParts';
import Sidebar from './Sidebar';

/**
 * My Profile for the staff roles (Wattaman, Receptionist; teachers have it on their portal home): the
 * account (photo, contacts, password) and what each active plugin holds about them
 * (GET /api/plugin-api/profile).
 */
export default function MyProfile() {
  const { me, photoBusy, photoError, changePhoto } = useMyAccount();
  const [role, setRole] = useState<string | null>(null);
  const [cards, setCards] = useState<PluginDashboardWidget[] | null>(null);

  useEffect(() => {
    setRole(storedRole());
    apiFetch('/api/plugin-api/profile')
      .then(async (response) => setCards(response.ok ? pluginDashboardWidgets(await response.json()) : []))
      .catch(() => setCards([]));
  }, []);
  useEffect(() => { if (me?.role) setRole(me.role); }, [me]);

  const info = ROLE_INFO[role || ''];
  return (
    <div className="page-shell">
      <Sidebar title={workspaceTitle(role)} subtitle={info?.label || 'Wattanam'} navItems={workspaceNav(role)} accentColor={role === 'TEACHER' ? 'emerald' : 'indigo'} />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-body space-y-6">
          <section className="card overflow-hidden" aria-label="My account">
            <div className="h-20 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
            <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
              <div className="-mt-12"><AvatarPicker me={me} busy={photoBusy} onPick={changePhoto} /></div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold text-slate-800">{me?.name || 'My Profile'}</h1>
                {info && <p className="mt-1 inline-flex items-center gap-2 text-sm"><span className="rounded-full bg-emerald-50 px-3 py-0.5 font-semibold text-emerald-700">{info.label} · {info.kh}</span></p>}
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex gap-2"><dt className="text-slate-500">Email</dt><dd className="truncate font-medium text-slate-800">{me?.email || '—'}</dd></div>
                  <div className="flex gap-2"><dt className="text-slate-500">Phone</dt><dd className="font-medium text-slate-800">{me?.phone || '—'}</dd></div>
                </dl>
                {photoError && <p className="mt-2 text-sm text-red-600" role="alert">{photoError}</p>}
              </div>
            </div>
          </section>

          {cards === null ? (
            <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((key) => <div key={key} className="card h-40 animate-pulse bg-slate-50" />)}</div>
          ) : cards.length > 0 && (
            <div className="grid gap-4 xl:grid-cols-2">{cards.map((card) => <WidgetCard key={`${card.pluginId}:${card.id}`} widget={card} />)}</div>
          )}

          <section className="card max-w-2xl p-5" aria-labelledby="password-title">
            <h2 id="password-title" className="text-lg font-bold text-slate-800">Change password</h2>
            <div className="mt-1"><PasswordForm /></div>
          </section>
        </div>
      </main>
    </div>
  );
}
