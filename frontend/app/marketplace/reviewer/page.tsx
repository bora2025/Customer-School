'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ReviewerApiErrorPayload, reviewerEvidenceHint } from './reviewer-i18n';

type ReviewerSubmission = {
  id: string;
  status: 'ANALYZING' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  riskLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  submittedAt: string;
  decidedAt: string | null;
  publisher: { id: string; slug: string; displayName: string };
  pluginVersion: { id: string; pluginId: string; version: string; channel: string; reviewStatus: string };
  _count: { reviews: number };
};

type ReviewerSubmissionPage = {
  items: ReviewerSubmission[];
  nextCursor: string | null;
};

function evidenceTemplate(riskLevel: ReviewerSubmission['riskLevel'], decision: 'APPROVE' | 'REJECT') {
  const base = {
    checks: ['manifest-validation', 'signature-verification'],
    artifacts: ['analysis-report:package-analysis-v1'],
    ticket: '',
    summary: decision === 'APPROVE' ? 'Independent review passed.' : 'Release blocked by reviewer findings.',
  };
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
    return {
      ...base,
      checks: [...base.checks, 'malware-scan', 'dependency-advisory-review', 'migration-risk-review'],
      artifacts: [...base.artifacts, 'sandbox-log:runtime-sandbox-01', 'policy-checklist:review-policy-v1'],
    };
  }
  return base;
}

export default function ReviewerQueuePage() {
  const [rows, setRows] = useState<ReviewerSubmission[]>([]);
  const [status, setStatus] = useState<'NEEDS_REVIEW' | 'ANALYZING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'>('NEEDS_REVIEW');
  const [riskLevel, setRiskLevel] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [decisionTarget, setDecisionTarget] = useState<ReviewerSubmission | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [notes, setNotes] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceHint, setEvidenceHint] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '30');
    if (status) params.set('status', status);
    if (riskLevel) params.set('riskLevel', riskLevel);
    return params.toString();
  }, [status, riskLevel]);

  async function load() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/marketplace/reviewer/submissions?${query}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load reviewer queue');
      const payload = body as ReviewerSubmissionPage;
      setRows(Array.isArray(payload.items) ? payload.items : []);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : 'Could not load reviewer queue');
    } finally {
      setBusy(false);
    }
  }

  function openDecision(row: ReviewerSubmission, nextDecision: 'APPROVE' | 'REJECT') {
    setDecisionTarget(row);
    setDecision(nextDecision);
    setNotes('');
    setEvidenceText(JSON.stringify(evidenceTemplate(row.riskLevel, nextDecision), null, 2));
    setEvidenceHint('');
    setError('');
    setMessage('');
  }

  async function submitQuickDecision() {
    if (!decisionTarget) return;
    if (notes.trim().length < 5) {
      setError('Review notes must include at least 5 characters.');
      return;
    }
    let evidence: unknown;
    try {
      evidence = JSON.parse(evidenceText || '{}');
    } catch {
      setError('Evidence JSON is invalid.');
      return;
    }
    setDecisionBusy(true);
    setError('');
    setEvidenceHint('');
    setMessage('');
    try {
      const response = await fetch(`/api/marketplace/reviewer/submissions/${encodeURIComponent(decisionTarget.id)}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, notes: notes.trim(), evidence }),
      });
      const body = (await response.json().catch(() => ({}))) as ReviewerApiErrorPayload;
      if (!response.ok) {
        const hint = reviewerEvidenceHint(body);
        if (hint) setEvidenceHint(hint);
        throw new Error(body.error || 'Could not submit reviewer decision');
      }
      setMessage(decision === 'APPROVE' ? 'Approval recorded.' : 'Rejection recorded.');
      setDecisionTarget(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit reviewer decision');
    } finally {
      setDecisionBusy(false);
    }
  }

  useEffect(() => {
    load().catch(() => setError('Could not load reviewer queue'));
    // query is pre-normalized and small.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-slate-900">Reviewer Queue</h1>
          <p className="mt-2 text-slate-600">Moderate plugin submissions using reviewer identity and audited decisions.</p>
        </header>

        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-medium">
              Status
              <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                {['NEEDS_REVIEW', 'ANALYZING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map((value) => (
                  <option key={value} value={value}>{value.toLowerCase().replaceAll('_', ' ')}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium">
              Risk level
              <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
                <option value="">All</option>
                {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((value) => (
                  <option key={value} value={value}>{value.toLowerCase()}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button className="btn btn-secondary" onClick={() => load()} disabled={busy}>{busy ? 'Loading...' : 'Refresh'}</button>
            </div>
          </div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Submissions</h2>
          {busy ? <p className="mt-3 text-sm text-slate-500">Loading queue...</p> : null}
          {!busy && rows.length === 0 ? <p className="mt-3 text-sm text-slate-500">No submissions match this filter.</p> : null}
          <div className="mt-3 space-y-2">
            {rows.map((row) => (
              <article key={row.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    <Link className="text-indigo-700 hover:underline" href={`/marketplace/reviewer/submissions/${row.id}`}>
                      {row.pluginVersion.pluginId} {row.pluginVersion.version}
                    </Link>
                  </strong>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {row.status.toLowerCase().replaceAll('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {row.publisher.displayName} · {row.pluginVersion.channel.toLowerCase()} · risk {row.riskLevel.toLowerCase()} · reviews {row._count.reviews}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Submitted {new Date(row.submittedAt).toLocaleString()} · Decided {row.decidedAt ? new Date(row.decidedAt).toLocaleString() : 'Pending'}
                </p>
                {row.status === 'NEEDS_REVIEW' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => openDecision(row, 'APPROVE')}>Quick approve</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDecision(row, 'REJECT')}>Quick reject</button>
                    <Link className="btn btn-secondary btn-sm" href={`/marketplace/reviewer/submissions/${row.id}`}>Open full review</Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        {decisionTarget && (
          <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{decision === 'APPROVE' ? 'Quick Approve' : 'Quick Reject'}</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setDecisionTarget(null)} disabled={decisionBusy}>Close</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {decisionTarget.pluginVersion.pluginId} {decisionTarget.pluginVersion.version} · risk {decisionTarget.riskLevel.toLowerCase()}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium">
                Decision
                <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={decision} onChange={(event) => {
                  const nextDecision = event.target.value === 'REJECT' ? 'REJECT' : 'APPROVE';
                  setDecision(nextDecision);
                  if (decisionTarget) setEvidenceText(JSON.stringify(evidenceTemplate(decisionTarget.riskLevel, nextDecision), null, 2));
                }}>
                  <option value="APPROVE">Approve</option>
                  <option value="REJECT">Reject</option>
                </select>
              </label>
              <label className="text-xs font-medium md:col-span-2">
                Notes
                <textarea className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" value={notes} placeholder="Decision rationale and concrete findings." onChange={(event) => setNotes(event.target.value)} />
              </label>
              <label className="text-xs font-medium md:col-span-2">
                Evidence JSON
                <textarea className="mt-1 min-h-36 w-full rounded-lg border px-3 py-2 text-sm font-mono" value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} />
              </label>
            </div>
            {evidenceHint && <p className="mt-2 text-xs text-amber-700">{evidenceHint}</p>}
            <button className="btn btn-primary mt-4" onClick={() => submitQuickDecision()} disabled={decisionBusy}>{decisionBusy ? 'Submitting...' : 'Submit decision'}</button>
          </section>
        )}
      </div>
    </main>
  );
}
