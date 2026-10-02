'use client';

import { FormEvent, useState } from 'react';

type Field = { id: string; label: string; type: 'text' | 'date' | 'number' | 'select'; options?: Array<{ label: string; value: string | number }> };

export default function PluginQueryFilter({ fields, options, onApply }: { fields: Field[]; options: { sources: string[]; applyLabel?: string; clearLabel?: string }; onApply(sources: string[], values: Record<string, string>): void | Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.id, ''])));
  const [busy, setBusy] = useState(false);
  async function apply(event: FormEvent) { event.preventDefault(); setBusy(true); try { await onApply(options.sources, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))); } finally { setBusy(false); } }
  async function clear() { const empty = Object.fromEntries(fields.map((field) => [field.id, ''])); setValues(empty); setBusy(true); try { await onApply(options.sources, {}); } finally { setBusy(false); } }
  return <form className="card p-5" onSubmit={apply}><div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{fields.map((field) => <label key={field.id} className="text-sm font-medium text-slate-700">{field.label}{field.type === 'select' ? <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={values[field.id]} disabled={busy} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}><option value="">All</option>{field.options?.map((option) => <option key={String(option.value)} value={option.value}>{option.label}</option>)}</select> : <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type={field.type} value={values[field.id]} disabled={busy} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} />}</label>)}</div><div className="mt-4 flex gap-2"><button className="btn btn-primary" disabled={busy}>{options.applyLabel || 'Apply filters'}</button><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void clear()}>{options.clearLabel || 'Clear'}</button></div></form>;
}
