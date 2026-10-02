'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../components/AuthGuard'
import StatCard from '../../../../../components/StatCard'
import EmptyState from '../../../../../components/EmptyState'
import { apiFetch } from '../../../../../lib/api'

type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'

interface MySessionRow {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  location: string | null
  lesson: { id: string; title: string } | null
  hasCheckInCode: boolean
  attendance: {
    id: string
    status: AttendanceStatus
    source: 'MANUAL' | 'AUTO_LESSON' | 'CODE'
    checkInTime: string | null
    notes: string | null
  } | null
}

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  LATE: 'bg-amber-100 text-amber-700 border-amber-200',
  ABSENT: 'bg-rose-100 text-rose-700 border-rose-200',
  EXCUSED: 'bg-slate-100 text-slate-700 border-slate-200',
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Marked by teacher',
  AUTO_LESSON: 'Auto via lesson',
  CODE: 'Self check-in',
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export default function StudentCourseAttendancePage() {
  const params = useParams<{ id: string }>()
  const courseId = params?.id as string
  const qc = useQueryClient()

  const { data: course } = useQuery({
    queryKey: ['course-meta', courseId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}`)
      if (!r.ok) throw new Error('Failed to load course')
      return r.json() as Promise<{ id: string; title: string }>
    },
    enabled: !!courseId,
  })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['student-course-attendance', courseId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}/my-attendance`)
      if (!r.ok) throw new Error('Failed to load attendance')
      return r.json() as Promise<MySessionRow[]>
    },
    enabled: !!courseId,
  })

  const stats = useMemo(() => {
    const total = rows.length
    let present = 0
    let late = 0
    let absent = 0
    let excused = 0
    for (const r of rows) {
      const st = r.attendance?.status
      if (st === 'PRESENT') present++
      else if (st === 'LATE') late++
      else if (st === 'ABSENT') absent++
      else if (st === 'EXCUSED') excused++
    }
    const counted = present + late + absent + excused
    const pct = counted === 0 ? 0 : Math.round(((present + late) / counted) * 100)
    return { total, present, late, absent, excused, pct, counted }
  }, [rows])

  return (
    <AuthGuard allowedRoles={['STUDENT', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href={`/student/courses/${courseId}`}
            className="text-sm text-sky-600 hover:underline"
          >
            ← Back to course
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900">
          My Attendance · {course?.title || ''}
        </h1>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Sessions" value={stats.total} decimals={0} prefix="" color="bg-slate-100"
            icon={<svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>} />
          <StatCard label="Present" value={stats.present} decimals={0} prefix="" color="bg-emerald-100"
            icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
          <StatCard label="Late" value={stats.late} decimals={0} prefix="" color="bg-amber-100"
            icon={<svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
          <StatCard label="Absent" value={stats.absent} decimals={0} prefix="" color="bg-rose-100"
            icon={<svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>} />
          <StatCard label="Attendance %" value={`${stats.pct}%`} prefix="" color="bg-sky-100"
            icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>} />
        </div>

        {isLoading && <div className="space-y-3">{[1,2].map(i => <div key={i} className="bg-white h-16 rounded-2xl animate-pulse border border-gray-100" />)}</div>}

        {!isLoading && rows.length === 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
            <EmptyState icon="🗓️" message="No sessions scheduled yet." />
          </div>
        )}

        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-800">{row.title}</div>
                  <div className="text-xs text-slate-500">
                    {fmt(row.scheduledAt)} · {row.durationMinutes} min
                    {row.location ? ` · ${row.location}` : ''}
                  </div>
                  {row.lesson && (
                    <div className="mt-1 text-xs text-indigo-600">
                      🎯 Linked lesson: {row.lesson.title}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {row.attendance ? (
                    <>
                      <span
                        className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.attendance.status]}`}
                      >
                        {row.attendance.status}
                      </span>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {SOURCE_LABEL[row.attendance.source]}
                        {row.attendance.checkInTime
                          ? ` · ${new Date(row.attendance.checkInTime).toLocaleTimeString()}`
                          : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">— not marked —</span>
                  )}
                </div>
              </div>
              {row.hasCheckInCode && !row.attendance && (
                <CheckInForm
                  sessionId={row.id}
                  onSuccess={() =>
                    qc.invalidateQueries({
                      queryKey: ['student-course-attendance', courseId],
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </AuthGuard>
  )
}

function CheckInForm({
  sessionId,
  onSuccess,
}: {
  sessionId: string
  onSuccess: () => void
}) {
  const [code, setCode] = useState('')
  const m = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/api/courses/sessions/${sessionId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.message || 'Check-in failed')
      }
      return r.json()
    },
    onSuccess: () => {
      setCode('')
      onSuccess()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim()) m.mutate()
      }}
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Enter check-in code"
        className="flex-1 rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
      />
      <button
        type="submit"
        disabled={m.isPending || !code.trim()}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {m.isPending ? 'Checking in…' : 'Check in'}
      </button>
      {m.error && (
        <div className="w-full text-xs text-rose-600">{(m.error as Error).message}</div>
      )}
    </form>
  )
}
