'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Policy = {
  id: string;
  policyKey: string;
  version: string;
  title: string;
  effectiveAt: string;
};

type PublisherListItem = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  myRoles: string[];
  _count: { plugins: number; keys: number; submissions: number; members: number };
};

type PublisherPage = { items: PublisherListItem[]; nextCursor: string | null };

type SubmissionListItem = {
  id: string;
  status: string;
  riskLevel: string;
  submittedAt: string;
  decidedAt?: string | null;
  publisher: { id: string; slug: string; displayName: string };
  pluginVersion: { pluginId: string; version: string; channel: string; reviewStatus: string; publishedAt?: string | null; withdrawnAt?: string | null };
  _count: { reviews: number };
};

type SubmissionPage = { items: SubmissionListItem[]; nextCursor: string | null };

type PublisherDetail = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  members: Array<{
    id: string;
    role: string;
    verifiedAt?: string | null;
    suspendedAt?: string | null;
    account: { id: string; displayName: string; email: string; mfaEnabled: boolean };
  }>;
  keys: Array<{ id: string; keyId: string; createdAt: string; approvedAt?: string | null; revokedAt?: string | null }>;
  acceptances: Array<{ acceptedAt: string; policy: { id: string; policyKey: string; version: string; title: string; effectiveAt: string } }>;
};

const MEMBER_ROLES = ['OWNER', 'ADMIN', 'RELEASE_MANAGER', 'FINANCE', 'SUPPORT', 'REVIEWER'] as const;

