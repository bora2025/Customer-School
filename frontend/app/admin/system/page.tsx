'use client';

import { useEffect, useState } from 'react';
import AuthGuard from '../../../components/AuthGuard';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';

interface Diagnostics {
  status: string;
  version?: { version?: string; commit?: string | null; environment?: string; distribution?: string };
  checks?: { database?: { status?: string; responseTimeMs?: number } };
  migrations?: { appliedCount?: number; latestApplied?: string | null; failed?: string[] };
  backup?: { configured?: boolean; backupCount?: number };
}

interface UpdateStatus {
  enabled?: boolean;
  reason?: string;
  pluginUpdates?: unknown[];
  core?: { updates?: unknown[] };
}

export default function SystemPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [updates, setUpdates] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([apiFetch('/api/diagnostics'), apiFetch('/api/updates')])
      .then(async ([diagnosticsResponse, updatesResponse]) => {
        if (!diagnosticsResponse.ok) throw new Error(`Diagnostics failed (${diagnosticsResponse.status})`);
        setDiagnostics(await diagnosticsResponse.json());
        if (updatesResponse.ok) setUpdates(await updatesResponse.json());
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load system status'));
  }, []);

  const updateCount = (updates?.pluginUpdates?.length || 0) + (updates?.core?.updates?.length || 0);

  return (
    <AuthGuard allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
        <main className="page-content">
          <div className="h-14 lg:hidden" />
          <header className="page-header">
            <h1 className="text-2xl font-bold text-slate-800">Updates &amp; System Health</h1>
            <p className="mt-1 text-sm text-slate-500">Core runtime, database, migrations, backups and available updates.</p>
          </header>
          <div className="page-body space-y-6">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Status label="API" value={diagnostics?.status || 'Checking…'} good={diagnostics?.status === 'ready'} />
              <Status label="Database" value={diagnostics?.checks?.database?.status || 'Checking…'} good={diagnostics?.checks?.database?.status === 'up'} />
              <Status label="Migrations" value={diagnostics ? `${diagnostics.migrations?.appliedCount || 0} applied` : 'Checking…'} good={!diagnostics?.migrations?.failed?.length} />
              <Status label="Updates" value={!updates ? 'Checking…' : updates.enabled === false ? 'Disabled' : `${updateCount} available`} good={updates?.enabled !== false && updateCount === 0} />
            </section>
            <section className="card p-6">
              <h2 className="text-lg font-semibold text-slate-800">Runtime</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Version" value={diagnostics?.version?.version || '—'} />
                <Detail label="Distribution" value={diagnostics?.version?.distribution || '—'} />
                <Detail label="Environment" value={diagnostics?.version?.environment || '—'} />
                <Detail label="Commit" value={diagnostics?.version?.commit || '—'} />
              </dl>
              {updates?.enabled === false && <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Updates are disabled: {updates.reason || 'repository not configured'}</p>}
              <a href="/admin/plugins" className="btn btn-primary mt-5 inline-flex">Review and install updates</a>
            </section>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

function Status({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="card p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-lg font-semibold ${good ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-800">{value}</dd></div>;
}

