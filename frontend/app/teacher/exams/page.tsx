"use client"

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import StatCard from '../../../components/StatCard'
import EmptyState from '../../../components/EmptyState'
import { teacherNav } from '../../../lib/teacher-nav'
import { apiFetch } from '../../../lib/api'

interface Exam {
  id: string; title: string; description: string | null; status: string
  duration: number; totalMarks: number; passMark: number; maxAttempts: number
  class: { id: string; name: string } | null
  createdBy: { id: string; name: string }
  _count: { questions: number; attempts: number }
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PUBLISHED: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-purple-100 text-purple-700',
}

const STATUS_HINT: Record<string, string> = {
  DRAFT: 'Hidden from students — still being written.',
  PUBLISHED: 'Visible to students, but they can\'t start it yet.',
  ACTIVE: 'Students can start and submit right now.',
  COMPLETED: 'Closed — students can no longer start it.',
}

export default function TeacherExamsPage() {
  const qc = useQueryClient()

  const { data: exams = [] as Exam[], isLoading, isError, refetch } = useQuery<Exam[]>({
    queryKey: ['teacher-exams'],
    queryFn: async () => { const r = await apiFetch('/api/exams'); if (!r.ok) throw new Error(); return r.json() },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/exams/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-exams'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/exams/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-exams'] }),
  })

  const counts = useMemo(() => ({
    total: exams.length,
    draft: exams.filter(e => e.status === 'DRAFT').length,
    live: exams.filter(e => e.status === 'PUBLISHED' || e.status === 'ACTIVE').length,
    attempts: exams.reduce((s, e) => s + e._count.attempts, 0),
  }), [exams])

  return (
    <AuthGuard requiredRole="TEACHER">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Teacher" subtitle="Portal" navItems={teacherNav} accentColor="sky" />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📝 My Exams</h1>
                <p className="text-sm text-gray-500 mt-0.5">Author exams and grade student attempts</p>
              </div>
              <Link href="/teacher/exams/new?returnTo=/teacher/exams"
                className="bg-sky-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-sky-700 shadow-sm">
                + Create Exam
              </Link>
            </div>

            {!isLoading && !isError && exams.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Exams" value={counts.total} decimals={0} prefix="" color="bg-sky-100"
                  icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>} />
                <StatCard label="Draft" value={counts.draft} decimals={0} prefix="" color="bg-slate-100"
                  icon={<svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>} />
                <StatCard label="Live" value={counts.live} decimals={0} prefix="" color="bg-emerald-100" sub="published or active"
                  icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>} />
                <StatCard label="Total Attempts" value={counts.attempts} decimals={0} prefix="" color="bg-amber-100" sub="awaiting or done"
                  icon={<svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
              </div>
            )}

            {isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />)}</div>
            ) : isError ? (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
                <p className="text-red-600 mb-2">Failed to load exams</p>
                <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
              </div>
            ) : exams.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <EmptyState icon="📝" message="No exams created yet" action={
                  <Link href="/teacher/exams/new?returnTo=/teacher/exams" className="text-sm text-sky-600 font-medium hover:underline">Create your first exam</Link>
                } />
              </div>
            ) : (
              <div className="space-y-3">
                {exams.map(exam => (
                  <div key={exam.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-semibold text-gray-900 truncate">{exam.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[exam.status]}`}>{exam.status}</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {exam.class?.name ?? 'All classes'} · {exam._count.questions} questions · {exam.duration} min · Pass: {exam.passMark}/{exam.totalMarks}
                        {exam.maxAttempts !== 1 && ` · ${exam.maxAttempts === 0 ? 'unlimited' : `up to ${exam.maxAttempts}`} attempts`}
                      </p>
                      <p className="text-xs text-amber-600 mt-0.5">{exam._count.attempts} attempt(s)</p>
                      <p className="text-xs text-gray-400 mt-0.5">{STATUS_HINT[exam.status]}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link href={`/teacher/exams/${exam.id}/edit?returnTo=/teacher/exams`} className="text-xs text-sky-600 hover:underline font-medium">
                        Edit
                      </Link>
                      <Link
                        href={`/teacher/exams/${exam.id}/attempts`}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50 font-medium"
                      >
                        Grade ({exam._count.attempts})
                      </Link>
                      {(exam.status === 'DRAFT' || exam.status === 'PUBLISHED') && (
                        <button
                          onClick={() => statusMutation.mutate({ id: exam.id, status: 'ACTIVE' })}
                          disabled={statusMutation.isPending}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-semibold disabled:opacity-50"
                        >
                          ▶ Activate Now
                        </button>
                      )}
                      <select value={exam.status}
                        onChange={e => statusMutation.mutate({ id: exam.id, status: e.target.value })}
                        title="Change exam status"
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300">
                        {['DRAFT','PUBLISHED','ACTIVE','COMPLETED'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => deleteMutation.mutate(exam.id)} className="text-xs text-red-500 hover:underline font-medium">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
