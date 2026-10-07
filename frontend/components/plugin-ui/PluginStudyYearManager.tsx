'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

type StudyYear = {
  id: string;
  year: number;
  label?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
  schoolName?: string | null;
  logoUrl?: string | null;
  classCount?: number;
  _count?: { classes?: number };
};

type Source = { id: string; method: string; path: string };

const emptyForm = (year = new Date().getFullYear()) => ({
  year: String(year), label: `${year}-${year + 1}`, startDate: '', endDate: '', schoolName: '', logoUrl: '',
});

function rowsFrom(value: unknown): StudyYear[] {
  if (Array.isArray(value)) return value as StudyYear[];
  if (value && typeof value === 'object' && Array.isArray((value as any).items)) return (value as any).items;
  return [];
}

function dateLabel(value?: string | null) {
  if (!value) return 'Not set';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }).format(date);
}

async function logoDataUrl(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2 MB or smaller.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) throw new Error('Use a PNG, JPG, SVG, or WebP logo.');
  const input = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Logo could not be read.')); reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const candidate = new Image(); candidate.onload = () => resolve(candidate); candidate.onerror = () => reject(new Error('Logo is not a valid image.')); candidate.src = input;
  });
  const maximum = 320; const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('Logo preview is unavailable.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png', 0.9);
}

