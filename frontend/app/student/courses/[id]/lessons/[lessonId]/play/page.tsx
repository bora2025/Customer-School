'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../../../components/AuthGuard'
import { apiFetch } from '../../../../../../../lib/api'
import { type H5PType, isH5PType, sanitizeH5PForPreview } from '../../../../../../../lib/h5pQuestionLogic'
import { EssayInput } from '../../../../../../../components/questions/EssayField'
import { SortParagraphsInput } from '../../../../../../../components/questions/SortParagraphsField'
import { DragWordsInput } from '../../../../../../../components/questions/DragWordsField'
import { FillBlanksInput } from '../../../../../../../components/questions/FillBlanksField'
import { DragDropInput } from '../../../../../../../components/questions/DragDropField'
import { SpeakWordsInput } from '../../../../../../../components/questions/SpeakWordsField'
import { SpeakWordsSetInput } from '../../../../../../../components/questions/SpeakWordsSetField'
import { DictationInput } from '../../../../../../../components/questions/DictationField'
import MathText from '../../../../../../../components/MathText'
import RichText from '../../../../../../../components/RichText'
import ProgressBar from '../../../../../../../components/ProgressBar'
import EmptyState from '../../../../../../../components/EmptyState'

type PageType = 'CONTENT' | 'QUESTION' | 'BRANCH'
type AttemptStatus = 'IN_PROGRESS' | 'COMPLETED' | 'AWAITING_GRADE' | 'ABANDONED'

interface LessonPage {
  id: string
  lessonId: string
  title: string
  pageType: PageType
  order: number
  content: any
  nextPageId: string | null
}

interface Attempt {
  id: string
  lessonId: string
  studentId: string
  status: AttemptStatus
  currentPageId: string | null
  score: number
  maxScore: number
  passed: boolean | null
  startedAt: string
  completedAt: string | null
}

interface SubmitResult {
  correct: boolean | null
  pointsAwarded: number | null
  nextPageId: string | null
  done: boolean
}

interface Lesson {
  id: string
  title: string
  description: string | null
  passingScore: number | null
  gradingMode?: 'GRADED' | 'PRACTICE' | 'UNGRADED'
  requireVideoWatch?: boolean
  videoWatchPct?: number
}

