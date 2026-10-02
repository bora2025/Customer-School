'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type SubmissionDetail = {
  id: string;
  status: string;
  riskLevel: string;
  analysisReport: unknown;
  submittedBy: string;
  submittedAt: string;
  decidedAt?: string | null;
  publisher: { id: string; slug: string; displayName: string };
  pluginVersion: {
    id: string;
    pluginId: string;
    version: string;
    channel: string;
    reviewStatus: string;
    publishedAt?: string | null;
    withdrawnAt?: string | null;
    changelog?: string | null;
  };
  reviews: Array<{
    id: string;
    decision: string;
    notes: string;
    evidence: unknown;
    createdAt: string;
    reviewer: { id: string; displayName: string };
  }>;
};

export default function PublisherSubmissionDetailPage() {
  const params = useParams<{ submissionId: string }>();
  const submissionId = params.submissionId;
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setBusy(true);
      setError('');
      const response = await fetch(`/api/marketplace/publisher-submissions/${encodeURIComponent(submissionId)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSubmission(null);
        setError(body.error || 'Could not load submission detail');
      } else {
        setSubmission(body as SubmissionDetail);
      }
      setBusy(false);
    }
    if (submissionId) load().catch(() => setError('Could not load submission detail'));
  }, [submissionId]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Submission Detail</h1>
            <p className="mt-2 text-slate-600">Review timeline and analysis for your plugin submission.</p>
          </div>
          <Link className="btn btn-secondary" href="/marketplace/publisher">Back to publisher portal</Link>
        </header>

        {busy && <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">Loading submission...</div>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        {submission && !busy && (
          <>
            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Release</h2>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
                <div><dt className="text-xs text-slate-500">Plugin</dt><dd className="font-medium">{submission.pluginVersion.pluginId}</dd></div>
                <div><dt className="text-xs text-slate-500">Version</dt><dd className="font-medium">{submission.pluginVersion.version}</dd></div>
                <div><dt className="text-xs text-slate-500">Channel</dt><dd>{submission.pluginVersion.channel.toLowerCase()}</dd></div>
                <div><dt className="text-xs text-slate-500">Submission status</dt><dd>{submission.status.toLowerCase().replaceAll('_', ' ')}</dd></div>
                <div><dt className="text-xs text-slate-500">Review status</dt><dd>{submission.pluginVersion.reviewStatus.toLowerCase().replaceAll('_', ' ')}</dd></div>
                <div><dt className="text-xs text-slate-500">Risk level</dt><dd>{submission.riskLevel.toLowerCase()}</dd></div>
                <div><dt className="text-xs text-slate-500">Submitted</dt><dd>{new Date(submission.submittedAt).toLocaleString()}</dd></div>
                <div><dt className="text-xs text-slate-500">Decided</dt><dd>{submission.decidedAt ? new Date(submission.decidedAt).toLocaleString() : 'Pending'}</dd></div>
              </dl>
              {submission.pluginVersion.changelog && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">{submission.pluginVersion.changelog}</div>
              )}
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Review timeline</h2>
              {submission.reviews.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No reviewer decisions yet.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {submission.reviews.map((review) => (
                    <article key={review.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{review.decision.toLowerCase()}</strong>
                        <span className="text-xs text-slate-500">{new Date(review.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Reviewer: {review.reviewer.displayName}</p>
                      <p className="mt-2 whitespace-pre-wrap text-slate-700">{review.notes}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-indigo-700">Evidence</summary>
                        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(review.evidence, null, 2)}</pre>
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Analyzer output</h2>
              <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(submission.analysisReport, null, 2)}</pre>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
