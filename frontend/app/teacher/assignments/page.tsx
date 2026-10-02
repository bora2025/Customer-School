"use client"

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import StatCard from '../../../components/StatCard'
import EmptyState from '../../../components/EmptyState'
import { teacherNav } from '../../../lib/teacher-nav'
import { apiFetch } from '../../../lib/api'

interface Assignment {
  id: string
  title: string
  description: string | null
  instructions: string | null
  dueDate: string | null
  availableFrom: string | null
  totalMarks: number
  type: string
  weight: number
  latePenaltyPct: number
  maxAttempts: number
  allowLate: boolean
  status: string
  attachmentUrl: string | null
  randomizeQuestions?: boolean
  randomizeChoices?: boolean
  timeLimitMinutes?: number | null
  class: { id: string; name: string; subject: string }
  _count: { submissions: number }
}
interface ClassItem { id: string; name: string; subject: string }

const TYPE_BADGES: Record<string, string> = {
  HOMEWORK: 'bg-sky-100 text-sky-700',
  QUIZ: 'bg-violet-100 text-violet-700',
  PROJECT: 'bg-amber-100 text-amber-700',
  LAB: 'bg-teal-100 text-teal-700',
  ESSAY: 'bg-pink-100 text-pink-700',
}
const STATUS_BADGES: Record<string, string> = {
  DRAFT: 'bg-slate-200 text-slate-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-rose-100 text-rose-700',
}

function toDatetimeLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type FormShape = {
  id?: string
  title: string
  description?: string
  instructions?: string
  classId: string
  type: string
  weight: number
  totalMarks: number
  latePenaltyPct: number
  maxAttempts: number
  allowLate: boolean
  availableFrom?: string
  dueDate?: string
  attachmentUrl?: string
  status: string
  randomizeQuestions?: boolean
  randomizeChoices?: boolean
  timeLimitMinutes?: number | string
  allowRetake?: boolean
}