export default function PublisherPortalPage() {
  const [publishers, setPublishers] = useState<PublisherListItem[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionListItem[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selectedPublisherId, setSelectedPublisherId] = useState('');
  const [selectedPublisher, setSelectedPublisher] = useState<PublisherDetail | null>(null);
  const [newPublisherSlug, setNewPublisherSlug] = useState('');
  const [newPublisherName, setNewPublisherName] = useState('');
  const [newKeyId, setNewKeyId] = useState('');
  const [newPublicKeyPem, setNewPublicKeyPem] = useState('');
  const [newMemberAccountId, setNewMemberAccountId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<(typeof MEMBER_ROLES)[number]>('RELEASE_MANAGER');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submissionChannel, setSubmissionChannel] = useState<'BETA' | 'STABLE'>('BETA');
  const [submissionChangelog, setSubmissionChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function hasAllPoliciesAccepted() {
    if (!policies.length) return true;
    if (!selectedPublisher) return false;
    const accepted = new Set(selectedPublisher.acceptances.map((entry) => entry.policy.id));
    return policies.every((policy) => accepted.has(policy.id));
  }

  async function loadPublisherDetail(publisherId: string) {
    if (!publisherId) {
      setSelectedPublisher(null);
      return;
    }
    const response = await fetch(`/api/marketplace/publishers/${encodeURIComponent(publisherId)}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not load publisher detail');
    setSelectedPublisher(body as PublisherDetail);
  }

  async function load() {
    setBusy(true);
    setError('');
    try {
      const [publishersRes, submissionsRes, policiesRes] = await Promise.all([
        fetch('/api/marketplace/publishers?limit=20', { cache: 'no-store' }),
        fetch('/api/marketplace/publisher-submissions?limit=20', { cache: 'no-store' }),
        fetch('/api/marketplace/publisher-policies', { cache: 'no-store' }),
      ]);

      if (!publishersRes.ok) {
        const body = await publishersRes.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load publishers');
      }
      if (!submissionsRes.ok) {
        const body = await submissionsRes.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load submissions');
      }
      if (!policiesRes.ok) {
        const body = await policiesRes.json().catch(() => ({}));
        throw new Error(body.error || 'Could not load publisher policies');
      }

      const publishersBody = (await publishersRes.json()) as PublisherPage;
      const submissionsBody = (await submissionsRes.json()) as SubmissionPage;
      const policiesBody = (await policiesRes.json()) as Policy[];
      setPublishers(Array.isArray(publishersBody.items) ? publishersBody.items : []);
      setSubmissions(Array.isArray(submissionsBody.items) ? submissionsBody.items : []);
      setPolicies(Array.isArray(policiesBody) ? policiesBody : []);
      if (!selectedPublisherId && publishersBody.items?.length) {
        setSelectedPublisherId(publishersBody.items[0].id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load publisher portal data');
    } finally {
      setBusy(false);
    }
  }

  async function createPublisher() {
    if (!newPublisherSlug.trim() || !newPublisherName.trim()) {
      setError('Publisher slug and display name are required.');
      return;
    }
    setActionBusy('create-publisher');
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/marketplace/publishers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: newPublisherSlug.trim(), displayName: newPublisherName.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not create publisher');
      setMessage(`Publisher ${newPublisherSlug.trim()} created.`);
      setNewPublisherSlug('');
      setNewPublisherName('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create publisher');
    } finally {
      setActionBusy('');
    }
  }

  async function acceptPolicies(publisherId: string) {
    if (!policies.length) return;
    setActionBusy(`accept:${publisherId}`);
    setError('');
    setMessage('');
    try {
      for (const policy of policies) {
        const response = await fetch(`/api/marketplace/publishers/${encodeURIComponent(publisherId)}/policies/${encodeURIComponent(policy.id)}/accept`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!response.ok && response.status !== 409) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Could not accept policy ${policy.policyKey}`);
        }
      }
      setMessage('Policies accepted (or already accepted).');
      await load();
      await loadPublisherDetail(publisherId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not accept policies');
    } finally {
      setActionBusy('');
    }
  }

  async function requestPublisherKey() {
    if (!selectedPublisherId) {
      setError('Select a publisher first.');
      return;
    }
    if (!newKeyId.trim() || !newPublicKeyPem.trim()) {
      setError('Key ID and public key PEM are required.');
      return;
    }
    setActionBusy('request-key');
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/marketplace/publishers/${encodeURIComponent(selectedPublisherId)}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId: newKeyId.trim(), publicKeyPem: newPublicKeyPem.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not request publisher key');
      setMessage('Publisher key request submitted. Waiting for approval.');
      setNewKeyId('');
      setNewPublicKeyPem('');
      await loadPublisherDetail(selectedPublisherId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request publisher key');
    } finally {
      setActionBusy('');
    }
  }

  async function updateKeyStatus(keyRecordId: string, action: 'approve' | 'revoke') {
    setActionBusy(`key:${action}:${keyRecordId}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/marketplace/publisher-keys/${encodeURIComponent(keyRecordId)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not ${action} key`);
      setMessage(`Key ${action}d.`);
      if (selectedPublisherId) await loadPublisherDetail(selectedPublisherId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} key`);
    } finally {
      setActionBusy('');
    }
  }

  async function updateMemberStatus(memberId: string, action: 'suspend' | 'reactivate') {
    if (!selectedPublisherId) return;
    setActionBusy(`member:${action}:${memberId}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/marketplace/publishers/${encodeURIComponent(selectedPublisherId)}/members/${encodeURIComponent(memberId)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not ${action} member`);
      setMessage(`Member ${action}ed.`);
      await loadPublisherDetail(selectedPublisherId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} member`);
    } finally {
      setActionBusy('');
    }
  }

  async function addPublisherMember() {
    if (!selectedPublisherId) {
      setError('Select a publisher first.');
      return;
    }
    if (!newMemberAccountId.trim()) {
      setError('Member marketplace account ID is required.');
      return;
    }
    setActionBusy('add-member');
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/marketplace/publishers/${encodeURIComponent(selectedPublisherId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: newMemberAccountId.trim(), role: newMemberRole }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not add publisher member');
      setMessage('Publisher member verified and added.');
      setNewMemberAccountId('');
      await loadPublisherDetail(selectedPublisherId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add publisher member');
    } finally {
      setActionBusy('');
    }
  }

  async function submitPackage() {
    if (!selectedPublisherId) {
      setError('Select a publisher first.');
      return;
    }
    if (!submissionFile) {
      setError('Choose a .wtp package file first.');
      return;
    }
    if (!submissionFile.name.toLowerCase().endsWith('.wtp')) {
      setError('Submission file must be a .wtp package.');
      return;
    }

    setActionBusy('submit-package');
    setError('');
    setMessage('');
    try {
      const form = new FormData();
      form.set('publisherId', selectedPublisherId);
      form.set('channel', submissionChannel);
      form.set('paid', 'false');
      if (submissionChangelog.trim()) form.set('changelog', submissionChangelog.trim());
      form.set('package', submissionFile, submissionFile.name);

      const response = await fetch('/api/marketplace/publisher-submissions', {
        method: 'POST',
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not submit package');

      setMessage(`Submission created (${body.submissionId || 'ok'}).`);
      setSubmissionFile(null);
      setSubmissionChangelog('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit package');
    } finally {
      setActionBusy('');
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedPublisherId) return;
    loadPublisherDetail(selectedPublisherId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Could not load publisher detail');
    });
  }, [selectedPublisherId]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Publisher Portal</h1>
            <p className="mt-2 text-slate-600">Manage your publisher organizations and track plugin submission reviews.</p>
          </div>
          <div className="flex gap-2">
            <Link className="btn btn-secondary" href="/marketplace">Back to marketplace</Link>
            <button className="btn btn-primary" onClick={() => load()} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh'}</button>
          </div>
        </header>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}

        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Create publisher</h2>
          <p className="text-xs text-slate-500">Use a stable slug. Example: acme.school-tools</p>
          <div className="grid gap-3 md:grid-cols-3">
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="slug" value={newPublisherSlug} onChange={(event) => setNewPublisherSlug(event.target.value)} />
            <input className="rounded-lg border px-3 py-2 text-sm md:col-span-2" placeholder="Display name" value={newPublisherName} onChange={(event) => setNewPublisherName(event.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => createPublisher()} disabled={actionBusy === 'create-publisher'}>{actionBusy === 'create-publisher' ? 'Creating...' : 'Create publisher'}</button>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">My publishers</h2>
          {publishers.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No publishers found for this account. Sign in with your marketplace developer account first.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Publisher</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">My roles</th>
                    <th className="px-3 py-2">Plugins</th>
                    <th className="px-3 py-2">Submissions</th>
                  </tr>
                </thead>
                <tbody>
                  {publishers.map((publisher) => (
                    <tr key={publisher.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2"><div className="font-medium text-slate-800">{publisher.displayName}</div><div className="text-xs text-slate-500">{publisher.slug}</div></td>
                      <td className="px-3 py-2">{publisher.status.toLowerCase()}</td>
                      <td className="px-3 py-2">{publisher.myRoles.join(', ').toLowerCase()}</td>
                      <td className="px-3 py-2">{publisher._count.plugins}</td>
                      <td className="px-3 py-2">{publisher._count.submissions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!publishers.length && (
            <div className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p>Before first submission, accept all current publisher policies for your selected publisher.</p>
              <div className="flex flex-wrap items-center gap-2">
                <select className="rounded-lg border px-3 py-2 text-sm" value={selectedPublisherId} onChange={(event) => setSelectedPublisherId(event.target.value)}>
                  {publishers.map((publisher) => (
                    <option key={publisher.id} value={publisher.id}>{publisher.displayName} ({publisher.slug})</option>
                  ))}
                </select>
                <button className="btn btn-secondary" onClick={() => acceptPolicies(selectedPublisherId)} disabled={!selectedPublisherId || actionBusy === `accept:${selectedPublisherId}`}>
                  {actionBusy === `accept:${selectedPublisherId}` ? 'Accepting...' : 'Accept all policies'}
                </button>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${hasAllPoliciesAccepted() ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                  {hasAllPoliciesAccepted() ? 'Policies accepted' : 'Policies pending'}
                </span>
              </div>
              {policies.length > 0 && <p className="text-xs">Current policies: {policies.map((policy) => `${policy.policyKey} v${policy.version}`).join(', ')}</p>}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Publisher signing keys</h2>
          <p className="text-xs text-slate-500">Upload a public key tied to the private key used for package signing.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Key ID (example: acme-key-2026)" value={newKeyId} onChange={(event) => setNewKeyId(event.target.value)} />
            <select className="rounded-lg border px-3 py-2 text-sm" value={selectedPublisherId} onChange={(event) => setSelectedPublisherId(event.target.value)}>
              <option value="">Select publisher</option>
              {publishers.map((publisher) => (
                <option key={publisher.id} value={publisher.id}>{publisher.displayName} ({publisher.slug})</option>
              ))}
            </select>
          </div>
          <textarea className="min-h-24 w-full rounded-lg border px-3 py-2 text-sm font-mono" placeholder="-----BEGIN PUBLIC KEY----- ..." value={newPublicKeyPem} onChange={(event) => setNewPublicKeyPem(event.target.value)} />
          <button className="btn btn-secondary" onClick={() => requestPublisherKey()} disabled={actionBusy === 'request-key'}>{actionBusy === 'request-key' ? 'Submitting...' : 'Register public key'}</button>
          {selectedPublisher?.keys?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Key ID</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Created</th><th className="px-3 py-2">Actions</th></tr></thead>
                <tbody>
                  {selectedPublisher.keys.map((key) => (
                    <tr key={key.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 font-mono">{key.keyId}</td>
                      <td className="px-3 py-2">{key.revokedAt ? 'revoked' : key.approvedAt ? 'approved' : 'pending approval'}</td>
                      <td className="px-3 py-2">{new Date(key.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {!key.approvedAt && !key.revokedAt && (
                            <button className="btn btn-secondary btn-sm" disabled={actionBusy === `key:approve:${key.id}`} onClick={() => updateKeyStatus(key.id, 'approve')}>
                              {actionBusy === `key:approve:${key.id}` ? 'Approving...' : 'Approve'}
                            </button>
                          )}
                          {!key.revokedAt && (
                            <button className="btn btn-secondary btn-sm" disabled={actionBusy === `key:revoke:${key.id}`} onClick={() => updateKeyStatus(key.id, 'revoke')}>
                              {actionBusy === `key:revoke:${key.id}` ? 'Revoking...' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">No keys registered for selected publisher.</p>}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Publisher members</h2>
          <p className="text-xs text-slate-500">Add verified collaborators by marketplace account ID. You cannot self-verify the same account as second-person check.</p>
          <div className="grid gap-3 md:grid-cols-3">
            <select className="rounded-lg border px-3 py-2 text-sm" value={selectedPublisherId} onChange={(event) => setSelectedPublisherId(event.target.value)}>
              <option value="">Select publisher</option>
              {publishers.map((publisher) => (
                <option key={publisher.id} value={publisher.id}>{publisher.displayName} ({publisher.slug})</option>
              ))}
            </select>
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Member account UUID" value={newMemberAccountId} onChange={(event) => setNewMemberAccountId(event.target.value)} />
            <select className="rounded-lg border px-3 py-2 text-sm" value={newMemberRole} onChange={(event) => setNewMemberRole((event.target.value as (typeof MEMBER_ROLES)[number]))}>
              {MEMBER_ROLES.map((role) => <option key={role} value={role}>{role.toLowerCase().replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={() => addPublisherMember()} disabled={actionBusy === 'add-member'}>{actionBusy === 'add-member' ? 'Adding...' : 'Add member'}</button>
          {selectedPublisher?.members?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Member</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">MFA</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead>
                <tbody>
                  {selectedPublisher.members.map((member) => (
                    <tr key={member.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2"><div className="font-medium">{member.account.displayName}</div><div className="font-mono text-[11px] text-slate-500">{member.account.id}</div></td>
                      <td className="px-3 py-2">{member.role.toLowerCase().replaceAll('_', ' ')}</td>
                      <td className="px-3 py-2">{member.account.mfaEnabled ? 'enabled' : 'disabled'}</td>
                      <td className="px-3 py-2">{member.suspendedAt ? 'suspended' : member.verifiedAt ? 'active' : 'pending verification'}</td>
                      <td className="px-3 py-2">
                        {member.suspendedAt ? (
                          <button className="btn btn-secondary btn-sm" disabled={actionBusy === `member:reactivate:${member.id}`} onClick={() => updateMemberStatus(member.id, 'reactivate')}>
                            {actionBusy === `member:reactivate:${member.id}` ? 'Reactivating...' : 'Reactivate'}
                          </button>
                        ) : (
                          <button className="btn btn-secondary btn-sm" disabled={actionBusy === `member:suspend:${member.id}`} onClick={() => updateMemberStatus(member.id, 'suspend')}>
                            {actionBusy === `member:suspend:${member.id}` ? 'Suspending...' : 'Suspend'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">No members found for selected publisher.</p>}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Policy acceptance history</h2>
          {selectedPublisher?.acceptances?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Policy</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">Accepted at</th></tr></thead>
                <tbody>
                  {selectedPublisher.acceptances.map((acceptance) => (
                    <tr key={`${acceptance.policy.id}:${acceptance.acceptedAt}`} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">{acceptance.policy.policyKey}</td>
                      <td className="px-3 py-2">{acceptance.policy.version}</td>
                      <td className="px-3 py-2">{new Date(acceptance.acceptedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">No policy acceptances recorded yet for selected publisher.</p>}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold">Submit plugin package</h2>
          <p className="text-xs text-slate-500">Upload a signed .wtp package for review. Approved submissions become visible in catalog.</p>
          <div className="grid gap-3 md:grid-cols-3">
            <select className="rounded-lg border px-3 py-2 text-sm" value={selectedPublisherId} onChange={(event) => setSelectedPublisherId(event.target.value)}>
              <option value="">Select publisher</option>
              {publishers.map((publisher) => (
                <option key={publisher.id} value={publisher.id}>{publisher.displayName} ({publisher.slug})</option>
              ))}
            </select>
            <select className="rounded-lg border px-3 py-2 text-sm" value={submissionChannel} onChange={(event) => setSubmissionChannel(event.target.value === 'STABLE' ? 'STABLE' : 'BETA')}>
              <option value="BETA">beta</option>
              <option value="STABLE">stable</option>
            </select>
            <input className="rounded-lg border px-3 py-2 text-sm" type="file" accept=".wtp" onChange={(event) => setSubmissionFile(event.target.files?.[0] || null)} />
          </div>
          <textarea className="min-h-24 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Changelog (optional)" value={submissionChangelog} onChange={(event) => setSubmissionChangelog(event.target.value)} />
          <button className="btn btn-primary" onClick={() => submitPackage()} disabled={actionBusy === 'submit-package'}>{actionBusy === 'submit-package' ? 'Submitting...' : 'Submit .wtp for review'}</button>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">My recent submissions</h2>
          {submissions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No submissions yet. Submit a signed .wtp package from your publisher workflow.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {submissions.map((submission) => (
                <article key={submission.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong><Link className="text-indigo-700 hover:underline" href={`/marketplace/publisher/submissions/${submission.id}`}>{submission.pluginVersion.pluginId} {submission.pluginVersion.version}</Link></strong>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{submission.status.toLowerCase().replaceAll('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{submission.publisher.displayName} · {submission.pluginVersion.channel.toLowerCase()} · risk {submission.riskLevel.toLowerCase()}</p>
                  <p className="mt-1 text-xs text-slate-500">Submitted {new Date(submission.submittedAt).toLocaleString()} · Reviews {submission._count.reviews}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
