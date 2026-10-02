"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../components/AuthGuard'
import ConfirmModal from '../../../../components/ConfirmModal'
import EmptyState from '../../../../components/EmptyState'
import { apiFetch } from '../../../../lib/api'
import { type H5PType, isH5PType, H5P_TYPE_LABEL, h5pDefaultData } from '../../../../lib/h5pQuestionLogic'
import { EssayEditor } from '../../../../components/questions/EssayField'
import { SortParagraphsEditor } from '../../../../components/questions/SortParagraphsField'
import { DragWordsEditor } from '../../../../components/questions/DragWordsField'
import { FillBlanksEditor } from '../../../../components/questions/FillBlanksField'
import { DragDropEditor } from '../../../../components/questions/DragDropField'
import { SpeakWordsEditor } from '../../../../components/questions/SpeakWordsField'
import { SpeakWordsSetEditor } from '../../../../components/questions/SpeakWordsSetField'
import { DictationEditor } from '../../../../components/questions/DictationField'
import RichTextEditor from '../../../../components/RichTextEditor'

type LessonStatus = 'DRAFT' | 'PUBLISHED'
type GradingMode = 'GRADED' | 'PRACTICE' | 'UNGRADED'
type PageType = 'CONTENT' | 'QUESTION' | 'BRANCH'
type QuestionType =
  | 'MCQ_SINGLE'
  | 'MCQ_MULTI'
  | 'TRUE_FALSE'
  | 'SHORT_ANSWER'
  | 'NUMERIC'
  | H5PType

interface Lesson {
  id: string
  courseId: string
  title: string
  description: string | null
  order: number
  status: LessonStatus
  gradingMode?: GradingMode
  showProgressBar: boolean
  branchingEnabled: boolean
  totalPoints: number
  passingScore: number | null
  requireVideoWatch?: boolean
  videoWatchPct?: number
  maxAttempts?: number
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
  status: string
  enrollmentOpen: boolean
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

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>()
  const courseId = params?.id as string
  const qc = useQueryClient()
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [showNewLesson, setShowNewLesson] = useState(false)
  const [confirmDeleteLesson, setConfirmDeleteLesson] = useState(false)

