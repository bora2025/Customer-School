'use client';

import { useEffect, useState } from 'react';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';

interface BackupStatus {
  strategy: 'postgresql-native';
  configured: boolean;
  backupCount: number;
  latest: null | {
    createdAt: string;
    file: string;
    sizeBytes: number;
    sha256: string;
    installationSlug: string | null;
    appVersion: string | null;
  };
  restoreMode: 'offline-cli-only';
}

function size(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupPage() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/backup/status')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Status request failed (${response.status})`);
        setStatus(await response.json());
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load backup status'));
  }, []);

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">Backup & Recovery</h1>
          <p className="mt-1 text-sm text-slate-500">PostgreSQL-native, checksum-verified operational backups.</p>
        </div>

        <div className="page-body space-y-6">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          <section className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Backup status</h2>
                <p className="mt-1 text-sm text-slate-500">The browser cannot export or restore the database.</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {!status ? 'Checking…' : status.configured ? 'Storage configured' : 'No backup storage detected'}
              </span>
            </div>

            {status?.latest ? (
              <dl className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 sm:grid-cols-2 xl:grid-cols-4">
                <Info label="Latest backup" value={new Date(status.latest.createdAt).toLocaleString()} />
                <Info label="Size" value={size(status.latest.sizeBytes)} />
                <Info label="School" value={status.latest.installationSlug || 'Legacy / not recorded'} />
                <Info label="Version" value={status.latest.appVersion || 'Not recorded'} />
                <div className="sm:col-span-2 xl:col-span-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">SHA-256</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-700">{status.latest.sha256}</dd>
                </div>
              </dl>
            ) : status ? (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No verified backup manifest was found. Run the operational backup command and confirm this page updates.</div>
            ) : null}
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-semibold text-slate-800">Create a backup</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Run from the API container or an authorized operations job:</p>
            <Code>npm run backup:create</Code>
            <p className="mt-3 text-xs text-slate-500">Docker Compose: <code>docker compose --profile operations run --rm backup</code></p>
          </section>

          <section className="card border-2 border-red-100 p-6">
            <h2 className="text-lg font-semibold text-red-700">Offline restore only</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Restore is intentionally unavailable through the web API. Stop application writes, verify the archive and target school, and use the documented CLI recovery procedure.</p>
            <Code>npm run backup:restore -- --from /data/backups/&lt;file&gt;.dump --confirm-target &lt;school-slug|EMPTY&gt; --yes-replace</Code>
            <p className="mt-3 text-xs font-medium text-red-700">The restore command checks the manifest checksum and creates a pre-restore backup when replacing an installed school.</p>
          </section>

          <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-6">
            <h3 className="font-semibold text-indigo-900">Production protection layers</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-indigo-900/80">
              <li>Railway scheduled volume backups for routine recovery.</li>
              <li>Point-in-time recovery when available for the database plan.</li>
              <li>Portable custom-format dumps stored outside the Railway project.</li>
              <li>Scheduled restore drills; an untested backup is not considered verified.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd></div>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-xs text-emerald-300"><code>{children}</code></pre>;
}
