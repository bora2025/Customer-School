'use client';

import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../lib/api';
import { resolvePluginSourcePath } from '../../lib/plugin-ui-routing';

function rows(value: unknown): any[] { if (Array.isArray(value)) return value; if (value && typeof value === 'object') { const source = value as any; return source.items || source.rows || source.data || []; } return []; }

export default function PluginAttendanceWindowManager({ pluginId, value, data, sources, options, onRefresh }: any) {
  const windows = rows(value);
  const classes = rows(data[options.classesSource]);
  const initial = windows.find((item) => item.status === 'OPEN' && new Date(item.endsAt).getTime() > Date.now());
  const [active, setActive] = useState<any>(initial || null);
  const [live, setLive] = useState<any>(null);
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ classId: '', session: '1', sessionType: 'CHECK_IN', minutes: '15', qrValiditySeconds: '45', locationRequired: false, registeredDeviceRequired: false });
  const byId = useMemo(() => new Map(sources.map((source: any) => [source.id, source])), [sources]);

  const call = useCallback(async (sourceId: string, payload?: unknown, id?: string) => {
    const source: any = byId.get(sourceId); if (!source) throw new Error(`Missing source ${sourceId}`);
    const path = resolvePluginSourcePath(source.path, id ? { id } : {});
    const response = await apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/${path}`, { method: source.method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || 'Request failed'); return result;
  }, [byId, pluginId]);

  const rotate = useCallback(async () => {
    if (!active?.id || busy) return;
    setBusy(true); try { const result = await call(options.rotateSource, {}, active.id); setActive((current: any) => ({ ...current, ...result })); setMessage('A fresh signed QR code was generated.'); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Unable to rotate QR'); } finally { setBusy(false); }
  }, [active?.id, busy, call, options.rotateSource]);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!active?.attendanceToken) return setQr(''); void QRCode.toDataURL(active.attendanceToken, { width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#020617', light: '#ffffff' } }).then(setQr); }, [active?.attendanceToken]);
  useEffect(() => {
    if (!active?.id) return;
    let cancelled = false;
    const poll = async () => { try { const result = await call(options.liveSource, undefined, active.id); if (!cancelled) setLive(result); } catch { /* next poll retries */ } };
    void poll(); const timer = window.setInterval(poll, 3000); return () => { cancelled = true; window.clearInterval(timer); };
  }, [active?.id, call, options.liveSource]);
  useEffect(() => { const expires = new Date(active?.expiresAt || 0).getTime(); if (active?.status === 'OPEN' && expires && expires - now <= 5000 && expires - now > 0 && !busy) void rotate(); }, [active?.expiresAt, active?.status, busy, now, rotate]);

  async function openWindow(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const startsAt = new Date(); const endsAt = new Date(startsAt.getTime() + Number(form.minutes) * 60000);
      const result = await call(options.openSource, { classId: form.classId, session: Number(form.session), sessionType: form.sessionType, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), qrValiditySeconds: Number(form.qrValiditySeconds), locationRequired: form.locationRequired, registeredDeviceRequired: form.registeredDeviceRequired, maxAccuracyMeters: 100, maxOfflineMinutes: 1440 });
      setActive(result); setMessage('Attendance window opened. Display this QR to the class.'); await onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Unable to open window'); } finally { setBusy(false); }
  }
  async function closeWindow() { if (!active?.id) return; setBusy(true); try { await call(options.closeSource, {}, active.id); setActive(null); setLive(null); setMessage('Attendance window closed.'); await onRefresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Unable to close window'); } finally { setBusy(false); } }

  const remaining = Math.max(0, Math.ceil((new Date(active?.expiresAt || 0).getTime() - now) / 1000));
  const accepted = Number(live?.counts?.ACCEPTED || 0) + Number(live?.counts?.ACCEPTED_LATE || 0);
  const rejected = Object.entries(live?.counts || {}).filter(([key]) => !key.startsWith('ACCEPTED')).reduce((total, [, count]) => total + Number(count), 0);
  return <section className="space-y-5">
    {!active && <form className="card grid gap-4 p-5 md:grid-cols-3" onSubmit={openWindow}><div className="md:col-span-3"><h2 className="text-xl font-bold text-slate-900">Open Student Attendance QR</h2><p className="text-sm text-slate-500">Create a short-lived, signed QR code for one class session.</p></div>
      <label className="text-sm font-medium">Class<select required className="mt-1 w-full rounded-lg border p-2" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">Select class…</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name || item.label || item.id}</option>)}</select></label>
      <label className="text-sm font-medium">Session<select className="mt-1 w-full rounded-lg border p-2" value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })}>{[1,2,3,4].map((n) => <option key={n} value={n}>Session {n}</option>)}</select></label>
      <label className="text-sm font-medium">Action<select className="mt-1 w-full rounded-lg border p-2" value={form.sessionType} onChange={(e) => setForm({ ...form, sessionType: e.target.value })}><option value="CHECK_IN">Check-In</option><option value="CHECK_OUT">Check-Out</option></select></label>
      <label className="text-sm font-medium">Window duration<input type="number" min="1" max="720" className="mt-1 w-full rounded-lg border p-2" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></label>
      <label className="text-sm font-medium">QR rotation seconds<input type="number" min="15" max="300" className="mt-1 w-full rounded-lg border p-2" value={form.qrValiditySeconds} onChange={(e) => setForm({ ...form, qrValiditySeconds: e.target.value })} /></label>
      <div className="flex flex-col justify-end gap-2 text-sm"><label><input type="checkbox" checked={form.locationRequired} onChange={(e) => setForm({ ...form, locationRequired: e.target.checked })} /> Require campus GPS</label><label><input type="checkbox" checked={form.registeredDeviceRequired} onChange={(e) => setForm({ ...form, registeredDeviceRequired: e.target.checked })} /> Require registered device</label></div>
      <button disabled={busy} className="btn btn-primary md:col-span-3">{busy ? 'Opening…' : 'Open and display signed QR'}</button></form>}
    {active && <div className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-2xl"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 p-5"><div><p className="text-sm text-slate-300">Class {classes.find((item) => item.id === active.classId)?.name || active.classId}</p><h2 className="text-2xl font-bold">Session {active.session} · {active.sessionType === 'CHECK_OUT' ? 'Check-Out' : 'Check-In'}</h2></div><div className="flex gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => void rotate()}>Rotate now</button><button className="rounded-lg bg-rose-600 px-4 py-2 font-semibold" disabled={busy} onClick={() => void closeWindow()}>Close window</button></div></header>
      <div className="grid items-center gap-6 p-6 lg:grid-cols-[minmax(300px,520px)_1fr]">{qr ? <img src={qr} alt="Rotating signed attendance QR code" className="mx-auto aspect-square w-full max-w-[520px] rounded-xl bg-white p-3" /> : <div className="aspect-square animate-pulse rounded-xl bg-slate-800" />}<div className="space-y-5"><div><p className="text-sm uppercase tracking-widest text-slate-400">QR rotates in</p><p className="font-mono text-7xl font-bold tabular-nums">{remaining}s</p></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-600 p-5"><p className="text-4xl font-bold">{accepted}</p><p>Accepted</p></div><div className="rounded-xl bg-rose-600 p-5"><p className="text-4xl font-bold">{rejected}</p><p>Rejected</p></div></div><p className="text-sm text-slate-300">Window ends {new Date(active.endsAt).toLocaleTimeString()}</p></div></div>
      <div className="border-t border-slate-700 p-5"><h3 className="mb-3 font-semibold">Recent confirmations</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{rows(live?.recent).slice(0, 9).map((item) => <div key={item.id} className="rounded-lg bg-slate-800 p-3 text-sm"><strong>{item.studentProfileId}</strong><span className="float-right text-slate-300">{item.result}</span></div>)}{!rows(live?.recent).length && <p className="text-sm text-slate-400">Waiting for student scans…</p>}</div></div></div>}
    {message && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800" role="status">{message}</p>}
  </section>;
}
