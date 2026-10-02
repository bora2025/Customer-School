'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import AuthGuard from '../../../components/AuthGuard'
import EmptyState from '../../../components/EmptyState'
import { apiFetch } from '../../../lib/api'

type CourseStatus =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'ENROLLMENT'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'ARCHIVED'

interface StudentCourse {
  id: string
  title: string
  description: string | null
  category: string | null
  status: CourseStatus
  enrollmentOpen: boolean
  startDate: string | null
  endDate: string | null
  coverImageUrl: string | null
  class: { id: string; name: string; subject: string | null }
  createdBy: { id: string; name: string }
  enrollments: { id: string; studentId: string }[]
  _count: { lessons: number }
  updatedAt: string
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
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ENROLLMENT: 'Enrollment Open',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

export default function StudentCoursesPage() {
  const [filterStatus, setFilterStatus] = useState<'ALL' | CourseStatus>('ALL')
  const [search, setSearch] = useState('')

  const { data: courses = [], isLoading, isError, error } = useQuery({
    queryKey: ['student-courses'],
    queryFn: async () => {
      const r = await apiFetch('/api/courses/student/my-courses')
      if (!r.ok) throw new Error('Failed to load courses')
      return r.json() as Promise<StudentCourse[]>
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return courses.filter((c) => {
      if (filterStatus !== 'ALL' && c.status !== filterStatus) return false
      if (!q) return true
      return (
        c.title.toLowerCase().includes(q) ||
        (c.description?.toLowerCase().includes(q) ?? false) ||
        (c.category?.toLowerCase().includes(q) ?? false) ||
        c.class.name.toLowerCase().includes(q)
      )
    })
  }, [courses, filterStatus, search])

  return (
    <AuthGuard allowedRoles={['STUDENT', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">My Courses</h1>
            <p className="text-sm text-slate-500">
              Browse courses available to you, plus the ones you’re enrolled in.
            </p>
          </div>
          <Link
            href="/student"
            className="text-sm text-sky-600 hover:underline self-start sm:self-auto"
          >
            ← Back to dashboard
          </Link>
        </header>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Search title, class, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'ALL' | CourseStatus)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          >
            <option value="ALL">All statuses</option>
            <option value="PUBLISHED">Published</option>
            <option value="ENROLLMENT">Enrollment Open</option>
            <option value="ACTIVE">Active</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>

        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1,2,3].map(i => <div key={i} className="bg-white h-64 rounded-2xl animate-pulse border border-gray-100" />)}</div>
        )}

        {isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {(error as Error)?.message || 'Failed to load courses.'}
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
            <EmptyState icon="📖" message="No courses to show yet." />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const enrolled = (c.enrollments?.length ?? 0) > 0
            return (
              <Link
                key={c.id}
                href={`/student/courses/${c.id}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
              >
                {c.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.coverImageUrl}
                    alt={c.title}
                    className="h-32 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-32 items-center justify-center bg-gradient-to-br from-sky-100 to-violet-100 text-slate-400 text-sm">
                    {c.category || 'Course'}
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[c.status]}`}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                    {enrolled && (
                      <span className="inline-block rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        Enrolled
                      </span>
                    )}
                  </div>
                  <h2 className="font-semibold text-slate-800 group-hover:text-sky-600">
                    {c.title}
                  </h2>
                  {c.description && (
                    <p className="line-clamp-2 text-sm text-slate-600">{c.description}</p>
                  )}
                  <div className="mt-auto space-y-1 text-xs text-slate-500">
                    <div>
                      <span className="font-medium text-slate-600">Class:</span>{' '}
                      {c.class.name}
                      {c.class.subject ? ` · ${c.class.subject}` : ''}
                    </div>
                    <div>
                      <span className="font-medium text-slate-600">Teacher:</span>{' '}
                      {c.createdBy.name}
                    </div>
                    <div className="flex justify-between">
                      <span>{c._count.lessons} lesson{c._count.lessons === 1 ? '' : 's'}</span>
                      <span>{formatDate(c.startDate)} → {formatDate(c.endDate)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </AuthGuard>
  )
}
