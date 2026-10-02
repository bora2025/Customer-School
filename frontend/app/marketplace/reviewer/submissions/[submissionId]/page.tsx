'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ReviewerApiErrorPayload, reviewerEvidenceHint } from '../../reviewer-i18n';

type ReviewerSubmissionDetail = {
  id: string;
  status: string;
  riskLevel: string;
  analysisReport: unknown;
  submittedAt: string;
  decidedAt: string | null;
  publisher: { id: string; slug: string; displayName: string; status: string };
  pluginVersion: {
    id: string;
    pluginId: string;
    version: string;
    requiresCore: string;
    channel: string;
    reviewStatus: string;
    artifact: { sha256: string; sizeBytes: number; publisherKeyId: string };
  };
  reviews: Array<{
    id: string;
    decision: 'APPROVE' | 'REJECT';
    notes: string;
    evidence: unknown;
    createdAt: string;
    reviewer: { id: string; displayName: string };
  }>;
};

function buildEvidenceTemplate(riskLevel: string, decision: 'APPROVE' | 'REJECT') {
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

function validateEvidenceForRisk(evidence: unknown, riskLevel: string) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return 'Evidence must be a JSON object.';
  const record = evidence as Record<string, unknown>;
  const checks = Array.isArray(record.checks) ? record.checks.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
  if (checks.length === 0) return 'Evidence must include at least one non-empty check in checks[].';
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
  const artifactPattern = /^([a-z][a-z0-9-]{1,40}):([A-Za-z0-9._:-]{3,120})$/;
  if (artifacts.some((value) => !artifactPattern.test(value))) return 'Artifact format is invalid. Use <type>:<reference>.';
  const ticket = typeof record.ticket === 'string' ? record.ticket.trim() : '';
  const ticketPattern = /^[A-Z][A-Z0-9_]{1,15}-\d{1,8}$/;
  if (ticket && !ticketPattern.test(ticket)) return 'Ticket format is invalid. Use format like SEC-1234.';
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
    if (artifacts.length === 0) return 'High/critical submissions require at least one artifact in artifacts[].';
    if (!ticket) return 'High/critical submissions require a non-empty ticket field.';
  }
  return null;
}

