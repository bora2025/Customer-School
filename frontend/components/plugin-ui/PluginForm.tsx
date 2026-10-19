'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { resolvePluginSourcePath } from '../../lib/plugin-ui-routing';

type Field = {
  id: string; type: 'text' | 'email' | 'number' | 'date' | 'datetime' | 'select' | 'textarea' | 'json' | 'checkbox'; label: string;
  required?: boolean; disabled?: boolean; min?: number; max?: number; minLength?: number; maxLength?: number;
  jsonShape?: 'object' | 'array' | 'any'; defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>; visibleWhen?: { field: string; equals: string | number | boolean };
};

export default function PluginForm({ title, pluginId, source, params, fields, options, initialData, onSuccess }: {
  title?: string;
  pluginId: string;
  source: { method: 'POST' | 'PUT' | 'PATCH'; path: string };
  params: Record<string, string>;
  fields: Field[];
  options?: { submitLabel?: string; confirmation?: string; successMessage?: string; successRoute?: string; collapsible?: boolean; defaultCollapsed?: boolean; triggerLabel?: string };
  initialData?: unknown;
  onSuccess(result: unknown): void | Promise<void>;
}) {
  const router = useRouter();
  const initial = useMemo(() => initialData && typeof initialData === 'object' && !Array.isArray(initialData) ? initialData as Record<string, unknown> : {}, [initialData]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(!(options?.collapsible && options?.defaultCollapsed !== false));
  useEffect(() => { const next: Record<string, unknown> = {}; fields.forEach((field) => {
    const value = initial[field.id] ?? field.defaultValue;
    next[field.id] = field.type === 'json' && value && typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : value ?? (field.type === 'checkbox' ? false : '');
  }); setValues(next); }, [fields, initial]);

  const visible = (field: Field) => !field.visibleWhen || values[field.visibleWhen.field] === field.visibleWhen.equals;
  function validate() {
    const next: Record<string, string> = {};
    fields.filter(visible).forEach((field) => {
      const value = values[field.id];
      const text = typeof value === 'string' ? value.trim() : value;
      if (field.required && (text === '' || text === undefined || text === null || value === false)) next[field.id] = `${field.label} is required.`;
      else if (typeof text === 'string' && field.type === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) next[field.id] = 'Enter a valid email address.';
      else if (typeof text === 'string' && field.minLength !== undefined && text.length < field.minLength) next[field.id] = `Use at least ${field.minLength} characters.`;
      else if (typeof text === 'string' && field.maxLength !== undefined && text.length > field.maxLength) next[field.id] = `Use no more than ${field.maxLength} characters.`;
      else if (field.type === 'json') {
        try {
          const parsed = JSON.parse(String(value));
          const shape = field.jsonShape || 'object';
          if (shape === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) next[field.id] = 'Enter a JSON object.';
          if (shape === 'array' && !Array.isArray(parsed)) next[field.id] = 'Enter a JSON array.';
        } catch { next[field.id] = 'Enter valid JSON.'; }
      }
      else if (field.type === 'number' && text !== '' && (!Number.isFinite(Number(text)) || (field.min !== undefined && Number(text) < field.min) || (field.max !== undefined && Number(text) > field.max))) next[field.id] = `Enter a number${field.min !== undefined ? ` from ${field.min}` : ''}${field.max !== undefined ? ` to ${field.max}` : ''}.`;
    });
    setErrors(next); return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setServerError(''); setSuccess('');
    if (!validate()) return;
    if (options?.confirmation && !window.confirm(options.confirmation)) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(fields.filter(visible).map((field) => [field.id,
        field.type === 'number' && values[field.id] !== '' ? Number(values[field.id])
          : field.type === 'json' ? JSON.parse(String(values[field.id])) : values[field.id],
      ]));
      const routeValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? '')]));
      const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(source.path, { ...routeValues, ...params })}`;
      const response = await apiFetch(endpoint, { method: source.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.fieldErrors && typeof result.fieldErrors === 'object') setErrors(result.fieldErrors);
        throw new Error(Array.isArray(result.message) ? result.message.join(' ') : result.message || `Request failed (${response.status})`);
      }
      setSuccess(options?.successMessage || 'Saved successfully.');
      await onSuccess(result);
      if (options?.successRoute && result && typeof result === 'object' && !Array.isArray(result)) {
        const destination = resolvePluginSourcePath(options.successRoute, Object.fromEntries(Object.entries(result as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])));
        router.push(`/plugins/${encodeURIComponent(pluginId)}/${destination}`);
      }
    } catch (cause) { setServerError(cause instanceof Error ? cause.message : 'The form could not be saved.'); }
    finally { setBusy(false); }
  }

  if (options?.collapsible && !expanded) return <section className="card flex flex-wrap items-center justify-between gap-4 p-5"><div><h2 className="text-lg font-bold text-slate-950">{title || 'Details'}</h2><p className="mt-1 text-sm text-slate-500">Open the form when you need to create a new record.</p></div><button type="button" className="btn btn-primary" onClick={() => setExpanded(true)}>＋ {options.triggerLabel || title || 'Add record'}</button></section>;
  return <form className="card max-w-5xl space-y-5 overflow-hidden p-0" onSubmit={submit} noValidate>
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-indigo-50/60 px-6 py-5"><div><h2 className="text-lg font-bold text-slate-950">{title || 'Details'}</h2><p className="mt-1 text-xs text-slate-500">Fields marked with an asterisk are required. Changes are validated before saving.</p></div>{options?.collapsible && <button type="button" className="btn btn-secondary" onClick={() => setExpanded(false)}>Close</button>}</div>
    <div className="space-y-4 px-6" aria-live="polite">
    {serverError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{serverError}</div>}
    {success && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}
    </div><div className="grid gap-5 px-6 sm:grid-cols-2">{fields.filter(visible).map((field) => <label key={field.id} className={`block text-sm font-medium text-slate-700 ${field.type === 'textarea' || field.type === 'json' ? 'sm:col-span-2' : ''}`}>{field.label}{field.required && <span aria-hidden="true" className="text-red-600"> *</span>}
      {field.type === 'textarea' || field.type === 'json' ? <textarea className={`mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 ${field.type === 'json' ? 'min-h-64 font-mono text-xs' : 'min-h-28'}`} value={String(values[field.id] ?? '')} disabled={field.disabled || busy} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} aria-invalid={Boolean(errors[field.id])} aria-describedby={errors[field.id] ? `${field.id}-error` : undefined} />
      : field.type === 'select' ? <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={String(values[field.id] ?? '')} disabled={field.disabled || busy} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}><option value="">Select…</option>{field.options?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      : field.type === 'checkbox' ? <input className="ml-3" type="checkbox" checked={Boolean(values[field.id])} disabled={field.disabled || busy} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.checked }))} />
      : <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type={field.type === 'datetime' ? 'datetime-local' : field.type} value={String(values[field.id] ?? '')} disabled={field.disabled || busy} min={field.min} max={field.max} minLength={field.minLength} maxLength={field.maxLength} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} aria-invalid={Boolean(errors[field.id])} aria-describedby={errors[field.id] ? `${field.id}-error` : undefined} />}
      {errors[field.id] && <span id={`${field.id}-error`} className="mt-1 block text-xs font-normal text-red-600">{errors[field.id]}</span>}
    </label>)}</div>
    <div className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-6 py-4"><button className="btn btn-primary min-w-32" type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : options?.submitLabel || 'Save'}</button></div>
  </form>;
}
