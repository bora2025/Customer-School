'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { groupResults, highlightParts, PluginSearchResult, rememberSearch, searchPlugins } from '../lib/plugin-search';

/** Type-ahead search over every active plugin's records. Enter on a result opens it; Enter on the
 *  text opens the full search page. "/" focuses the box from anywhere on the page. */
export default function GlobalSearchBox({ placeholder, searchPath = '/admin/search' }: { placeholder?: string; searchPath?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPlugins(q, controller.signal)
        .then((found) => { setResults(found.slice(0, 8)); setActive(-1); })
        .catch(() => { if (!controller.signal.aborted) setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      event.preventDefault(); input.current?.focus();
    };
    const onClick = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  const groups = useMemo(() => groupResults(results), [results]);
  const flat = useMemo(() => groups.flatMap((group) => group.results), [groups]);
  const q = query.trim();

  function openAll() {
    if (q.length < 2) return;
    rememberSearch(q);
    router.push(`${searchPath}?q=${encodeURIComponent(q)}`);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(flat.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(-1, index - 1)); }
    else if (event.key === 'Escape') { setOpen(false); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && flat[active]) { rememberSearch(q); router.push(flat[active].href); } else openAll();
    }
  }

  const showPanel = open && q.length >= 2;
  return (
    <div ref={box} className="relative w-full">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
        <input
          ref={input}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          maxLength={100}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-label="Search students, staff and classes"
          placeholder={placeholder || 'Search students, staff, classes — name, ID, phone…'}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
        />
        {loading ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" aria-label="Searching" />
          : <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 sm:inline">/</kbd>}
      </div>
      {showPanel && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          {!loading && flat.length === 0 && <p className="px-4 py-5 text-sm text-slate-500">No matches for “{q}”.</p>}
          {groups.map((group) => (
            <div key={group.key} className="border-b border-slate-100 py-1.5 last:border-b-0">
              <p className="px-4 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{group.label}</p>
              {group.results.map((result) => {
                const index = flat.indexOf(result);
                return (
                  <Link key={`${result.pluginId}:${result.id}`} href={result.href} role="option" aria-selected={index === active}
                    onClick={() => rememberSearch(q)}
                    className={`flex items-center gap-3 px-4 py-2 ${index === active ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{initials(result.title)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800"><Highlight text={result.title} query={q} /></span>
                      {result.description && <span className="block truncate text-xs text-slate-500"><Highlight text={result.description} query={q} /></span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
          <button type="button" onClick={openAll} className="flex w-full items-center justify-between bg-slate-50 px-4 py-2.5 text-left text-sm font-semibold text-indigo-700 hover:bg-indigo-50">
            <span>See all results for “{q}”</span><span aria-hidden="true">↵</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Highlight({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, index) => part.match
    ? <mark key={index} className="rounded bg-amber-100 px-0.5 text-inherit">{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() || '•';
}
