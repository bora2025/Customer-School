"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useRouter, useParams } from 'next/navigation'
import AuthGuard from '../../../../components/AuthGuard'
import { apiFetch } from '../../../../lib/api'
import { QuestionInput } from '../../../../components/ExamQuestionInput'
import RichText from '../../../../components/RichText'
import ProgressBar from '../../../../components/ProgressBar'
import SectionPager from '../../../../components/SectionPager'
import { groupQuestionsBySection, type QType } from '../../../../lib/examQuestionLogic'

interface Question { id: string; text: string; type: QType; marks: number; order: number; section?: string | null; data: any }
interface ExamDetail { id: string; title: string; duration: number; totalMarks: number; passMark: number; questions: Question[] }
interface Attempt { id: string; status: string; startedAt: string; answers?: Record<string, any> | null }

function formatTime(secs: number) {
  return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`
}

/** Owns the second-by-second countdown itself, so ticking only re-renders this
 * small header widget — not the whole exam page (questions, audio players,
 * drag-and-drop inputs, etc.) every single second. `onExpire`/`onTick` are read
 * fresh from props each time the internal tick fires, so the parent doesn't need
 * to memoize them; it just reacts to being called (submit on expiry, autosave
 * every 30s) without needing to hold the ticking value in its own state. */
function ExamCountdown({ initialSeconds, onExpire, onTick }: { initialSeconds: number; onExpire: () => void; onTick: (secondsLeft: number) => void }) {
  const [timeLeft, setTimeLeft] = useState(initialSeconds)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  const onTickRef = useRef(onTick)
  onExpireRef.current = onExpire
  onTickRef.current = onTick

  useEffect(() => {
    onTickRef.current(timeLeft)
    if (timeLeft <= 0) {
      if (!expiredRef.current) { expiredRef.current = true; onExpireRef.current() }
      return
    }
    const tick = setTimeout(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
    return () => clearTimeout(tick)
  }, [timeLeft])

  return (
    <div className={`text-base sm:text-lg font-mono font-bold px-2.5 py-1 sm:px-3 rounded-xl whitespace-nowrap ${timeLeft < 300 ? 'text-red-600 bg-red-50' : 'text-gray-800 bg-gray-100'}`}>
      ⏱ {formatTime(timeLeft)}
    </div>
  )
}

export default function StudentExamTakingPage() {
  const params = useParams()
  const router = useRouter()
  const examId = params?.id as string
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const { data: exam, isLoading } = useQuery({
    queryKey: ['exam-detail', examId],
    queryFn: async () => { const r = await apiFetch(`/api/exams/${examId}/take`); if (!r.ok) throw new Error(); return r.json() as Promise<ExamDetail> },
    enabled: !!examId,
  })

  const startMutation = useMutation({
    mutationFn: () => apiFetch(`/api/exams/${examId}/start`, { method: 'POST' }),
    onSuccess: async (res) => {
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setStartError(j.message || 'Failed to start exam')
        return
      }
      const data = await res.json()
      setAttempt(data)
      setAnswers(data.answers || {})
      // Resuming an in-progress attempt — count down from the real remaining
      // time, not a fresh full duration, so refreshing the page can't reset the clock.
      const elapsed = Math.floor((Date.now() - new Date(data.startedAt).getTime()) / 1000)
      const remaining = Math.max(0, (exam?.duration ?? 60) * 60 - elapsed)
      setTimeLeft(remaining)
    },
    onError: () => setStartError('Failed to start exam'),
  })

  const submitMutation = useMutation({
    mutationFn: (attemptId: string) =>
      apiFetch(`/api/exams/attempts/${attemptId}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) }),
    onSuccess: async (res) => {
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSubmitError(j.message || 'Failed to submit exam')
        return
      }
      setSubmitted(true)
    },
    onError: () => setSubmitError('Failed to submit exam'),
  })

  const saveAnswers = useCallback(async () => {
    if (!attempt) return
    await apiFetch(`/api/exams/attempts/${attempt.id}/answers`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) })
  }, [attempt, answers])

  const handleTick = useCallback((secondsLeft: number) => {
    if (secondsLeft % 30 === 0) saveAnswers()
  }, [saveAnswers])

  const handleExpire = useCallback(() => {
    if (attempt) submitMutation.mutate(attempt.id)
  }, [attempt])

  // TEXT (a reading passage) has no answer, so it's excluded from "answered X of
  // Y" — otherwise a student could never reach 100% no matter what they answered.
  const answerableQuestions = exam?.questions.filter(q => q.type !== 'TEXT') ?? []
  const answeredCount = answerableQuestions.filter(q => answers[q.id] != null).length

  // Consecutive questions sharing a section (e.g. "Listening") become one page —
  // an exam with no sections assigned collapses to a single page, so SectionPager
  // renders nothing and this behaves exactly like the old single-list layout.
  // Answers are keyed by question id regardless of which page is showing, so
  // navigating back and forth between pages never loses anything already typed.
  //
  // These two useMemo calls (and everything above) must stay ABOVE the
  // `if (submitted) return` below — hooks can never be skipped on some renders
  // and not others. They used to sit after that early return, so the moment an
  // exam actually got submitted (auto-submit at timeout or a manual Submit
  // click) React saw a different number of hooks called than the previous
  // render and threw a hard "Rendered fewer hooks than expected" error, caught
  // by the app's error boundary instead of showing the confirmation screen.
  const pages = useMemo(() => groupQuestionsBySection(exam?.questions ?? []), [exam?.questions])
  const currentPage = pages[Math.min(page, pages.length - 1)] ?? { section: null, questions: [] as Question[], startIndex: 0 }
  const isLastPage = pages.length === 0 || page >= pages.length - 1

  // A passage is never numbered as a question — "Q1, Q2…" skips straight over it.
  const displayNumbers = useMemo(() => {
    let n = 0
    return (exam?.questions ?? []).map((q) => (q.type === 'TEXT' ? null : ++n))
  }, [exam?.questions])

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-10 text-center shadow-xl max-w-sm border border-gray-100">
        <p className="text-5xl mb-4">✅</p>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Exam Submitted!</h2>
        <p className="text-gray-500 text-sm mb-6">Your answers have been submitted. Results will be available soon.</p>
        <button onClick={() => router.push('/student/exams')} className="bg-sky-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-sky-700 shadow-sm">Back to Exams</button>
      </div>
    </div>
  )

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-gray-900 truncate">{exam?.title ?? 'Loading...'}</p>
              <p className="text-xs text-gray-400">{exam?.totalMarks} marks · {exam?.questions?.length ?? 0} questions</p>
            </div>
            {attempt && timeLeft !== null && (
              <div className="flex-shrink-0">
                <ExamCountdown initialSeconds={timeLeft} onTick={handleTick} onExpire={handleExpire} />
              </div>
            )}
          </div>
          {attempt && exam && (
            <div className="mt-3">
              <ProgressBar pct={(answeredCount / (answerableQuestions.length || 1)) * 100} label={`${answeredCount} of ${answerableQuestions.length} answered`} color="bg-emerald-500" />
            </div>
          )}
          {attempt && pages.length > 1 && (
            <div className="mt-2">
              {currentPage.section && <p className="text-center text-sm font-bold text-gray-700 mb-1">{currentPage.section}</p>}
              <SectionPager labels={pages.map(p => p.section || 'Questions')} current={page} onChange={setPage} />
            </div>
          )}
        </div>

        <div className="max-w-2xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
          {!attempt ? (
            <div className="bg-white rounded-2xl p-6 sm:p-10 text-center shadow-sm border border-gray-100 mt-6 sm:mt-10">
              <p className="text-4xl mb-4">📝</p>
              {isLoading ? (
                <p className="text-gray-400">Loading exam...</p>
              ) : exam ? (
                <>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">{exam.title}</h2>
                  <p className="text-gray-500 text-sm mb-1">{exam.questions.length} questions · {exam.duration} minutes</p>
                  <p className="text-gray-500 text-sm mb-6">Pass mark: {exam.passMark}/{exam.totalMarks}</p>
                  <p className="text-xs text-amber-700 mb-6 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">⚠️ Once started, the timer cannot be paused. Answers auto-save every 30 seconds.</p>
                  <button onClick={() => { setStartError(null); startMutation.mutate() }} disabled={startMutation.isPending}
                    className="w-full sm:w-auto bg-sky-600 text-white px-8 py-3 rounded-xl font-semibold text-lg hover:bg-sky-700 disabled:opacity-60 shadow-sm">
                    {startMutation.isPending ? 'Starting...' : 'Start Exam'}
                  </button>
                  {startError && <p className="text-sm text-red-600 mt-4">{startError}</p>}
                </>
              ) : (
                <p className="text-red-500">Failed to load exam</p>
              )}
            </div>
          ) : (
            // Bottom padding clears the fixed action bar below so it never covers
            // the last question — the button used to sit in-flow after the last
            // question, which on a long/mobile-height list meant scrolling all the
            // way down just to find Submit.
            <div className="space-y-3 sm:space-y-4 pb-28">
              {currentPage.questions.map((q, localI) => {
                const i = currentPage.startIndex + localI
                const isPassage = q.type === 'TEXT'
                return (
                <div key={q.id} className={`rounded-2xl shadow-sm p-4 sm:p-5 border ${isPassage ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-100'}`}>
                  <div className="flex items-start gap-2 mb-3">
                    {isPassage ? (
                      <span className="text-lg leading-none mt-0.5">📖</span>
                    ) : (
                      <span className="flex-none w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">{displayNumbers[i]}</span>
                    )}
                    <div className="font-semibold text-gray-900 flex-1 min-w-0">
                      <RichText as="div" html={q.text} />
                      {!isPassage && <span className="text-xs font-normal text-gray-400">({q.marks} mark{q.marks !== 1 ? 's' : ''})</span>}
                    </div>
                  </div>
                  <QuestionInput q={q} value={answers[q.id]} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} />
                </div>
                )
              })}
            </div>
          )}
        </div>

        {attempt && (
          <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] z-10">
            <div className="max-w-2xl mx-auto px-4 py-3 sm:px-6">
              {!isLastPage ? (
                <button onClick={() => setPage(p => p + 1)}
                  className="w-full bg-sky-600 text-white px-6 py-3 rounded-xl font-semibold text-base sm:text-lg hover:bg-sky-700 shadow-sm">
                  Next Section →
                </button>
              ) : (
                <>
                  <button onClick={() => { setSubmitError(null); attempt && submitMutation.mutate(attempt.id) }} disabled={submitMutation.isPending}
                    className="w-full bg-emerald-600 text-white px-6 py-3 rounded-xl font-semibold text-base sm:text-lg hover:bg-emerald-700 disabled:opacity-60 shadow-sm">
                    {submitMutation.isPending ? 'Submitting...' : 'Submit Exam'}
                  </button>
                  <p className="text-center text-xs text-gray-400 mt-1.5">Make sure all questions are answered before submitting</p>
                </>
              )}
              {submitError && <p className="text-center text-sm text-red-600 mt-1.5">{submitError}</p>}
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
