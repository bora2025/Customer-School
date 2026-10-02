"use client"

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../components/AuthGuard'
import Sidebar from '../../../../../components/Sidebar'
import StatCard from '../../../../../components/StatCard'
import EmptyState from '../../../../../components/EmptyState'
import ConfirmModal from '../../../../../components/ConfirmModal'
import { teacherNav } from '../../../../../lib/teacher-nav'
import { adminNav } from '../../../../../lib/admin-nav'
import { apiFetch } from '../../../../../lib/api'
import { gradeQuestion } from '../../../../../lib/examQuestionLogic'
import { parseDragWordsText, parseFillBlanksText, diffWords } from '../../../../../lib/h5pQuestionLogic'
import MathText from '../../../../../components/MathText'
import RichText from '../../../../../components/RichText'

interface ExamQuestion {
  id: string
  text: string
  type: string
  data: any
  marks: number
  order: number
}
interface Exam {
  id: string
  title: string
  totalMarks: number
  passMark: number
  questions: ExamQuestion[]
}
interface Attempt {
  id: string
  studentId: string
  status: string
  score: number | null
  grade: string | null
  attemptNumber: number
  submittedAt: string | null
  gradedAt: string | null
  answers: Record<string, any> | null
  manualMarks: Record<string, number> | null
  feedback: string | null
  student: { id: string; user: { name: string } }
}

// Every exam type except ESSAY is auto-graded (the only one exercising the
// mixed-exam "wait for manual grading" path — see exam.service.ts's submitAttempt).
function isAutoGraded(type: string) {
  return type !== 'ESSAY'
}

// Mirrors backend/src/h5p/h5p-questions.ts's parseDragWordsText, so the gradebook
// can derive blanks+answers from the same *word*-marked-up text without a round trip.
function parseDragWordsBlanks(text: string): { id: string; answer: string }[] {
  return parseDragWordsText(text).filter((s): s is { type: 'blank'; id: string; answer: string; group: 'a' | 'b' } => s.type === 'blank')
}

function parseFillBlanksBlanks(text: string): { id: string; answers: string[] }[] {
  return parseFillBlanksText(text).filter((s): s is { type: 'blank'; id: string; answers: string[] } => s.type === 'blank')
}

// Delegates to lib/examQuestionLogic.ts's gradeQuestion (which mirrors the backend
// exactly, including the shared H5P grading for the 6 auto-graded H5P types), so the
// gradebook can show the score without a round-trip.
function gradeAutoQuestion(q: ExamQuestion, response: any): number {
  return gradeQuestion({ type: q.type, marks: q.marks, data: q.data }, response).awarded ?? 0
}

const STATUS_COLOR: Record<string, string> = {
  IN_PROGRESS: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  GRADED: 'bg-emerald-100 text-emerald-700',
}