export default function PluginStudyYearManager({ pluginId, value, sources, options, loading, error, onRefresh }: any) {
  const years = useMemo(() => rowsFrom(value), [value]);
  const [open, setOpen] = useState(false); const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState(''); const [formError, setFormError] = useState('');
  const source = (id: string) => sources.find((item: Source) => item.id === id) as Source | undefined;
  const endpoint = (item: Source, id?: string) => `/api/plugin-api/${encodeURIComponent(pluginId)}/${item.path.replace(':studyYearId', encodeURIComponent(id || ''))}`;

  function changeYear(raw: string) {
    const year = Number(raw); setForm((current) => ({ ...current, year: raw, label: !current.label || /^\d{4}-\d{4}$/.test(current.label) ? (Number.isInteger(year) ? `${year}-${year + 1}` : '') : current.label }));
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setFormError('');
    try {
      const logoUrl = await logoDataUrl(file);
      setForm((current) => ({ ...current, logoUrl }));
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Logo could not be uploaded.'); }
    event.target.value = '';
  }

  async function mutate(item: Source | undefined, id?: string, body?: unknown) {
    if (!item) throw new Error('This action is unavailable.');
    const response = await apiFetch(endpoint(item, id), { method: item.method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(' ') : result.message || `Request failed (${response.status})`);
    return result;
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setFormError(''); setMessage('');
    const year = Number(form.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return setFormError('Year must be between 2020 and 2100.');
    if (form.startDate && form.endDate && form.startDate > form.endDate) return setFormError('End Date must be on or after Start Date.');
    setBusy('create');
    try {
      await mutate(source(options.createSource), undefined, { ...form, year, label: form.label.trim() || `${year}-${year + 1}`, schoolName: form.schoolName.trim() || null, logoUrl: form.logoUrl || null, startDate: form.startDate || null, endDate: form.endDate || null });
      setForm(emptyForm(year + 1)); setOpen(false); setMessage('Study year created successfully.'); await onRefresh();
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : 'Study year could not be created.'); } finally { setBusy(''); }
  }

  async function action(kind: 'current' | 'delete', row: StudyYear) {
    if (kind === 'delete' && !window.confirm(`Delete ${row.label || row.year}? This cannot be undone.`)) return;
    setBusy(`${kind}:${row.id}`); setMessage('');
    try { await mutate(source(kind === 'current' ? options.setCurrentSource : options.deleteSource), row.id); setMessage(kind === 'current' ? `${row.label || row.year} is now current.` : 'Study year deleted.'); await onRefresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The action failed.'); } finally { setBusy(''); }
  }

  return <div className="space-y-7">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Study Years</h1><p className="mt-1 text-base text-slate-500">Manage academic study years. Create a study year first, then create classes under it.</p></div>
      <button className="inline-flex min-h-11 items-center justify-center self-start rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200" onClick={() => { setOpen((current) => !current); setFormError(''); }}>+ New Study Year</button>
    </div>

    {message && <div className={`rounded-xl border px-4 py-3 text-sm ${/failed|cannot|unavailable/i.test(message) ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`} role="status">{message}</div>}

    {open && <form className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7" onSubmit={create} noValidate>
      <h2 className="text-xl font-bold text-slate-900">New Study Year</h2>
      {formError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{formError}</div>}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Year <span className="text-red-600">*</span><input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" type="number" min="2020" max="2100" value={form.year} onChange={(event) => changeYear(event.target.value)} required /></label>
        <label className="text-sm font-semibold text-slate-700">Label<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={form.label} placeholder="2026-2027" onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} /></label>
        <label className="text-sm font-semibold text-slate-700">Start Date<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label className="text-sm font-semibold text-slate-700">End Date<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></label>
      </div>
      <label className="mt-5 block text-sm font-semibold text-slate-700">School Name · ឈ្មោះសាលា<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={form.schoolName} placeholder="e.g. Wattanam International School" onChange={(event) => setForm((current) => ({ ...current, schoolName: event.target.value }))} /></label>
      <div className="mt-5"><p className="text-sm font-semibold text-slate-700">School Logo</p><div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-400">{form.logoUrl ? <img src={form.logoUrl} alt="School logo preview" className="h-full w-full object-contain p-2" /> : <span>▧<br />Logo</span>}</div>
        <div><label className="inline-flex cursor-pointer rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Upload Logo<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={upload} /></label><p className="mt-2 text-xs text-slate-400">PNG, JPG, SVG or WebP · max 2 MB</p></div>
      </div></div>
      <div className="mt-6 flex gap-3"><button className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-60" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create'}</button><button type="button" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { setOpen(false); setFormError(''); }}>Cancel</button></div>
    </form>}

    {loading ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-52 animate-pulse rounded-3xl bg-slate-100" />)}</div>
      : error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      : years.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center"><h2 className="text-lg font-bold text-slate-800">No study years yet</h2><p className="mt-1 text-sm text-slate-500">Create the first study year to begin organizing classes.</p></div>
      : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{years.map((row) => { const count = Number(row._count?.classes ?? row.classCount ?? 0); return <article key={row.id} className={`relative rounded-3xl border-2 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${row.isCurrent ? 'border-indigo-500 bg-indigo-50/30' : 'border-slate-200'}`}>
        {row.isCurrent && <span className="absolute right-4 top-4 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">Current</span>}
        <div className="flex gap-4 pr-16"><div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">{row.logoUrl ? <img src={row.logoUrl} alt="" className="h-full w-full object-contain p-1" /> : <span className="text-xl font-bold text-indigo-600">SY</span>}</div><div className="min-w-0"><h2 className="text-xl font-extrabold text-slate-900">{row.label || `${row.year}-${Number(row.year) + 1}`}</h2>{row.schoolName && <p className="mt-0.5 truncate font-medium text-indigo-700">{row.schoolName}</p>}<p className="mt-1 text-sm text-slate-600">{count} {count === 1 ? 'class' : 'classes'}</p><p className="mt-1 text-sm text-slate-400">{dateLabel(row.startDate)} – {dateLabel(row.endDate)}</p></div></div>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-100 pt-5 text-sm font-semibold"><Link className="text-slate-700 hover:text-indigo-700" href={`/plugins/${encodeURIComponent(pluginId)}/${options.classesRoute}?studyYearId=${encodeURIComponent(row.id)}`}>View Classes</Link><Link className="text-slate-700 hover:text-indigo-700" href={`/plugins/${encodeURIComponent(pluginId)}/${options.editRoute}/${encodeURIComponent(row.id)}`}>Edit</Link>{!row.isCurrent && <button className="text-indigo-600 hover:text-indigo-800 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void action('current', row)}>{busy === `current:${row.id}` ? 'Setting…' : 'Set Current'}</button>}<button className="text-red-600 hover:text-red-700 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void action('delete', row)}>{busy === `delete:${row.id}` ? 'Deleting…' : 'Delete'}</button></div>
      </article>; })}</div>}
  </div>;
}
