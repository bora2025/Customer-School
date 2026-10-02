'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type LinkRequest = { requestId: string; status: string; requestedScope: string; expiresAt: string; installationLabel?: string; installationId: string };

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'catalog:browse': 'Browse the plugin catalog',
  'purchase:create': 'Create paid orders on your behalf',
  'download:artifact': 'Download purchased plugin packages',
};

export default function MarketplaceLinkPage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId;
  const [request, setRequest] = useState<LinkRequest | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [signedIn, setSignedIn] = useState(false); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [decided, setDecided] = useState<'APPROVED' | 'DENIED' | null>(null);

  async function load() {
    const response = await fetch(`/api/marketplace/marketplace-links/${requestId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) { setMessage(body.error || 'Link request could not be loaded'); return; }
    setRequest(body);
    const owned = await fetch('/api/marketplace/customer/entitlements', { cache: 'no-store' });
    setSignedIn(owned.ok);
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [requestId]);

  async function login() {
    setBusy('login'); setMessage('');
    const response = await fetch('/api/marketplace/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, ...(code ? { code } : {}) }) });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Sign-in failed');
    if (body.status === 'mfa_required') return setMessage('Enter your MFA or recovery code, then sign in again.');
    setSignedIn(true); setMessage('Signed in securely.');
  }

  async function decide(decision: 'approve' | 'deny') {
    setBusy(decision); setMessage('');
    const response = await fetch(`/api/marketplace/marketplace-links/${requestId}/${decision}`, { method: 'POST' });
    const body = await response.json(); setBusy('');
    if (!response.ok) return setMessage(body.error || 'Could not record your decision');
    setDecided(decision === 'approve' ? 'APPROVED' : 'DENIED');
    setMessage(decision === 'approve' ? 'Installation linked. You can return to the school admin panel.' : 'Link request denied.');
  }

  if (!request) return <main className="min-h-screen bg-slate-50 px-4 py-10"><div className="mx-auto max-w-xl">{message && <p className="text-sm text-red-700">{message}</p>}</div></main>;

  const expired = request.status === 'EXPIRED' || new Date(request.expiresAt) <= new Date();
  const final = decided || (request.status !== 'PENDING' ? request.status : null);

  return <main className="min-h-screen bg-slate-50 px-4 py-10"><div className="mx-auto max-w-xl space-y-6">
    <header><h1 className="text-2xl font-bold text-slate-900">Link a school installation</h1><p className="mt-2 text-slate-600">A Wattanam school admin panel is requesting permission to act on your marketplace account.</p></header>
    {message && <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">{message}</div>}
    <section className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
      <div><span className="text-xs font-semibold uppercase text-slate-500">Installation</span><p className="mt-1 font-medium text-slate-900">{request.installationLabel || request.installationId}</p></div>
      <div><span className="text-xs font-semibold uppercase text-slate-500">Requested permissions</span><ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{request.requestedScope.split(' ').map((scope) => <li key={scope}>{SCOPE_DESCRIPTIONS[scope] || scope}</li>)}</ul></div>
      <p className="text-xs text-slate-500">This installation will never see your password, and cannot change your account details, disable MFA, or access publisher tools. You can revoke this at any time from your account.</p>
      {final ? <p className="text-sm font-medium text-slate-700">This request has already been {final.toLowerCase()}.</p> : expired ? <p className="text-sm font-medium text-red-700">This request has expired. Ask the school admin to start a new link.</p> : !signedIn ? (
        <div className="space-y-3 border-t pt-4">
          <h2 className="font-semibold">Sign in to approve</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <input aria-label="Email" className="rounded-lg border px-3 py-2" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input aria-label="Password" type="password" className="rounded-lg border px-3 py-2" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
            <input aria-label="MFA code" className="rounded-lg border px-3 py-2" placeholder="MFA/recovery code (if enabled)" value={code} onChange={e=>setCode(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={!!busy} onClick={login}>{busy === 'login' ? 'Signing in…' : 'Sign in'}</button>
        </div>
      ) : (
        <div className="flex gap-3 border-t pt-4">
          <button className="btn btn-primary" disabled={!!busy} onClick={() => decide('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => decide('deny')}>{busy === 'deny' ? 'Denying…' : 'Deny'}</button>
        </div>
      )}
    </section>
  </div></main>;
}