export default function TeacherAssignmentsPage() {
  const qc = useQueryClient()
  const router = useRouter()
  const [editing, setEditing] = useState<Assignment | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('ALL')
  const [filterType, setFilterType] = useState<string>('ALL')
  const [filterClass, setFilterClass] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'createdAt' | 'dueDate' | 'title'>('createdAt')

  const { data: assignments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['teacher-assignments'],
    queryFn: async () => { const r = await apiFetch('/api/assignments/my-assignments'); if (!r.ok) throw new Error(); return r.json() as Promise<Assignment[]> },
  })
  const { data: classes = [] } = useQuery({
    queryKey: ['teacher-my-classes'],
    queryFn: async () => { const r = await apiFetch('/api/classes?teacherId=me'); if (!r.ok) throw new Error(); return r.json() as Promise<ClassItem[]> },
  })

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = data.id ? `/api/assignments/${data.id}` : '/api/assignments'
      const method = data.id ? 'PUT' : 'POST'
      const { id, ...payload } = data
      const r = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to save assignment')
      }
      return r.json()
    },
    onSuccess: (created: any, vars: any) => {
      qc.invalidateQueries({ queryKey: ['teacher-assignments'] })
      closeForm()
      // If a new QUIZ was just created, jump straight to the question editor.
      if (!vars?.id && vars?.type === 'QUIZ' && created?.id) {
        router.push(`/teacher/assignments/${created.id}/quiz`)
      }
    },
    onError: (e: any) => setFormError(e?.message || 'Failed to save assignment'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-assignments'] }),
  })

  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm<FormShape>()
  const watchType = watch('type')
  const watchAllowRetake = watch('allowRetake')

  function openCreate() {
    setEditing(null)
    reset({
      title: '', description: '', instructions: '', classId: '',
      type: 'HOMEWORK', weight: 1, totalMarks: 100,
      latePenaltyPct: 0, maxAttempts: 1, allowLate: true,
      availableFrom: '', dueDate: '', attachmentUrl: '', status: 'PUBLISHED',
      randomizeQuestions: false, randomizeChoices: false, timeLimitMinutes: '',
      allowRetake: false,
    })
    setFormError(null)
    setShowForm(true)
  }
  function openEdit(a: Assignment) {
    setEditing(a)
    reset({
      id: a.id,
      title: a.title,
      description: a.description ?? '',
      instructions: a.instructions ?? '',
      classId: a.class.id,
      type: a.type,
      weight: a.weight,
      totalMarks: a.totalMarks,
      latePenaltyPct: a.latePenaltyPct,
      maxAttempts: a.maxAttempts,
      allowLate: a.allowLate,
      availableFrom: toDatetimeLocalInput(a.availableFrom),
      dueDate: toDatetimeLocalInput(a.dueDate),
      attachmentUrl: a.attachmentUrl ?? '',
      status: a.status,
      randomizeQuestions: !!a.randomizeQuestions,
      randomizeChoices: !!a.randomizeChoices,
      timeLimitMinutes: a.timeLimitMinutes ?? '',
      allowRetake: a.maxAttempts !== 1,
    })
    setFormError(null)
    setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditing(null); setFormError(null); reset() }

  const onSubmit = async (data: FormShape) => {
    const payload: any = {
      title: String(data.title || '').trim(),
      description: data.description ? String(data.description).trim() : null,
      instructions: data.instructions ? String(data.instructions).trim() : null,
      classId: data.classId,
      type: data.type,
      weight: Number(data.weight) || 1,
      totalMarks: Number(data.totalMarks) || 100,
      latePenaltyPct: Number(data.latePenaltyPct) || 0,
      maxAttempts: Number(data.maxAttempts) || 1,
      allowLate: !!data.allowLate,
      status: data.status || 'PUBLISHED',
      attachmentUrl: data.attachmentUrl?.trim() || null,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      availableFrom: data.availableFrom ? new Date(data.availableFrom).toISOString() : null,
    }
    if (data.type === 'QUIZ') {
      payload.randomizeQuestions = !!data.randomizeQuestions
      payload.randomizeChoices = !!data.randomizeChoices
      payload.timeLimitMinutes = data.timeLimitMinutes === '' || data.timeLimitMinutes == null ? null : Number(data.timeLimitMinutes) || null
      if (!data.allowRetake) {
        payload.maxAttempts = 1
      } else {
        // 0 = unlimited; any other positive int otherwise.
        const n = Number(data.maxAttempts)
        payload.maxAttempts = isFinite(n) && n >= 0 ? n : 0
      }
    }
    if (editing) payload.id = editing.id
    setFormError(null)
    try { await saveMutation.mutateAsync(payload) } catch { /* surfaced */ }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = assignments.filter(a => {
      if (filterStatus !== 'ALL' && a.status !== filterStatus) return false
      if (filterType !== 'ALL' && a.type !== filterType) return false
      if (filterClass !== 'ALL' && a.class.id !== filterClass) return false
      if (q && !a.title.toLowerCase().includes(q)) return false
      return true
    })
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      if (sortBy === 'dueDate') {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER
        return ad - bd
      }
      return 0 // default keeps API ordering (createdAt desc)
    })
    return sorted
  }, [assignments, filterStatus, filterType, filterClass, search, sortBy])

  const counts = useMemo(() => ({
    total: assignments.length,
    draft: assignments.filter(a => a.status === 'DRAFT').length,
    published: assignments.filter(a => a.status === 'PUBLISHED').length,
    submissions: assignments.reduce((s, a) => s + (a._count?.submissions ?? 0), 0),
  }), [assignments])

  return (
    <AuthGuard requiredRole="TEACHER">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Teacher" subtitle="Portal" navItems={teacherNav} accentColor="sky" />
        <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📚 My Assignments</h1>
              <p className="text-sm text-gray-500 mt-0.5">Homework, quizzes, projects, and more</p>
            </div>
            <button onClick={openCreate} className="bg-sky-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-sky-700 shadow-sm">+ New Assignment</button>
          </div>

          {!isLoading && !isError && assignments.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total" value={counts.total} decimals={0} prefix="" color="bg-sky-100"
                icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>} />
              <StatCard label="Draft" value={counts.draft} decimals={0} prefix="" color="bg-slate-100"
                icon={<svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>} />
              <StatCard label="Published" value={counts.published} decimals={0} prefix="" color="bg-emerald-100"
                icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>} />
              <StatCard label="Submissions" value={counts.submissions} decimals={0} prefix="" color="bg-amber-100"
                icon={<svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm p-3 flex flex-wrap items-center gap-2 border border-gray-100">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title…" className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="ALL">All status</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="CLOSED">Closed</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="ALL">All types</option>
              <option value="HOMEWORK">Homework</option>
              <option value="QUIZ">Quiz</option>
              <option value="PROJECT">Project</option>
              <option value="LAB">Lab</option>
              <option value="ESSAY">Essay</option>
            </select>
            <select value={filterClass} onChange={e => setFilterClass(e.target.value)} className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="ALL">All classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="createdAt">Newest</option>
              <option value="dueDate">Due date</option>
              <option value="title">Title</option>
            </select>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
              <p className="text-red-600 mb-2">Failed to load assignments</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <EmptyState icon="📚" message={assignments.length === 0 ? 'No assignments created yet' : 'No assignments match your filters'} />
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(a => (
                <div key={a.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-gray-900 truncate">{a.title}</p>
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGES[a.status] || 'bg-slate-100 text-slate-600'}`}>{a.status}</span>
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold ${TYPE_BADGES[a.type] || 'bg-slate-100 text-slate-600'}`}>{a.type}</span>
                      {a.weight !== 1 && <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-700">×{a.weight}</span>}
                    </div>
                    <p className="text-xs text-gray-500">{a.class?.name} · {a.class?.subject} · {a.totalMarks} marks{a.maxAttempts > 1 ? ` · up to ${a.maxAttempts} attempts` : ''}</p>
                    {a.dueDate && <p className="text-xs text-gray-400">Due: {new Date(a.dueDate).toLocaleString()}</p>}
                    <p className="text-xs text-amber-600 mt-0.5">{a._count?.submissions ?? 0} submission(s){a.latePenaltyPct > 0 ? ` · ${a.latePenaltyPct}% late penalty` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {a.type === 'QUIZ' && (
                      <Link href={`/teacher/assignments/${a.id}/quiz`} className="text-xs bg-violet-100 text-violet-700 px-3 py-1.5 rounded-lg font-medium hover:bg-violet-200">📝 Questions</Link>
                    )}
                    <Link href={`/teacher/assignments/${a.id}`} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-200">Grade</Link>
                    <button onClick={() => openEdit(a)} className="text-xs bg-sky-50 text-sky-700 px-3 py-1.5 rounded-lg font-medium hover:bg-sky-100">Edit</button>
                    <button onClick={() => { if (confirm(`Delete "${a.title}"?`)) deleteMutation.mutate(a.id) }} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </main>

        {showForm && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl my-8">
              <h2 className="text-lg font-bold mb-4">{editing ? 'Edit Assignment' : 'New Assignment'}</h2>
              {formError && (
                <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{formError}</div>
              )}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
                <input {...register('title', { required: true })} placeholder="Title *" className="w-full border rounded-lg px-3 py-2 text-sm" />
                <textarea {...register('description')} rows={2} placeholder="Short description" className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />
                <textarea {...register('instructions')} rows={4} placeholder="Detailed instructions (visible to students)" className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />

                <div className="grid grid-cols-2 gap-3">
                  <select {...register('classId', { required: true })} className="border rounded-lg px-3 py-2 text-sm">
                    <option value="">Select class *</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name} — {c.subject}</option>)}
                  </select>
                  <select {...register('type')} className="border rounded-lg px-3 py-2 text-sm">
                    <option value="HOMEWORK">Homework</option>
                    <option value="QUIZ">Quiz</option>
                    <option value="PROJECT">Project</option>
                    <option value="LAB">Lab</option>
                    <option value="ESSAY">Essay</option>
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="text-xs text-slate-500">Total marks
                    <input type="number" step="any" min={0} {...register('totalMarks')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs text-slate-500">Weight
                    <input type="number" step="0.1" min={0} {...register('weight')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs text-slate-500">Status
                    <select {...register('status')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="DRAFT">Draft</option>
                      <option value="PUBLISHED">Published</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-slate-500">Available from
                    <input type="datetime-local" {...register('availableFrom')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs text-slate-500">Due date & time
                    <input type="datetime-local" {...register('dueDate')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <label className="text-xs text-slate-500">Late penalty %
                    <input type="number" step="any" min={0} max={100} {...register('latePenaltyPct')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                  </label>
                  {watchType !== 'QUIZ' ? (
                    <label className="text-xs text-slate-500">Max attempts
                      <input type="number" min={1} {...register('maxAttempts')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                    </label>
                  ) : <div />}
                  <label className="text-xs text-slate-500 flex items-center gap-2 mt-5">
                    <input type="checkbox" {...register('allowLate')} className="h-4 w-4" />
                    Allow late submissions
                  </label>
                </div>

                <input {...register('attachmentUrl')} placeholder="Attachment URL (Google Drive, Dropbox, etc.)" className="w-full border rounded-lg px-3 py-2 text-sm" />

                {watchType === 'QUIZ' && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-violet-700">Quiz settings</div>
                      {editing ? (
                        <Link href={`/teacher/assignments/${editing.id}/quiz`} className="text-xs bg-violet-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-violet-700">📝 Add / edit questions</Link>
                      ) : (
                        <span className="text-[10px] text-violet-600">You'll be taken to the question editor after saving.</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3 items-end">
                      <label className="text-xs text-slate-600 flex items-center gap-2">
                        <input type="checkbox" {...register('randomizeQuestions')} className="h-4 w-4" />
                        Randomize question order
                      </label>
                      <label className="text-xs text-slate-600 flex items-center gap-2">
                        <input type="checkbox" {...register('randomizeChoices')} className="h-4 w-4" />
                        Randomize MCQ choices
                      </label>
                      <label className="text-xs text-slate-500">Time limit (minutes)
                        <input type="number" min={1} max={600} placeholder="No limit" {...register('timeLimitMinutes')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-3 items-end pt-2 border-t border-violet-200/60">
                      <label className="text-xs text-slate-700 flex items-center gap-2 col-span-2">
                        <input type="checkbox" {...register('allowRetake')} className="h-4 w-4" />
                        <span>Allow students to <strong>retake</strong> this quiz</span>
                      </label>
                      {watchAllowRetake ? (
                        <label className="text-xs text-slate-500">Max attempts
                          <input type="number" min={0} max={50} placeholder="0 = unlimited" {...register('maxAttempts')} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                        </label>
                      ) : (
                        <span className="text-[11px] text-slate-500 mt-5">Students get a single attempt.</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={closeForm} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg font-medium disabled:opacity-60">
                    {isSubmitting ? 'Saving…' : (editing ? 'Save changes' : 'Create')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
