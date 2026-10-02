'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { adminNav } from '../lib/admin-nav';
import { apiFetch } from '../lib/api';
import Sidebar from './Sidebar';

interface PluginSearchResult {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
  href: string;
}

export default function CorePluginSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2) return setError('Enter at least two characters.');
    setLoading(true); setError(''); setSearched(true);
    try {
      const response = await apiFetch(`/api/plugin-api/search?q=${encodeURIComponent(q)}`);
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body?.message || 'Search failed');
      setResults(Array.isArray(body) ? body : []);
    } catch (cause) {
      setResults([]);
      setError(cause instanceof Error ? cause.message : 'Search failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanam Core" navItems={adminNav} accentColor="indigo" />
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <header className="page-header"><h1 className="text-2xl font-bold text-slate-800">Search installed features</h1><p className="mt-1 text-sm text-slate-500">Results are supplied by active plugins and filtered by your permissions.</p></header>
        <div className="page-body space-y-5">
          <form onSubmit={search} className="card flex gap-3 p-4">
            <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Search plugin records…" className="input flex-1" autoFocus />
            <button className="btn btn-primary" disabled={loading || query.trim().length < 2}>{loading ? 'Searching…' : 'Search'}</button>
          </form>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {results.length > 0 && <div className="grid gap-3">{results.map((result) => (
            <Link key={`${result.pluginId}:${result.id}`} href={result.href} className="card block p-5 hover:shadow-md">
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{result.pluginId}</div>
              <h2 className="mt-1 font-semibold text-slate-800">{result.title}</h2>
              {result.description && <p className="mt-2 text-sm text-slate-500">{result.description}</p>}
            </Link>
          ))}</div>}
          {searched && !loading && !error && results.length === 0 && <div className="card p-8 text-center"><p className="font-semibold text-slate-800">No plugin results found.</p><p className="mt-2 text-sm text-slate-500">Only active plugins with a granted search provider are queried.</p></div>}
          {!searched && <div className="card p-8 text-center text-sm text-slate-500">Install and activate feature plugins to make their records searchable here.</div>}
        </div>
      </main>
    </div>
  );
}

