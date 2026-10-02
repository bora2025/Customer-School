'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueries } from '@tanstack/react-query'
import AuthGuard from '../../../../components/AuthGuard'
import EmptyState from '../../../../components/EmptyState'
import { apiFetch } from '../../../../lib/api'

type LessonStatus = 'DRAFT' | 'PUBLISHED'
type PageType = 'CONTENT' | 'QUESTION' | 'BRANCH'

interface Lesson {
  id: string
  courseId: string
  title: string
  description: string | null
  order: number
  status: LessonStatus
  totalPoints: number
  passingScore: number | null
  publishedAt: string | null
  _count: { pages: number }
}

interface LessonPage {
  id: string
  lessonId: string
  title: string
  pageType: PageType
  order: number
  content: any
  nextPageId: string | null
}

interface Course {
  id: string
  title: string
  description: string | null
  category: string | null
  status: string
  startDate: string | null
  endDate: string | null
  coverImageUrl: string | null
  class: { id: string; name: string; subject: string | null }
  createdBy: { id: string; name: string }
  lessons: Lesson[]
  _count: { enrollments: number }
}

const STATUS_BADGES: Record<string, string> = {
  DRAFT: 'bg-slate-200 text-slate-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  ENROLLMENT: 'bg-sky-100 text-sky-700',
  ACTIVE: 'bg-violet-100 text-violet-700',
  COMPLETED: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-rose-100 text-rose-700',
}