export default function LessonPlayPage() {
  const params = useParams<{ id: string; lessonId: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const courseId = params?.id as string
  const lessonId = params?.lessonId as string

  // Start (or resume) the attempt as soon as the page mounts.
  const startMutation = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(
        `/api/courses/lessons/${lessonId}/attempts/start`,
        { method: 'POST' },
      )
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to start lesson')
      }
      return r.json() as Promise<Attempt>
    },
  })

  useEffect(() => {
    if (lessonId && !startMutation.data && !startMutation.isPending && !startMutation.isError) {
      startMutation.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId])

  // Record that the student opened this lesson (for engagement report).
  useEffect(() => {
    if (!lessonId) return
    apiFetch(`/api/courses/lessons/${lessonId}/views/open`, { method: 'POST' }).catch(
      () => {},
    )
  }, [lessonId])

  const attempt = startMutation.data ?? null

  const {
    data: pages = [],
    isLoading: pagesLoading,
    isError: pagesError,
    error: pagesErrorObj,
  } = useQuery({
    queryKey: ['lesson-play-pages', lessonId],
    enabled: !!lessonId && !!attempt,
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/lessons/${lessonId}/pages`)
      if (!r.ok) throw new Error('Failed to load pages')
      return r.json() as Promise<LessonPage[]>
    },
  })

  const { data: course } = useQuery({
    queryKey: ['lesson-play-course', courseId],
    enabled: !!courseId,
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/${courseId}`)
      if (!r.ok) throw new Error('Failed to load course')
      return r.json() as Promise<{ lessons: Lesson[] }>
    },
  })
  const lesson = useMemo(
    () => course?.lessons?.find((l) => l.id === lessonId) || null,
    [course, lessonId],
  )

  const [currentPageId, setCurrentPageId] = useState<string | null>(null)
  useEffect(() => {
    if (!attempt || pages.length === 0) return
    // If we haven't picked a page yet, OR the page we picked no longer exists
    // (e.g. the teacher edited/deleted pages while this attempt was in progress),
    // fall back to the attempt's stored page or the first page in the lesson.
    const stillExists =
      currentPageId != null && pages.some((p) => p.id === currentPageId)
    if (stillExists) return
    const attemptPageExists =
      attempt.currentPageId != null &&
      pages.some((p) => p.id === attempt.currentPageId)
    setCurrentPageId(
      attemptPageExists ? attempt.currentPageId : pages[0].id,
    )
  }, [attempt, pages, currentPageId])

  const currentPage = useMemo(
    () => pages.find((p) => p.id === currentPageId) || null,
    [pages, currentPageId],
  )

  const [lastResult, setLastResult] = useState<SubmitResult | null>(null)
  const [finished, setFinished] = useState<Attempt | null>(null)
  const [teacherMsg, setTeacherMsg] = useState<string | null>(null)

  const submitMutation = useMutation({
    mutationFn: async (payload: { pageId: string; answer: any }) => {
      const r = await apiFetch(`/api/courses/attempts/${attempt!.id}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to submit')
      }
      return r.json() as Promise<SubmitResult>
    },
    onSuccess: (result) => {
      setLastResult(result)
    },
    onError: (e: any) => alert(e?.message || 'Failed to submit'),
  })

  const finishMutation = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/api/courses/attempts/${attempt!.id}/finish`, {
        method: 'POST',
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
        throw new Error(err?.message || 'Failed to finalize lesson')
      }
      return r.json() as Promise<Attempt>
    },
    onSuccess: (a) => {
      setFinished(a)
      qc.invalidateQueries({ queryKey: ['student-course', courseId] })
      qc.invalidateQueries({ queryKey: ['student-courses'] })
    },
    onError: (e: any) => setTeacherMsg(e?.message || 'Could not finish lesson'),
  })

  function handleNext() {
    if (!lastResult) return
    if (lastResult.done || !lastResult.nextPageId) {
      finishMutation.mutate()
    } else {
      setCurrentPageId(lastResult.nextPageId)
      setLastResult(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <AuthGuard allowedRoles={['STUDENT', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="mx-auto max-w-3xl min-h-screen p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/student/courses/${courseId}`}
            className="text-sm text-sky-600 hover:underline"
          >
            ← Back to course
          </Link>
          {lesson && (
            <div className="text-xs text-slate-500">
              {lesson.gradingMode === 'PRACTICE'
                ? 'Practice mode'
                : lesson.gradingMode === 'UNGRADED'
                  ? 'Ungraded'
                  : 'Graded'}
            </div>
          )}
        </div>

        {startMutation.isPending && (
          <div className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />
        )}
        {startMutation.isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {(startMutation.error as Error)?.message || 'Could not start lesson.'}
          </div>
        )}

        {attempt && pagesLoading && (
          <div className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />
        )}
        {attempt && pagesError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {(pagesErrorObj as Error)?.message || 'Failed to load lesson pages.'}
          </div>
        )}
        {attempt && !pagesLoading && !pagesError && pages.length === 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50">
            <EmptyState icon="📄" message="This lesson has no pages yet. Please contact your teacher." />
          </div>
        )}
        {attempt && pages.length > 0 && !currentPage && !finished && (
          <div className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />
        )}

        {teacherMsg && (
          <TeacherSaysModal
            message={teacherMsg}
            onClose={() => setTeacherMsg(null)}
            onBack={() => router.push(`/student/courses/${courseId}`)}
            onJumpToVideo={() => {
              const videoPage = pages.find(
                (p) =>
                  p.pageType === 'CONTENT' &&
                  p.content?.mediaUrl &&
                  (p.content?.mediaType === 'video' ||
                    p.content?.mediaType === 'embed'),
              )
              if (videoPage) {
                setCurrentPageId(videoPage.id)
                setLastResult(null)
              }
              setTeacherMsg(null)
            }}
          />
        )}

        {finished && (
          <ResultScreen
            attempt={finished}
            lesson={lesson}
            onReturn={() => router.push(`/student/courses/${courseId}`)}
          />
        )}

        {!finished && attempt && currentPage && (
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
            <ProgressBar
              pct={pages.length > 0 ? ((pages.findIndex((p) => p.id === currentPage.id) + 1) / pages.length) * 100 : 0}
              label={`Page ${pages.findIndex((p) => p.id === currentPage.id) + 1} of ${pages.length}`}
            />
            <h2 className="text-lg font-semibold text-gray-900">
              {currentPage.title}
            </h2>

            {currentPage.pageType === 'CONTENT' && (
              <ContentView content={currentPage.content} lessonId={lessonId} />
            )}
            {currentPage.pageType === 'QUESTION' && (
              <QuestionView
                page={currentPage}
                lastResult={lastResult}
                onSubmit={(answer) =>
                  submitMutation.mutate({ pageId: currentPage.id, answer })
                }
                submitting={submitMutation.isPending}
              />
            )}
            {currentPage.pageType === 'BRANCH' && (
              <BranchView
                page={currentPage}
                lastResult={lastResult}
                onSubmit={(answer) =>
                  submitMutation.mutate({ pageId: currentPage.id, answer })
                }
                submitting={submitMutation.isPending}
              />
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              {currentPage.pageType === 'CONTENT' && !lastResult && (
                <button
                  onClick={() =>
                    submitMutation.mutate({ pageId: currentPage.id, answer: {} })
                  }
                  disabled={submitMutation.isPending}
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  Continue
                </button>
              )}
              {lastResult && (
                <button
                  onClick={handleNext}
                  disabled={finishMutation.isPending}
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {lastResult.done || !lastResult.nextPageId
                    ? finishMutation.isPending
                      ? 'Finalizing…'
                      : 'Finish lesson'
                    : 'Next →'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}

// ─── Sub-views ────────────────────────────────────────────────────────

function TeacherSaysModal({
  message,
  onClose,
  onBack,
  onJumpToVideo,
}: {
  message: string
  onClose: () => void
  onBack: () => void
  onJumpToVideo: () => void
}) {
  const m = /current:\s*(\d+)%/i.exec(message)
  const current = m ? Number(m[1]) : null
  const r = /at least\s*(\d+)%/i.exec(message)
  const required = r ? Number(r[1]) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-amber-100 px-5 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-xl text-white">
            👩‍🏫
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Teacher says
            </div>
            <div className="text-sm font-semibold text-amber-900">
              Almost there — keep watching!
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-slate-700">{message}</p>

          {required != null && current != null && (
            <ProgressBar
              pct={(current / required) * 100}
              label={`Watched — ${current}% / ${required}%`}
              showPercent={false}
              color="bg-amber-500"
            />
          )}

          <ul className="space-y-1 text-xs text-slate-600">
            <li>• Scroll back to the video page and press play.</li>
            <li>• Your watched time is saved automatically.</li>
            <li>
              • Once you reach the required %, tap <strong>Finish</strong> again
              to complete the lesson.
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200"
          >
            ← Back to course
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onJumpToVideo}
              className="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"
            >
              ▶ Go to video
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ContentView({ content, lessonId }: { content: any; lessonId: string }) {
  const body = typeof content?.body === 'string' ? content.body : ''
  const mediaUrl = content?.mediaUrl as string | null | undefined
  const mediaType = content?.mediaType as string | null | undefined

  // Auto-detect YouTube / Vimeo URLs even if mediaType is "video" — they need
  // an iframe embed, not <video>. Returns a normalized embed URL or null.
  const embedUrl = mediaUrl ? toEmbedUrl(mediaUrl) : null
  const showAsEmbed =
    !!embedUrl && (mediaType === 'embed' || mediaType === 'video')

  // Throttled video progress reporter for native <video>.
  const lastSentRef = useRef(0)
  function handleTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget
    const now = Date.now()
    if (now - lastSentRef.current < 5000) return
    lastSentRef.current = now
    apiFetch(`/api/courses/lessons/${lessonId}/views/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        watchedSeconds: Math.floor(v.currentTime || 0),
        videoDurationSec: Number.isFinite(v.duration)
          ? Math.floor(v.duration)
          : undefined,
      }),
    }).catch(() => {})
  }
  function handleEnded(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget
    apiFetch(`/api/courses/lessons/${lessonId}/views/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        watchedSeconds: Math.floor(v.duration || v.currentTime || 0),
        videoDurationSec: Number.isFinite(v.duration)
          ? Math.floor(v.duration)
          : undefined,
      }),
    }).catch(() => {})
  }

  return (
    <div className="space-y-3">
      {mediaUrl && mediaType === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl} alt="" className="max-h-80 rounded-md" />
      )}
      {mediaUrl && mediaType === 'video' && !showAsEmbed && (
        <video
          src={mediaUrl}
          controls
          className="w-full rounded-md"
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />
      )}
      {showAsEmbed && (
        <div className="relative w-full overflow-hidden rounded-md border border-slate-200" style={{ paddingTop: '56.25%' }}>
          <iframe
            src={embedUrl!}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )}
      {mediaUrl && mediaType === 'embed' && !embedUrl && (
        <iframe
          src={mediaUrl}
          className="aspect-video w-full rounded-md border border-slate-200"
          allowFullScreen
        />
      )}
      <MathText as="div" className="whitespace-pre-wrap text-sm text-slate-700" text={body} />
    </div>
  )
}

/**
 * Normalize a user-pasted media URL into an embeddable iframe URL.
 * Supports YouTube (watch / youtu.be / shorts / already-embed) and Vimeo.
 * Returns null when the URL is not a known embeddable provider.
 */
function toEmbedUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')

    // youtu.be/<id>
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (id) return buildYouTubeEmbed(id, u)
    }
    // youtube.com / m.youtube.com / youtube-nocookie.com
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      // already an /embed/<id> URL
      if (u.pathname.startsWith('/embed/')) return url
      // /watch?v=<id>
      const v = u.searchParams.get('v')
      if (v) return buildYouTubeEmbed(v, u)
      // /shorts/<id> or /live/<id>
      const m = u.pathname.match(/^\/(shorts|live)\/([^/]+)/)
      if (m) return buildYouTubeEmbed(m[2], u)
    }
    // Vimeo: vimeo.com/<id> → player.vimeo.com/video/<id>
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`
    }
    if (host === 'player.vimeo.com') return url
  } catch {
    return null
  }
  return null
}

function buildYouTubeEmbed(id: string, src: URL): string {
  const params = new URLSearchParams()
  const t = src.searchParams.get('t') || src.searchParams.get('start')
  if (t) {
    const secs = parseYouTubeTime(t)
    if (secs > 0) params.set('start', String(secs))
  }
  const list = src.searchParams.get('list')
  if (list) params.set('list', list)
  const qs = params.toString()
  return `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ''}`
}

function parseYouTubeTime(t: string): number {
  // Accepts "90", "90s", "1m30s", "1h2m3s"
  if (/^\d+$/.test(t)) return Number(t)
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  if (!m) return 0
  const h = Number(m[1] || 0)
  const min = Number(m[2] || 0)
  const s = Number(m[3] || 0)
  return h * 3600 + min * 60 + s
}

function QuestionView({
  page,
  lastResult,
  onSubmit,
  submitting,
}: {
  page: LessonPage
  lastResult: SubmitResult | null
  onSubmit: (answer: any) => void
  submitting: boolean
}) {
  const c = page.content || {}
  const qt = c.questionType as
    | 'MCQ_SINGLE'
    | 'MCQ_MULTI'
    | 'TRUE_FALSE'
    | 'SHORT_ANSWER'
    | 'NUMERIC'
    | H5PType

  const [choiceId, setChoiceId] = useState<string | null>(null)
  const [choiceIds, setChoiceIds] = useState<string[]>([])
  const [bool, setBool] = useState<boolean | null>(null)
  const [text, setText] = useState('')
  const [num, setNum] = useState('')
  const [h5pValue, setH5pValue] = useState<any>(null)

  // Courses doesn't sanitize page.content server-side (pre-existing convention —
  // same as its other question types), but the drag/sort/drag-drop shared Input
  // components expect the same shuffled/blanked-out shape sanitizeH5PForPreview
  // produces for the exam preview modal. Memoized per page so the shuffle order
  // stays stable across re-renders while the student is answering.
  const safeH5PData = useMemo(
    () => (isH5PType(qt) ? sanitizeH5PForPreview(qt, c.data) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.id, qt],
  )

  const disabled = submitting || !!lastResult

  function buildAnswer(): any {
    if (isH5PType(qt)) return { h5pResponse: h5pValue }
    switch (qt) {
      case 'MCQ_SINGLE':
        return { choiceId }
      case 'MCQ_MULTI':
        return { choiceIds }
      case 'TRUE_FALSE':
        return { boolean: bool }
      case 'SHORT_ANSWER':
        return { text }
      case 'NUMERIC':
        return { number: Number(num) }
      default:
        return {}
    }
  }

  const ready = (() => {
    if (qt === 'ESSAY' || qt === 'SPEAK_WORDS' || qt === 'DICTATION') {
      return String(h5pValue || '').trim().length > 0
    }
    if (isH5PType(qt)) return true // SORT_PARAGRAPHS / DRAG_WORDS / DRAG_DROP / SPEAK_WORDS_SET support partial credit
    switch (qt) {
      case 'MCQ_SINGLE':
        return !!choiceId
      case 'MCQ_MULTI':
        return choiceIds.length > 0
      case 'TRUE_FALSE':
        return bool !== null
      case 'SHORT_ANSWER':
        return text.trim().length > 0
      case 'NUMERIC':
        return num !== '' && Number.isFinite(Number(num))
      default:
        return false
    }
  })()

  return (
    <div className="space-y-3">
      <RichText as="div" className="whitespace-pre-wrap text-sm text-slate-700" html={c.prompt} />

      {(qt === 'MCQ_SINGLE' || qt === 'MCQ_MULTI') && (
        <div className="space-y-1.5">
          {(c.choices || []).map((ch: any) => {
            const checked =
              qt === 'MCQ_SINGLE'
                ? choiceId === ch.id
                : choiceIds.includes(ch.id)
            return (
              <label
                key={ch.id}
                className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${
                  checked
                    ? 'border-sky-400 bg-sky-50'
                    : 'border-slate-200 hover:border-slate-300'
                } ${disabled ? 'opacity-70' : ''}`}
              >
                <input
                  type={qt === 'MCQ_SINGLE' ? 'radio' : 'checkbox'}
                  name="answer"
                  disabled={disabled}
                  checked={checked}
                  onChange={() => {
                    if (qt === 'MCQ_SINGLE') setChoiceId(ch.id)
                    else {
                      setChoiceIds((prev) =>
                        prev.includes(ch.id)
                          ? prev.filter((x) => x !== ch.id)
                          : [...prev, ch.id],
                      )
                    }
                  }}
                />
                <MathText as="span" text={ch.text} />
              </label>
            )
          })}
        </div>
      )}

      {qt === 'TRUE_FALSE' && (
        <div className="flex gap-2">
          {[
            { label: 'True', value: true },
            { label: 'False', value: false },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              disabled={disabled}
              onClick={() => setBool(opt.value)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                bool === opt.value
                  ? 'border-sky-400 bg-sky-50 text-sky-800'
                  : 'border-slate-200 text-slate-700 hover:border-slate-300'
              } disabled:opacity-70`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {qt === 'SHORT_ANSWER' && (
        <input
          type="text"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Your answer…"
        />
      )}

      {qt === 'NUMERIC' && (
        <input
          type="number"
          value={num}
          disabled={disabled}
          onChange={(e) => setNum(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Your answer (number)…"
        />
      )}

      {qt === 'ESSAY' && (
        <EssayInput data={c.data} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'SORT_PARAGRAPHS' && (
        <SortParagraphsInput data={safeH5PData} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'DRAG_WORDS' && (
        <DragWordsInput data={safeH5PData} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'FILL_BLANKS' && (
        <FillBlanksInput data={safeH5PData} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'DRAG_DROP' && (
        <DragDropInput data={safeH5PData} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'SPEAK_WORDS' && (
        <SpeakWordsInput data={c.data} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'SPEAK_WORDS_SET' && (
        <SpeakWordsSetInput data={c.data} value={h5pValue} onChange={setH5pValue} disabled={disabled} />
      )}
      {qt === 'DICTATION' && (
        <DictationInput data={c.data} value={h5pValue} onChange={setH5pValue} disabled={disabled} revealFeedback={disabled} />
      )}

      {!lastResult && (
        <button
          onClick={() => onSubmit(buildAnswer())}
          disabled={!ready || submitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit answer'}
        </button>
      )}

      {lastResult && (
        <Feedback result={lastResult} explanation={c.explanation} />
      )}
    </div>
  )
}

function BranchView({
  page,
  lastResult,
  onSubmit,
  submitting,
}: {
  page: LessonPage
  lastResult: SubmitResult | null
  onSubmit: (answer: any) => void
  submitting: boolean
}) {
  const c = page.content || {}
  const disabled = submitting || !!lastResult
  return (
    <div className="space-y-3">
      <RichText as="div" className="whitespace-pre-wrap text-sm text-slate-700" html={c.prompt} />
      <div className="space-y-2">
        {(c.choices || []).map((ch: any) => (
          <button
            key={ch.id}
            type="button"
            disabled={disabled}
            onClick={() => onSubmit({ choiceId: ch.id })}
            className="block w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-sky-400 hover:bg-sky-50 disabled:opacity-60"
          >
            {ch.text ? <MathText as="span" text={ch.text} /> : '(unnamed choice)'}
          </button>
        ))}
      </div>
    </div>
  )
}

function Feedback({
  result,
  explanation,
}: {
  result: SubmitResult
  explanation?: string
}) {
  if (result.correct === null) {
    if (result.pointsAwarded === null) {
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="font-semibold">Submitted — graded manually by your teacher</div>
        </div>
      )
    }
    return null
  }
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        result.correct
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      <div className="font-semibold">
        {result.correct ? '✓ Correct' : '✗ Incorrect'} · {result.pointsAwarded} pts
      </div>
      {explanation && (
        <MathText as="div" className="mt-1 whitespace-pre-wrap text-xs" text={explanation} />
      )}
    </div>
  )
}

function ResultScreen({
  attempt,
  lesson,
  onReturn,
}: {
  attempt: Attempt
  lesson: Lesson | null
  onReturn: () => void
}) {
  const pct =
    attempt.maxScore > 0
      ? Math.round((attempt.score / attempt.maxScore) * 100)
      : 0
  const awaitingGrade = attempt.status === 'AWAITING_GRADE'
  const ungraded = !awaitingGrade && (lesson?.gradingMode === 'UNGRADED' || attempt.passed === null)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4 text-center">
      <h2 className="text-2xl font-bold text-slate-800">
        {awaitingGrade ? 'Submitted' : 'Lesson complete'}
      </h2>
      {awaitingGrade && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          One or more of your answers need to be graded by your teacher before this lesson counts as complete.
        </div>
      )}
      {!awaitingGrade && !ungraded && (
        <>
          <div className="text-4xl font-extrabold text-slate-900">
            {attempt.score} / {attempt.maxScore}
          </div>
          <div className="text-sm text-slate-500">{pct}%</div>
          <div
            className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
              attempt.passed
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-rose-100 text-rose-800'
            }`}
          >
            {attempt.passed ? 'Passed' : 'Did not pass'}
          </div>
        </>
      )}
      {ungraded && (
        <div className="text-sm text-slate-600">
          Nice work! This lesson is ungraded.
        </div>
      )}
      <button
        onClick={onReturn}
        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
      >
        Back to course
      </button>
    </div>
  )
}
