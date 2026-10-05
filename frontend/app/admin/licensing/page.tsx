'use client';

import { useEffect, useState } from 'react';
import AuthGuard from '../../../components/AuthGuard';
import PlatformBillingPanel from '../../../components/PlatformBillingPanel';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';

interface InstallationStatus {
  installationId: string;
  hasLocalKey: boolean;
  keyFingerprint: string | null;
  marketplaceConfigured: boolean;
  entitlementKeysConfigured: boolean;
  registered: boolean;
  registeredAt: string | null;
  registeredAccountId: string | null;
  registrationInferred: boolean;
}

interface EntitlementRecord {
  pluginId: string;
  status: string;
  tokenId: string | null;
  expiresAt: string | null;
  updatesThrough: string | null;
  offlineRecheckAfter: string | null;
  lastVerifiedAt: string | null;
  lastRefreshAttemptAt: string | null;
  lastRefreshSucceededAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export default function LicensingPage() {
  const [status, setStatus] = useState<InstallationStatus | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementRecord[]>([]);
  const [accountId, setAccountId] = useState('');
  const [showAdvancedAccount, setShowAdvancedAccount] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [label, setLabel] = useState('');
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [accountDisplayName, setAccountDisplayName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showResetForm, setShowResetForm] = useState(false);
  const [offlinePluginId, setOfflinePluginId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    const [statusResponse, entitlementsResponse] = await Promise.all([
      apiFetch('/api/admin/marketplace/installation'),
      apiFetch('/api/admin/marketplace/entitlements'),
    ]);
    if (!statusResponse.ok) throw new Error(`Could not load installation status (${statusResponse.status})`);
    setStatus(await statusResponse.json());
    if (entitlementsResponse.ok) setEntitlements(await entitlementsResponse.json());
  }

  useEffect(() => { load().catch((cause) => setError(cause.message)); }, []);

  async function run(key: string, path: string, body?: unknown, successMessage?: string) {
    setBusy(key); setError(''); setNotice('');
    try {
      const response = await apiFetch(path, {
        method: 'POST',
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join('. ') : result.message || `Request failed (${response.status})`);
      if (successMessage) setNotice(successMessage);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed'); }
    finally { setBusy(''); }
  }

  async function register() {
    // Either identifies this school to the marketplace: an enrollment token was minted by a
    // platform operator against a named customer school, and is the path for a school the operator
    // provisioned. An account ID is the self-serve path.
    if (!enrollmentToken.trim() && !accountId.trim()) {
      return setError('Enter the one-time enrollment token from your platform operator.');
    }
    setBusy('register'); setError(''); setNotice('');
    try {
      if (enrollmentToken.trim()) {
        if (!ownerEmail.trim() || !ownerPassword) throw new Error('Enter the marketplace owner email and password.');
      }
      const response = await apiFetch('/api/admin/marketplace/installation/register', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          ...(accountId.trim() ? { accountId: accountId.trim() } : {}),
          ...(enrollmentToken.trim() ? { enrollmentToken: enrollmentToken.trim() } : {}),
          ...(enrollmentToken.trim() ? { owner: {
            email: ownerEmail.trim(), password: ownerPassword,
            ...(ownerCode.trim() ? { code: ownerCode.trim() } : {}),
          } } : {}),
          ...(label.trim() ? { label: label.trim() } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join('. ') : result.message || `Registration failed (${response.status})`);
      setOwnerPassword(''); setOwnerCode('');
      setNotice('School claimed, registered, and linked to the marketplace account. You can now install plugins.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Registration failed'); }
    finally { setBusy(''); }
  }

  async function createMarketplaceAccount() {
    if (!accountDisplayName.trim() || !accountEmail.trim() || !accountPassword) return setError('Enter your name, email, and password.');
    if (accountPassword.length < 10) return setError('Marketplace passwords must contain at least 10 characters.');
    if (accountPassword !== accountPasswordConfirm) return setError('The password confirmation does not match.');
    setBusy('create-account'); setError(''); setNotice('');
    try {
      const response = await apiFetch('/api/admin/marketplace/accounts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: accountDisplayName.trim(), email: accountEmail.trim(), password: accountPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Account request failed (${response.status})`);
      setOwnerEmail(accountEmail.trim()); setAccountPassword(''); setAccountPasswordConfirm(''); setShowAccountForm(false);
      setNotice('Marketplace account created. Ask the platform operator to create the school and send its one-time enrollment token, then complete the claim form below.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Account request failed'); }
    finally { setBusy(''); }
  }

  async function requestPasswordReset() {
    if (!resetEmail.trim()) return setError('Enter the marketplace account email.');
    await run('request-reset', '/api/admin/marketplace/password-resets', { email: resetEmail.trim() }, 'If the account exists, its password-reset instructions have been requested.');
  }

  async function confirmPasswordReset() {
    if (!resetToken.trim() || !resetPassword) return setError('Enter the reset token and a new password.');
    if (resetPassword.length < 10) return setError('Marketplace passwords must contain at least 10 characters.');
    await run('confirm-reset', '/api/admin/marketplace/password-resets/confirm', { token: resetToken.trim(), newPassword: resetPassword }, 'Marketplace password reset. You can now use it in the claim form.');
    setResetToken(''); setResetPassword('');
  }

  function rotate() {
    if (!window.confirm('Rotate this installation’s marketplace signing key?\n\nA new key pair is generated locally and the marketplace is asked to replace the current one. The new key is only saved if the marketplace accepts it, so a failure here leaves the existing key working.')) return;
    return run('rotate', '/api/admin/marketplace/installation/keys/rotate', undefined, 'Signing key rotated. The previous key is now revoked.');
  }

  async function exportToken(pluginId: string) {
    setBusy(`${pluginId}:export`); setError('');
    try {
      const response = await apiFetch(`/api/admin/marketplace/entitlements/${encodeURIComponent(pluginId)}/export`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Export failed');
      const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${pluginId}-entitlement.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Export failed'); }
    finally { setBusy(''); }
  }

  async function importToken(pluginId: string, file?: File) {
    if (!file) return;
    setBusy(`${pluginId}:import`); setError(''); setNotice('');
    try {
      const document = JSON.parse(await file.text());
      const response = await apiFetch(`/api/admin/marketplace/entitlements/${encodeURIComponent(pluginId)}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedToken: document.signedToken ?? document }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Import failed');
      setNotice(`Imported and locally verified the offline entitlement for ${pluginId}.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import failed'); }
    finally { setBusy(''); }
  }

  return (
    <AuthGuard allowedRoles={['SUPER_ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-800">Licensing</h1><p className="mt-1 text-sm text-slate-500">Your platform subscription, this installation’s marketplace identity, and plugin licence status.</p></div><a className="btn btn-primary" href="/admin/plugins">Browse marketplace</a></div>
          </div>
          <div className="page-body space-y-6">
            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
            {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

            {status && !status.marketplaceConfigured && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <strong>The marketplace is not configured for this installation.</strong> Set <code className="font-mono">MARKETPLACE_URL</code> to register this school and check plugin licences. The school keeps operating normally without it.
              </div>
            )}

            {/* The platform bill, live. It reads only the billing-control endpoint, which the suspension
                guard keeps open -- so this card still loads when everything else on the page is refused. */}
            <PlatformBillingPanel variant="section" />

            <section className="card p-6">
              <h2 className="font-semibold text-slate-800">Installation identity</h2>
              <p className="mt-1 text-sm text-slate-500">
                This school signs marketplace requests with a private key that never leaves this server. The marketplace only ever stores the matching public key.
              </p>
              <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <Info label="Installation ID" value={status?.installationId ?? '—'} mono />
                <Info label="Local signing key" value={status ? (status.hasLocalKey ? 'Present' : 'Not created yet') : '—'} />
                <Info label="Key fingerprint (SHA-256)" value={status?.keyFingerprint ?? 'Not created yet'} mono />
                <Info label="Entitlement keys pinned" value={status ? (status.entitlementKeysConfigured ? 'Yes' : 'No — licence tokens cannot be verified') : '—'} />
              </dl>
            </section>

            <section className="card p-6">
              <h2 className="font-semibold text-slate-800">{status?.registered ? 'Marketplace registration' : 'Register with the marketplace'}</h2>
              {status?.registered ? (
                <p className="mt-1 text-sm text-slate-500">
                  This installation is registered with the marketplace{status.registeredAt ? ` since ${new Date(status.registeredAt).toLocaleDateString()}` : ''}.{' '}
                  {status.registrationInferred
                    ? 'It registered before this school kept a local record, so only the fact is known here — the marketplace holds the rest.'
                    : 'Registering again is not needed; use Rotate signing key to replace its key.'}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  Enter the school’s one-time token and sign in as its marketplace owner. One secure action claims the installation and links Plugin Manager automatically.
                </p>
              )}
              {!status?.registered && <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-800">1. Marketplace account</h3>
                  <p className="mt-1 text-xs text-slate-600">Create an owner account first. The platform operator then creates your customer-school record and sends the one-time enrollment token used in step 2.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAccountForm(value => !value)}>{showAccountForm ? 'Hide account form' : 'Create marketplace account'}</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowResetForm(value => !value)}>{showResetForm ? 'Hide password reset' : 'Forgot marketplace password?'}</button>
                  </div>
                  {showAccountForm && <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input className="rounded-lg border px-3 py-2" placeholder="Owner full name" value={accountDisplayName} onChange={event => setAccountDisplayName(event.target.value)} />
                    <input type="email" autoComplete="email" className="rounded-lg border px-3 py-2" placeholder="Owner email" value={accountEmail} onChange={event => setAccountEmail(event.target.value)} />
                    <input type="password" autoComplete="new-password" className="rounded-lg border px-3 py-2" placeholder="Password (10+ characters)" value={accountPassword} onChange={event => setAccountPassword(event.target.value)} />
                    <input type="password" autoComplete="new-password" className="rounded-lg border px-3 py-2" placeholder="Confirm password" value={accountPasswordConfirm} onChange={event => setAccountPasswordConfirm(event.target.value)} />
                    <button type="button" className="btn btn-primary sm:col-span-2 sm:w-fit" disabled={!!busy} onClick={createMarketplaceAccount}>{busy === 'create-account' ? 'Creating account…' : 'Send account creation request'}</button>
                  </div>}
                  {showResetForm && <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input type="email" autoComplete="email" className="rounded-lg border px-3 py-2" placeholder="Marketplace account email" value={resetEmail} onChange={event => setResetEmail(event.target.value)} />
                    <button type="button" className="btn btn-secondary sm:w-fit" disabled={!!busy} onClick={requestPasswordReset}>{busy === 'request-reset' ? 'Requesting…' : 'Request reset'}</button>
                    <input className="rounded-lg border px-3 py-2 font-mono text-xs" placeholder="Reset token from email or operator" value={resetToken} onChange={event => setResetToken(event.target.value)} />
                    <input type="password" autoComplete="new-password" className="rounded-lg border px-3 py-2" placeholder="New password (10+ characters)" value={resetPassword} onChange={event => setResetPassword(event.target.value)} />
                    <button type="button" className="btn btn-primary sm:col-span-2 sm:w-fit" disabled={!!busy} onClick={confirmPasswordReset}>{busy === 'confirm-reset' ? 'Resetting…' : 'Set new password'}</button>
                  </div>}
                </div>
                <label className="text-sm sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">2. Enrollment token</span>
                  <input value={enrollmentToken} onChange={(event) => setEnrollmentToken(event.target.value)} placeholder="wtn_enr_…"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" />
                  <span className="mt-1 block text-xs font-normal text-slate-500">Get this from Platform Admin → Customer schools → your school → Installation enrollment. It is shown once and consumed on successful registration.</span>
                </label>
                <div className="sm:col-span-2 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <h3 className="text-sm font-semibold text-indigo-950">Marketplace owner</h3>
                  <p className="mt-1 text-xs text-indigo-800">Credentials go directly to the marketplace through this school’s secure proxy. They are never stored by the school.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <input aria-label="Marketplace owner email" type="email" autoComplete="username" className="rounded-lg border px-3 py-2" placeholder="Owner email" value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} />
                    <input aria-label="Marketplace owner password" type="password" autoComplete="current-password" className="rounded-lg border px-3 py-2" placeholder="Password" value={ownerPassword} onChange={event => setOwnerPassword(event.target.value)} />
                    <input aria-label="Marketplace owner MFA code" inputMode="numeric" autoComplete="one-time-code" className="rounded-lg border px-3 py-2" placeholder="MFA / recovery code" value={ownerCode} onChange={event => setOwnerCode(event.target.value)} />
                  </div>
                </div>
                <button className="text-left text-xs text-indigo-700 underline sm:col-span-2" type="button" onClick={() => setShowAdvancedAccount(value => !value)} aria-expanded={showAdvancedAccount}>Advanced: register with an existing marketplace account ID</button>
                {showAdvancedAccount && <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Marketplace account ID</span>
                  <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" />
                  <span className="mt-1 block text-xs font-normal text-slate-500">Self-managed installations only. For a platform-managed customer school, use its enrollment token instead.</span>
                </label>}
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Label (optional)</span>
                  <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Main campus"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </label>
              </div>}
              <div className="mt-4 flex flex-wrap gap-3">
                {!status?.registered && <button className="btn btn-primary" disabled={!!busy || !status?.marketplaceConfigured} onClick={register}>
                  {busy === 'register' ? 'Claiming and linking…' : 'Claim and link marketplace'}
                </button>}
                {status?.registered && <a className="btn btn-primary" href="/admin/plugins">Next: link marketplace account</a>}
                <button className="btn btn-secondary" disabled={!!busy || !status?.marketplaceConfigured || !status?.hasLocalKey} onClick={rotate}>
                  {busy === 'rotate' ? 'Rotating…' : 'Rotate signing key'}
                </button>
              </div>
            </section>

            <section className="card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-800">Plugin licences</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Licence tokens are verified on this server against pinned keys. A marketplace outage never disables an installed plugin — the last verified licence simply stays in place.
                  </p>
                </div>
                <button className="btn btn-secondary" disabled={!!busy || !status?.marketplaceConfigured} onClick={() => run('refresh', '/api/admin/marketplace/entitlements/refresh', undefined, 'Licence refresh finished.')}>
                  {busy === 'refresh' ? 'Refreshing…' : 'Refresh all'}
                </button>
              </div>

              {entitlements.length === 0 && <p className="mt-5 text-sm text-slate-500">No plugin licences have been cached yet.</p>}

              <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-4">
                <h3 className="text-sm font-semibold text-slate-700">Offline activation</h3>
                <p className="mt-1 text-xs text-slate-500">When this school cannot reach the marketplace, enter the exact plugin ID and import the signed entitlement JSON exported from the customer portal.</p>
                <div className="mt-3 flex flex-wrap gap-2"><input className="min-w-64 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" placeholder="wattanam.plugin-id" value={offlinePluginId} onChange={event => setOfflinePluginId(event.target.value)} /><label className={`btn btn-secondary cursor-pointer ${!offlinePluginId.trim() ? 'pointer-events-none opacity-50' : ''}`}>Choose signed token<input className="sr-only" type="file" accept="application/json,.json" disabled={!offlinePluginId.trim() || !!busy} onChange={(event) => { importToken(offlinePluginId.trim(), event.target.files?.[0]); event.target.value = ''; }} /></label></div>
              </div>

              {entitlements.length > 0 && (
                <div className="mt-5 space-y-3">
                  {entitlements.map((entitlement) => (
                    <div key={entitlement.pluginId} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <strong className="text-slate-800">{entitlement.pluginId}</strong>
                            <LicenceStatus value={entitlement.status} />
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {entitlement.expiresAt ? `Expires ${formatDate(entitlement.expiresAt)}` : 'No expiry recorded'}
                            {entitlement.updatesThrough ? ` · updates through ${formatDate(entitlement.updatesThrough)}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {entitlement.lastVerifiedAt ? `Last verified ${formatDate(entitlement.lastVerifiedAt)}` : 'Never verified'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className="btn btn-secondary" disabled={!!busy} onClick={() => exportToken(entitlement.pluginId)}>{busy === `${entitlement.pluginId}:export` ? 'Exporting…' : 'Export offline token'}</button>
                          <label className="btn btn-secondary cursor-pointer">{busy === `${entitlement.pluginId}:import` ? 'Importing…' : 'Import offline token'}<input className="sr-only" type="file" accept="application/json,.json" disabled={!!busy} onChange={(event) => { importToken(entitlement.pluginId, event.target.files?.[0]); event.target.value = ''; }} /></label>
                          <button className="btn btn-secondary" disabled={!!busy || !status?.marketplaceConfigured}
                            onClick={() => run(`${entitlement.pluginId}:refresh`, `/api/admin/marketplace/entitlements/${encodeURIComponent(entitlement.pluginId)}/refresh`, undefined, `Refreshed ${entitlement.pluginId}.`)}>
                            {busy === `${entitlement.pluginId}:refresh` ? 'Refreshing…' : 'Refresh'}
                          </button>
                        </div>
                      </div>
                      {entitlement.consecutiveFailures > 0 && (
                        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                          <strong>{entitlement.consecutiveFailures} failed refresh{entitlement.consecutiveFailures === 1 ? '' : 'es'}.</strong>{' '}
                          {entitlement.lastError ?? 'No detail recorded.'} The previously verified licence above is still in effect.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

function LicenceStatus({ value }: { value: string }) {
  const style = value === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700'
    : value === 'EXPIRED' || value === 'REVOKED' || value === 'REFUNDED' ? 'bg-red-50 text-red-700'
      : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{value.toLowerCase()}</span>;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 break-all text-sm text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
