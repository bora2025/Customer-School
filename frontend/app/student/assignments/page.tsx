"use client"

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import StatCard from '../../../components/StatCard'
import EmptyState from '../../../components/EmptyState'
import { apiFetch } from '../../../lib/api'

const studentNav = [
  { label: 'nav.dashboard', href: '/student', icon: 'dashboard' },
  { label: 'Assignments', href: '/student/assignments', icon: 'book' },
  { label: 'My Scores', href: '/student/scores', icon: 'chart' },
  { label: 'Exams', href: '/student/exams', icon: 'clipboard' },
  { label: 'Messages', href: '/student/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'My Parent', href: '/student/parent', icon: 'users' },
]

interface Assignment {
  id: string
  title: string
  description: string | null
  instructions: string | null
  dueDate: string | null
  availableFrom: string | null
  totalMarks: number
  type: string
  status: string // PUBLISHED | CLOSED
  attachmentUrl: string | null
  maxAttempts: number
  allowLate: boolean
  latePenaltyPct: number
  class?: { name?: string; subject?: string } | null
  createdBy?: { name?: string } | null
  submission: {
    id: string
    marks: number | null
    submittedAt: string
    status: string // SUBMITTED | LATE | GRADED
    attemptNumber: number
    latePenaltyApplied: number | null
    content: string | null
    attachmentUrl: string | null
    feedback: string | null
  } | null
}

const STATUS_MAP = {
  graded: { label: 'Graded', color: 'bg-emerald-100 text-emerald-700' },
  submitted: { label: 'Submitted', color: 'bg-emerald-100 text-emerald-700' },
  late: { label: 'Late', color: 'bg-orange-100 text-orange-700' },
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700' },
  missing: { label: 'Missing', color: 'bg-red-100 text-red-700' },
  closed: { label: 'Closed', color: 'bg-slate-200 text-slate-600' },
} as const

type StatusKey = keyof typeof STATUS_MAP

function getStatus(a: Assignment): StatusKey {
  if (a.submission) {
    if (a.submission.marks !== null) return 'graded'
    if (a.submission.status === 'LATE') return 'late'
    return 'submitted'
  }
  if (a.status === 'CLOSED') return 'closed'
  if (a.dueDate && new Date(a.dueDate) < new Date()) return 'missing'
  return 'pending'
}

export default function StudentAssignmentsPage() {
  const [submitFor, setSubmitFor] = useState<Assignment | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | StatusKey>('ALL')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'dueDate' | 'title'>('dueDate')
  const qc = useQueryClient()

  const { data: assignments = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['student-assignments'],
    queryFn: async () => { const r = await apiFetch('/api/assignments/student/my-assignments'); if (!r.ok) throw new Error(); return r.json() as Promise<Assignment[]> },
  })

  const submitMutation = useMutation({
    mutationFn: async ({ id, content, attachmentUrl }: { id: string; content: string; attachmentUrl: string }) => {
      const r = await apiFetch(`/api/assignments/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content || undefined, attachmentUrl: attachmentUrl || undefined }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to submit')
      }
      return r.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['student-assignments'] }); setSubmitFor(null); setSubmitError(null) },
    onError: (e: any) => setSubmitError(e?.message || 'Failed to submit'),
  })

  const { register, handleSubmit, reset } = useForm<{ content: string; attachmentUrl: string }>()
  const onSubmit = (data: { content: string; attachmentUrl: string }) => {
    if (!submitFor) return
    if (!data.content?.trim() && !data.attachmentUrl?.trim()) {
      setSubmitError('Please provide your work or a Google Drive / Dropbox link')
      return
    }
    setSubmitError(null)
    submitMutation.mutate({ id: submitFor.id, content: data.content?.trim() ?? '', attachmentUrl: data.attachmentUrl?.trim() ?? '' })
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = assignments.filter(a => {
      if (filterStatus !== 'ALL' && getStatus(a) !== filterStatus) return false
      if (q && !a.title.toLowerCase().includes(q)) return false
      return true
    })
    return [...rows].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER
      return ad - bd
    })
  }, [assignments, filterStatus, search, sortBy])

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Student" subtitle="Portal" navItems={studentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />
        <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📚 My Assignments</h1>
            <p className="text-sm text-gray-500 mt-0.5">Homework, quizzes, and projects for your classes</p>
          </div>

          {!isLoading && !isError && assignments.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Pending" value={assignments.filter(a => getStatus(a) === 'pending').length} decimals={0} prefix="" color="bg-amber-100"
                icon={<svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
              <StatCard label="Submitted" value={assignments.filter(a => ['submitted','late'].includes(getStatus(a))).length} decimals={0} prefix="" color="bg-sky-100"
                icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>} />
              <StatCard label="Graded" value={assignments.filter(a => getStatus(a) === 'graded').length} decimals={0} prefix="" color="bg-emerald-100"
                icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm p-3 flex flex-wrap items-center gap-2 border border-gray-100">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title…" className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="ALL">All</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="graded">Graded</option>
              <option value="late">Late</option>
              <option value="missing">Missing</option>
              <option value="closed">Closed</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm bg-white">
              <option value="dueDate">Due date</option>
              <option value="title">Title</option>
            </select>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
              <p className="text-red-600 mb-2">Failed to load assignments</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <EmptyState icon="📚" message={assignments.length === 0 ? 'No assignments assigned yet' : 'Nothing matches your filters'} />
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map(a => {
                const status = getStatus(a)
                const meta = STATUS_MAP[status]
                const attemptsUsed = a.submission?.attemptNumber ?? 0
                const attemptsRemain = a.maxAttempts === 0 || attemptsUsed < a.maxAttempts
                const canResubmit = !!a.submission && a.status !== 'CLOSED' && attemptsRemain && (a.type === 'QUIZ' || a.submission.marks === null)
                const canSubmit = !a.submission && a.status !== 'CLOSED'
                return (
                  <div key={a.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-semibold text-gray-900">{a.title}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${meta.color}`}>{meta.label}</span>
                          <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600">{a.type}</span>
                        </div>
                        <p className="text-xs text-gray-500">{[a.class?.name, a.class?.subject, a.createdBy?.name && `by ${a.createdBy.name}`].filter(Boolean).join(' · ')}</p>
                        {a.dueDate && <p className="text-xs text-gray-400 mt-0.5">Due: {new Date(a.dueDate).toLocaleString()}</p>}
                        {a.instructions && <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">{a.instructions}</p>}
                        {a.attachmentUrl && (
                          <a href={a.attachmentUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-emerald-600 underline mt-1">📎 Resource link</a>
                        )}
                        {a.maxAttempts > 1 && <p className="text-xs text-gray-400 mt-1">Attempts: {attemptsUsed}/{a.maxAttempts}</p>}
                        {a.latePenaltyPct > 0 && <p className="text-xs text-orange-600 mt-0.5">Late penalty: {a.latePenaltyPct}%</p>}
                        {a.submission?.marks !== null && a.submission && (
                          <p className="text-xs font-semibold text-emerald-600 mt-1 bg-emerald-50 inline-block px-2 py-0.5 rounded-lg">
                            Score: {a.submission.marks}/{a.totalMarks}
                            {a.submission.latePenaltyApplied ? ` (after −${a.submission.latePenaltyApplied}% late)` : ''}
                          </p>
                        )}
                        {a.submission?.feedback && <p className="text-xs text-gray-500 italic mt-1">Feedback: "{a.submission.feedback}"</p>}
                        {a.submission?.attachmentUrl && (
                          <a href={a.submission.attachmentUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-emerald-600 underline mt-1">📎 My submission link</a>
                        )}
                      </div>
                      {(canSubmit || canResubmit) && (
                        a.type === 'QUIZ' ? (
                          <Link href={`/student/assignments/${a.id}/quiz`}
                            className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-xl font-semibold hover:bg-violet-700 flex-shrink-0 shadow-sm">
                            {canResubmit ? 'Retake quiz' : 'Take quiz'}
                          </Link>
                        ) : (
                          <button onClick={() => { setSubmitFor(a); setSubmitError(null); reset({ content: a.submission?.content ?? '', attachmentUrl: a.submission?.attachmentUrl ?? '' }) }}
                            className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-xl font-semibold hover:bg-emerald-700 flex-shrink-0 shadow-sm">
                            {canResubmit ? 'Resubmit' : 'Submit'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {submitFor && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
              <h2 className="text-lg font-bold mb-1">{submitFor.title}</h2>
              <p className="text-xs text-slate-400 mb-4">{submitFor.class?.name ?? ''}{submitFor.maxAttempts > 1 ? ` · Attempt ${(submitFor.submission?.attemptNumber ?? 0) + 1} of ${submitFor.maxAttempts}` : ''}</p>
              {submitError && (
                <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{submitError}</div>
              )}
              <form onSubmit={handleSubmit(onSubmit)}>
                <textarea {...register('content')}
                  rows={5}
                  placeholder="Write your answer (optional if you provide a link below)…"
                  className="w-full border rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-3" />
                <label className="block text-xs text-slate-500 mb-1">Google Drive / Dropbox / link</label>
                <input {...register('attachmentUrl')}
                  placeholder="https://drive.google.com/…"
                  className="w-full border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-4" />
                <p className="text-[11px] text-slate-400 mb-3">Tip: in Google Drive, click Share → Anyone with the link → Viewer, then paste the link here.</p>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => { setSubmitFor(null); setSubmitError(null) }} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
                  <button type="submit" disabled={submitMutation.isPending}
                    className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-medium disabled:opacity-60">
                    {submitMutation.isPending ? 'Submitting…' : 'Submit Assignment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
    </AuthGuard>
  )
}
