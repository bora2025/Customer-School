'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { PluginDashboardWidget, pluginDashboardWidgets } from '../lib/dashboard-extensions';
import { storedRole } from '../lib/school-lock';
import { ROLE_INFO, workspaceNav, workspaceTitle } from '../lib/workspace-nav';
import { WidgetCard } from './CoreAdminDashboard';
import { initials } from './GlobalSearchBox';
import Sidebar from './Sidebar';

const MINIMUM_LENGTH = 12;
const MAX_PHOTO_EDGE = 512;

interface Me { id: string; name?: string | null; email?: string | null; phone?: string | null; photo?: string | null; role: string }

function toSquareJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That file is not an image this browser can read'));
      image.onload = () => {
        const edge = Math.min(image.width, image.height);
        const size = Math.min(edge, MAX_PHOTO_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const g = canvas.getContext('2d');
        if (!g) return reject(new Error('This browser cannot process images'));
        g.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * My Profile for the staff roles (Teacher, Wattaman, Receptionist): the account (photo, contacts,
 * password) and what each active plugin holds about them (GET /api/plugin-api/profile) — for a teacher,
 * the staff record, their classes and their own attendance this month.
 */
export default function MyProfile() {
  const [me, setMe] = useState<Me | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [cards, setCards] = useState<PluginDashboardWidget[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setRole(storedRole());
    apiFetch('/api/auth/me').then(async (response) => { if (response.ok) { const user = await response.json(); setMe(user); setRole(user.role); } }).catch(() => undefined);
    apiFetch('/api/plugin-api/profile')
      .then(async (response) => setCards(response.ok ? pluginDashboardWidgets(await response.json()) : []))
      .catch(() => setCards([]));
  }, []);

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true); setPhotoError('');
    try {
      const photo = await toSquareJpeg(file);
      const response = await apiFetch('/api/auth/profile/photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photo }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not save the photo');
      setMe((current) => (current ? { ...current, photo: result.photo ?? photo } : current));
    } catch (cause) { setPhotoError(cause instanceof Error ? cause.message : 'Could not save the photo'); }
    finally { setPhotoBusy(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice('');
    if (newPassword !== confirmPassword) return setError('The two new passwords do not match.');
    if (newPassword.length < MINIMUM_LENGTH) return setError(`The new password must be at least ${MINIMUM_LENGTH} characters.`);
    setBusy(true);
    try {
      const response = await apiFetch('/api/auth/password/change', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not change the password');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice(result.revokedSessions > 0 ? `Password changed. ${result.revokedSessions} other ${result.revokedSessions === 1 ? 'session was' : 'sessions were'} signed out.` : 'Password changed.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change the password'); }
    finally { setBusy(false); }
  }

  const info = ROLE_INFO[role || ''];
  return (
    <div className="page-shell">
      <Sidebar title={workspaceTitle(role)} subtitle={info?.label || 'Wattanam'} navItems={workspaceNav(role)} accentColor={role === 'TEACHER' ? 'emerald' : 'indigo'} />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-body space-y-6">
          {/* the person */}
          <section className="card overflow-hidden" aria-label="My account">
            <div className="h-20 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
            <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
              <div className="-mt-12 shrink-0">
                <label className="group relative block h-28 w-28 cursor-pointer overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-md" title="Change photo">
                  {me?.photo
                    ? <img src={me.photo} alt="" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center text-3xl font-bold text-slate-500">{initials(me?.name || me?.email || '?')}</span>}
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">{photoBusy ? 'Saving…' : 'Change photo'}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Change photo" onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ''; }} />
                </label>
              </div>
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

          {/* what the plugins hold about me */}
          {cards === null ? (
            <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map((key) => <div key={key} className="card h-40 animate-pulse bg-slate-50" />)}</div>
          ) : cards.length > 0 && (
            <div className="grid gap-4 xl:grid-cols-2">{cards.map((card) => <WidgetCard key={`${card.pluginId}:${card.id}`} widget={card} />)}</div>
          )}

          {/* password */}
          <section className="card max-w-2xl p-5" aria-labelledby="password-title">
            <h2 id="password-title" className="text-lg font-bold text-slate-800">Change password</h2>
            <p className="mt-1 text-sm text-slate-500">Enter your current password, then the new one twice (at least {MINIMUM_LENGTH} characters). Your other sessions are signed out.</p>
            <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold text-slate-700">Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input mt-1 w-full" required /></label>
              <label className="text-sm font-semibold text-slate-700">New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input mt-1 w-full" required /></label>
              <label className="text-sm font-semibold text-slate-700">Repeat new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input mt-1 w-full" required /></label>
              <div className="sm:col-span-3"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
            </form>
            {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</p>}
            {notice && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
          </section>
        </div>
      </main>
    </div>
  );
}
