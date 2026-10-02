'use client';

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed'];
const TONES: Record<string, string> = { neutral: 'bg-slate-100 text-slate-700', success: 'bg-emerald-100 text-emerald-800', warning: 'bg-amber-100 text-amber-800', danger: 'bg-red-100 text-red-800', info: 'bg-blue-100 text-blue-800' };

function atPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value);
}

function LoadingCard() { return <section className="card p-5" aria-busy="true"><div className="h-4 w-24 animate-pulse rounded bg-slate-200" /><div className="mt-3 h-8 w-36 animate-pulse rounded bg-slate-100" /><span className="sr-only">Loading dashboard item</span></section>; }
function ErrorCard({ title, error }: { title?: string; error: string }) { return <section className="card border-red-200 p-5" role="alert"><h2 className="font-semibold text-red-800">{title || 'Dashboard item'}</h2><p className="mt-2 text-sm text-red-700">{error}</p></section>; }

export function PluginMetric({ title, value, options, loading, error, formatValue }: any) {
  if (loading) return <LoadingCard />; if (error) return <ErrorCard title={title} error={error} />;
  const raw = atPath(value, options.valuePath); const trend = atPath(value, options.trendPath);
  const formatted = options.format === 'percent' && typeof raw === 'number' ? `${formatValue(raw, 'number')}%` : formatValue(raw, options.format || 'text');
  return <section className="card p-5"><p className="text-sm font-medium text-slate-500">{title}</p><p className="mt-2 text-3xl font-bold text-slate-900">{formatted}</p>{trend !== undefined && <p className={`mt-2 text-sm ${Number(trend) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{Number(trend) >= 0 ? '↑' : '↓'} {String(trend)}</p>}</section>;
}

export function PluginStatus({ title, value, options, loading, error }: any) {
  if (loading) return <LoadingCard />; if (error) return <ErrorCard title={title} error={error} />;
  const raw = atPath(value, options.valuePath); const state = options.states.find((item: any) => item.value === raw);
  return <section className="card p-5"><p className="text-sm font-medium text-slate-500">{title}</p><span className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${TONES[state?.tone] || TONES.neutral}`}><span className="mr-2" aria-hidden="true">●</span>{state?.label || String(raw ?? 'Unknown')}</span></section>;
}

export function PluginCard({ title, value, fields, loading, error, formatValue }: any) {
  if (loading) return <LoadingCard />; if (error) return <ErrorCard title={title} error={error} />;
  return <section className="card p-5"><h2 className="font-semibold text-slate-800">{title}</h2><dl className="mt-4 divide-y divide-slate-100">{fields.map((field: any) => <div key={field.path} className="flex justify-between gap-4 py-2 text-sm"><dt className="text-slate-500">{field.label}</dt><dd className="text-right font-medium text-slate-800">{formatValue(atPath(value, field.path), field.format || 'text')}</dd></div>)}</dl></section>;
}

export function PluginChart({ title, value, options, loading, error }: any) {
  if (loading) return <LoadingCard />; if (error) return <ErrorCard title={title} error={error} />;
  const candidate = atPath(value, options.itemsPath); const rows = (Array.isArray(candidate) ? candidate : []).slice(0, options.maximumItems || 100).map((item) => ({ category: String(atPath(item, options.categoryPath) ?? ''), value: Number(atPath(item, options.valuePath) ?? 0) }));
  if (!rows.length) return <section className="card p-8 text-center text-sm text-slate-500"><h2 className="mb-2 font-semibold text-slate-800">{title}</h2>No chart data.</section>;
  return <section className="card p-5"><h2 className="mb-4 font-semibold text-slate-800">{title}</h2><div className="h-72" role="img" aria-label={`${title} ${options.chartType} chart`}>
    <ResponsiveContainer width="100%" height="100%">{options.chartType === 'line' ? <LineChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="category" /><YAxis /><Tooltip /><Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} /></LineChart> : options.chartType === 'pie' ? <PieChart><Tooltip /><Pie data={rows} dataKey="value" nameKey="category" outerRadius={100} label>{rows.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie></PieChart> : <BarChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="category" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#4f46e5" /></BarChart>}</ResponsiveContainer>
  </div><ul className="sr-only">{rows.map((row, index) => <li key={index}>{row.category}: {row.value}</li>)}</ul></section>;
}
