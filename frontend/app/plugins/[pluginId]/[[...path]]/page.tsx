'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import AuthGuard from '../../../../components/AuthGuard';
import Sidebar from '../../../../components/Sidebar';
import { adminNav } from '../../../../lib/admin-nav';
import { apiFetch } from '../../../../lib/api';
import { matchPluginPage, PluginUiPageDescriptor, resolvePluginSourcePath } from '../../../../lib/plugin-ui-routing';
import PluginUiRenderer from '../../../../components/plugin-ui/PluginUiRenderer';

export default function PluginPageHost() {
  const params = useParams<{ pluginId: string; path?: string[] }>();
  const pluginId = decodeURIComponent(params.pluginId || '');
  const routePath = (params.path || ['settings']).map(decodeURIComponent).join('/');
  const legacyEndpoint = useMemo(() => `/api/plugin-api/${encodeURIComponent(pluginId)}/${routePath.split('/').map(encodeURIComponent).join('/')}`, [pluginId, routePath]);
  const [value, setValue] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [label, setLabel] = useState(pluginId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [descriptor, setDescriptor] = useState<PluginUiPageDescriptor | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [routeParams, setRouteParams] = useState<Record<string, string>>({});
  const [sourceQueries, setSourceQueries] = useState<Record<string, Record<string, string>>>({});

  async function load(queries = sourceQueries) {
    setError(''); setSourceErrors({}); setValue(null);
    const extensionsResponse = await apiFetch('/api/plugin-api/my-extensions');
    if (!extensionsResponse.ok) throw new Error(`Plugin extensions failed (${extensionsResponse.status})`);
    const extensions = await extensionsResponse.json();
    const pluginPages = (extensions.pages || []).filter((entry: any) => entry.pluginId === pluginId);
    const v1Page = pluginPages.find((entry: any) => entry.schemaVersion === 1 && entry.routePath === routePath);
    const matched = matchPluginPage(pluginPages.filter((entry: any) => entry.schemaVersion === 2), routePath);
    const page = v1Page || matched?.page;
    if (!page) throw new Error('This plugin page is not registered by an active plugin or its route parameters are invalid.');
    setLabel(page.title || pluginId);
    setDescriptor(page.schemaVersion === 2 ? page : null);
    setRouteParams(matched?.params || {});
    if (page.schemaVersion === 2) {
      const data: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      await Promise.all(page.dataSources.filter((entry: any) => entry.method === 'GET' && entry.autoload !== false).map(async (source: any) => {
        const query = new URLSearchParams(queries[source.id] || {}).toString();
        const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(source.path, matched?.params || {})}${query ? `?${query}` : ''}`;
        try {
          const response = await apiFetch(endpoint);
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.message || `Data request failed (${response.status})`);
          data[source.id] = result;
        } catch (cause) { errors[source.id] = cause instanceof Error ? cause.message : 'Data request failed'; }
      }));
      setSourceErrors(errors); setValue(data); setText(JSON.stringify(data, null, 2)); return;
    }
    const response = await apiFetch(legacyEndpoint);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Plugin page failed (${response.status})`);
    setValue(result);
    setText(JSON.stringify(result, null, 2));
  }

  useEffect(() => { setSourceQueries({}); load({}).catch((cause) => setError(cause instanceof Error ? cause.message : 'Plugin page failed')); }, [legacyEndpoint]);

  async function save() {
    setBusy(true); setError('');
    try {
      const body = JSON.parse(text);
      const response = await apiFetch(legacyEndpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Plugin settings update failed (${response.status})`);
      setValue(result); setText(JSON.stringify(result, null, 2));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Plugin settings update failed'); }
    finally { setBusy(false); }
  }

  return (
    <AuthGuard>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanam" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header"><h1 className="text-2xl font-bold text-slate-800">{label}</h1><p className="mt-1 font-mono text-xs text-slate-500">{pluginId} · {routePath}</p></div>
          <div className="page-body">
            {descriptor ? <PluginUiRenderer pluginId={pluginId} page={descriptor} params={routeParams} data={(value || {}) as Record<string, unknown>} loading={value === null} errors={sourceErrors} onRefresh={load} onQueryFilters={async (sources, values) => { const next = { ...sourceQueries }; sources.forEach((source) => { next[source] = values; }); setSourceQueries(next); await load(next); }} /> : <section className="card max-w-3xl p-6">
              <h2 className="font-semibold text-slate-800">{descriptor ? 'Plugin page data' : 'Plugin settings'}</h2>
              <p className="mt-1 text-sm text-slate-500">This generic host sends JSON only to the plugin&apos;s namespaced, authenticated core route. Plugin browser scripts are not injected into Wattanam.</p>
              {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
              <textarea aria-label="Plugin settings JSON" className="mt-4 min-h-72 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm" value={text} onChange={(event) => setText(event.target.value)} disabled={value === null || busy} />
              <div className="mt-4 flex gap-3">{!descriptor && <button className="btn btn-primary" onClick={save} disabled={value === null || busy}>{busy ? 'Saving…' : 'Save settings'}</button>}<button className="btn btn-secondary" onClick={() => load().catch((cause) => setError(cause.message))} disabled={busy}>Reload</button></div>
            </section>}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
