'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../components/AuthGuard'
import { apiFetch } from '../../../../../lib/api'

type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'

interface Lesson {
  id: string
  title: string
  status: string
}

interface CourseSession {
  id: string
  courseId: string
  title: string
  scheduledAt: string
  durationMinutes: number
  location: string | null
  lessonId: string | null
  checkInCode: string | null
  lesson: { id: string; title: string } | null
  _count: { attendances: number }
}

interface AttendanceRecord {
  id: string
  sessionId: string
  studentId: string
  status: AttendanceStatus
  source: 'MANUAL' | 'AUTO_LESSON' | 'CODE'
  checkInTime: string | null
  notes: string | null
}

interface RosterRow {
  studentId: string
  studentNumber: string | null
  name: string
  email: string
  attendance: AttendanceRecord | null
}

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  LATE: 'bg-amber-100 text-amber-700 border-amber-200',
  ABSENT: 'bg-rose-100 text-rose-700 border-rose-200',
  EXCUSED: 'bg-slate-100 text-slate-700 border-slate-200',
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  AUTO_LESSON: 'Auto (Lesson)',
  CODE: 'Self check-in',
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TeacherCourseAttendancePage() {
  const params = useParams<{ id: string }>()
  const courseId = params?.id as string
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  const { data: course } = useQuery({
    queryKey: ['course-meta', courseId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}`)
      if (!r.ok) throw new Error('Failed to load course')
      return r.json() as Promise<{ id: string; title: string; lessons: Lesson[] }>
    },
    enabled: !!courseId,
  })

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['course-sessions', courseId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}/sessions`)
      if (!r.ok) throw new Error('Failed to load sessions')
      return r.json() as Promise<CourseSession[]>
    },
    enabled: !!courseId,
  })

  const createSession = useMutation({
    mutationFn: async (body: any) => {
      const r = await apiFetch(`/api/courses/${courseId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).message || 'Failed to create session')
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-sessions', courseId] })
      setShowForm(false)
    },
  })

  const generateFromLessons = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(
        `/api/courses/${courseId}/sessions/generate-from-lessons`,
        { method: 'POST' },
      )
      if (!r.ok)
        throw new Error((await r.json()).message || 'Failed to generate sessions')
      return r.json() as Promise<{ created: number; skipped: number }>
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['course-sessions', courseId] })
      alert(`Created ${res.created} session(s). Skipped ${res.skipped} already linked.`)
    },
    onError: (e: any) => alert(e?.message || 'Failed'),
  })

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const r = await apiFetch(`/api/courses/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      if (!r.ok) throw new Error('Failed to delete session')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-sessions', courseId] })
      setOpenSessionId(null)
    },
  })

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
          <div className="flex items-center justify-between">
            <Link
              href={`/teacher/courses/${courseId}`}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Back to course
            </Link>
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowForm((s) => !s)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              {showForm ? 'Cancel' : '+ New session'}
            </button>
            <button
              type="button"
              disabled={generateFromLessons.isPending}
              onClick={() => {
                if (
                  confirm(
                    'Create one session per published lesson? Lessons already linked to a session will be skipped.',
                  )
                )
                  generateFromLessons.mutate()
              }}
              className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-60"
            >
              {generateFromLessons.isPending
                ? 'Generating…'
                : '⚡ Generate per lesson'}
            </button>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-800">
            Attendance · {course?.title || ''}
          </h1>

          {showForm && (
            <NewSessionForm
              lessons={course?.lessons || []}
              busy={createSession.isPending}
              error={createSession.error as Error | null}
              onSubmit={(v) => createSession.mutate(v)}
            />
          )}

          {isLoading && <div className="text-sm text-slate-500">Loading sessions…</div>}

          {sessions.length === 0 && !isLoading && (
            <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              No sessions yet. Create one to start tracking attendance.
            </div>
          )}

          <ul className="space-y-3">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-semibold text-slate-800">{s.title}</div>
                    <div className="text-xs text-slate-500">
                      {fmt(s.scheduledAt)} · {s.durationMinutes} min
                      {s.location ? ` · ${s.location}` : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {s.lesson && (
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">
                          🎯 Auto: {s.lesson.title}
                        </span>
                      )}
                      {s.checkInCode && (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
                          🔑 Code: <code className="font-mono">{s.checkInCode}</code>
                        </span>
                      )}
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                        {s._count.attendances} marked
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSessionId((cur) => (cur === s.id ? null : s.id))
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      {openSessionId === s.id ? 'Hide roster' : 'Roster'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete session "${s.title}"?`)) {
                          deleteSession.mutate(s.id)
                        }
                      }}
                      className="rounded-md border border-rose-300 bg-white px-3 py-1 text-sm text-rose-600 hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {openSessionId === s.id && <SessionRoster sessionId={s.id} />}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AuthGuard>
  )
}

function NewSessionForm({
  lessons,
  busy,
  error,
  onSubmit,
}: {
  lessons: Lesson[]
  busy: boolean
  error: Error | null
  onSubmit: (v: any) => void
}) {
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState(fmtLocalInput(new Date()))
  const [durationMinutes, setDuration] = useState(60)
  const [location, setLocation] = useState('')
  const [lessonId, setLessonId] = useState('')
  const [checkInCode, setCheckInCode] = useState('')

  const publishedLessons = useMemo(
    () => lessons.filter((l) => l.status === 'PUBLISHED'),
    [lessons],
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          title: title.trim(),
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes,
          location: location.trim() || null,
          lessonId: lessonId || null,
          checkInCode: checkInCode.trim() || null,
        })
      }}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <div className="mb-1 font-medium text-slate-700">Title *</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 font-medium text-slate-700">When *</div>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            required
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 font-medium text-slate-700">Duration (min)</div>
          <input
            type="number"
            min={1}
            value={durationMinutes}
            onChange={(e) => setDuration(Number(e.target.value) || 60)}
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 font-medium text-slate-700">Location</div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 font-medium text-slate-700">
            Auto-mark on lesson (optional)
          </div>
          <select
            value={lessonId}
            onChange={(e) => setLessonId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">— none —</option>
            {publishedLessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 font-medium text-slate-700">
            Check-in code (optional)
          </div>
          <input
            value={checkInCode}
            onChange={(e) => setCheckInCode(e.target.value.toUpperCase())}
            placeholder="e.g. MATH-23"
            className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
          />
        </label>
      </div>
      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
          {error.message}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Create session'}
        </button>
      </div>
    </form>
  )
}

function SessionRoster({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['session-roster', sessionId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/sessions/${sessionId}/attendance`)
      if (!r.ok) throw new Error('Failed to load roster')
      return r.json() as Promise<{ session: CourseSession; roster: RosterRow[] }>
    },
  })

  const markMutation = useMutation({
    mutationFn: async (v: { studentId: string; status: AttendanceStatus; notes?: string }) => {
      const r = await apiFetch(`/api/courses/sessions/${sessionId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      if (!r.ok) throw new Error('Failed to mark')
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-roster', sessionId] })
      qc.invalidateQueries({ queryKey: ['course-sessions'] })
    },
  })

  if (isLoading) return <div className="p-4 text-sm text-slate-500">Loading roster…</div>
  if (!data) return null

  return (
    <div className="border-t border-slate-200 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600">
          {data.roster.length} enrolled
        </div>
        <button
          type="button"
          onClick={() => {
            if (!confirm('Mark all unmarked students as PRESENT?')) return
            data.roster
              .filter((r) => !r.attendance)
              .forEach((r) =>
                markMutation.mutate({ studentId: r.studentId, status: 'PRESENT' }),
              )
          }}
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
        >
          ✓ Mark all PRESENT
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">Student</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Source</th>
              <th className="px-2 py-1">Check-in</th>
              <th className="px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.roster.map((row) => {
              const status = row.attendance?.status ?? null
              return (
                <tr key={row.studentId} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-slate-800">{row.name}</div>
                    <div className="text-xs text-slate-500">
                      {row.studentNumber ? `#${row.studentNumber} · ` : ''}
                      {row.email}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {status ? (
                      <span
                        className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
                      >
                        {status}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">— not marked —</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">
                    {row.attendance ? SOURCE_LABEL[row.attendance.source] : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">
                    {row.attendance?.checkInTime
                      ? new Date(row.attendance.checkInTime).toLocaleTimeString()
                      : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as AttendanceStatus[]).map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() =>
                              markMutation.mutate({ studentId: row.studentId, status: st })
                            }
                            disabled={markMutation.isPending}
                            className={`rounded border px-2 py-0.5 text-xs hover:opacity-90 disabled:opacity-50 ${
                              status === st
                                ? STATUS_STYLE[st]
                                : 'border-slate-200 bg-white text-slate-600'
                            }`}
                          >
                            {st}
                          </button>
                        ),
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
