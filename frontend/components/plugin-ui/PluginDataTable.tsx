'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Column = { id: string; label?: string; sortable?: boolean; filterable?: boolean; format?: string };

function rowsFrom(value: unknown): Record<string, unknown>[] {
  const candidate = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as any).items) ? (value as any).items : [];
  return candidate.filter((row: unknown) => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[];
}

function display(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function valueAtPath(row: Record<string, unknown>, dataPath: string) {
  return dataPath.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, row);
}

export default function PluginDataTable({
  title, value, fields, options, loading, error, onSelectionChange, formatValue, pluginId, pageParams,
}: {
  title?: string;
  value: unknown;
  fields?: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
  loading?: boolean;
  error?: string;
  onSelectionChange?(ids: string[]): void;
  formatValue?(value: unknown, kind?: string): string;
  pluginId?: string;
  pageParams?: Record<string, string>;
}) {
  const sourceRows = useMemo(() => rowsFrom(value), [value]);
  const columns = useMemo<Column[]>(() => {
    if (fields?.length) return fields.map((field) => ({ id: String(field.id), label: typeof field.label === 'string' ? field.label : String(field.id), sortable: field.sortable !== false, filterable: field.filterable !== false, format: typeof field.format === 'string' ? field.format : 'text' }));
    return Object.keys(sourceRows[0] || {}).slice(0, 12).map((id) => ({ id, label: id, sortable: true, filterable: true }));
  }, [fields, sourceRows]);
  const pageSize = typeof options?.pageSize === 'number' ? Math.min(Math.max(Math.trunc(options.pageSize), 1), 100) : 10;
  const selectable = options?.selectable === true;
  const rowRoute = typeof options?.rowRoute === 'string' ? options.rowRoute : '';
  const rowParameterMap = options?.rowParameterMap && typeof options.rowParameterMap === 'object' ? options.rowParameterMap as Record<string, string> : {};
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ id: string; direction: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { const available = new Set(sourceRows.map((row, index) => String(row.id ?? `1-${index}`))); setSelected((current) => new Set([...current].filter((id) => available.has(id)))); }, [sourceRows]);
  useEffect(() => { onSelectionChange?.([...selected]); }, [onSelectionChange, selected]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    const result = needle ? sourceRows.filter((row) => columns.some((column) => column.filterable && display(row[column.id]).toLocaleLowerCase().includes(needle))) : [...sourceRows];
    if (sort) result.sort((left, right) => display(left[sort.id]).localeCompare(display(right[sort.id]), undefined, { numeric: true }) * (sort.direction === 'asc' ? 1 : -1));
    return result;
  }, [columns, filter, sort, sourceRows]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rowKey = (row: Record<string, unknown>, index: number) => String(row.id ?? `${currentPage}-${index}`);
  const visibleKeys = visible.map(rowKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

  function rowHref(row: Record<string, unknown>) {
    if (!rowRoute || !pluginId) return '';
    const resolved = rowRoute.replace(/:([a-z][a-zA-Z0-9]*)/g, (_match, name: string) => {
      const value = pageParams?.[name] ?? (rowParameterMap[name] ? valueAtPath(row, rowParameterMap[name]) : undefined);
      return value === undefined || value === null ? '' : encodeURIComponent(String(value));
    });
    return resolved.split('/').some((segment) => !segment) ? '' : `/plugins/${encodeURIComponent(pluginId)}/${resolved}`;
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleKeys.forEach((key) => next.delete(key)); else visibleKeys.forEach((key) => next.add(key));
      return next;
    });
  }

  if (loading) return <section className="card p-6" aria-busy="true"><div className="h-5 w-40 animate-pulse rounded bg-slate-200" /><div className="mt-4 h-28 animate-pulse rounded bg-slate-100" /><span className="sr-only">Loading table</span></section>;
  if (error) return <section className="card border-red-200 p-6" role="alert"><h2 className="font-semibold text-red-800">{title || 'Table'}</h2><p className="mt-2 text-sm text-red-700">{error}</p></section>;

  return <section className="card overflow-hidden">
    <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-semibold text-slate-800">{title || 'Records'}</h2>{selectable && selected.size > 0 && <p className="text-xs text-slate-500">{selected.size} selected</p>}</div>
      <label className="text-sm text-slate-600">Filter <input className="ml-2 rounded-lg border border-slate-300 px-3 py-2" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }} type="search" /></label>
    </div>
    {sourceRows.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No records found.</div> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No records match this filter.</div> : <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50"><tr>
          {selectable && <th className="w-12 px-4 py-3"><input aria-label="Select all visible rows" type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /></th>}
          {columns.map((column) => <th key={column.id} scope="col" className="px-4 py-3 text-left font-semibold text-slate-700">{column.sortable ? <button className="inline-flex items-center gap-1" onClick={() => setSort((current) => ({ id: column.id, direction: current?.id === column.id && current.direction === 'asc' ? 'desc' : 'asc' }))}>{column.label}{sort?.id === column.id ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button> : column.label}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100 bg-white">{visible.map((row, index) => { const key = rowKey(row, index); const href = rowHref(row); return <tr key={key} className={selected.has(key) ? 'bg-indigo-50' : ''}>
          {selectable && <td className="px-4 py-3"><input aria-label={`Select row ${index + 1}`} type="checkbox" checked={selected.has(key)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} /></td>}
          {columns.map((column, columnIndex) => { const content = formatValue ? formatValue(valueAtPath(row, column.id), column.format) : display(valueAtPath(row, column.id)); return <td key={column.id} className="max-w-sm px-4 py-3 text-slate-700">{href && columnIndex === 0 ? <Link className="font-medium text-indigo-700 hover:underline" href={href}>{content}</Link> : content}</td>; })}
        </tr>; })}</tbody>
      </table>
    </div>}
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600"><span>{filtered.length} record{filtered.length === 1 ? '' : 's'}</span><div className="flex items-center gap-2"><button className="btn btn-secondary" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="btn btn-secondary" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button></div></div>
  </section>;
}
