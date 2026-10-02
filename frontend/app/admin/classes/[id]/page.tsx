"use client"

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import AuthGuard from '../../../../components/AuthGuard'
import Sidebar from '../../../../components/Sidebar'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import { formatCambodiaTime } from '../../../../lib/dateUtils'

type Tab = 'assignments' | 'exams' | 'courses'
const TABS: Tab[] = ['assignments', 'exams', 'courses']

interface ClassDetail {
  id: string
  name: string
  subject: string | null
  teacher?: { id: string; name: string } | null
  studyYear?: { label: string } | null
}

interface AssignmentRow {
  id: string
  title: string
  description?: string | null
  type: string
  status: string
  dueDate: string | null
  totalMarks: number
  _count?: { submissions: number }
}

interface ExamRow {
  id: string
  title: string
  description?: string | null
  status: string
  duration: number
  totalMarks: number
  passMark: number
  maxAttempts: number
  createdBy?: { id: string; name: string } | null
  _count?: { questions: number; attempts: number }
  createdAt: string
}

interface CourseRow {
  id: string
  title: string
  description?: string | null
  status: string
  createdBy?: { id: string; name: string } | null
  _count?: { lessons: number; enrollments: number }
  updatedAt: string
}

const ASSIGNMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED']
const ASSIGNMENT_TYPES = ['HOMEWORK', 'QUIZ', 'PROJECT', 'LAB', 'ESSAY']
const EXAM_STATUSES = ['DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED']
const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function statusColor(s: string) {
  switch (s) {
    case 'PUBLISHED':
    case 'ACTIVE': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'DRAFT': return 'bg-slate-100 text-slate-600 border-slate-200'
    case 'CLOSED':
    case 'COMPLETED':
    case 'ARCHIVED': return 'bg-blue-100 text-blue-700 border-blue-200'
    default: return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}

function ClassDetailContent() {
  const params = useParams<{ id: string }>()
  const classId = params?.id as string
  const searchParams = useSearchParams()
  // Lets a Cancel/Save on the exam builder page land back on this exact tab
  // (via ?tab=exams in its returnTo) instead of always resetting to Assignments.
  const initialTab = TABS.includes(searchParams?.get('tab') as Tab) ? (searchParams!.get('tab') as Tab) : 'assignments'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [cls, setCls] = useState<ClassDetail | null>(null)
  const [loadingClass, setLoadingClass] = useState(true)

  useEffect(() => {
    if (!classId) return
    apiFetch('/api/classes').then(async r => {
      if (r.ok) {
        const list: ClassDetail[] = await r.json()
        setCls(list.find(c => c.id === classId) ?? null)
      }
    }).finally(() => setLoadingClass(false))
  }, [classId])

  if (!classId) return null

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <nav className="flex items-center gap-1 text-xs text-slate-500 mb-2" aria-label="Breadcrumb">
            <Link href="/admin" className="hover:text-indigo-600 hover:underline">🏠 Dashboard</Link>
            <span className="text-slate-300">/</span>
            <Link href="/admin/classes" className="hover:text-indigo-600 hover:underline">Classes</Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-700 font-medium truncate max-w-[200px]">{cls?.name ?? '…'}</span>
          </nav>
          {loadingClass ? (
            <p className="text-sm text-slate-400">Loading class…</p>
          ) : !cls ? (
            <p className="text-sm text-red-600">Class not found.</p>
          ) : (
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{cls.name}</h1>
                <p className="text-sm text-slate-500 mt-1">
                  {cls.subject ?? 'No subject'}
                  {cls.teacher && <> · Teacher: <span className="font-medium text-slate-700">{cls.teacher.name}</span></>}
                  {cls.studyYear && <> · {cls.studyYear.label}</>}
                </p>
              </div>
              <Link href={`/admin/attendance?classId=${classId}`}
                className="btn-outline btn-sm">📋 Attendance</Link>
            </div>
          )}
        </div>

        <div className="page-body">
          <div className="flex gap-1 border-b border-slate-200 mb-6">
            {([
              ['assignments', '📝 Assignments'],
              ['exams', '🎯 Examinations'],
              ['courses', '📚 Courses'],
            ] as [Tab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                  tab === id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'assignments' && <AssignmentsPanel classId={classId} />}
          {tab === 'exams' && <ExamsPanel classId={classId} />}
          {tab === 'courses' && <CoursesPanel classId={classId} />}
        </div>
      </div>
    </div>
  )
}

// ─── Assignments panel ────────────────────────────────────────────────────
function AssignmentsPanel({ classId }: { classId: string }) {
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', type: 'HOMEWORK', totalMarks: 100, dueDate: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<AssignmentRow | null>(null)
  const [editForm, setEditForm] = useState({ title: '', type: 'HOMEWORK', totalMarks: 100, dueDate: '', description: '' })
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch(`/api/assignments?classId=${classId}`)
      if (!r.ok) throw new Error()
      setRows(await r.json())
    } catch { setError('Failed to load assignments.') }
    finally { setLoading(false) }
  }, [classId])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true); setError('')
    try {
      const body: any = {
        classId,
        title: form.title.trim(),
        type: form.type,
        totalMarks: Number(form.totalMarks) || 100,
        description: form.description.trim() || undefined,
      }
      if (form.dueDate) body.dueDate = new Date(form.dueDate).toISOString()
      const r = await apiFetch('/api/assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error()
      setForm({ title: '', type: 'HOMEWORK', totalMarks: 100, dueDate: '', description: '' })
      setCreating(false)
      await load()
    } catch { setError('Failed to create assignment.') }
    finally { setSaving(false) }
  }

  const handleStatusChange = async (row: AssignmentRow, status: string) => {
    try {
      const r = await apiFetch(`/api/assignments/${row.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to update status.') }
  }

  const handleDelete = async (row: AssignmentRow) => {
    if (!confirm(`Delete assignment "${row.title}"? This cannot be undone.`)) return
    try {
      const r = await apiFetch(`/api/assignments/${row.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to delete assignment.') }
  }

  const openEdit = (row: AssignmentRow) => {
    setCreating(false)
    setEditing(row)
    setEditForm({
      title: row.title,
      type: row.type,
      totalMarks: row.totalMarks,
      dueDate: row.dueDate ? toDatetimeLocal(row.dueDate) : '',
      description: row.description || '',
    })
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing || !editForm.title.trim()) return
    setEditSaving(true); setError('')
    try {
      const body: any = {
        title: editForm.title.trim(),
        type: editForm.type,
        totalMarks: Number(editForm.totalMarks) || 100,
        description: editForm.description.trim() || undefined,
        dueDate: editForm.dueDate ? new Date(editForm.dueDate).toISOString() : null,
      }
      const r = await apiFetch(`/api/assignments/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error()
      setEditing(null)
      await load()
    } catch { setError('Failed to update assignment.') }
    finally { setEditSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{rows.length}</span> assignment{rows.length === 1 ? '' : 's'} in this class
        </p>
        <button onClick={() => { setEditing(null); setCreating(s => !s) }} className="btn-primary btn-sm">
          {creating ? '× Cancel' : '+ New Assignment'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="card p-4 space-y-3 bg-indigo-50/30 border-indigo-200">
          <h3 className="text-sm font-semibold text-slate-800">New assignment</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {ASSIGNMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Total marks</label>
              <input type="number" value={form.totalMarks} onChange={e => setForm(f => ({ ...f, totalMarks: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Due date</label>
              <input type="datetime-local" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary btn-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="btn-outline btn-sm">Cancel</button>
          </div>
        </form>
      )}

      {editing && (
        <form onSubmit={handleSaveEdit} className="card p-4 space-y-3 bg-emerald-50/30 border-emerald-200">
          <h3 className="text-sm font-semibold text-slate-800">Edit assignment</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
              <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} required
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {ASSIGNMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Total marks</label>
              <input type="number" value={editForm.totalMarks} onChange={e => setEditForm(f => ({ ...f, totalMarks: Number(e.target.value) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Due date</label>
              <input type="datetime-local" value={editForm.dueDate} onChange={e => setEditForm(f => ({ ...f, dueDate: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={editSaving} className="btn-primary btn-sm disabled:opacity-60">
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn-outline btn-sm">Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      {loading ? (
        <div className="card p-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 text-sm">No assignments yet for this class.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Due</th>
                <th className="px-4 py-2 text-left">Marks</th>
                <th className="px-4 py-2 text-left">Submissions</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {r.title}
                    {r.description && <p className="text-xs text-slate-400 truncate max-w-xs">{r.description}</p>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">{r.type}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{r.dueDate ? formatCambodiaTime(r.dueDate) : '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{r.totalMarks}</td>
                  <td className="px-4 py-2 text-slate-600">{r._count?.submissions ?? 0}</td>
                  <td className="px-4 py-2">
                    <select value={r.status} onChange={e => handleStatusChange(r, e.target.value)}
                      className={`text-xs font-semibold px-2 py-1 rounded-full border outline-none ${statusColor(r.status)}`}>
                      {ASSIGNMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(r)} className="text-xs text-emerald-700 hover:underline mr-3">Edit</button>
                    {r.type === 'QUIZ' && (
                      <Link href={`/teacher/assignments/${r.id}/quiz`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-violet-600 hover:underline mr-3">Quiz Questions ↗</Link>
                    )}
                    <Link href={`/teacher/assignments/${r.id}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:underline mr-3">Grade ↗</Link>
                    <button onClick={() => handleDelete(r)} className="text-xs text-red-600 hover:underline">Delete</button>
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

// ─── Exams panel ──────────────────────────────────────────────────────────
// Links out to the shared exam builder pages (/teacher/exams/new, /teacher/exams/[id]/edit)
// — the same pages admin's Examinations sidebar and the teacher's own
// Examinations page use — so create/edit exam is one consistent page
// everywhere an admin reaches it, scoped to this class via ?classId= and
// returning here (on this exact tab) via ?returnTo=.
function ExamsPanel({ classId }: { classId: string }) {
  const [rows, setRows] = useState<ExamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const returnTo = encodeURIComponent(`/admin/classes/${classId}?tab=exams`)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch(`/api/exams?classId=${classId}`)
      if (!r.ok) throw new Error()
      setRows(await r.json())
    } catch { setError('Failed to load exams.') }
    finally { setLoading(false) }
  }, [classId])

  useEffect(() => { load() }, [load])

  const handleStatusChange = async (row: ExamRow, status: string) => {
    try {
      const r = await apiFetch(`/api/exams/${row.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to update status.') }
  }

  const handleDelete = async (row: ExamRow) => {
    if (!confirm(`Delete exam "${row.title}"? This cannot be undone.`)) return
    try {
      const r = await apiFetch(`/api/exams/${row.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to delete exam.') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{rows.length}</span> exam{rows.length === 1 ? '' : 's'} in this class
        </p>
        <Link href={`/teacher/exams/new?classId=${classId}&returnTo=${returnTo}`} className="btn-primary btn-sm">+ New Exam</Link>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      {loading ? (
        <div className="card p-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 text-sm">No exams yet for this class.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-4 py-2 text-left">Duration</th>
                <th className="px-4 py-2 text-left">Marks · Pass</th>
                <th className="px-4 py-2 text-left">Questions</th>
                <th className="px-4 py-2 text-left">Attempts</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {r.title}
                    {r.createdBy && <p className="text-xs text-slate-400">by {r.createdBy.name}</p>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{r.duration} min</td>
                  <td className="px-4 py-2 text-slate-600">{r.totalMarks} · {r.passMark}</td>
                  <td className="px-4 py-2 text-slate-600">{r._count?.questions ?? 0}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {r._count?.attempts ?? 0}
                    {r.maxAttempts !== 1 && <p className="text-[10px] text-slate-400">{r.maxAttempts === 0 ? 'unlimited' : `up to ${r.maxAttempts}`} allowed</p>}
                  </td>
                  <td className="px-4 py-2">
                    <select value={r.status} onChange={e => handleStatusChange(r, e.target.value)}
                      className={`text-xs font-semibold px-2 py-1 rounded-full border outline-none ${statusColor(r.status)}`}>
                      {EXAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Link href={`/teacher/exams/${r.id}/edit?returnTo=${returnTo}`}
                      className="text-xs text-emerald-700 hover:underline mr-3">Edit</Link>
                    <Link href={`/teacher/exams/${r.id}/attempts`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:underline mr-3">Grade ↗</Link>
                    <button onClick={() => handleDelete(r)} className="text-xs text-red-600 hover:underline">Delete</button>
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

// ─── Courses panel ────────────────────────────────────────────────────────
function CoursesPanel({ classId }: { classId: string }) {
  const [rows, setRows] = useState<CourseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CourseRow | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '' })
  const [editSaving, setEditSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await apiFetch(`/api/courses?classId=${classId}`)
      if (!r.ok) throw new Error()
      setRows(await r.json())
    } catch { setError('Failed to load courses.') }
    finally { setLoading(false) }
  }, [classId])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true); setError('')
    try {
      const body = {
        classId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
      }
      const r = await apiFetch('/api/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error()
      setForm({ title: '', description: '' })
      setCreating(false)
      await load()
    } catch { setError('Failed to create course.') }
    finally { setSaving(false) }
  }

  const handleStatusChange = async (row: CourseRow, status: string) => {
    try {
      const r = await apiFetch(`/api/courses/${row.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to update status.') }
  }

  const handleDelete = async (row: CourseRow) => {
    if (!confirm(`Delete course "${row.title}"? This cannot be undone.`)) return
    try {
      const r = await apiFetch(`/api/courses/${row.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      await load()
    } catch { setError('Failed to delete course.') }
  }

  const openEdit = (row: CourseRow) => {
    setCreating(false)
    setEditing(row)
    setEditForm({ title: row.title, description: row.description || '' })
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing || !editForm.title.trim()) return
    setEditSaving(true); setError('')
    try {
      const body = {
        title: editForm.title.trim(),
        description: editForm.description.trim() || undefined,
      }
      const r = await apiFetch(`/api/courses/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error()
      setEditing(null)
      await load()
    } catch { setError('Failed to update course.') }
    finally { setEditSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{rows.length}</span> course{rows.length === 1 ? '' : 's'} in this class
        </p>
        <button onClick={() => { setEditing(null); setCreating(s => !s) }} className="btn-primary btn-sm">
          {creating ? '× Cancel' : '+ New Course'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="card p-4 space-y-3 bg-indigo-50/30 border-indigo-200">
          <h3 className="text-sm font-semibold text-slate-800">New course</h3>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary btn-sm disabled:opacity-60">
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="btn-outline btn-sm">Cancel</button>
          </div>
        </form>
      )}

      {editing && (
        <form onSubmit={handleSaveEdit} className="card p-4 space-y-3 bg-emerald-50/30 border-emerald-200">
          <h3 className="text-sm font-semibold text-slate-800">Edit course</h3>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} required
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={editSaving} className="btn-primary btn-sm disabled:opacity-60">
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn-outline btn-sm">Cancel</button>
          </div>
        </form>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      {loading ? (
        <div className="card p-8 text-center text-slate-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-slate-400 text-sm">No courses yet for this class.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-4 py-2 text-left">Lessons</th>
                <th className="px-4 py-2 text-left">Enrolled</th>
                <th className="px-4 py-2 text-left">Updated</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {r.title}
                    {r.createdBy && <p className="text-xs text-slate-400">by {r.createdBy.name}</p>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{r._count?.lessons ?? 0}</td>
                  <td className="px-4 py-2 text-slate-600">{r._count?.enrollments ?? 0}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{formatCambodiaTime(r.updatedAt)}</td>
                  <td className="px-4 py-2">
                    <select value={r.status} onChange={e => handleStatusChange(r, e.target.value)}
                      className={`text-xs font-semibold px-2 py-1 rounded-full border outline-none ${statusColor(r.status)}`}>
                      {COURSE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(r)} className="text-xs text-emerald-700 hover:underline mr-3">Edit</button>
                    <Link href={`/teacher/courses/${r.id}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:underline mr-3">Lessons ↗</Link>
                    <button onClick={() => handleDelete(r)} className="text-xs text-red-600 hover:underline">Delete</button>
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

export default function AdminClassDetailPage() {
  return (
    <AuthGuard allowedRoles={['ADMIN', 'SUPER_ADMIN', 'CLASS_ADMIN']}>
      <Suspense>
        <ClassDetailContent />
      </Suspense>
    </AuthGuard>
  )
}
