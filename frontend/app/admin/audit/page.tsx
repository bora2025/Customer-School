"use client"

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface AuditLog {
  id: string
  createdAt: string
  actorId: string | null
  actorRole: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  resource: string
  resourceId: string | null
  resourceLabel: string | null
  changes: any
  metadata: any
  method: string | null
  path: string | null
  statusCode: number | null
  ip: string | null
  userAgent: string | null
  success: boolean
  errorMessage: string | null
}

interface Page<T> { items: T[]; total: number; page: number; pageSize: number; pages: number }
interface Facets {
  actions: string[]
  resources: string[]
  actors: { actorId: string; actorName: string | null; actorEmail: string | null; actorRole: string | null }[]
}
interface Stats {
  last24h: number
  last7d: number
  failures24h: number
  byAction: { action: string; count: number }[]
}

const ACTION_STYLES: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-amber-100 text-amber-700 border-amber-200',
  DELETE: 'bg-red-100 text-red-700 border-red-200',
  LOGIN: 'bg-sky-100 text-sky-700 border-sky-200',
  LOGIN_FAILED: 'bg-rose-100 text-rose-700 border-rose-200',
  LOGOUT: 'bg-slate-100 text-slate-700 border-slate-200',
  EXPORT: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  IMPORT: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  ROLE_CHANGE: 'bg-purple-100 text-purple-700 border-purple-200',
  PASSWORD_RESET: 'bg-purple-100 text-purple-700 border-purple-200',
}
const actionStyle = (a: string) => ACTION_STYLES[a] || 'bg-slate-100 text-slate-700 border-slate-200'

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function AuditLogsPage() {
  const [activeTab, setActiveTab] = useState<'logs' | 'cleanup'>('logs')
  const [page, setPage] = useState<Page<AuditLog>>({ items: [], total: 0, page: 1, pageSize: 50, pages: 0 })
  const [facets, setFacets] = useState<Facets>({ actions: [], resources: [], actors: [] })
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detailCache, setDetailCache] = useState<Record<string, AuditLog>>({})
  const [detailLoading, setDetailLoading] = useState(false)

  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [resource, setResource] = useState('')
  const [success, setSuccess] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (actor) p.set('actorId', actor)
    if (action) p.set('action', action)
    if (resource) p.set('resource', resource)
    if (success) p.set('success', success)
    if (q) p.set('q', q)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    p.set('page', String(currentPage))
    p.set('pageSize', '50')
    return p.toString()
  }, [actor, action, resource, success, q, from, to, currentPage])

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/audit/logs?${queryString}`)
      if (res.ok) setPage(await res.json())
    } finally {
      setLoading(false)
    }
  }, [queryString])

  const fetchFacets = useCallback(async () => {
    const [f, s] = await Promise.all([
      apiFetch('/api/audit/logs/facets').then(r => r.ok ? r.json() : null),
      apiFetch('/api/audit/logs/stats').then(r => r.ok ? r.json() : null),
    ])
    if (f) setFacets(f)
    if (s) setStats(s)
  }, [])

  useEffect(() => { fetchFacets() }, [fetchFacets])
  useEffect(() => { fetchLogs() }, [fetchLogs])

  const resetFilters = () => {
    setActor(''); setAction(''); setResource(''); setSuccess(''); setQ(''); setFrom(''); setTo(''); setCurrentPage(1)
  }

  const toggleExpand = useCallback(async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (detailCache[id]) return
    setDetailLoading(true)
    try {
      const r = await apiFetch(`/api/audit/logs/${id}`)
      if (r.ok) {
        const full = await r.json()
        if (full) setDetailCache(prev => ({ ...prev, [id]: full }))
      }
    } finally {
      setDetailLoading(false)
    }
  }, [expanded, detailCache])

  const exportCsv = () => {
    const p = new URLSearchParams()
    if (actor) p.set('actorId', actor)
    if (action) p.set('action', action)
    if (resource) p.set('resource', resource)
    if (success) p.set('success', success)
    if (q) p.set('q', q)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    window.open(`/api/audit/logs/export.csv?${p.toString()}`, '_blank')
  }

  return (
    <AuthGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />

          <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Audit Logs</h1>
              <p className="text-sm text-slate-500 mt-1">Append-only record of every admin action across the system.</p>
            </div>
            {activeTab === 'logs' && (
              <div className="flex gap-2">
                <button onClick={fetchLogs} className="btn-outline btn-sm" disabled={loading}>
                  {loading ? '⏳' : '🔄'} Refresh
                </button>
                <button onClick={exportCsv} className="btn-primary btn-sm">📥 Export CSV</button>
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-slate-200 mt-2 -mb-2">
            {([['logs', '📋 Logs'], ['cleanup', '🗑 Cleanup Schedules']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                  activeTab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}>{label}</button>
            ))}
          </div>

          {activeTab === 'cleanup' && (
            <div className="page-body">
              <CleanupSchedulePanel />
            </div>
          )}

          {activeTab === 'logs' && (
          <div className="page-body space-y-6">
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Last 24h" value={stats.last24h} tone="indigo" />
                <StatTile label="Last 7 days" value={stats.last7d} tone="sky" />
                <StatTile label="Failures (24h)" value={stats.failures24h} tone={stats.failures24h > 0 ? 'red' : 'slate'} />
                <StatTile label="Distinct actors" value={facets.actors.length} tone="emerald" />
              </div>
            )}

            <div className="card p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="form-label">Search</label>
                  <input value={q} onChange={e => { setQ(e.target.value); setCurrentPage(1) }} placeholder="name, email, path…" />
                </div>
                <div>
                  <label className="form-label">Actor</label>
                  <select value={actor} onChange={e => { setActor(e.target.value); setCurrentPage(1) }}>
                    <option value="">All actors</option>
                    {facets.actors.map(a => (
                      <option key={a.actorId} value={a.actorId}>
                        {a.actorName || a.actorEmail || a.actorId}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Action</label>
                  <select value={action} onChange={e => { setAction(e.target.value); setCurrentPage(1) }}>
                    <option value="">All actions</option>
                    {facets.actions.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Resource</label>
                  <select value={resource} onChange={e => { setResource(e.target.value); setCurrentPage(1) }}>
                    <option value="">All resources</option>
                    {facets.resources.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Outcome</label>
                  <select value={success} onChange={e => { setSuccess(e.target.value); setCurrentPage(1) }}>
                    <option value="">All</option>
                    <option value="true">Success only</option>
                    <option value="false">Failures only</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">From</label>
                  <input type="datetime-local" value={from} onChange={e => { setFrom(e.target.value); setCurrentPage(1) }} />
                </div>
                <div>
                  <label className="form-label">To</label>
                  <input type="datetime-local" value={to} onChange={e => { setTo(e.target.value); setCurrentPage(1) }} />
                </div>
                <div className="flex items-end">
                  <button onClick={resetFilters} className="btn-outline btn-sm w-full">Clear filters</button>
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {loading ? 'Loading…' : <>Showing <strong>{page.items.length}</strong> of <strong>{page.total}</strong> entries</>}
                </span>
                {page.pages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="btn-outline btn-sm">←</button>
                    <span className="px-2 text-slate-500">Page {currentPage} / {page.pages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(page.pages, p + 1))} disabled={currentPage >= page.pages} className="btn-outline btn-sm">→</button>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left">
                      <th className="px-3 py-2 font-medium text-slate-600">When</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Actor</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Action</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Resource</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Target</th>
                      <th className="px-3 py-2 font-medium text-slate-600">IP</th>
                      <th className="px-3 py-2 font-medium text-slate-600">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {page.items.map(log => (
                      <Fragment key={log.id}>
                        <tr className={`hover:bg-slate-50 ${!log.success ? 'bg-red-50/40' : ''}`}>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700" title={new Date(log.createdAt).toLocaleString()}>
                            {relativeTime(log.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="font-medium">{log.actorName || <span className="text-slate-400">anonymous</span>}</div>
                            <div className="text-xs text-slate-500">{log.actorEmail || '—'} {log.actorRole && <span className="ml-1 text-[10px] text-slate-400">[{log.actorRole}]</span>}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${actionStyle(log.action)}`}>{log.action}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="font-medium">{log.resource}</div>
                            {log.method && <div className="text-xs text-slate-400">{log.method} {log.path}</div>}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="font-mono text-xs">{log.resourceLabel || log.resourceId || '—'}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-500 font-mono text-xs">{log.ip || '—'}</td>
                          <td className="px-3 py-2">
                            {log.success
                              ? <span className="text-emerald-600 text-xs">✓ {log.statusCode ?? 'OK'}</span>
                              : <span className="text-red-600 text-xs">✕ {log.statusCode ?? 'ERR'}</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => toggleExpand(log.id)} className="text-xs text-indigo-600 hover:text-indigo-800">
                              {expanded === log.id ? 'Hide' : 'Details'}
                            </button>
                          </td>
                        </tr>
                        {expanded === log.id && (() => {
                          const full = detailCache[log.id] ?? log
                          return (
                          <tr className="bg-slate-50/60">
                            <td colSpan={8} className="px-4 py-3">
                              {detailLoading && !detailCache[log.id] && (
                                <div className="text-xs text-slate-500 mb-2">Loading details…</div>
                              )}
                              <div className="grid sm:grid-cols-2 gap-4 text-xs">
                                <DetailBlock title="Request">
                                  <KV k="When" v={new Date(full.createdAt).toLocaleString()} />
                                  <KV k="Method" v={full.method} />
                                  <KV k="Path" v={full.path} />
                                  <KV k="Status" v={full.statusCode} />
                                  <KV k="IP" v={full.ip} />
                                  <KV k="User-Agent" v={full.userAgent} truncate />
                                </DetailBlock>
                                <DetailBlock title="Target">
                                  <KV k="Resource" v={full.resource} />
                                  <KV k="Resource ID" v={full.resourceId} />
                                  <KV k="Label" v={full.resourceLabel} />
                                  {full.errorMessage && <KV k="Error" v={full.errorMessage} />}
                                </DetailBlock>
                                {full.changes && (
                                  <DetailBlock title="Changes" wide>
                                    <pre className="bg-white p-2 rounded border border-slate-200 max-h-64 overflow-auto text-[11px]">
                                      {JSON.stringify(full.changes, null, 2)}
                                    </pre>
                                  </DetailBlock>
                                )}
                                {full.metadata && (
                                  <DetailBlock title="Metadata" wide>
                                    <pre className="bg-white p-2 rounded border border-slate-200 max-h-64 overflow-auto text-[11px]">
                                      {JSON.stringify(full.metadata, null, 2)}
                                    </pre>
                                  </DetailBlock>
                                )}
                              </div>
                            </td>
                          </tr>
                          )
                        })()}
                      </Fragment>
                    ))}
                    {!loading && page.items.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">No audit entries match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )} {/* end logs tab */}
        </div>
      </div>
    </AuthGuard>
  )
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'indigo' | 'sky' | 'red' | 'emerald' | 'slate' }) {
  const tones = {
    indigo: 'from-indigo-50 to-indigo-100 text-indigo-700 border-indigo-200',
    sky: 'from-sky-50 to-sky-100 text-sky-700 border-sky-200',
    red: 'from-red-50 to-red-100 text-red-700 border-red-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-700 border-emerald-200',
    slate: 'from-slate-50 to-slate-100 text-slate-700 border-slate-200',
  }
  return (
    <div className={`card bg-gradient-to-br border ${tones[tone]} px-4 py-3`}>
      <div className="text-xs font-medium opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  )
}

function DetailBlock({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function KV({ k, v, truncate }: { k: string; v: any; truncate?: boolean }) {
  if (v === null || v === undefined || v === '') return null
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 min-w-[80px]">{k}:</span>
      <span className={`text-slate-800 font-mono ${truncate ? 'truncate max-w-md' : ''}`}>{String(v)}</span>
    </div>
  )
}

// ─── Cleanup Schedule Panel ───────────────────────────────────────────────

interface CleanupSchedule {
  id: string
  label: string
  frequency: string
  retainDays: number
  enabled: boolean
  lastRunAt: string | null
  lastDeletedCount: number
  createdAt: string
}

const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']
const FREQ_LABELS: Record<string, string> = {
  HOURLY: 'Every hour',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly (≈30 days)',
}

function CleanupSchedulePanel() {
  const [schedules, setSchedules] = useState<CleanupSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', frequency: 'DAILY', retainDays: 90 })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch('/api/audit/cleanup-schedules')
      if (!r.ok) throw new Error()
      setSchedules(await r.json())
    } catch { setError('Failed to load cleanup schedules.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const r = await apiFetch('/api/audit/cleanup-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, retainDays: Number(form.retainDays) }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'Failed') }
      setForm({ label: '', frequency: 'DAILY', retainDays: 90 })
      setCreating(false)
      await load()
    } catch (err: any) { setError(err.message || 'Failed to create schedule.') }
    finally { setSaving(false) }
  }

  const handleToggle = async (s: CleanupSchedule) => {
    try {
      const r = await apiFetch(`/api/audit/cleanup-schedules/${s.id}/toggle`, { method: 'POST' })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to toggle schedule.') }
  }

  const handleDelete = async (s: CleanupSchedule) => {
    if (!confirm(`Delete schedule "${s.label}"?`)) return
    try {
      const r = await apiFetch(`/api/audit/cleanup-schedules/${s.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to delete schedule.') }
  }

  const handleRunNow = async (s: CleanupSchedule) => {
    if (!confirm(`Run cleanup now for "${s.label}"?\nThis will delete all audit logs older than ${s.retainDays} day(s).`)) return
    setRunningId(s.id); setError('')
    try {
      const r = await apiFetch(`/api/audit/cleanup-schedules/${s.id}/run-now`, { method: 'POST' })
      if (!r.ok) throw new Error()
      const result = await r.json()
      alert(`Done. Deleted ${result.deleted} log entries older than ${s.retainDays} day(s).`)
      await load()
    } catch { setError('Cleanup run failed.') }
    finally { setRunningId(null) }
  }

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <p className="text-sm text-slate-700 font-semibold mb-1">Automatic Audit Log Cleanup</p>
        <p className="text-xs text-slate-500">
          Configure schedules to automatically delete audit logs older than a chosen number of days.
          The scheduler checks every hour and runs any schedule whose interval has elapsed.
          You can also trigger a schedule immediately with <strong>Run Now</strong>.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          {schedules.length} schedule{schedules.length === 1 ? '' : 's'} configured
        </p>
        <button onClick={() => setCreating(s => !s)} className="btn-primary btn-sm">
          {creating ? '× Cancel' : '+ New Schedule'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="card p-4 space-y-3 bg-indigo-50/30 border-indigo-200">
          <h3 className="text-sm font-semibold text-slate-800">New cleanup schedule</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Label (optional)</label>
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Daily – keep 90 days"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Frequency *</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Retain last N days *</label>
              <input type="number" min={1} value={form.retainDays}
                onChange={e => setForm(f => ({ ...f, retainDays: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary btn-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="btn-outline btn-sm">Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      {loading ? (
        <div className="card p-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : schedules.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 text-sm">No cleanup schedules yet. Create one above.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Label</th>
                <th className="px-4 py-2 text-left">Frequency</th>
                <th className="px-4 py-2 text-left">Retain</th>
                <th className="px-4 py-2 text-left">Last run</th>
                <th className="px-4 py-2 text-left">Deleted</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{s.label}</td>
                  <td className="px-4 py-2 text-slate-600">{FREQ_LABELS[s.frequency] ?? s.frequency}</td>
                  <td className="px-4 py-2 text-slate-600">{s.retainDays} days</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {s.lastRunAt ? formatCambodiaTime(s.lastRunAt) : '—'}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{s.lastDeletedCount.toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => handleToggle(s)}
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                        s.enabled
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                      }`}>
                      {s.enabled ? '✅ Active' : '⏸ Paused'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                    <button onClick={() => handleRunNow(s)} disabled={runningId === s.id}
                      className="text-xs text-indigo-600 hover:underline disabled:opacity-50">
                      {runningId === s.id ? 'Running…' : 'Run Now'}
                    </button>
                    <button onClick={() => handleDelete(s)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
