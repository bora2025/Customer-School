"use client"

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
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

interface Exam { id: string; title: string; duration: number; totalMarks: number; passMark: number; maxAttempts: number; status: string; class: { name: string } | null; attempts: { id: string; status: string; score: number | null; submittedAt: string | null; attemptNumber: number }[] }

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PUBLISHED: 'bg-indigo-100 text-indigo-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-purple-100 text-purple-700',
}

export default function StudentExamsPage() {
  const { data: exams = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['student-exams'],
    queryFn: async () => { const r = await apiFetch('/api/exams/student/my-exams'); if (!r.ok) throw new Error(); return r.json() as Promise<Exam[]> },
  })

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Student" subtitle="Portal" navItems={studentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />
        <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📝 My Exams</h1>
            <p className="text-sm text-gray-500 mt-0.5">Exams available for your class</p>
          </div>

          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
              <p className="text-red-600 mb-2">Failed to load exams</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : exams.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <EmptyState icon="📝" message="No exams available" />
            </div>
          ) : (
            <div className="space-y-3">
              {exams.map(exam => {
                const attempt = exam.attempts?.[0] ?? null
                const hasAttempt = !!attempt
                const isGraded = attempt?.status === 'GRADED'
                const isInProgress = attempt?.status === 'IN_PROGRESS'
                const attemptsUsed = attempt?.attemptNumber ?? 0
                const attemptsLeft = exam.maxAttempts === 0 || attemptsUsed < exam.maxAttempts
                const canStart = exam.status === 'ACTIVE' && !hasAttempt
                const canResume = exam.status === 'ACTIVE' && isInProgress
                // Only once fully GRADED — retaking while still SUBMITTED (awaiting manual
                // grading on a mixed exam) would silently wipe the teacher's pending item.
                const canRetake = exam.status === 'ACTIVE' && isGraded && attemptsLeft
                return (
                  <div key={exam.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-none bg-indigo-100">
                        <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-semibold text-gray-900">{exam.title}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[exam.status]}`}>{exam.status}</span>
                        </div>
                        <p className="text-xs text-gray-500">{exam.class?.name ?? 'General'} · {exam.duration} min · Pass: {exam.passMark}/{exam.totalMarks}</p>
                        {isGraded && attempt && (
                          <p className={`text-xs font-semibold mt-1 ${(attempt.score ?? 0) >= exam.passMark ? 'text-emerald-600' : 'text-red-600'}`}>
                            Score: {attempt.score}/{exam.totalMarks} — {(attempt.score ?? 0) >= exam.passMark ? 'PASSED' : 'FAILED'}
                          </p>
                        )}
                        {hasAttempt && !isGraded && !isInProgress && <p className="text-xs text-amber-600 mt-1">Submitted · Awaiting result</p>}
                        {!hasAttempt && exam.status === 'PUBLISHED' && <p className="text-xs text-gray-400 mt-1">Not open yet — check back once your teacher starts it</p>}
                        {!hasAttempt && exam.status === 'COMPLETED' && <p className="text-xs text-gray-400 mt-1">Closed — this exam is no longer open</p>}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {canStart && (
                        <Link href={`/student/exams/${exam.id}`}
                          className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-emerald-700 shadow-sm">
                          Start Exam
                        </Link>
                      )}
                      {canResume && (
                        <Link href={`/student/exams/${exam.id}`}
                          className="bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-amber-600 shadow-sm">
                          Resume Exam
                        </Link>
                      )}
                      {canRetake && (
                        <Link href={`/student/exams/${exam.id}`}
                          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-indigo-700 shadow-sm">
                          Retake Exam
                        </Link>
                      )}
                      {isGraded && !canRetake && <span className="text-xs text-emerald-600 font-semibold">✓ Completed</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
    </AuthGuard>
  )
}