  const { data: course, isLoading } = useQuery({
    queryKey: ['course', courseId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}`)
      if (!r.ok) throw new Error('Failed to load course')
      return r.json() as Promise<Course>
    },
    enabled: !!courseId,
  })

  const selectedLesson = useMemo(
    () => course?.lessons.find((l) => l.id === selectedLessonId) || null,
    [course, selectedLessonId],
  )

  const createLessonMutation = useMutation({
    mutationFn: async (body: { title: string; description?: string }) => {
      const r = await apiFetch(`/api/courses/${courseId}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to create lesson')
      }
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', courseId] })
      setShowNewLesson(false)
    },
    onError: (e: any) => alert(e?.message || 'Failed to create lesson'),
  })

  const updateLessonMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => {
      const r = await apiFetch(`/api/courses/lessons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to update lesson')
      }
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course', courseId] }),
    onError: (e: any) => alert(e?.message || 'Failed to update lesson'),
  })

  const deleteLessonMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/api/courses/lessons/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete lesson')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', courseId] })
      setSelectedLessonId(null)
    },
  })

  if (isLoading) {
    return (
      <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
        <div className="p-8 text-center text-slate-500">Loading course…</div>
      </AuthGuard>
    )
  }
  if (!course) {
    return (
      <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
        <div className="p-8 text-center text-rose-600">Course not found.</div>
      </AuthGuard>
    )
  }

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-7xl px-4 py-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/teacher/courses"
                className="text-sm text-blue-600 hover:underline"
              >
                ← All Courses
              </Link>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Link
                href={`/teacher/courses/${courseId}/attendance`}
                className="text-sm rounded-md border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700 hover:bg-sky-100"
              >
                📋 Attendance
              </Link>
              <Link
                href={`/teacher/courses/${courseId}/engagement`}
                className="text-sm rounded-md border border-violet-200 bg-violet-50 px-3 py-1 text-violet-700 hover:bg-violet-100"
              >
                📊 Engagement
              </Link>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-slate-800">{course.title}</h1>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${STATUS_BADGES[course.status] || 'bg-slate-100 text-slate-700'}`}
                  >
                    {course.status}
                  </span>
                </div>
                <p className="text-sm text-slate-500">
                  {course.class.name}
                  {course.class.subject ? ` • ${course.class.subject}` : ''} • by{' '}
                  {course.createdBy.name}
                </p>
                {course.description && (
                  <p className="mt-2 max-w-2xl text-sm text-slate-700">
                    {course.description}
                  </p>
                )}
              </div>
              <div className="text-right text-sm text-slate-600">
                <div>📚 {course.lessons.length} lessons</div>
                <div>👥 {course._count.enrollments} enrolled</div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            {/* Lesson list */}
            <div
              className={`rounded-2xl bg-white border border-gray-100 p-4 shadow-sm lg:block ${
                selectedLessonId ? 'hidden' : 'block'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">Lessons</h2>
                <button
                  onClick={() => setShowNewLesson(true)}
                  className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  + Add
                </button>
              </div>

              {showNewLesson && (
                <NewLessonForm
                  onCancel={() => setShowNewLesson(false)}
                  onSubmit={(data) => createLessonMutation.mutate(data)}
                  pending={createLessonMutation.isPending}
                />
              )}

              {course.lessons.length === 0 ? (
                <div className="bg-gray-50 rounded-xl">
                  <EmptyState icon="📚" message="No lessons yet. Add the first one to get started." />
                </div>
              ) : (
                <ul className="space-y-1">
                  {course.lessons.map((l) => (
                    <li key={l.id}>
                      <button
                        onClick={() => setSelectedLessonId(l.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                          selectedLessonId === l.id
                            ? 'bg-blue-50 ring-1 ring-blue-300'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-800">
                            {l.order + 1}. {l.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {l._count.pages} page{l._count.pages === 1 ? '' : 's'}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            l.status === 'PUBLISHED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {l.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Lesson editor */}
            <div
              className={`rounded-2xl bg-white border border-gray-100 p-5 shadow-sm lg:block ${
                selectedLessonId ? 'block' : 'hidden lg:block'
              }`}
            >
              {!selectedLesson ? (
                <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-gray-400">
                  Select a lesson on the left to edit its pages.
                </div>
              ) : (
                <>
                <button
                  type="button"
                  onClick={() => setSelectedLessonId(null)}
                  className="mb-3 text-sm text-blue-600 hover:underline lg:hidden"
                >
                  ← Back to lessons
                </button>
                <LessonEditor
                  key={selectedLesson.id}
                  lesson={selectedLesson}
                  onSaveLesson={(body) =>
                    updateLessonMutation.mutate({ id: selectedLesson.id, body })
                  }
                  onDeleteLesson={() => setConfirmDeleteLesson(true)}
                />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDeleteLesson && selectedLesson && (
        <ConfirmModal
          title="Delete lesson?"
          message={`Delete lesson "${selectedLesson.title}"? All pages inside will be removed. This cannot be undone.`}
          confirmLabel="Delete lesson"
          danger
          pending={deleteLessonMutation.isPending}
          onCancel={() => setConfirmDeleteLesson(false)}
          onConfirm={() => { deleteLessonMutation.mutate(selectedLesson.id); setConfirmDeleteLesson(false) }}
        />
      )}
    </AuthGuard>
  )
}

// ─── New lesson inline form ───────────────────────────────────────────
function NewLessonForm({
  onSubmit,
  onCancel,
  pending,
}: {
  onSubmit: (data: { title: string; description?: string }) => void
  onCancel: () => void
  pending: boolean
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div className="mb-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Lesson title"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional description"
        rows={2}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
        >
          Cancel
        </button>
        <button
          disabled={pending || !title.trim()}
          onClick={() =>
            onSubmit({ title: title.trim(), description: description.trim() || undefined })
          }
          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add Lesson'}
        </button>
      </div>
    </div>
  )
}

// ─── Lesson editor with page CRUD ─────────────────────────────────────
function LessonEditor({
  lesson,
  onSaveLesson,
  onDeleteLesson,
}: {
  lesson: Lesson
  onSaveLesson: (body: any) => void
  onDeleteLesson: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(lesson.title)
  const [description, setDescription] = useState(lesson.description ?? '')
  const [status, setStatus] = useState<LessonStatus>(lesson.status)
  const [gradingMode, setGradingMode] = useState<GradingMode>(
    (lesson.gradingMode as GradingMode) || 'GRADED',
  )
  const [showProgressBar, setShowProgressBar] = useState(lesson.showProgressBar)
  const [branchingEnabled, setBranchingEnabled] = useState(lesson.branchingEnabled)
  const [passingScore, setPassingScore] = useState<string>(
    lesson.passingScore != null ? String(lesson.passingScore) : '',
  )
  const [requireVideoWatch, setRequireVideoWatch] = useState<boolean>(
    !!lesson.requireVideoWatch,
  )
  const [videoWatchPct, setVideoWatchPct] = useState<string>(
    String(lesson.videoWatchPct ?? 90),
  )
  const [limitAttempts, setLimitAttempts] = useState<boolean>((lesson.maxAttempts ?? 0) > 0)
  const [maxAttempts, setMaxAttempts] = useState<string>(
    String(lesson.maxAttempts && lesson.maxAttempts > 0 ? lesson.maxAttempts : 3),
  )
  const [newPageType, setNewPageType] = useState<PageType | null>(null)
  const [confirmDeletePage, setConfirmDeletePage] = useState<LessonPage | null>(null)

  const { data: pages = [], isLoading: pagesLoading } = useQuery({
    queryKey: ['lesson-pages', lesson.id],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/lessons/${lesson.id}/pages`)
      if (!r.ok) throw new Error('Failed to load pages')
      return r.json() as Promise<LessonPage[]>
    },
  })

  const createPageMutation = useMutation({
    mutationFn: async (body: any) => {
      const r = await apiFetch(`/api/courses/lessons/${lesson.id}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to create page')
      }
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lesson-pages', lesson.id] })
      qc.invalidateQueries({ queryKey: ['course', lesson.courseId] })
    },
    onError: (e: any) => alert(e?.message || 'Failed to create page'),
  })

  const updatePageMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => {
      const r = await apiFetch(`/api/courses/pages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to update page')
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lesson-pages', lesson.id] }),
  })

  const deletePageMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/api/courses/pages/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete page')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lesson-pages', lesson.id] })
      qc.invalidateQueries({ queryKey: ['course', lesson.courseId] })
    },
  })

  function saveSettings() {
    onSaveLesson({
      title: title.trim() || lesson.title,
      description: description.trim() || null,
      status,
      gradingMode,
      showProgressBar,
      branchingEnabled,
      passingScore: passingScore === '' ? null : Number(passingScore),
      requireVideoWatch,
      videoWatchPct: Math.max(1, Math.min(100, Number(videoWatchPct) || 90)),
      maxAttempts: limitAttempts ? Math.max(1, Number(maxAttempts) || 1) : 0,
    })
  }

  function addPage(pageType: PageType, title: string) {
    if (!title?.trim()) return
    const baseContent =
      pageType === 'CONTENT'
        ? { body: '', mediaUrl: null, mediaType: null }
        : pageType === 'QUESTION'
          ? {
              questionType: 'MCQ_SINGLE',
              prompt: '',
              points: 1,
              choices: [
                { id: 'c1', text: '' },
                { id: 'c2', text: '' },
              ],
              correctChoiceId: null,
            }
          : {
              prompt: '',
              choices: [
                { id: 'b1', text: '', nextPageId: null },
                { id: 'b2', text: '', nextPageId: null },
              ],
            }
    createPageMutation.mutate({ title: title.trim(), pageType, content: baseContent })
  }

  return (
    <div className="space-y-5">
      {/* Lesson settings */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Lesson settings
        </h3>

        {/* Basics */}
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-400">Basics</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LessonStatus)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>
          </div>
        </div>

        {/* Grading */}
        <div className="pt-4 border-t border-gray-100">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-400">Grading</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Grading mode
              </label>
              <select
                value={gradingMode}
                onChange={(e) => setGradingMode(e.target.value as GradingMode)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
              >
                <option value="GRADED">Graded</option>
                <option value="PRACTICE">Practice</option>
                <option value="UNGRADED">Ungraded</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Passing score
              </label>
              <input
                type="number"
                min={0}
                value={passingScore}
                onChange={(e) => setPassingScore(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Optional"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={showProgressBar}
                onChange={(e) => setShowProgressBar(e.target.checked)}
              />
              Show progress bar
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={limitAttempts}
                onChange={(e) => setLimitAttempts(e.target.checked)}
              />
              Limit number of attempts
            </label>
            {limitAttempts && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Max attempts
                </label>
                <input
                  type="number"
                  min={1}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            )}
            {!limitAttempts && (
              <p className="text-xs text-gray-400 self-center">Students can retake this lesson unlimited times.</p>
            )}
          </div>
        </div>

        {/* Branching & video */}
        <div className="pt-4 border-t border-gray-100">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-400">Branching & video</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={branchingEnabled}
                onChange={(e) => setBranchingEnabled(e.target.checked)}
              />
              Allow branching pages
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={requireVideoWatch}
                onChange={(e) => setRequireVideoWatch(e.target.checked)}
              />
              Require watching video before finishing
            </label>
            {requireVideoWatch && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Minimum watched %
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={videoWatchPct}
                  onChange={(e) => setVideoWatchPct(e.target.value)}
                  className="w-full sm:w-40 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Tracked for uploaded videos (HTML5). YouTube/Vimeo embeds cannot be
                  tracked automatically.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex justify-between">
          <button
            onClick={onDeleteLesson}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            Delete lesson
          </button>
          <button
            onClick={saveSettings}
            className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm"
          >
            Save settings
          </button>
        </div>
      </section>

      {/* Pages */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Pages
          </h3>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/teacher/courses/${lesson.courseId}/lessons/${lesson.id}/grading`}
              className="rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200"
            >
              📝 Grade pending
            </Link>
            <button
              onClick={() => setNewPageType('CONTENT')}
              className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              + Content
            </button>
            <button
              onClick={() => setNewPageType('QUESTION')}
              className="rounded-md bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200"
            >
              + Question
            </button>
            <button
              onClick={() => setNewPageType('BRANCH')}
              disabled={!branchingEnabled}
              className="rounded-md bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-200 disabled:opacity-40"
              title={branchingEnabled ? '' : 'Enable branching in lesson settings first'}
            >
              + Branch
            </button>
          </div>
        </div>

        {pagesLoading ? (
          <div className="space-y-2">{[1,2].map(i => <div key={i} className="bg-gray-50 h-14 rounded-xl animate-pulse" />)}</div>
        ) : pages.length === 0 ? (
          <div className="bg-gray-50 rounded-xl">
            <EmptyState icon="📄" message="No pages yet. Add a Content, Question or Branch page above." />
          </div>
        ) : (
          <ul className="space-y-2">
            {pages.map((p) => (
              <PageRow
                key={p.id}
                page={p}
                allPages={pages}
                onSave={(body) => updatePageMutation.mutate({ id: p.id, body })}
                onDelete={() => setConfirmDeletePage(p)}
                saving={
                  updatePageMutation.isPending &&
                  updatePageMutation.variables?.id === p.id
                }
              />
            ))}
          </ul>
        )}
      </section>

      {newPageType && (
        <NewPageModal
          pageType={newPageType}
          onCancel={() => setNewPageType(null)}
          onCreate={(title) => { addPage(newPageType, title); setNewPageType(null) }}
          pending={createPageMutation.isPending}
        />
      )}
      {confirmDeletePage && (
        <ConfirmModal
          title="Delete page?"
          message={`Delete page "${confirmDeletePage.title}"? This cannot be undone.`}
          confirmLabel="Delete page"
          danger
          pending={deletePageMutation.isPending}
          onCancel={() => setConfirmDeletePage(null)}
          onConfirm={() => { deletePageMutation.mutate(confirmDeletePage.id); setConfirmDeletePage(null) }}
        />
      )}
    </div>
  )
}

// ─── New page title modal (replaces window.prompt) ────────────────────
function NewPageModal({
  pageType, onCancel, onCreate, pending,
}: {
  pageType: PageType
  onCancel: () => void
  onCreate: (title: string) => void
  pending: boolean
}) {
  const [title, setTitle] = useState('')
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="text-lg font-bold text-gray-900 mb-1">New {PAGE_TYPE_LABEL[pageType]} page</h2>
        <p className="text-sm text-gray-500 mb-4">Give this page a title students will see in the lesson outline.</p>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && title.trim()) onCreate(title.trim()) }}
          placeholder="Page title"
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => title.trim() && onCreate(title.trim())}
            disabled={!title.trim() || pending}
            className="px-4 py-2 text-sm font-semibold rounded-xl text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 shadow-sm"
          >
            {pending ? 'Creating…' : 'Create page'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PageRow({
  page,
  allPages,
  onSave,
  onDelete,
  saving,
}: {
  page: LessonPage
  allPages: LessonPage[]
  onSave: (body: any) => void
  onDelete: () => void
  saving: boolean
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(page.title)
  const [content, setContent] = useState<any>(() => normalizeContent(page))

  return (
    <li className="rounded-md border border-slate-200">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left text-sm font-medium text-slate-800"
        >
          <span>{open ? '▾' : '▸'}</span>
          <span>{PAGE_TYPE_LABEL[page.pageType]}</span>
          <span>{page.title}</span>
        </button>
        <button
          onClick={onDelete}
          className="text-xs font-medium text-rose-600 hover:underline"
        >
          Delete
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>

          {page.pageType === 'CONTENT' && (
            <ContentEditor value={content} onChange={setContent} />
          )}
          {page.pageType === 'QUESTION' && (
            <QuestionEditor value={content} onChange={setContent} />
          )}
          {page.pageType === 'BRANCH' && (
            <BranchEditor
              value={content}
              onChange={setContent}
              otherPages={allPages.filter((p) => p.id !== page.id)}
            />
          )}

          <div className="flex justify-end">
            <button
              disabled={saving}
              onClick={() => onSave({ title: title.trim() || page.title, content })}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save page'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// ─── Per-type editors ─────────────────────────────────────────────────

function normalizeContent(page: LessonPage): any {
  const c =
    typeof page.content === 'object' && page.content !== null
      ? { ...page.content }
      : {}
  if (page.pageType === 'CONTENT') {
    return {
      body: typeof c.body === 'string' ? c.body : '',
      mediaUrl: c.mediaUrl ?? null,
      mediaType: c.mediaType ?? null,
    }
  }
  if (page.pageType === 'QUESTION') {
    const qt = String(c.questionType || 'MCQ_SINGLE').toUpperCase()
    const allowed = ['MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'SHORT_ANSWER', 'NUMERIC', 'ESSAY', 'SORT_PARAGRAPHS', 'DRAG_WORDS', 'DRAG_DROP', 'SPEAK_WORDS', 'SPEAK_WORDS_SET', 'DICTATION']
    const questionType = allowed.includes(qt) ? qt : 'MCQ_SINGLE'
    const base = {
      questionType,
      prompt: typeof c.prompt === 'string' ? c.prompt : '',
      explanation: c.explanation ?? '',
      points: Number.isFinite(Number(c.points)) ? Number(c.points) : 1,
      choices: Array.isArray(c.choices)
        ? c.choices.map((ch: any, i: number) => ({
            id: String(ch?.id ?? `c${i + 1}`),
            text: String(ch?.text ?? ''),
          }))
        : [
            { id: 'c1', text: '' },
            { id: 'c2', text: '' },
          ],
      correctChoiceId: c.correctChoiceId ?? null,
      correctChoiceIds: Array.isArray(c.correctChoiceIds)
        ? c.correctChoiceIds.map((s: any) => String(s))
        : [],
      correctAnswer: !!c.correctAnswer,
      acceptedAnswers: Array.isArray(c.acceptedAnswers)
        ? c.acceptedAnswers.map((s: any) => String(s))
        : [],
      caseSensitive: !!c.caseSensitive,
      correctValue: Number.isFinite(Number(c.correctValue)) ? Number(c.correctValue) : 0,
      tolerance: Number.isFinite(Number(c.tolerance)) ? Number(c.tolerance) : 0,
    }
    if (isH5PType(questionType)) {
      return { ...base, data: c.data && typeof c.data === 'object' ? c.data : h5pDefaultData(questionType) }
    }
    return base
  }
  // BRANCH
  return {
    prompt: typeof c.prompt === 'string' ? c.prompt : '',
    choices: Array.isArray(c.choices) && c.choices.length > 0
      ? c.choices.map((ch: any, i: number) => ({
          id: String(ch?.id ?? `b${i + 1}`),
          text: String(ch?.text ?? ''),
          nextPageId: ch?.nextPageId ?? null,
        }))
      : [
          { id: 'b1', text: '', nextPageId: null },
          { id: 'b2', text: '', nextPageId: null },
        ],
  }
}

function ContentEditor({
  value,
  onChange,
}: {
  value: any
  onChange: (v: any) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Body</label>
        <textarea
          value={value.body ?? ''}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          rows={6}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Lesson content (plain text or markdown)…"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Media URL (optional)
          </label>
          <input
            value={value.mediaUrl ?? ''}
            onChange={(e) =>
              onChange({ ...value, mediaUrl: e.target.value || null })
            }
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="https://…"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Media type
          </label>
          <select
            value={value.mediaType ?? ''}
            onChange={(e) =>
              onChange({ ...value, mediaType: e.target.value || null })
            }
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="embed">Embed</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function QuestionEditor({
  value,
  onChange,
}: {
  value: any
  onChange: (v: any) => void
}) {
  const qt: QuestionType = value.questionType

  function updateChoice(idx: number, patch: Partial<{ text: string }>) {
    const choices = [...(value.choices || [])]
    choices[idx] = { ...choices[idx], ...patch }
    onChange({ ...value, choices })
  }
  function addChoice() {
    const choices = [...(value.choices || [])]
    const id = `c${choices.length + 1}_${Math.random().toString(36).slice(2, 6)}`
    choices.push({ id, text: '' })
    onChange({ ...value, choices })
  }
  function removeChoice(idx: number) {
    const choices = [...(value.choices || [])]
    const [removed] = choices.splice(idx, 1)
    const next: any = { ...value, choices }
    if (next.correctChoiceId === removed?.id) next.correctChoiceId = null
    if (Array.isArray(next.correctChoiceIds)) {
      next.correctChoiceIds = next.correctChoiceIds.filter(
        (id: string) => id !== removed?.id,
      )
    }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Question type
          </label>
          <select
            value={qt}
            onChange={(e) => {
              const nextType = e.target.value as QuestionType
              onChange(
                isH5PType(nextType)
                  ? { ...value, questionType: nextType, data: h5pDefaultData(nextType) }
                  : { ...value, questionType: nextType },
              )
            }}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="MCQ_SINGLE">Multiple choice (single)</option>
            <option value="MCQ_MULTI">Multiple choice (multi)</option>
            <option value="TRUE_FALSE">True / False</option>
            <option value="SHORT_ANSWER">Short answer</option>
            <option value="NUMERIC">Numeric</option>
            {(Object.keys(H5P_TYPE_LABEL) as H5PType[]).map((t) => (
              <option key={t} value={t}>{H5P_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Points</label>
          <input
            type="number"
            min={0}
            value={value.points ?? 1}
            onChange={(e) => onChange({ ...value, points: Number(e.target.value) })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Prompt</label>
        <RichTextEditor
          value={value.prompt ?? ''}
          onChange={(prompt) => onChange({ ...value, prompt })}
          placeholder="Question prompt"
        />
      </div>

      {(qt === 'MCQ_SINGLE' || qt === 'MCQ_MULTI') && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-600">Choices</label>
          {(value.choices || []).map((ch: any, idx: number) => {
            const isCorrect =
              qt === 'MCQ_SINGLE'
                ? value.correctChoiceId === ch.id
                : Array.isArray(value.correctChoiceIds) &&
                  value.correctChoiceIds.includes(ch.id)
            return (
              <div key={ch.id} className="flex items-center gap-2">
                <input
                  type={qt === 'MCQ_SINGLE' ? 'radio' : 'checkbox'}
                  name="correct"
                  checked={isCorrect}
                  onChange={() => {
                    if (qt === 'MCQ_SINGLE') {
                      onChange({ ...value, correctChoiceId: ch.id })
                    } else {
                      const set = new Set<string>(value.correctChoiceIds || [])
                      if (set.has(ch.id)) set.delete(ch.id)
                      else set.add(ch.id)
                      onChange({ ...value, correctChoiceIds: Array.from(set) })
                    }
                  }}
                />
                <input
                  value={ch.text}
                  onChange={(e) => updateChoice(idx, { text: e.target.value })}
                  placeholder={`Choice ${idx + 1}`}
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeChoice(idx)}
                  className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                >
                  ✕
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={addChoice}
            className="mt-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            + Add choice
          </button>
          <p className="text-[11px] text-slate-500">
            {qt === 'MCQ_SINGLE'
              ? 'Tick the single correct choice.'
              : 'Tick every correct choice (all required, no extras).'}
          </p>
        </div>
      )}

      {qt === 'TRUE_FALSE' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Correct answer
          </label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={value.correctAnswer === true}
                onChange={() => onChange({ ...value, correctAnswer: true })}
              />
              True
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={value.correctAnswer === false}
                onChange={() => onChange({ ...value, correctAnswer: false })}
              />
              False
            </label>
          </div>
        </div>
      )}

      {qt === 'SHORT_ANSWER' && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Accepted answers (one per line)
            </label>
            <textarea
              value={(value.acceptedAnswers || []).join('\n')}
              onChange={(e) =>
                onChange({
                  ...value,
                  acceptedAnswers: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={!!value.caseSensitive}
              onChange={(e) => onChange({ ...value, caseSensitive: e.target.checked })}
            />
            Case sensitive
          </label>
        </div>
      )}

      {qt === 'NUMERIC' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Correct value
            </label>
            <input
              type="number"
              value={value.correctValue ?? 0}
              onChange={(e) =>
                onChange({ ...value, correctValue: Number(e.target.value) })
              }
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Tolerance (±)
            </label>
            <input
              type="number"
              min={0}
              value={value.tolerance ?? 0}
              onChange={(e) =>
                onChange({ ...value, tolerance: Number(e.target.value) })
              }
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      )}

      {qt === 'ESSAY' && (
        <EssayEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'SORT_PARAGRAPHS' && (
        <SortParagraphsEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'DRAG_WORDS' && (
        <DragWordsEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'FILL_BLANKS' && (
        <FillBlanksEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'DRAG_DROP' && (
        <DragDropEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'SPEAK_WORDS' && (
        <SpeakWordsEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'SPEAK_WORDS_SET' && (
        <SpeakWordsSetEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}
      {qt === 'DICTATION' && (
        <DictationEditor data={value.data} onChange={(d) => onChange({ ...value, data: d })} />
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Explanation (shown after answering)
        </label>
        <textarea
          value={value.explanation ?? ''}
          onChange={(e) => onChange({ ...value, explanation: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
    </div>
  )
}

function BranchEditor({
  value,
  onChange,
  otherPages,
}: {
  value: any
  onChange: (v: any) => void
  otherPages: LessonPage[]
}) {
  function updateChoice(idx: number, patch: Partial<{ text: string; nextPageId: string | null }>) {
    const choices = [...(value.choices || [])]
    choices[idx] = { ...choices[idx], ...patch }
    onChange({ ...value, choices })
  }
  function addChoice() {
    const choices = [...(value.choices || [])]
    const id = `b${choices.length + 1}_${Math.random().toString(36).slice(2, 6)}`
    choices.push({ id, text: '', nextPageId: null })
    onChange({ ...value, choices })
  }
  function removeChoice(idx: number) {
    const choices = [...(value.choices || [])]
    choices.splice(idx, 1)
    onChange({ ...value, choices })
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Prompt</label>
        <RichTextEditor
          value={value.prompt ?? ''}
          onChange={(prompt) => onChange({ ...value, prompt })}
          placeholder="Question prompt"
        />
      </div>
      <label className="block text-xs font-medium text-slate-600">
        Choices → next page
      </label>
      {(value.choices || []).map((ch: any, idx: number) => (
        <div key={ch.id} className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
          <input
            value={ch.text}
            onChange={(e) => updateChoice(idx, { text: e.target.value })}
            placeholder={`Choice ${idx + 1}`}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <select
            value={ch.nextPageId ?? ''}
            onChange={(e) =>
              updateChoice(idx, { nextPageId: e.target.value || null })
            }
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— next in order —</option>
            {otherPages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.order + 1}. {p.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => removeChoice(idx)}
            className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addChoice}
        className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        + Add choice
      </button>
    </div>
  )
}
