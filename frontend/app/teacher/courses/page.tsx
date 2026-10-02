"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../components/AuthGuard'
import StatCard from '../../../components/StatCard'
import EmptyState from '../../../components/EmptyState'
import { apiFetch } from '../../../lib/api'

// ─── Types ──────────────────────────────────────────────────────────────
type CourseStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'ENROLLMENT'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'ARCHIVED'

interface Course {
  id: string
  title: string
  description: string | null
  category: string | null
  status: CourseStatus
  enrollmentOpen: boolean
  startDate: string | null
  endDate: string | null
  publishedAt: string | null
  archivedAt: string | null
  completedAt: string | null
  coverImageUrl: string | null
  class: { id: string; name: string; subject: string | null }
  createdBy: { id: string; name: string }
  _count: { lessons: number; enrollments: number }
  createdAt: string
  updatedAt: string
}

interface ClassItem {
  id: string
  name: string
  subject: string | null
}

// Allowed forward transitions (mirrors backend)
const NEXT_BY_STATUS: Record<CourseStatus, CourseStatus[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ENROLLMENT', 'DRAFT', 'ARCHIVED'],
  ENROLLMENT: ['ACTIVE', 'PUBLISHED', 'ARCHIVED'],
  ACTIVE: ['COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
}

const STATUS_BADGES: Record<CourseStatus, string> = {
  DRAFT: 'bg-slate-200 text-slate-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ENROLLMENT: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-violet-100 text-violet-700',
  COMPLETED: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-rose-100 text-rose-700',
}

const STATUS_LABEL: Record<CourseStatus, string> = {
  DRAFT: '1. Draft',
  PUBLISHED: '2. Published',
  ENROLLMENT: '3. Enrollment',
  ACTIVE: '4. Active',
  COMPLETED: '5. Completed',
  ARCHIVED: '6. Archived',
}

const STATUS_TILE_COLOR: Record<CourseStatus, string> = {
  DRAFT: 'bg-slate-100', PUBLISHED: 'bg-emerald-100', ENROLLMENT: 'bg-sky-100',
  ACTIVE: 'bg-violet-100', COMPLETED: 'bg-amber-100', ARCHIVED: 'bg-rose-100',
}
const STATUS_ICON_COLOR: Record<CourseStatus, string> = {
  DRAFT: 'text-slate-600', PUBLISHED: 'text-emerald-600', ENROLLMENT: 'text-sky-600',
  ACTIVE: 'text-violet-600', COMPLETED: 'text-amber-600', ARCHIVED: 'text-rose-600',
}
const STATUS_ICON_PATH: Record<CourseStatus, string> = {
  DRAFT: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  PUBLISHED: 'M13 10V3L4 14h7v7l9-11h-7z',
  ENROLLMENT: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z',
  ACTIVE: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  COMPLETED: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  ARCHIVED: 'M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
}

const STATUS_ACTION_LABEL: Record<CourseStatus, string> = {
  DRAFT: 'Back to Draft',
  PUBLISHED: 'Publish',
  ENROLLMENT: 'Open Enrollment',
  ACTIVE: 'Start Course',
  COMPLETED: 'Mark Completed',
  ARCHIVED: 'Archive',
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
  category?: string
  classId: string
  coverImageUrl?: string
  startDate?: string
  endDate?: string
}

export default function TeacherCoursesPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Course | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | CourseStatus>('ALL')
  const [filterClass, setFilterClass] = useState<string>('ALL')
  const [search, setSearch] = useState('')

  const { data: courses = [], isLoading, isError } = useQuery({
    queryKey: ['teacher-courses'],
    queryFn: async () => {
      const r = await apiFetch('/api/courses')
      if (!r.ok) throw new Error('Failed to load courses')
      return r.json() as Promise<Course[]>
    },
  })
  const { data: classes = [] } = useQuery({
    queryKey: ['teacher-my-classes'],
    queryFn: async () => {
      const r = await apiFetch('/api/classes?teacherId=me')
      if (!r.ok) throw new Error('Failed to load classes')
      return r.json() as Promise<ClassItem[]>
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (data: FormShape & { id?: string }) => {
      const url = data.id ? `/api/courses/${data.id}` : '/api/courses'
      const method = data.id ? 'PUT' : 'POST'
      const { id, ...payload } = data
      const r = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          startDate: payload.startDate ? new Date(payload.startDate).toISOString() : null,
          endDate: payload.endDate ? new Date(payload.endDate).toISOString() : null,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to save course')
      }
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-courses'] })
      closeForm()
    },
    onError: (e: any) => setFormError(e?.message || 'Failed to save course'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/api/courses/${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to delete course')
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-courses'] }),
  })

  const transitionMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CourseStatus }) => {
      const r = await apiFetch(`/api/courses/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to update status')
      }
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-courses'] }),
    onError: (e: any) => alert(e?.message || 'Failed to update status'),
  })

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<FormShape>()

  function openCreate() {
    setEditing(null)
    reset({
      title: '',
      description: '',
      category: '',
      classId: '',
      coverImageUrl: '',
      startDate: '',
      endDate: '',
    })
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(c: Course) {
    setEditing(c)
    reset({
      id: c.id,
      title: c.title,
      description: c.description ?? '',
      category: c.category ?? '',
      classId: c.class.id,
      coverImageUrl: c.coverImageUrl ?? '',
      startDate: toDatetimeLocalInput(c.startDate),
      endDate: toDatetimeLocalInput(c.endDate),
    })
    setFormError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setFormError(null)
    reset()
  }

  const onSubmit = async (data: FormShape) => {
    if (!data.title?.trim()) {
      setFormError('Title is required')
      return
    }
    if (!data.classId) {
      setFormError('Please choose a class')
      return
    }
    setFormError(null)
    try {
      await saveMutation.mutateAsync({
        ...data,
        ...(editing ? { id: editing.id } : {}),
      })
    } catch {
      /* surfaced */
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return courses.filter((c) => {
      if (filterStatus !== 'ALL' && c.status !== filterStatus) return false
      if (filterClass !== 'ALL' && c.class.id !== filterClass) return false
      if (q && !c.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [courses, search, filterStatus, filterClass])

  // Group by lifecycle stage for an at-a-glance kanban-style summary
  const byStatus = useMemo(() => {
    const counts: Record<CourseStatus, number> = {
      DRAFT: 0, PUBLISHED: 0, ENROLLMENT: 0, ACTIVE: 0, COMPLETED: 0, ARCHIVED: 0,
    }
    for (const c of courses) counts[c.status] = (counts[c.status] || 0) + 1
    return counts
  }, [courses])

  return (
    <AuthGuard requiredRole="TEACHER">
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Courses</h1>
              <p className="text-sm text-slate-500">
                Create and manage LMS courses for your classes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/teacher"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ← Dashboard
              </Link>
              <button
                onClick={openCreate}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                + New Course
              </button>
            </div>
          </div>

          {/* Lifecycle summary strip */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(STATUS_LABEL) as CourseStatus[]).map((s) => (
              <StatCard
                key={s}
                label={STATUS_LABEL[s]}
                value={byStatus[s]}
                decimals={0}
                prefix=""
                color={STATUS_TILE_COLOR[s]}
                active={filterStatus === s}
                onClick={() => setFilterStatus(filterStatus === s ? 'ALL' : s)}
                icon={<svg className={`w-5 h-5 ${STATUS_ICON_COLOR[s]}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={STATUS_ICON_PATH[s]}/></svg>}
              />
            ))}
          </div>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title…"
              className="flex-1 min-w-[180px] rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="ALL">All Classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="ALL">All Statuses</option>
              {(Object.keys(STATUS_LABEL) as CourseStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1,2,3].map(i => <div key={i} className="bg-white h-40 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : isError ? (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-rose-700">
              Failed to load courses.
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm">
              <EmptyState icon="📖" message="No courses match your filters. Click + New Course to get started." />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  onEdit={() => openEdit(c)}
                  onDelete={() => {
                    if (confirm(`Delete course "${c.title}"? This cannot be undone.`)) {
                      deleteMutation.mutate(c.id)
                    }
                  }}
                  onTransition={(status) =>
                    transitionMutation.mutate({ id: c.id, status })
                  }
                  transitioning={
                    transitionMutation.isPending &&
                    transitionMutation.variables?.id === c.id
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Modal form */}
        {showForm && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <h2 className="text-lg font-semibold text-slate-800">
                  {editing ? 'Edit Course' : 'Create New Course'}
                </h2>
                <button
                  onClick={closeForm}
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
                {formError && (
                  <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {formError}
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Title *
                  </label>
                  <input
                    {...register('title', { required: true })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. Khmer Literature 101"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Class *
                    </label>
                    <select
                      {...register('classId', { required: true })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">— Choose class —</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.subject ? ` (${c.subject})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Category
                    </label>
                    <input
                      {...register('category')}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="e.g. Science, Math"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Description
                  </label>
                  <textarea
                    {...register('description')}
                    rows={3}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Short summary visible to students."
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Start Date
                    </label>
                    <input
                      type="datetime-local"
                      {...register('startDate')}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      End Date
                    </label>
                    <input
                      type="datetime-local"
                      {...register('endDate')}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Cover Image URL
                  </label>
                  <input
                    {...register('coverImageUrl')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="https://…"
                  />
                </div>

                {!editing && (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    New courses start in <b>Draft</b>. Add lessons, then publish from the
                    course card to make it visible to students.
                  </div>
                )}

                <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || saveMutation.isPending}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Draft'}
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

// ─── Course card ───────────────────────────────────────────────────────
function CourseCard({
  course,
  onEdit,
  onDelete,
  onTransition,
  transitioning,
}: {
  course: Course
  onEdit: () => void
  onDelete: () => void
  onTransition: (next: CourseStatus) => void
  transitioning: boolean
}) {
  const nextStates = NEXT_BY_STATUS[course.status] || []
  return (
    <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-gray-900">
            {course.title}
          </h3>
          <p className="truncate text-xs text-gray-500">
            {course.class.name}
            {course.class.subject ? ` • ${course.class.subject}` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${STATUS_BADGES[course.status]}`}
        >
          {STATUS_LABEL[course.status]}
        </span>
      </div>

      {course.description && (
        <p className="mb-3 line-clamp-2 text-sm text-gray-600">{course.description}</p>
      )}

      <div className="mb-3 flex items-center gap-3 text-xs text-gray-500">
        <span>📚 {course._count.lessons} lessons</span>
        <span>👥 {course._count.enrollments} enrolled</span>
        {course.enrollmentOpen && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-700">
            Enrolling
          </span>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <Link
          href={`/teacher/courses/${course.id}`}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
        >
          Open
        </Link>
        <button
          onClick={onEdit}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
        >
          Edit
        </button>
        {nextStates.map((next) => (
          <button
            key={next}
            onClick={() => onTransition(next)}
            disabled={transitioning}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {STATUS_ACTION_LABEL[next]}
          </button>
        ))}
        <button
          onClick={onDelete}
          className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
