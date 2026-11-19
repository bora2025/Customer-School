'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { DashboardExtensionCard, pluginDashboardCards, PluginDashboardWidget, pluginDashboardWidgets } from '../lib/dashboard-extensions';
import { ROLE_INFO, workspaceNav, workspaceTitle } from '../lib/workspace-nav';
import { WidgetCard } from './CoreAdminDashboard';
import { AvatarPicker, PasswordForm, useMyAccount } from './ProfileParts';
import Sidebar from './Sidebar';

/**
 * The Teacher Portal's home, which is also the teacher's profile: who they are (photo, contacts, staff
 * record), their daily work (the plugin pages their role may open, most-used first), today in their
 * classes (GET /api/plugin-api/dashboard), their own attendance (GET /api/plugin-api/profile) and their
 * account settings.
 */
export default function TeacherHome() {
  const { me, photoBusy, photoError, changePhoto } = useMyAccount();
  const [tasks, setTasks] = useState<DashboardExtensionCard[] | null>(null);
  const [today, setToday] = useState<PluginDashboardWidget[] | null>(null);
  const [profile, setProfile] = useState<PluginDashboardWidget[] | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    apiFetch('/api/plugin-api/my-extensions')
      .then(async (response) => setTasks(response.ok ? pluginDashboardCards((await response.json())?.navigation) : []))
      .catch(() => setTasks([]));
    apiFetch('/api/plugin-api/profile')
      .then(async (response) => setProfile(response.ok ? pluginDashboardWidgets(await response.json()) : []))
      .catch(() => setProfile([]));
    const loadToday = () => apiFetch('/api/plugin-api/dashboard')
      .then(async (response) => setToday(response.ok ? pluginDashboardWidgets(await response.json()) : []))
      .catch(() => setToday((current) => current || []));
    loadToday();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') loadToday(); }, 60_000);
    // the old My Profile address (and #account) opens the account settings here
    if (window.location.hash === '#account') setAccountOpen(true);
    return () => window.clearInterval(timer);
  }, []);

  const info = ROLE_INFO.TEACHER;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const work = useMemo(() => (tasks || []).slice().sort((a, b) => taskWeight(b) - taskWeight(a)), [tasks]);
  // The staff record is shown in the header; the rest of the profile next to today's classes.
  const staff = profile?.find((card) => card.id === 'staff-record');
  const staffStat = (id: string) => staff?.stats.find((stat) => stat.id === id)?.value;
  const hasTodayClasses = (today || []).some((card) => card.id === 'my-classes');
  const side = (profile || []).filter((card) => card.id !== 'staff-record' && !(hasTodayClasses && card.id === 'my-classes'));
  const facts = [['Staff ID', staffStat('number')], ['Position', staffStat('position')], ['Department', staffStat('department')]]
    .filter((pair): pair is [string, string] => Boolean(pair[1]) && pair[1] !== '—');

  return (
    <div className="page-shell">
      <Sidebar title={workspaceTitle('TEACHER')} subtitle={info.label} navItems={workspaceNav('TEACHER')} accentColor="emerald" />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-body space-y-6">
          {/* who I am */}
          <section className="card overflow-hidden" aria-label="My profile">
            <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 pb-14 pt-5 text-white sm:px-7">
              <p className="text-sm font-medium text-emerald-50">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <p className="mt-0.5 text-lg font-semibold">{greeting} 👋</p>
            </div>
            <div className="flex flex-col gap-3 px-5 pb-5 sm:flex-row sm:items-start sm:gap-5 sm:px-7">
              <div className="-mt-12"><AvatarPicker me={me} busy={photoBusy} onPick={changePhoto} size={104} /></div>
              <div className="min-w-0 flex-1 sm:pt-3">
                <h1 className="truncate text-2xl font-bold text-slate-800" data-testid="teacher-name">{me?.name || 'Teacher'}</h1>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-emerald-50 px-3 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">{info.label} · {info.kh}</span>
                  {facts.map(([label, value]) => <span key={label} className="rounded-full bg-slate-100 px-3 py-0.5 text-slate-700" data-fact={label}><span className="text-slate-500">{label}</span> <b className="font-semibold">{value}</b></span>)}
                </p>
                {(me?.email || me?.phone) && (
                  <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                    {me?.email && <span>✉️ {me.email}</span>}
                    {me?.phone && <span>📞 {me.phone}</span>}
                  </p>
                )}
              </div>
              <div className="flex text-sm sm:pt-3">
                <button type="button" onClick={() => { setAccountOpen(true); setTimeout(() => document.getElementById('account')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }} className="mt-1 font-semibold text-emerald-700 hover:text-emerald-900">⚙️ Account settings</button>
              </div>
            </div>
            {photoError && <p className="px-5 pb-4 text-sm text-red-600 sm:px-7" role="alert">{photoError}</p>}
            {staff && !staff.stats.some((stat) => stat.id === 'position') && staff.description && <p className="px-5 pb-4 text-sm text-amber-700 sm:px-7">{staff.description}</p>}
          </section>

          {/* my work */}
          <section aria-labelledby="work-title">
            <h2 id="work-title" className="text-lg font-bold text-slate-800">Today&apos;s work</h2>
            {tasks === null ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="card h-24 animate-pulse bg-slate-50" />)}</div>
            ) : work.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="work">
                {work.map((card, index) => <TaskTile key={`${card.pluginId}:${card.id}`} card={card} primary={index < 4} />)}
              </div>
            ) : (
              <div className="card mt-3 p-6">
                <p className="font-semibold text-slate-800">Nothing is open to teachers yet.</p>
                <p className="mt-1 text-sm text-slate-500">Ask your school administrator to give the Teacher role access on <b>Roles &amp; access</b>.</p>
              </div>
            )}
          </section>

          {/* today in my classes, and my own attendance */}
          {(today === null || profile === null || (today || []).length > 0 || side.length > 0) && (
            <section aria-labelledby="today-title" className="space-y-3">
              <h2 id="today-title" className="text-lg font-bold text-slate-800">Today</h2>
              {today === null || profile === null ? (
                <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((key) => <div key={key} className="card h-48 animate-pulse bg-slate-50" />)}</div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                  {[...(today || []), ...side].map((card) => <WidgetCard key={`${card.pluginId}:${card.id}`} widget={card} />)}
                </div>
              )}
            </section>
          )}

          {/* account */}
          <section id="account" className="card" aria-labelledby="account-title">
            <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-controls="account-body" className="flex w-full items-center justify-between gap-3 p-5 text-left">
              <span><span id="account-title" className="block text-lg font-bold text-slate-800">Account settings</span><span className="text-sm text-slate-500">Photo, password and sign-in. Your staff record is kept by the school office.</span></span>
              <span className={`text-slate-400 transition ${accountOpen ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
            </button>
            {accountOpen && (
              <div id="account-body" className="border-t border-slate-100 p-5">
                <h3 className="font-semibold text-slate-800">Change password</h3>
                <div className="mt-1"><PasswordForm /></div>
              </div>
            )}
          </section>
          <p className="text-xs text-slate-400">Need a different page? Your administrator decides what teachers can open. <Link href="/settings/notifications" className="underline">Notification settings</Link></p>
        </div>
      </main>
    </div>
  );
}

// A teacher's daily work first: their class, attendance, permissions, scores, classes, then documents.
function taskWeight(card: DashboardExtensionCard) {
  const text = `${card.label} ${card.href}`;
  if (/my class|\/my-class/i.test(text)) return 7;
  if (/take attendance|\/attendance$|\/attendance\?|scan/i.test(text)) return 6;
  if (/permission/i.test(text)) return 5;
  if (/enter scores|score-entry/i.test(text)) return 4;
  if (/score sheet/i.test(text)) return 3;
  if (/^classes|\/classes$/i.test(text)) return 2;
  return /attendance/i.test(text) ? 1 : 0;
}

const TASK_STYLE: Array<[RegExp, string, string]> = [
  [/attendance|scan/i, '📷', 'bg-emerald-100 text-emerald-700'],
  [/permission/i, '📝', 'bg-amber-100 text-amber-700'],
  [/score|grade/i, '📊', 'bg-indigo-100 text-indigo-700'],
  [/class/i, '🏫', 'bg-sky-100 text-sky-700'],
  [/progress|record|report|book|card/i, '📘', 'bg-violet-100 text-violet-700'],
  [/rank|honor/i, '🏆', 'bg-rose-100 text-rose-700'],
];

function TaskTile({ card, primary }: { card: DashboardExtensionCard; primary: boolean }) {
  const [, icon, tone] = TASK_STYLE.find(([pattern]) => pattern.test(card.label)) || [/./, '📌', 'bg-slate-100 text-slate-700'];
  return (
    <Link href={card.href} data-task={card.id}
      className={`card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md ${primary ? 'sm:min-h-[96px]' : ''}`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ${tone}`} aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold text-slate-800 group-hover:text-emerald-700">{card.label}</span>
        <span className="block truncate text-xs text-slate-500">{card.description}</span>
      </span>
    </Link>
  );
}
