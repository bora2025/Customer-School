'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/** Shared by My Profile and the Teacher Portal home: the signed-in account, its photo and password. */
export interface Me { id: string; name?: string | null; email?: string | null; phone?: string | null; photo?: string | null; role: string }

export const MINIMUM_PASSWORD_LENGTH = 12;
const MAX_PHOTO_EDGE = 512;

export function toSquareJpeg(file: File): Promise<string> {
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

/** The signed-in account (GET /api/auth/me) and its own photo (POST /api/auth/profile/photo). */
export function useMyAccount() {
  const [me, setMe] = useState<Me | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  useEffect(() => {
    apiFetch('/api/auth/me').then(async (response) => { if (response.ok) setMe(await response.json()); }).catch(() => undefined);
  }, []);
  const changePhoto = useCallback(async (file: File | undefined) => {
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
  }, []);
  return { me, photoBusy, photoError, changePhoto };
}

export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '•';
}

/** The round photo; clicking it chooses a new one. */
export function AvatarPicker({ me, busy, onPick, size = 112 }: { me: Me | null; busy: boolean; onPick: (file: File | undefined) => void; size?: number }) {
  return (
    <label className="group relative block shrink-0 cursor-pointer overflow-hidden rounded-full border-4 border-white bg-slate-100 shadow-md" style={{ width: size, height: size }} title="Change photo">
      {me?.photo
        ? <img src={me.photo} alt="" className="h-full w-full object-cover" />
        : <span className="flex h-full w-full items-center justify-center text-3xl font-bold text-slate-500">{initialsOf(me?.name || me?.email || '?')}</span>}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">{busy ? 'Saving…' : '📷 Change'}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Change photo" onChange={(event) => { onPick(event.target.files?.[0]); event.target.value = ''; }} />
    </label>
  );
}

/** Change your own password (POST /api/auth/password/change). */
export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice('');
    if (newPassword !== confirmPassword) return setError('The two new passwords do not match.');
    if (newPassword.length < MINIMUM_PASSWORD_LENGTH) return setError(`The new password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
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
  return (
    <>
      <p className="text-sm text-slate-500">Enter your current password, then the new one twice (at least {MINIMUM_PASSWORD_LENGTH} characters). Your other sessions are signed out.</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input mt-1 w-full" required /></label>
        <label className="text-sm font-semibold text-slate-700">New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input mt-1 w-full" required /></label>
        <label className="text-sm font-semibold text-slate-700">Repeat new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="input mt-1 w-full" required /></label>
        <div className="sm:col-span-3"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status">{notice}</p>}
    </>
  );
}
