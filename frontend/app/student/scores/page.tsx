"use client"

import { useQuery } from '@tanstack/react-query'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { apiFetch } from '../../../lib/api'

const studentNav = [
  { label: 'nav.dashboard', href: '/student', icon: 'dashboard' },
  { label: 'Assignments', href: '/student/assignments', icon: 'book' },
  { label: 'My Scores', href: '/student/scores', icon: 'chart' },
  { label: 'Exams', href: '/student/exams', icon: 'clipboard' },
  { label: 'Messages', href: '/student/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'My Parent', href: '/student/parent', icon: 'users' },
]

interface UnifiedScore {
  id: string
  kind: 'assignment' | 'exam'
  title: string
  subject: string
  className: string | null
  marks: number
  totalMarks: number
  date: string | null
  status?: string
}

export default function StudentScoresPage() {
  const assignmentsQuery = useQuery({
    queryKey: ['student-assignments-scores'],
    queryFn: async () => {
      const r = await apiFetch('/api/assignments/student/my-assignments')
      if (!r.ok) throw new Error('Failed to load assignments')
      return r.json() as Promise<any[]>
    },
  })

  const examsQuery = useQuery({
    queryKey: ['student-exam-results'],
    queryFn: async () => {
      const r = await apiFetch('/api/exams/student/results')
      if (!r.ok) return [] as any[]
      const data = await r.json()
      return Array.isArray(data) ? data : ([] as any[])
    },
  })

  const isLoading = assignmentsQuery.isLoading || examsQuery.isLoading
  const isError = assignmentsQuery.isError || examsQuery.isError
  const refetch = () => { assignmentsQuery.refetch(); examsQuery.refetch() }

  const assignmentScores: UnifiedScore[] = (assignmentsQuery.data ?? [])
    .flatMap((a: any): UnifiedScore[] => {
      const sub = Array.isArray(a?.submissions) ? a.submissions[0] : a?.submission
      if (!sub || sub.marks === null || sub.marks === undefined) return []
      return [{
        id: `a-${a.id}`,
        kind: 'assignment' as const,
        title: a.title,
        subject: a.class?.subject ?? a.subject ?? 'Other',
        className: a.class?.name ?? null,
        marks: sub.marks,
        totalMarks: a.totalMarks,
        date: sub.gradedAt ?? sub.submittedAt ?? null,
      }]
    })

  const examScores: UnifiedScore[] = (examsQuery.data ?? [])
    .filter((e: any) => e?.status === 'GRADED' && e?.score !== null && e?.score !== undefined)
    .map((e: any) => ({
      id: `e-${e.id}`,
      kind: 'exam',
      title: e.examTitle,
      subject: e.subject ?? 'Other',
      className: e.className ?? null,
      marks: e.score,
      totalMarks: e.totalMarks,
      date: e.gradedAt ?? e.submittedAt ?? null,
      status: e.grade ?? undefined,
    }))

  const pendingExams = (examsQuery.data ?? []).filter((e: any) => e?.status === 'SUBMITTED').length
  const scores = [...assignmentScores, ...examScores]

  const avg = scores.length
    ? Math.round(scores.reduce((s, g) => s + (g.marks / g.totalMarks) * 100, 0) / scores.length)
    : null

  const bySubject = scores.reduce<Record<string, UnifiedScore[]>>((acc, g) => {
    const key = g.subject
    if (!acc[key]) acc[key] = []
    acc[key].push(g)
    return acc
  }, {})

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Student" subtitle="Portal" navItems={studentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />
        <main className="flex-1 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mb-6">📊 My Scores</h1>

          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white h-16 rounded-xl animate-pulse" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-600 mb-2">Failed to load scores</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : scores.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-slate-400">No graded assignments or exams yet</p>
              {pendingExams > 0 && (
                <p className="text-xs text-amber-600 mt-2">{pendingExams} exam(s) submitted — awaiting teacher grading.</p>
              )}
            </div>
          ) : (
            <>
              {avg !== null && (
                <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex items-center gap-4 border border-slate-100">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white ${avg >= 70 ? 'bg-emerald-500' : avg >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}>
                    {avg}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 text-lg">Overall: {avg}%</p>
                    <p className="text-sm text-slate-400">
                      {assignmentScores.length} assignment(s) · {examScores.length} exam(s) · {Object.keys(bySubject).length} subject(s)
                    </p>
                  </div>
                </div>
              )}

              {pendingExams > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-800">
                  ⏳ {pendingExams} exam(s) submitted — awaiting teacher grading.
                </div>
              )}

              {Object.entries(bySubject).map(([subject, subjectScores]) => {
                const subAvg = Math.round(subjectScores.reduce((s, g) => s + (g.marks / g.totalMarks) * 100, 0) / subjectScores.length)
                return (
                  <div key={subject} className="bg-white rounded-xl shadow-sm p-4 mb-4 border border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-semibold text-slate-700">{subject}</p>
                      <span className={`text-sm font-bold ${subAvg >= 70 ? 'text-emerald-600' : subAvg >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{subAvg}%</span>
                    </div>
                    <div className="space-y-2">
                      {subjectScores.map(g => {
                        const pct = Math.round((g.marks / g.totalMarks) * 100)
                        return (
                          <div key={g.id} className="flex items-center gap-3">
                            <div className="w-40 truncate">
                              <p className="text-xs text-slate-600 truncate">{g.title}</p>
                              <p className="text-[10px] text-slate-400 uppercase tracking-wide">
                                {g.kind === 'exam' ? '📝 Exam' : '📚 Assignment'}
                                {g.status && <span className="ml-1">· {g.status}</span>}
                              </p>
                            </div>
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-xs font-semibold text-slate-700 w-14 text-right">{g.marks}/{g.totalMarks}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </main>
    </div>
    </AuthGuard>
  )
}
