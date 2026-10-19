'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { resolvePluginSourcePath } from '../../lib/plugin-ui-routing';

type Source = { id: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
type Action = { id: string; label: string; mode: 'single' | 'bulk'; source: string; selectionSource?: string; idField?: string; idParameter?: string; confirmation?: string; destructive?: boolean; body?: Record<string, unknown> };

export default function PluginActions({ pluginId, sources, params, actions, selections, onSuccess }: {
  pluginId: string; sources: Source[]; params: Record<string, string>; actions: Action[];
  selections: Record<string, string[]>; onSuccess(): void | Promise<void>;
}) {
  const [running, setRunning] = useState('');
  const [progress, setProgress] = useState<{ completed: number; total: number; failed: number } | null>(null);
  const [message, setMessage] = useState('');

  async function invoke(action: Action) {
    setMessage(''); setProgress(null);
    const source = sources.find((item) => item.id === action.source);
    if (!source) return setMessage('Action source is unavailable.');
    const ids = action.mode === 'bulk' ? selections[action.selectionSource || ''] || [] : [''];
    if (action.mode === 'bulk' && ids.length === 0) return setMessage('Select at least one record first.');
    if (action.confirmation && !window.confirm(action.confirmation)) return;
    setRunning(action.id); setProgress({ completed: 0, total: ids.length, failed: 0 });
    let failed = 0;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      try {
        const sourceParams = id && action.idParameter ? { ...params, [action.idParameter]: id } : params;
        const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(source.path, sourceParams)}`;
        const body = { ...(action.body || {}), ...(id ? { [action.idField || 'id']: id } : {}) };
        const response = await apiFetch(endpoint, { method: source.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(' ') : result.message || `Request failed (${response.status})`);
      } catch { failed += 1; }
      setProgress({ completed: index + 1, total: ids.length, failed });
    }
    setRunning('');
    setMessage(failed ? `${ids.length - failed} completed; ${failed} failed.` : `${ids.length} action${ids.length === 1 ? '' : 's'} completed.`);
    await onSuccess();
  }

  const selectedCount = Math.max(0, ...actions.map((action) => action.mode === 'bulk' ? (selections[action.selectionSource || ''] || []).length : 0));
  return <section className="card overflow-hidden border-slate-200 p-0 shadow-sm">
    <div className="flex flex-col gap-3 bg-gradient-to-r from-slate-50 to-indigo-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-900">Selected record actions</h3><p className="mt-0.5 text-xs text-slate-500">{selectedCount ? `${selectedCount} record${selectedCount === 1 ? '' : 's'} selected` : 'Select one or more rows to enable bulk actions.'}</p></div><div className="flex flex-wrap gap-3">{actions.map((action) => { const unavailable = action.mode === 'bulk' && (selections[action.selectionSource || ''] || []).length === 0; return <button key={action.id} type="button" className={action.destructive ? 'btn border border-red-200 bg-white text-red-700 hover:bg-red-600 hover:text-white' : 'btn btn-primary'} disabled={Boolean(running) || unavailable} onClick={() => invoke(action)}>{running === action.id ? 'Working…' : action.label}</button>; })}</div></div>
    {progress && <div className="mt-4" role="status" aria-live="polite"><div className="mb-1 flex justify-between text-xs text-slate-600"><span>{progress.completed} of {progress.total}</span><span>{progress.failed} failed</span></div><progress className="h-2 w-full" max={progress.total} value={progress.completed} /></div>}
    {message && <p className={`mt-3 text-sm ${message.includes('failed') || message.includes('Select') || message.includes('unavailable') ? 'text-red-700' : 'text-emerald-700'}`} role="status">{message}</p>}
  </section>;
}
