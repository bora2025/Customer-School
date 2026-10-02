'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../components/AuthGuard'
import StatCard from '../../../../../components/StatCard'
import ProgressBar from '../../../../../components/ProgressBar'
import EmptyState from '../../../../../components/EmptyState'
import ConfirmModal from '../../../../../components/ConfirmModal'
import { apiFetch } from '../../../../../lib/api'

interface LessonRow {
  lessonId: string
  opened: boolean
  openCount: number
  lastOpenedAt: string | null
  watchedSeconds: number
  videoDurationSec: number | null
  videoPct: number
  videoCompleted: boolean
  attemptId: string | null
  attemptStatus: string | null
  attemptScore: number | null
  attemptMaxScore: number | null
  attemptPassed: boolean | null
}

interface StudentRow {
  studentId: string
  studentNumber: string | null
  name: string
  email: string
  progressPct: number
  lessonsOpened: number
  lessonsCompleted: number
  sessionsAttended: number
  attendancePct: number
  lessons: LessonRow[]
}

interface Report {
  course: { id: string; sessionCount: number; lessonCount: number }
  lessons: Array<{
    id: string
    title: string
    requireVideoWatch: boolean
    videoWatchPct: number
  }>
  students: StudentRow[]
}

function fmtMin(seconds: number): string {
  if (!seconds) return '0m'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function CourseEngagementPage() {
  const params = useParams<{ id: string }>()
  const courseId = params?.id as string
  const qc = useQueryClient()
  const [resetTarget, setResetTarget] = useState<{ attemptId: string; studentName: string; lessonTitle: string } | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['course-engagement', courseId],
    enabled: !!courseId,
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}/engagement-report`)
      if (!r.ok) throw new Error('Failed to load engagement report')
      return r.json() as Promise<Report>
    },
  })

  const resetMutation = useMutation({
    mutationFn: async (attemptId: string) => {
      const r = await apiFetch(`/api/courses/attempts/${attemptId}/reset`, { method: 'PATCH' })
      if (!r.ok) throw new Error('Failed to reset attempt')
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-engagement', courseId] })
      setResetTarget(null)
    },
  })

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <Link
              href={`/teacher/courses/${courseId}`}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Back to course
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-gray-900">
            Lesson engagement
          </h1>

          {isLoading && (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="bg-white h-16 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          )}
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {(error as Error).message}
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Published Lessons" value={data.course.lessonCount} decimals={0} prefix="" color="bg-sky-100"
                  icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s4.332.477 5.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>} />
                <StatCard label="Sessions" value={data.course.sessionCount} decimals={0} prefix="" color="bg-violet-100"
                  icon={<svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>} />
                <StatCard label="Students" value={data.students.length} decimals={0} prefix="" color="bg-emerald-100"
                  icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4"/></svg>} />
              </div>

              {/* Summary table */}
              <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Student</th>
                      <th className="px-3 py-2 text-left">Progress</th>
                      <th className="px-3 py-2 text-left">Lessons opened</th>
                      <th className="px-3 py-2 text-left">Lessons completed</th>
                      <th className="px-3 py-2 text-left">Attendance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.length === 0 && (
                      <tr>
                        <td className="px-3 py-2" colSpan={5}>
                          <EmptyState icon="🧑‍🎓" message="No enrolled students yet." />
                        </td>
                      </tr>
                    )}
                    {data.students.map((s) => (
                      <tr key={s.studentId} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{s.name}</div>
                          <div className="text-xs text-gray-500">
                            {s.studentNumber || s.email}
                          </div>
                        </td>
                        <td className="px-3 py-2 w-32"><ProgressBar pct={s.progressPct} showPercent color="bg-emerald-500" /></td>
                        <td className="px-3 py-2">
                          {s.lessonsOpened} / {data.course.lessonCount}
                        </td>
                        <td className="px-3 py-2">
                          {s.lessonsCompleted} / {data.course.lessonCount}
                        </td>
                        <td className="px-3 py-2 w-32"><ProgressBar pct={s.attendancePct} label={`${s.sessionsAttended}/${data.course.sessionCount}`} color="bg-violet-500" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Per-lesson matrix */}
              {data.students.length > 0 && data.lessons.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 uppercase text-gray-500">
                      <tr>
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left">
                          Student
                        </th>
                        {data.lessons.map((l) => (
                          <th
                            key={l.id}
                            className="px-2 py-2 text-left min-w-[140px]"
                          >
                            {l.title}
                            {l.requireVideoWatch && (
                              <span className="ml-1 text-[10px] text-amber-600">
                                ▶ {l.videoWatchPct}%
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.students.map((s) => (
                        <tr key={s.studentId} className="border-t border-slate-100">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">
                            {s.name}
                          </td>
                          {s.lessons.map((row) => (
                            <td key={row.lessonId} className="px-2 py-2">
                              {!row.opened ? (
                                <span className="text-slate-400">—</span>
                              ) : (
                                <div className="space-y-0.5">
                                  <div className="text-slate-700">
                                    {row.attemptStatus === 'COMPLETED' ? (
                                      <span className="text-emerald-700">
                                        ✓ Done
                                        {row.attemptScore != null &&
                                        row.attemptMaxScore
                                          ? ` (${row.attemptScore}/${row.attemptMaxScore})`
                                          : ''}
                                      </span>
                                    ) : (
                                      <span className="text-sky-700">
                                        In progress
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    Opens: {row.openCount}
                                  </div>
                                  {row.attemptId && (
                                    <button
                                      onClick={() => setResetTarget({
                                        attemptId: row.attemptId!,
                                        studentName: s.name,
                                        lessonTitle: data.lessons.find(l => l.id === row.lessonId)?.title ?? 'this lesson',
                                      })}
                                      className="text-[10px] text-amber-600 hover:underline"
                                    >
                                      ↻ Reset
                                    </button>
                                  )}
                                  {row.videoDurationSec ? (
                                    <div
                                      className={
                                        'text-[10px] ' +
                                        (row.videoCompleted
                                          ? 'text-emerald-600'
                                          : 'text-amber-600')
                                      }
                                    >
                                      Video: {row.videoPct}% ({fmtMin(row.watchedSeconds)})
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {resetTarget && (
        <ConfirmModal
          title="Reset this attempt?"
          message={`This voids ${resetTarget.studentName}'s attempt on "${resetTarget.lessonTitle}" so they get a clean fresh start next time they open it. This can't be undone.`}
          confirmLabel="Reset Attempt"
          danger
          pending={resetMutation.isPending}
          onConfirm={() => resetMutation.mutate(resetTarget.attemptId)}
          onCancel={() => setResetTarget(null)}
        />
      )}
    </AuthGuard>
  )
}