const PAGE_TYPE_LABEL: Record<PageType, string> = {
  CONTENT: '📄 Content',
  QUESTION: '❓ Question',
  BRANCH: '🔀 Branch',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

export default function StudentCourseDetailPage() {
  const params = useParams<{ id: string }>()
  const courseId = params?.id as string
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)

  const { data: course, isLoading, isError, error } = useQuery({
    queryKey: ['student-course', courseId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}`)
      if (!r.ok) throw new Error('Failed to load course')
      return r.json() as Promise<Course>
    },
    enabled: !!courseId,
  })

  const visibleLessons = useMemo(
    () => (course?.lessons || []).filter((l) => l.status === 'PUBLISHED'),
    [course],
  )

  // Fetch each visible lesson's attempt status in parallel so the list can show
  // at-a-glance completion — reuses the same endpoint the lesson player itself
  // calls, no new backend work needed.
  const attemptQueries = useQueries({
    queries: visibleLessons.map((l) => ({
      queryKey: ['lesson-attempt-status', l.id],
      queryFn: async () => {
        const r = await apiFetch(`/api/courses/lessons/${l.id}/my-attempt`)
        if (!r.ok) return null
        return r.json() as Promise<{ status: string; passed: boolean | null } | null>
      },
    })),
  })
  const attemptByLessonId = useMemo(() => {
    const map = new Map<string, { status: string; passed: boolean | null } | null>()
    visibleLessons.forEach((l, i) => map.set(l.id, attemptQueries[i]?.data ?? null))
    return map
  }, [visibleLessons, attemptQueries])

  const selectedLesson = useMemo(
    () => visibleLessons.find((l) => l.id === selectedLessonId) || null,
    [visibleLessons, selectedLessonId],
  )

  const { data: pages = [], isLoading: pagesLoading } = useQuery({
    queryKey: ['student-lesson-pages', selectedLessonId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/lessons/${selectedLessonId}/pages`)
      if (!r.ok) throw new Error('Failed to load pages')
      return r.json() as Promise<LessonPage[]>
    },
    enabled: !!selectedLessonId,
  })

  return (
    <AuthGuard allowedRoles={['STUDENT', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/student/courses"
            className="text-sm text-sky-600 hover:underline"
          >
            ← All courses
          </Link>
          <Link
            href={`/student/courses/${courseId}/attendance`}
            className="text-sm rounded-md border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 hover:bg-sky-100"
          >
            📋 Attendance
          </Link>
        </div>

        {isLoading && (
          <div className="bg-white h-40 rounded-2xl animate-pulse border border-gray-100" />
        )}

        {isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {(error as Error)?.message || 'Failed to load course.'}
          </div>
        )}

        {course && (
          <>
            <header className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {course.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={course.coverImageUrl}
                  alt={course.title}
                  className="h-48 w-full object-cover"
                />
              )}
              <div className="space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[course.status] || 'bg-slate-100 text-slate-700'}`}
                  >
                    {course.status}
                  </span>
                  {course.category && (
                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {course.category}
                    </span>
                  )}
                </div>
                <h1 className="text-2xl font-bold text-slate-800">{course.title}</h1>
                {course.description && (
                  <p className="text-sm text-slate-600">{course.description}</p>
                )}
                <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                  <div>
                    <span className="font-medium text-slate-600">Class:</span>{' '}
                    {course.class.name}
                    {course.class.subject ? ` · ${course.class.subject}` : ''}
                  </div>
                  <div>
                    <span className="font-medium text-slate-600">Teacher:</span>{' '}
                    {course.createdBy.name}
                  </div>
                  <div>
                    <span className="font-medium text-slate-600">Dates:</span>{' '}
                    {formatDate(course.startDate)} → {formatDate(course.endDate)}
                  </div>
                </div>
              </div>
            </header>

            <div className="grid gap-4 lg:grid-cols-3">
              <aside
                className={`space-y-2 lg:col-span-1 lg:block ${
                  selectedLessonId ? 'hidden' : 'block'
                }`}
              >
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Lessons ({visibleLessons.length})
                </h2>
                {visibleLessons.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-white">
                    <EmptyState message="No lessons published yet." />
                  </div>
                )}
                <ul className="space-y-1.5">
                  {visibleLessons.map((l) => {
                    const active = l.id === selectedLessonId
                    const attempt = attemptByLessonId.get(l.id)
                    const badge =
                      attempt?.status === 'COMPLETED'
                        ? { label: attempt.passed === false ? 'Completed' : '✓ Completed', color: 'bg-emerald-100 text-emerald-700' }
                        : attempt?.status === 'AWAITING_GRADE'
                          ? { label: '⏱ Awaiting grade', color: 'bg-amber-100 text-amber-700' }
                          : attempt?.status === 'IN_PROGRESS'
                            ? { label: '● In progress', color: 'bg-sky-100 text-sky-700' }
                            : null
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedLessonId(l.id)}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                            active
                              ? 'border-sky-400 bg-sky-50 text-sky-800'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium truncate">
                              {l.order}. {l.title}
                            </div>
                            {badge && (
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${badge.color}`}>{badge.label}</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {l._count.pages} page{l._count.pages === 1 ? '' : 's'} ·{' '}
                            {l.totalPoints} pts
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </aside>

              <section
                className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2 lg:block ${
                  selectedLessonId ? 'block' : 'hidden lg:block'
                }`}
              >
                {!selectedLesson && (
                  <div className="text-sm text-slate-500">
                    Select a lesson to view its pages.
                  </div>
                )}
                {selectedLesson && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setSelectedLessonId(null)}
                      className="text-sm text-sky-600 hover:underline lg:hidden"
                    >
                      ← Back to lessons
                    </button>
                    <div className="sticky top-0 -mx-5 -mt-5 mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/95 px-5 py-3 backdrop-blur lg:static lg:mx-0 lg:mt-0 lg:border-0 lg:p-0">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-slate-800 sm:text-lg">
                          {selectedLesson.title}
                        </h3>
                        <div className="text-xs text-slate-500">
                          {selectedLesson._count.pages} page
                          {selectedLesson._count.pages === 1 ? '' : 's'} ·{' '}
                          {selectedLesson.totalPoints} pts
                        </div>
                      </div>
                      <Link
                        href={`/student/courses/${courseId}/lessons/${selectedLesson.id}/play`}
                        className="shrink-0 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-sky-700"
                      >
                        ▶ Start lesson
                      </Link>
                    </div>
                    {selectedLesson.description && (
                      <p className="text-sm text-slate-600">
                        {selectedLesson.description}
                      </p>
                    )}

                    {pagesLoading && (
                      <div className="text-sm text-slate-500">Loading pages…</div>
                    )}

                    {!pagesLoading && pages.length === 0 && (
                      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                        This lesson has no pages yet.
                      </div>
                    )}

                    <ol className="space-y-2">
                      {pages.map((p) => (
                        <li
                          key={p.id}
                          className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-slate-800">
                              {p.order}. {p.title}
                            </div>
                            <span className="text-xs text-slate-500">
                              {PAGE_TYPE_LABEL[p.pageType]}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            </div>

            {/* Mobile floating Start button when a lesson is selected. */}
            {selectedLesson && (
              <div className="fixed inset-x-0 bottom-3 z-30 flex justify-center px-4 lg:hidden">
                <Link
                  href={`/student/courses/${courseId}/lessons/${selectedLesson.id}/play`}
                  className="flex items-center gap-2 rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-sky-700"
                >
                  ▶ Start lesson
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  )
}
