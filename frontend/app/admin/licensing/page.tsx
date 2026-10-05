'use client';

import { useEffect, useState, type ReactNode } from 'react';
import AuthGuard from '../../../components/AuthGuard';
import PlatformBillingPanel from '../../../components/PlatformBillingPanel';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';

interface InstallationStatus {
  marketplaceConfigured: boolean;
  registered: boolean;
  registeredAt: string | null;
}

export default function LicensingPage() {
  const [status, setStatus] = useState<InstallationStatus | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [accountRequested, setAccountRequested] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [showClaim, setShowClaim] = useState(false);
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    const response = await apiFetch('/api/admin/marketplace/installation');
    if (!response.ok) throw new Error(`Could not load registration status (${response.status})`);
    setStatus(await response.json());
  }

  useEffect(() => {
    load().catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load registration status'));
  }, []);

  async function submitAccountRequest() {
    if (!schoolName.trim() || !displayName.trim() || !email.trim() || !password) {
      return setError('Enter the school name, owner name, email, and password.');
    }
    if (password.length < 10) return setError('Marketplace passwords must contain at least 10 characters.');
    if (password !== passwordConfirm) return setError('The password confirmation does not match.');
    setBusy('account'); setError(''); setNotice('');
    try {
      const response = await apiFetch('/api/admin/marketplace/account-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schoolName: schoolName.trim(), displayName: displayName.trim(), email: email.trim(), password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `Account request failed (${response.status})`);
      setOwnerEmail(email.trim());
      setPassword(''); setPasswordConfirm('');
      setRequestId(typeof result.id === 'string' ? result.id : '');
      setAccountRequested(true); setShowClaim(true);
      setNotice('Account request sent. After Platform Admin approves it, enter the enrollment token below to claim this school.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account request failed');
    } finally { setBusy(''); }
  }

  async function register() {
    if (!enrollmentToken.trim()) return setError('Enter the one-time enrollment token from Platform Admin.');
    if (!ownerEmail.trim() || !ownerPassword) return setError('Enter the approved Marketplace owner email and password.');
    setBusy('register'); setError(''); setNotice('');
    try {
      const response = await apiFetch('/api/admin/marketplace/installation/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enrollmentToken: enrollmentToken.trim(),
          owner: { email: ownerEmail.trim(), password: ownerPassword, ...(ownerCode.trim() ? { code: ownerCode.trim() } : {}) },
          ...(label.trim() ? { label: label.trim() } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join('. ') : result.message || result.error || `Registration failed (${response.status})`);
      setOwnerPassword(''); setOwnerCode(''); setEnrollmentToken('');
      setNotice('School claimed and linked to the Marketplace successfully.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration failed');
    } finally { setBusy(''); }
  }

  return (
    <AuthGuard allowedRoles={['SUPER_ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <h1 className="text-2xl font-bold text-slate-800">Register with the Marketplace</h1>
            <p className="mt-1 text-sm text-slate-500">Request an owner account, receive an enrollment token from Platform Admin, then claim this school.</p>
          </div>
          <div className="page-body">
            <div className="mx-auto max-w-3xl space-y-5">
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
              {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
              {status && !status.marketplaceConfigured && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Marketplace connection is not configured for this installation.</div>}

              {status?.registered ? (
                <>
                  <section className="card p-6">
                    <h2 className="text-lg font-semibold text-slate-800">Marketplace registration complete</h2>
                    <p className="mt-2 text-sm text-slate-600">This customer school is linked to the Marketplace{status.registeredAt ? ` since ${new Date(status.registeredAt).toLocaleDateString()}` : ''}.</p>
                  </section>
                  <PlatformBillingPanel variant="section" />
                </>
              ) : <>
                {!accountRequested && <section className="card p-6">
                  <div className="mb-5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Step 1</span>
                    <h2 className="mt-1 text-lg font-semibold text-slate-800">Request a Marketplace account</h2>
                    <p className="mt-1 text-sm text-slate-500">Platform Admin reviews this request before creating the account.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="School name"><input className="rounded-lg border px-3 py-2" value={schoolName} onChange={e => setSchoolName(e.target.value)} /></Field>
                    <Field label="Owner full name"><input className="rounded-lg border px-3 py-2" value={displayName} onChange={e => setDisplayName(e.target.value)} /></Field>
                    <Field label="Owner email"><input type="email" autoComplete="email" className="rounded-lg border px-3 py-2" value={email} onChange={e => setEmail(e.target.value)} /></Field>
                    <div className="hidden sm:block" />
                    <Field label="Password"><input type="password" autoComplete="new-password" className="rounded-lg border px-3 py-2" placeholder="10+ characters" value={password} onChange={e => setPassword(e.target.value)} /></Field>
                    <Field label="Confirm password"><input type="password" autoComplete="new-password" className="rounded-lg border px-3 py-2" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} /></Field>
                    <button type="button" className="btn btn-primary sm:col-span-2 sm:w-fit" disabled={!!busy} onClick={submitAccountRequest}>{busy === 'account' ? 'Sending request…' : 'Send account request'}</button>
                  </div>
                </section>}

                {!showClaim && <button type="button" className="text-sm text-indigo-700 underline" onClick={() => setShowClaim(true)}>I already have an approved Marketplace account and enrollment token</button>}

                {showClaim && <section className="card p-6">
                  <div className="mb-5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Step 2</span>
                    <h2 className="mt-1 text-lg font-semibold text-slate-800">Claim this customer school</h2>
                    <p className="mt-1 text-sm text-slate-500">Wait for account approval, then use the one-time enrollment token sent by Platform Admin.</p>
                    {requestId && <p className="mt-2 font-mono text-xs text-slate-500">Request ID: {requestId}</p>}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Enrollment token" wide><input className="rounded-lg border px-3 py-2 font-mono text-xs" placeholder="wtn_enr_…" value={enrollmentToken} onChange={e => setEnrollmentToken(e.target.value)} /></Field>
                    <Field label="Marketplace owner email"><input type="email" autoComplete="username" className="rounded-lg border px-3 py-2" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} /></Field>
                    <Field label="Marketplace owner password"><input type="password" autoComplete="current-password" className="rounded-lg border px-3 py-2" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} /></Field>
                    <Field label="MFA / recovery code (optional)"><input autoComplete="one-time-code" className="rounded-lg border px-3 py-2" value={ownerCode} onChange={e => setOwnerCode(e.target.value)} /></Field>
                    <Field label="Installation label (optional)"><input className="rounded-lg border px-3 py-2" placeholder="Main campus" value={label} onChange={e => setLabel(e.target.value)} /></Field>
                    <button type="button" className="btn btn-primary sm:col-span-2 sm:w-fit" disabled={!!busy} onClick={register}>{busy === 'register' ? 'Claiming school…' : 'Claim and link Marketplace'}</button>
                  </div>
                </section>}
              </>}
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`grid gap-1 text-sm font-medium text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}><span>{label}</span>{children}</label>;
}
