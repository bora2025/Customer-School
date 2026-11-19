'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyboardEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { adminNav } from '../lib/admin-nav';
import { forgetSearches, groupResults, pluginLabel, PluginSearchResult, recentSearches, rememberSearch, searchPlugins } from '../lib/plugin-search';
import { Highlight, initials } from './GlobalSearchBox';
import Sidebar from './Sidebar';
import { ROLE_INFO, workspaceNav } from '../lib/workspace-nav';

/** Search every active plugin's records: results appear while typing, grouped by kind (Students,
 *  Staff, Classes…), filterable, with keyboard navigation. The query stays in the address (?q=). */
/** `workspace`: the staff roles' version (their own menu and address). */
export default function CorePluginSearch({ workspace }: { workspace?: { role: string | null } }) {
  return <Suspense fallback={null}><SearchPage workspace={workspace} /></Suspense>;
}

function SearchPage({ workspace }: { workspace?: { role: string | null } }) {
  const basePath = workspace ? '/workspace/search' : '/admin/search';
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params?.get('q') || '');
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [searchedFor, setSearchedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setRecent(recentSearches()); }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearchedFor(''); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPlugins(q, controller.signal)
        .then((found) => {
          setResults(found); setSearchedFor(q); setError(''); setActive(-1); setFilter('all');
          router.replace(`${basePath}?q=${encodeURIComponent(q)}`, { scroll: false });
        })
        .catch((cause) => { if (!controller.signal.aborted) { setResults([]); setError(cause instanceof Error ? cause.message : 'Search failed'); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, router, basePath]);

  const groups = useMemo(() => groupResults(results), [results]);
  const visible = useMemo(() => (filter === 'all' ? groups : groups.filter((group) => group.key === filter)), [groups, filter]);
  const flat = useMemo(() => visible.flatMap((group) => group.results), [visible]);
  const q = query.trim();

  function open(result: PluginSearchResult) { rememberSearch(searchedFor || q); router.push(result.href); }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(flat.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(-1, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); const target = flat[Math.max(0, active)]; if (target) open(target); }
    else if (event.key === 'Escape') { setQuery(''); }
  }
  useEffect(() => {
    if (active < 0) return;
    document.querySelector(`[data-result-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="page-shell">
      {workspace
        ? <Sidebar title="Workspace" subtitle={ROLE_INFO[workspace.role || '']?.label || 'Wattanam'} navItems={workspaceNav(workspace.role)} accentColor="indigo" />
        : <Sidebar title="Admin Panel" subtitle="Wattanam Core" navItems={adminNav} accentColor="indigo" />}
      <main className="page-content">
        <div className="h-14 lg:hidden" />
        <header className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">Search</h1>
          <p className="mt-1 text-sm text-slate-500">Students, staff, classes and other records from your active plugins. Results respect your permissions.</p>
        </header>
        <div className="page-body space-y-5">
          <div className="card sticky top-2 z-10 flex items-center gap-3 p-3 sm:p-4">
            <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
            <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} maxLength={100} autoFocus
              aria-label="Search" placeholder="Name, Khmer name, ID number, phone, email, class…" className="min-w-0 flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400" />
            {loading && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" aria-label="Searching" />}
            {query && !loading && <button type="button" onClick={() => { setQuery(''); input.current?.focus(); }} className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">Clear</button>}
          </div>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {q.length < 2 && (
            <div className="card p-6">
              <p className="text-sm font-semibold text-slate-700">Type at least two characters — results appear as you type.</p>
              <ul className="mt-3 grid gap-1.5 text-sm text-slate-500 sm:grid-cols-2">
                <li>• A name in Khmer or Latin letters, in any word order</li>
                <li>• A student or employee ID number</li>
                <li>• A phone number or email</li>
                <li>• A class name, position or department</li>
              </ul>
              {recent.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent searches</p>
                    <button type="button" onClick={() => { forgetSearches(); setRecent([]); }} className="text-xs font-semibold text-slate-400 hover:text-slate-600">Clear</button></div>
                  <div className="mt-2 flex flex-wrap gap-2">{recent.map((item) => (
                    <button key={item} type="button" onClick={() => setQuery(item)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:border-indigo-300 hover:text-indigo-700">{item}</button>
                  ))}</div>
                </div>
              )}
            </div>
          )}

          {searchedFor && groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter results">
              {[{ key: 'all', label: 'All', count: results.length }, ...groups.map((group) => ({ key: group.key, label: group.label, count: group.results.length }))].map((chip) => (
                <button key={chip.key} type="button" role="tab" aria-selected={filter === chip.key} onClick={() => { setFilter(chip.key); setActive(-1); }}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${filter === chip.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-300'}`}>
                  {chip.label} <span className={filter === chip.key ? 'text-indigo-100' : 'text-slate-400'}>{chip.count}</span>
                </button>
              ))}
              <span className="ml-auto hidden text-xs text-slate-400 sm:inline">↑ ↓ to move · Enter to open</span>
            </div>
          )}

          {visible.map((group) => (
            <section key={group.key} aria-label={group.label} className="card overflow-hidden">
              <h2 className="border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">{group.label} <span className="text-slate-400">· {group.results.length}</span></h2>
              <ul className="divide-y divide-slate-100">
                {group.results.map((result) => {
                  const index = flat.indexOf(result);
                  return (
                    <li key={`${result.pluginId}:${result.id}`}>
                      <Link href={result.href} data-result-index={index} onClick={() => rememberSearch(searchedFor || q)}
                        className={`group flex items-center gap-4 px-5 py-3 transition ${index === active ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{initials(result.title)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-800"><Highlight text={result.title} query={searchedFor} /></span>
                          {result.description && <span className="mt-0.5 block truncate text-sm text-slate-500"><Highlight text={result.description} query={searchedFor} /></span>}
                        </span>
                        <span className="hidden shrink-0 text-xs font-medium text-slate-400 md:inline">{pluginLabel(result.pluginId)}</span>
                        <span className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold ${index === active ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white'}`}>Open →</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {searchedFor && !loading && !error && results.length === 0 && (
            <div className="card p-8 text-center">
              <p className="font-semibold text-slate-800">Nothing found for “{searchedFor}”.</p>
              <p className="mt-2 text-sm text-slate-500">Check the spelling, try fewer words, or search by ID number. Only active plugins that offer search are included.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