export default function ReviewerSubmissionDetailPage() {
  const params = useParams<{ submissionId: string }>();
  const submissionId = params.submissionId;
  const [submission, setSubmission] = useState<ReviewerSubmissionDetail | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [notes, setNotes] = useState('');
  const [evidenceText, setEvidenceText] = useState('{\n  "checks": ["manual-review"],\n  "ticket": ""\n}');
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [evidenceHint, setEvidenceHint] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    if (!submissionId) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/marketplace/reviewer/submissions/${encodeURIComponent(submissionId)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load submission');
      setSubmission(body as ReviewerSubmissionDetail);
      if (!evidenceDirty) {
        setEvidenceText(JSON.stringify(buildEvidenceTemplate((body as ReviewerSubmissionDetail).riskLevel, decision), null, 2));
      }
    } catch (cause) {
      setSubmission(null);
      setError(cause instanceof Error ? cause.message : 'Could not load submission');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setEvidenceDirty(false);
    load().catch(() => setError('Could not load submission'));
    // submissionId changes only through route navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  useEffect(() => {
    if (!submission || evidenceDirty) return;
    setEvidenceText(JSON.stringify(buildEvidenceTemplate(submission.riskLevel, decision), null, 2));
  }, [submission, decision, evidenceDirty]);

  async function submitDecision() {
    if (!submissionId) return;
    if (notes.trim().length < 5) {
      setError('Review notes must include at least 5 characters.');
      return;
    }
    let evidence: unknown = {};
    if (evidenceText.trim()) {
      try {
        evidence = JSON.parse(evidenceText);
      } catch {
        setError('Evidence JSON is invalid.');
        return;
      }
    }
    const validationError = validateEvidenceForRisk(evidence, submission?.riskLevel || 'NORMAL');
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError('');
    setEvidenceHint('');
    setMessage('');
    try {
      const response = await fetch(`/api/marketplace/reviewer/submissions/${encodeURIComponent(submissionId)}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, notes: notes.trim(), evidence }),
      });
      const body = (await response.json().catch(() => ({}))) as ReviewerApiErrorPayload;
      if (!response.ok) {
        const hint = reviewerEvidenceHint(body);
        if (hint) setEvidenceHint(hint);
        throw new Error(body.error || 'Could not submit review decision');
      }
      setMessage(decision === 'APPROVE' ? 'Approval recorded.' : 'Rejection recorded.');
      setNotes('');
      setEvidenceDirty(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit review decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-slate-900">Submission Review</h1>
          <p className="mt-2 text-slate-600">Record an audited reviewer decision for this release.</p>
        </header>

        {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {busy && !submission && <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">Loading submission...</div>}

        {submission && (
          <>
            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div><dt className="text-xs text-slate-500">Plugin</dt><dd className="font-medium">{submission.pluginVersion.pluginId}</dd></div>
                <div><dt className="text-xs text-slate-500">Version</dt><dd className="font-medium">{submission.pluginVersion.version}</dd></div>
                <div><dt className="text-xs text-slate-500">Publisher</dt><dd>{submission.publisher.displayName}</dd></div>
                <div><dt className="text-xs text-slate-500">Channel</dt><dd>{submission.pluginVersion.channel.toLowerCase()}</dd></div>
                <div><dt className="text-xs text-slate-500">Submission status</dt><dd>{submission.status.toLowerCase().replaceAll('_', ' ')}</dd></div>
                <div><dt className="text-xs text-slate-500">Risk level</dt><dd>{submission.riskLevel.toLowerCase()}</dd></div>
                <div><dt className="text-xs text-slate-500">Artifact digest</dt><dd className="font-mono text-xs break-all">{submission.pluginVersion.artifact.sha256}</dd></div>
                <div><dt className="text-xs text-slate-500">Submitted</dt><dd>{new Date(submission.submittedAt).toLocaleString()}</dd></div>
              </div>
            </section>

            {submission.status === 'NEEDS_REVIEW' && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm">
                <h2 className="font-semibold">Record Decision</h2>
                <p className="mt-1 text-xs text-slate-500">For high or critical risk, evidence must include checks[], artifacts[], and a non-empty ticket.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-xs font-medium">
                    Decision
                    <select className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={decision} onChange={(event) => { setDecision(event.target.value === 'REJECT' ? 'REJECT' : 'APPROVE'); setError(''); }}>
                      <option value="APPROVE">Approve</option>
                      <option value="REJECT">Reject</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium md:col-span-2">
                    Notes
                    <textarea className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Explain review findings and decision rationale." value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                  <label className="text-xs font-medium md:col-span-2">
                    Evidence JSON
                    <textarea className="mt-1 min-h-36 w-full rounded-lg border px-3 py-2 text-sm font-mono" value={evidenceText} onChange={(event) => { setEvidenceText(event.target.value); setEvidenceDirty(true); }} />
                  </label>
                </div>
                {evidenceHint && <p className="mt-2 text-xs text-amber-700">{evidenceHint}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEvidenceText(JSON.stringify(buildEvidenceTemplate(submission.riskLevel, decision), null, 2)); setEvidenceDirty(true); }}>Apply {submission.riskLevel.toLowerCase()} template</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEvidenceText(JSON.stringify(buildEvidenceTemplate('NORMAL', decision), null, 2)); setEvidenceDirty(true); }}>Apply normal template</button>
                </div>
                <button className="btn btn-primary mt-4" onClick={() => submitDecision()} disabled={busy}>{busy ? 'Submitting...' : 'Submit decision'}</button>
              </section>
            )}

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Review timeline</h2>
              {submission.reviews.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No reviewer decisions yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {submission.reviews.map((review) => (
                    <article key={review.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <strong>{review.decision.toLowerCase()}</strong>
                        <span className="text-xs text-slate-500">{new Date(review.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Reviewer: {review.reviewer.displayName}</p>
                      <p className="mt-2 whitespace-pre-wrap text-slate-700">{review.notes}</p>
                      <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(review.evidence, null, 2)}</pre>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Analysis report</h2>
              <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(submission.analysisReport, null, 2)}</pre>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