export default function ExamGradebookPage() {
  const params = useParams<{ id: string }>()
  const examId = params?.id
  const router = useRouter()
  const qc = useQueryClient()
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<Attempt | null>(null)

  const resetMutation = useMutation({
    mutationFn: async (attemptId: string) => {
      const r = await apiFetch(`/api/exams/attempts/${attemptId}/reset`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to reset attempt')
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-attempts', examId] })
      setResetTarget(null)
    },
  })

  const { data: exam, isLoading: examLoading } = useQuery<Exam>({
    enabled: !!examId,
    queryKey: ['exam', examId],
    queryFn: async () => {
      const r = await apiFetch(`/api/exams/${examId}`)
      if (!r.ok) throw new Error('Failed to load exam')
      return r.json()
    },
  })

  const { data: attempts = [] as Attempt[], isLoading: attemptsLoading } = useQuery<Attempt[]>({
    enabled: !!examId,
    queryKey: ['exam-attempts', examId],
    queryFn: async () => {
      const r = await apiFetch(`/api/exams/${examId}/attempts`)
      if (!r.ok) throw new Error('Failed to load attempts')
      return r.json()
    },
  })

  const manualQuestions = useMemo(() => exam?.questions.filter(q => !isAutoGraded(q.type)) ?? [], [exam])

  // This page is reachable from both the teacher's own nav AND an admin's
  // "Grade ↗" link (admin/exams, admin/classes/[id]) — the sidebar/back button
  // used to always assume a teacher, so an admin landing here had no way back
  // to their own home (the teacher nav's links/back button don't apply to them).
  const isAdmin = typeof window !== 'undefined' && ['ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(localStorage.getItem('role') || '')

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title={isAdmin ? 'Admin Panel' : 'Teacher'} subtitle={isAdmin ? 'Wattanman' : 'Portal'} navItems={isAdmin ? adminNav : teacherNav} accentColor={isAdmin ? 'indigo' : 'sky'} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => router.push(isAdmin ? '/admin/exams' : '/teacher/exams')} className="text-sm text-gray-500 hover:text-gray-800">← Back</button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              📊 Gradebook {exam ? `· ${exam.title}` : ''}
            </h1>
          </div>

          {examLoading || attemptsLoading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="bg-white h-20 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : !exam ? (
            <div className="text-red-600">Exam not found.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Marks" value={exam.totalMarks} decimals={0} prefix="" color="bg-indigo-100"
                  icon={<svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>} />
                <StatCard label="Pass Mark" value={exam.passMark} decimals={0} prefix="" color="bg-emerald-100"
                  icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
                <StatCard label="Questions" value={exam.questions.length} decimals={0} prefix="" color="bg-sky-100"
                  icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
                <StatCard label="Need Manual Grading" value={manualQuestions.length} decimals={0} prefix="" color="bg-amber-100"
                  icon={<svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>} />
              </div>

              {attempts.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
                  <EmptyState icon="🧑‍🎓" message="No student has attempted this exam yet." />
                </div>
              ) : (
                <div className="space-y-3">
                  {attempts.map(att => (
                    <div key={att.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-slate-800 truncate">{att.student.user.name}</p>
                            {att.attemptNumber > 1 && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">Attempt {att.attemptNumber}</span>}
                          </div>
                          <p className="text-xs text-slate-500">
                            Submitted: {att.submittedAt ? new Date(att.submittedAt).toLocaleString() : '—'}
                            {att.gradedAt && <> · Graded: {new Date(att.gradedAt).toLocaleString()}</>}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:flex-shrink-0">
                          <div className="text-left sm:text-right">
                            <div className="text-sm font-semibold text-slate-800">
                              {att.score ?? 0} / {exam.totalMarks}
                              {att.grade && <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${att.grade === 'PASS' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{att.grade}</span>}
                            </div>
                            <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[att.status] ?? 'bg-slate-100 text-slate-600'}`}>{att.status}</span>
                          </div>
                          <button
                            onClick={() => setOpenAttemptId(openAttemptId === att.id ? null : att.id)}
                            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md border border-sky-200 text-sky-700 hover:bg-sky-50 font-medium"
                          >
                            {openAttemptId === att.id ? 'Close' : att.status === 'GRADED' ? 'Review' : 'Grade'}
                          </button>
                          <button
                            onClick={() => setResetTarget(att)}
                            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md border border-amber-200 text-amber-700 hover:bg-amber-50 font-medium"
                          >
                            ↻ Re-Attempt
                          </button>
                        </div>
                      </div>

                      {openAttemptId === att.id && (
                        <GradePanel
                          exam={exam}
                          attempt={att}
                          onSaved={() => {
                            qc.invalidateQueries({ queryKey: ['exam-attempts', examId] })
                            setOpenAttemptId(null)
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          </div>
        </main>
      </div>

      {resetTarget && (
        <ConfirmModal
          title="Allow re-attempt?"
          message={`This permanently deletes ${resetTarget.student.user.name}'s current attempt${resetTarget.score != null ? ` (score: ${resetTarget.score}/${exam?.totalMarks})` : ''} so they can take this exam again from scratch. This can't be undone.`}
          confirmLabel="Delete & Allow Retry"
          danger
          pending={resetMutation.isPending}
          onConfirm={() => resetMutation.mutate(resetTarget.id)}
          onCancel={() => setResetTarget(null)}
        />
      )}
    </AuthGuard>
  )
}

function GradePanel({ exam, attempt, onSaved }: { exam: Exam; attempt: Attempt; onSaved: () => void }) {
  const answers = attempt.answers ?? {}
  const existingMarks = attempt.manualMarks ?? {}
  const [marks, setMarks] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const q of exam.questions) {
      if (!isAutoGraded(q.type)) {
        init[q.id] = existingMarks[q.id] !== undefined ? String(existingMarks[q.id]) : ''
      }
    }
    return init
  })
  const [feedback, setFeedback] = useState<string>(attempt.feedback ?? '')
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const perQuestionMarks: Record<string, number> = {}
      for (const [qid, v] of Object.entries(marks)) {
        const n = parseFloat(v)
        if (!isNaN(n)) perQuestionMarks[qid] = n
      }
      const r = await apiFetch(`/api/exams/attempts/${attempt.id}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perQuestionMarks, feedback: feedback || undefined }),
      })
      if (!r.ok) {
        let msg = `Save failed (${r.status})`
        try { const j = await r.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message } catch {}
        throw new Error(msg)
      }
      return r.json()
    },
    onSuccess: onSaved,
    onError: (e: any) => setError(e?.message || 'Failed to save'),
  })

  // A passage is never numbered as a question — "Q1, Q2…" skips straight over it,
  // matching how it's numbered on the student-facing preview/taking pages.
  const displayNumbers = (() => {
    let n = 0
    return exam.questions.map((q) => (q.type === 'TEXT' ? null : ++n))
  })()

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 p-4 space-y-4">
      {exam.questions.map((q, idx) => {
        const studentAnswer = answers[q.id]
        const autoGraded = isAutoGraded(q.type)
        const awarded = autoGraded ? gradeAutoQuestion(q, studentAnswer) : 0
        const choices: { id: string; text: string; isCorrect: boolean }[] = q.data?.choices ?? []
        const chosenIds = new Set(Array.isArray(studentAnswer) ? studentAnswer.map(String) : studentAnswer != null ? [String(studentAnswer)] : [])
        const paragraphs: { id: string; text: string }[] = q.data?.paragraphs ?? []
        const dragBlanks = q.type === 'DRAG_WORDS' ? parseDragWordsBlanks(q.data?.text || '') : []
        const fillBlanks = q.type === 'FILL_BLANKS' ? parseFillBlanksBlanks(q.data?.text || '') : []
        const dropItems: { id: string; label: string; correctZoneId: string }[] = q.data?.items ?? []
        const dropZones: { id: string }[] = q.data?.zones ?? []
        const swSetItems: { id: string; prompt: string; acceptedAnswers: string[] }[] = q.data?.items ?? []
        return (
          <div key={q.id} className={`bg-white rounded-xl border-l-4 border border-slate-200 p-3 ${autoGraded ? 'border-l-emerald-400' : 'border-l-amber-400'}`}>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 mb-2">
              <div className="text-sm font-semibold text-slate-800 min-w-0 break-words">
                <span>{q.type === 'TEXT' ? '📖 Reading Passage' : `Q${displayNumbers[idx]}.`}</span>
                <RichText as="div" html={q.text} />
                <span className="text-xs text-slate-400 font-normal">({q.type} · {q.marks} marks)</span>
              </div>
              {autoGraded && q.type !== 'TEXT' && (
                <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${awarded === q.marks ? 'bg-emerald-100 text-emerald-700' : awarded > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  +{Math.round(awarded * 100) / 100} (auto)
                </span>
              )}
            </div>
            {q.type === 'MCQ' && choices.length > 0 && (
              <ul className="text-xs text-slate-600 space-y-0.5 mb-2 ml-4">
                {choices.map((c) => (
                  <li key={c.id} className={c.isCorrect ? 'text-emerald-700 font-semibold' : ''}>
                    {chosenIds.has(c.id) ? '☑' : '☐'} <MathText as="span" text={c.text} />{c.isCorrect ? ' (correct)' : ''}
                  </li>
                ))}
              </ul>
            )}
            {q.type === 'TF' && (
              <div className="text-xs text-slate-600 mb-2 ml-4">
                Correct answer: <span className="font-semibold text-emerald-700">{q.data?.correct ? 'True' : 'False'}</span>
              </div>
            )}
            {q.type === 'SORT_PARAGRAPHS' && paragraphs.length > 0 && (
              <ol className="text-xs text-slate-600 space-y-0.5 mb-2 ml-4 list-decimal list-inside">
                {paragraphs.map((p) => <li key={p.id} className="text-emerald-700 font-semibold"><MathText as="span" text={p.text} /></li>)}
              </ol>
            )}
            {q.type === 'DRAG_WORDS' && dragBlanks.length > 0 && (
              <div className="text-xs text-slate-600 mb-2 ml-4">
                Correct words: {dragBlanks.map((b) => <span key={b.id} className="text-emerald-700 font-semibold mr-2">[{b.answer}]</span>)}
              </div>
            )}
            {q.type === 'FILL_BLANKS' && fillBlanks.length > 0 && (
              <div className="text-xs text-slate-600 mb-2 ml-4">
                Accepted answers: {fillBlanks.map((b) => <span key={b.id} className="text-emerald-700 font-semibold mr-2">[{b.answers.join(' / ')}]</span>)}
              </div>
            )}
            {q.type === 'DRAG_DROP' && dropItems.length > 0 && (
              <ul className="text-xs text-slate-600 space-y-0.5 mb-2 ml-4">
                {dropItems.map((it) => (
                  <li key={it.id} className="text-emerald-700 font-semibold">
                    <MathText as="span" text={it.label} /> → Zone {dropZones.findIndex(z => z.id === it.correctZoneId) + 1}
                  </li>
                ))}
              </ul>
            )}
            {q.type === 'SPEAK_WORDS' && (q.data?.acceptedAnswers ?? []).length > 0 && (
              <div className="text-xs text-slate-600 mb-2 ml-4">
                Accepted answers: {(q.data.acceptedAnswers as string[]).map((a, i) => <span key={i} className="text-emerald-700 font-semibold mr-2">[{a}]</span>)}
              </div>
            )}
            {q.type === 'SPEAK_WORDS_SET' && swSetItems.length > 0 && (
              <ul className="text-xs text-slate-600 space-y-0.5 mb-2 ml-4">
                {swSetItems.map((it) => (
                  <li key={it.id}><MathText as="span" text={it.prompt} />: <span className="text-emerald-700 font-semibold">{it.acceptedAnswers.join(' / ')}</span></li>
                ))}
              </ul>
            )}
            {q.type === 'DICTATION' && q.data?.script && (
              <div className="text-xs text-slate-600 mb-2 ml-4">
                Script: <MathText as="span" className="text-emerald-700 font-semibold" text={q.data.script} />
              </div>
            )}
            {q.type !== 'TEXT' && (
            <>
            <div className="text-xs text-slate-500 mb-1">Student answer:</div>
            <div className="text-sm bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap">
              {q.type === 'MCQ' ? (
                choices.filter(c => chosenIds.has(c.id)).length > 0
                  ? <MathText as="span" text={choices.filter(c => chosenIds.has(c.id)).map(c => c.text).join(', ')} />
                  : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'TF' ? (
                studentAnswer == null ? <span className="text-slate-400 italic">(no answer)</span> : (studentAnswer ? 'True' : 'False')
              ) : q.type === 'SORT_PARAGRAPHS' ? (
                Array.isArray(studentAnswer) && studentAnswer.length > 0 ? (
                  <ol className="list-decimal list-inside space-y-0.5">
                    {studentAnswer.map((id: string, i: number) => {
                      const p = paragraphs.find(x => x.id === id)
                      const rightSpot = paragraphs[i]?.id === id
                      return <li key={id} className={rightSpot ? 'text-emerald-700' : 'text-red-600'}>{p ? <MathText as="span" text={p.text} /> : '(unknown)'}</li>
                    })}
                  </ol>
                ) : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'DRAG_WORDS' ? (
                dragBlanks.length > 0 ? (
                  <div className="space-y-0.5">
                    {dragBlanks.map((b) => {
                      const given = studentAnswer && typeof studentAnswer === 'object' ? studentAnswer[b.id] : undefined
                      const ok = (given || '').trim().toLowerCase() === b.answer.trim().toLowerCase()
                      return <div key={b.id}>Blank &quot;{b.answer}&quot;: <span className={ok ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{given || '(blank)'}</span></div>
                    })}
                  </div>
                ) : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'FILL_BLANKS' ? (
                fillBlanks.length > 0 ? (
                  <div className="space-y-0.5">
                    {fillBlanks.map((b) => {
                      const given = studentAnswer && typeof studentAnswer === 'object' ? studentAnswer[b.id] : undefined
                      const ok = b.answers.some((a) => (given || '').trim().toLowerCase() === a.trim().toLowerCase())
                      return <div key={b.id}>Blank &quot;{b.answers.join(' / ')}&quot;: <span className={ok ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{given || '(blank)'}</span></div>
                    })}
                  </div>
                ) : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'DRAG_DROP' ? (
                dropItems.length > 0 ? (
                  <div className="space-y-0.5">
                    {dropItems.map((it) => {
                      const given = studentAnswer && typeof studentAnswer === 'object' ? studentAnswer[it.id] : undefined
                      const ok = given === it.correctZoneId
                      const zoneIdx = dropZones.findIndex(z => z.id === given)
                      return <div key={it.id}><MathText as="span" text={it.label} />: <span className={ok ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{given ? `Zone ${zoneIdx + 1}` : '(not placed)'}</span></div>
                    })}
                  </div>
                ) : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'SPEAK_WORDS' ? (
                studentAnswer ? <MathText as="span" text={studentAnswer} /> : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'SPEAK_WORDS_SET' ? (
                swSetItems.length > 0 ? (
                  <div className="space-y-0.5">
                    {swSetItems.map((it) => {
                      const given = studentAnswer && typeof studentAnswer === 'object' ? studentAnswer[it.id] : undefined
                      return <div key={it.id}><MathText as="span" text={it.prompt} />: <span className="text-slate-700">{given || '(no answer)'}</span></div>
                    })}
                  </div>
                ) : <span className="text-slate-400 italic">(no answer)</span>
              ) : q.type === 'DICTATION' ? (
                <div className="space-y-1">
                  {diffWords(q.data?.script || '', studentAnswer || '').map((d, i) => (
                    <span key={i} className={`mr-1.5 ${d.match ? 'text-emerald-700' : 'text-red-600 line-through'}`}>{d.word}</span>
                  ))}
                  {!studentAnswer && <span className="text-slate-400 italic block">(no answer)</span>}
                </div>
              ) : (
                studentAnswer || <span className="text-slate-400 italic">(no answer)</span>
              )}
            </div>
            </>
            )}
            {!autoGraded && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-600">Marks:</label>
                <input
                  type="number"
                  min={0}
                  max={q.marks}
                  step="0.5"
                  value={marks[q.id] ?? ''}
                  onChange={e => setMarks({ ...marks, [q.id]: e.target.value })}
                  className="w-24 text-sm border border-slate-300 rounded-md px-2 py-1.5"
                  placeholder="0"
                />
                <span className="text-xs text-slate-400">/ {q.marks}</span>
              </div>
            )}
          </div>
        )
      })}

      <div>
        <label className="text-xs text-slate-600 font-medium block mb-1">Overall feedback (optional)</label>
        <textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          rows={3}
          className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5"
          placeholder="Comments for the student…"
        />
      </div>

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</div>}

      <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full sm:w-auto bg-emerald-600 text-white text-sm font-medium px-4 py-2 sm:py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save & Finalize Grade'}
        </button>
      </div>
    </div>
  )
}
