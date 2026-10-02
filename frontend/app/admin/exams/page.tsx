"use client"

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import StatCard from '../../../components/StatCard'
import EmptyState from '../../../components/EmptyState'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'

interface Exam {
  id: string; title: string; description: string | null; status: string
  duration: number; totalMarks: number; passMark: number; maxAttempts: number
  class: { id: string; name: string } | null
  createdBy: { id: string; name: string }
  _count: { questions: number; attempts: number }
  createdAt: string
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PUBLISHED: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-purple-100 text-purple-700',
}

export default function ExamAdminPage() {
  const qc = useQueryClient()

  const { data: exams = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['exams'],
    queryFn: async () => { const r = await apiFetch('/api/exams'); if (!r.ok) throw new Error(); return r.json() as Promise<Exam[]> },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/exams/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exams'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/exams/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exams'] }),
  })

  const counts = useMemo(() => ({
    total: exams.length,
    draft: exams.filter(e => e.status === 'DRAFT').length,
    live: exams.filter(e => e.status === 'PUBLISHED' || e.status === 'ACTIVE').length,
    completed: exams.filter(e => e.status === 'COMPLETED').length,
  }), [exams])

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">📝 Examinations</h1>
                <p className="text-sm text-gray-500 mt-0.5">Create, publish, and manage exams across classes</p>
              </div>
              <Link href="/teacher/exams/new?returnTo=/admin/exams"
                className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 shadow-sm">
                + Create Exam
              </Link>
            </div>

            {!isLoading && !isError && exams.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Exams" value={counts.total} decimals={0} prefix="" color="bg-indigo-100"
                  icon={<svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>} />
                <StatCard label="Draft" value={counts.draft} decimals={0} prefix="" color="bg-slate-100"
                  icon={<svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>} />
                <StatCard label="Live" value={counts.live} decimals={0} prefix="" color="bg-emerald-100" sub="published or active"
                  icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>} />
                <StatCard label="Completed" value={counts.completed} decimals={0} prefix="" color="bg-purple-100"
                  icon={<svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
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
                <EmptyState icon="📝" message="No exams yet" action={
                  <Link href="/teacher/exams/new?returnTo=/admin/exams" className="text-sm text-indigo-600 font-medium hover:underline">Create your first exam</Link>
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
                      <p className="text-xs text-gray-400 mt-0.5">{exam._count.attempts} attempt(s) · by {exam.createdBy.name}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link href={`/teacher/exams/${exam.id}/edit?returnTo=/admin/exams`} className="text-xs text-indigo-600 hover:underline font-medium">
                        Edit
                      </Link>
                      <Link href={`/teacher/exams/${exam.id}/attempts`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-emerald-700 hover:underline font-medium">Grade ↗</Link>
                      <select value={exam.status}
                        onChange={e => statusMutation.mutate({ id: exam.id, status: e.target.value })}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
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
