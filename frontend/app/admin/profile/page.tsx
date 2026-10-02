'use client';

import { FormEvent, useEffect, useState } from 'react';
import AuthGuard from '../../../components/AuthGuard';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';

interface CurrentUser {
  id: string;
  email: string | null;
  name: string;
  role: string;
  photo: string | null;
}

const MINIMUM_LENGTH = 12;

/** Downscaled before upload, not after: the photo is stored inline in the user row, so shrinking it
 * in the browser is what keeps that row small rather than relying on the server to refuse. */
const MAX_PHOTO_EDGE = 512;

function toSquareJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That file is not an image this browser can read'));
      image.onload = () => {
        // Centre-cropped to a square so the avatar is not distorted by a wide or tall original.
        const edge = Math.min(image.width, image.height);
        const size = Math.min(edge, MAX_PHOTO_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) return reject(new Error('This browser cannot process images'));
        context.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The signed-in administrator's own account.
 *
 * Its reason for existing is the password form. Until now the only way to change a school
 * administrator's password was for someone with deploy access to run a break-glass script over
 * SSH, which is a poor answer to "I would like a different password" and left the account
 * dependent on whoever holds that access.
 */
export default function AdminProfilePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUrl: string; recoveryCodes: string[] } | null>(null);
  const [mfaMessage, setMfaMessage] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(response => (response.ok ? response.json() : null))
      .then(value => value && setUser(value))
      .catch(() => undefined);
  }, []);

  async function savePhoto(photo: string) {
    setPhotoBusy(true); setPhotoError('');
    try {
      const response = await apiFetch('/api/auth/profile/photo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not save the photo');
      setUser(current => (current ? { ...current, photo: result.photo ?? null } : current));
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'Could not save the photo');
    } finally { setPhotoBusy(false); }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError('');
    try {
      await savePhoto(await toSquareJpeg(file));
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'Could not read that image');
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(''); setNotice('');
    // Checked here as well as on the server so the mistake is caught before the current password is
    // sent anywhere, not after.
    if (newPassword !== confirmPassword) return setError('The two new passwords do not match.');
    if (newPassword.length < MINIMUM_LENGTH) return setError(`New password must be at least ${MINIMUM_LENGTH} characters.`);

    setBusy(true);
    try {
      const response = await apiFetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not change the password');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setNotice(result.revokedSessions > 0
        ? `Password changed. ${result.revokedSessions} other ${result.revokedSessions === 1 ? 'session was' : 'sessions were'} signed out.`
        : 'Password changed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the password');
    } finally { setBusy(false); }
  }

  async function beginMfa(event: FormEvent) {
    event.preventDefault(); setMfaBusy(true); setMfaMessage('');
    try {
      const response = await apiFetch('/api/auth/mfa/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: mfaPassword }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not start MFA setup');
      setMfaSetup(result); setMfaPassword('');
    } catch (cause) { setMfaMessage(cause instanceof Error ? cause.message : 'Could not start MFA setup'); }
    finally { setMfaBusy(false); }
  }

  async function enableMfa(event: FormEvent) {
    event.preventDefault(); setMfaBusy(true); setMfaMessage('');
    try {
      const response = await apiFetch('/api/auth/mfa/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: mfaCode }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Could not enable MFA');
      setMfaCode(''); setMfaMessage('MFA enabled. Store the recovery codes safely before leaving this page.');
    } catch (cause) { setMfaMessage(cause instanceof Error ? cause.message : 'Could not enable MFA'); }
    finally { setMfaBusy(false); }
  }

  return (
    <AuthGuard allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <h1 className="text-2xl font-bold text-slate-800">My profile</h1>
            <p className="mt-1 text-sm text-slate-500">The account you are signed in with on this school&apos;s admin panel.</p>
          </div>

          <div className="page-body space-y-6">
            <section className="card p-6">
              <h2 className="font-semibold text-slate-800">Signed in as</h2>

              <div className="mt-4 flex flex-wrap items-center gap-5">
                {user?.photo
                  ? <img src={user.photo} alt="" className="h-24 w-24 rounded-full object-cover ring-1 ring-slate-200" />
                  : <div aria-hidden="true" className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 text-2xl font-semibold text-slate-400">
                      {(user?.name || '?').trim().charAt(0).toUpperCase()}
                    </div>}
                <div>
                  <div className="flex flex-wrap gap-2">
                    <label className={`btn btn-secondary cursor-pointer ${photoBusy ? 'pointer-events-none opacity-50' : ''}`}>
                      {photoBusy ? 'Saving…' : user?.photo ? 'Change photo' : 'Upload photo'}
                      <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={photoBusy}
                        onChange={event => { choosePhoto(event.target.files?.[0]); event.target.value = ''; }} />
                    </label>
                    {user?.photo && <button className="btn btn-secondary" disabled={photoBusy} onClick={() => savePhoto('')}>Remove</button>}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    PNG, JPEG, or WebP. Cropped to a square and reduced to {MAX_PHOTO_EDGE}px in your browser before it is saved.
                  </p>
                  {photoError && <p role="alert" className="mt-2 text-xs text-red-700">{photoError}</p>}
                </div>
              </div>

              <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
                <Item label="Name" value={user?.name ?? '—'} />
                <Item label="Email" value={user?.email ?? '—'} />
                <Item label="Role" value={user?.role ?? '—'} />
              </dl>
              {/* Said plainly because the same address is also a marketplace account with its own,
                  different password -- a distinction that is easy to miss when both sign-in screens
                  are served from this one domain. */}
              <p className="mt-4 text-xs text-slate-500">
                This is your school administrator account. Your marketplace customer account may use the same
                email address, but it is a separate account with its own password and its own authenticator.
              </p>
            </section>

            <section className="card p-6">
              <h2 className="font-semibold text-slate-800">Change password</h2>
              <p className="mt-1 text-sm text-slate-500">
                Your current password is required, so someone who found this browser signed in cannot lock you
                out of your own account. Changing it signs out every other device.
              </p>

              <form className="mt-4 grid gap-4 sm:max-w-md" onSubmit={changePassword}>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current password</span>
                  <input type="password" autoComplete="current-password" required value={currentPassword}
                    onChange={event => setCurrentPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <div>
                  <label className="text-sm" htmlFor="new-password">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">New password</span>
                  </label>
                  <input id="new-password" type="password" autoComplete="new-password" required minLength={MINIMUM_LENGTH}
                    value={newPassword} onChange={event => setNewPassword(event.target.value)} aria-describedby="new-password-hint"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  {/* Outside the label and attached with aria-describedby: nested, it would fold into
                      the field's accessible name. */}
                  <p id="new-password-hint" className="mt-1 text-xs text-slate-500">At least {MINIMUM_LENGTH} characters.</p>
                </div>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Confirm new password</span>
                  <input type="password" autoComplete="new-password" required value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>

                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

                <button className="btn btn-primary justify-self-start" type="submit"
                  disabled={busy || !currentPassword || newPassword.length < MINIMUM_LENGTH}>
                  {busy ? 'Changing…' : 'Change password'}
                </button>
              </form>
            </section>

            <section className="card p-6">
              <h2 className="font-semibold text-slate-800">Authenticator MFA</h2>
              <p className="mt-1 text-sm text-slate-500">Protect this school account with Google Authenticator or another TOTP application.</p>
              {!mfaSetup ? (
                <form className="mt-4 grid gap-3 sm:max-w-md" onSubmit={beginMfa}>
                  <input type="password" autoComplete="current-password" required value={mfaPassword} onChange={event => setMfaPassword(event.target.value)} placeholder="Current password" />
                  <button className="btn btn-primary justify-self-start" disabled={mfaBusy}>{mfaBusy ? 'Preparing…' : 'Set up MFA'}</button>
                </form>
              ) : (
                <form className="mt-4 grid gap-4 sm:max-w-xl" onSubmit={enableMfa}>
                  <div className="rounded-lg bg-slate-50 p-4 text-sm">
                    <p className="font-semibold">Authenticator secret</p><code className="mt-1 block break-all select-all">{mfaSetup.secret}</code>
                    <p className="mt-3 font-semibold">One-time recovery codes</p>
                    <div className="mt-1 grid grid-cols-2 gap-1 font-mono">{mfaSetup.recoveryCodes.map(code => <code key={code}>{code}</code>)}</div>
                  </div>
                  <input required value={mfaCode} onChange={event => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit authenticator code" maxLength={6} />
                  <button className="btn btn-primary justify-self-start" disabled={mfaBusy}>{mfaBusy ? 'Checking…' : 'Verify and enable'}</button>
                </form>
              )}
              {mfaMessage && <p role="status" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{mfaMessage}</p>}
            </section>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-all text-sm text-slate-700">{value}</dd>
    </div>
  );
}
