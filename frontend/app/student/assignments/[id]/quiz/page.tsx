"use client"

import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import AuthGuard from '../../../../../components/AuthGuard'
import { apiFetch } from '../../../../../lib/api'
import { type H5PType } from '../../../../../lib/h5pQuestionLogic'
import { EssayInput } from '../../../../../components/questions/EssayField'
import { SortParagraphsInput } from '../../../../../components/questions/SortParagraphsField'
import { DragWordsInput } from '../../../../../components/questions/DragWordsField'
import { FillBlanksInput } from '../../../../../components/questions/FillBlanksField'
import { DragDropInput } from '../../../../../components/questions/DragDropField'
import { SpeakWordsInput } from '../../../../../components/questions/SpeakWordsField'
import { SpeakWordsSetInput } from '../../../../../components/questions/SpeakWordsSetField'
import { DictationInput } from '../../../../../components/questions/DictationField'
import MathText from '../../../../../components/MathText'
import RichText from '../../../../../components/RichText'
import ProgressBar from '../../../../../components/ProgressBar'
import EmptyState from '../../../../../components/EmptyState'

type QType = 'MCQ' | 'TF' | 'MATCHING' | 'NUMERICAL' | H5PType
interface Question {
  id: string; type: QType; prompt: string; points: number; order: number
  data: any
  correctData?: any
}
interface QuizPayload {
  assignment: { id: string; title: string; instructions: string | null; dueDate: string | null; totalMarks: number; maxAttempts: number; allowLate: boolean; timeLimitMinutes: number | null }
  questions: Question[]
  revealAnswers?: boolean
  submission: { id: string; status: string; marks: number | null; attemptNumber: number; submittedAt: string; quizStartedAt: string | null; answers: Array<{ questionId: string; response: any; pointsAwarded: number | null; feedback: string | null }> } | null
}

export default function StudentQuizPage() {
  const params = useParams()
  const router = useRouter()
  const assignmentId = params?.id as string
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<{ autoScore: number; adjustedAutoScore: number; hasManualGrading: boolean; latePenaltyApplied: number | null } | null>(null)
  const [deadline, setDeadline] = useState<Date | null>(null)
  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  const [autoSubmittedReason, setAutoSubmittedReason] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['student-quiz', assignmentId],
    queryFn: async () => { const r = await apiFetch(`/api/assignments/${assignmentId}/quiz`); if (!r.ok) throw new Error(); return r.json() as Promise<QuizPayload> },
    enabled: !!assignmentId,
  })

  // Seed answers from previous attempt so students can review/edit.
  useEffect(() => {
    if (data?.submission?.answers?.length) {
      const seed: Record<string, any> = {}
      for (const a of data.submission.answers) seed[a.questionId] = a.response
      setAnswers(seed)
    }
  }, [data?.submission?.id])

  const submitMutation = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/api/assignments/${assignmentId}/submit-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: Object.entries(answers).map(([questionId, response]) => ({ questionId, response })) }),
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.message || 'Submission failed') }
      return r.json()
    },
    onSuccess: (res: any) => { setResult(res); setSubmitError(null); refetch() },
    onError: (e: any) => setSubmitError(e?.message || 'Submission failed'),
  })

  function setAnswer(qId: string, value: any) { setAnswers(a => ({ ...a, [qId]: value })) }

  // Start quiz timer when timeLimit is set and quiz is takeable.
  const timeLimit = data?.assignment.timeLimitMinutes ?? null
  const attemptsExhausted = !!data && data.assignment.maxAttempts > 0 && (data.submission?.attemptNumber ?? 0) >= data.assignment.maxAttempts
  const isTakeable = !!data && !result && !attemptsExhausted

  useEffect(() => {
    if (!data || !timeLimit || !isTakeable || attemptsExhausted) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch(`/api/assignments/${assignmentId}/start-quiz`, { method: 'POST' })
        if (!r.ok || cancelled) return
        const j = await r.json() as { startedAt: string; timeLimitMinutes: number | null }
        if (!j?.startedAt || !j.timeLimitMinutes) return
        const dl = new Date(new Date(j.startedAt).getTime() + j.timeLimitMinutes * 60_000)
        setDeadline(dl)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [data?.assignment.id, timeLimit, isTakeable, attemptsExhausted, assignmentId])

  useEffect(() => {
    if (!deadline) return
    const tick = () => {
      const s = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 1000))
      setRemainingSec(s)
      if (s === 0) {
        setAutoSubmittedReason('Time is up — your answers were submitted automatically.')
        submitMutation.mutate()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline?.getTime()])

  if (isLoading) {
    return <AuthGuard requiredRole="STUDENT"><div className="min-h-screen bg-gray-50 p-6"><div className="max-w-3xl mx-auto space-y-3">{[1,2,3].map(i => <div key={i} className="bg-white h-24 rounded-2xl animate-pulse border border-gray-100" />)}</div></div></AuthGuard>
  }
  if (isError || !data) {
    return <AuthGuard requiredRole="STUDENT"><div className="min-h-screen bg-gray-50 p-6"><div className="max-w-3xl mx-auto"><div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center"><p className="text-red-600 mb-2">Failed to load quiz</p><Link href="/student/assignments" className="text-sm text-sky-600 underline">Back to assignments</Link></div></div></div></AuthGuard>
  }

  const { assignment, questions, submission } = data
  const totalPoints = questions.reduce((s, q) => s + (q.points || 0), 0)
  const attemptsUsed = submission?.attemptNumber ?? 0
  const exhausted = assignment.maxAttempts > 0 && attemptsUsed >= assignment.maxAttempts
  const alreadyGraded = submission?.status === 'GRADED' && submission.marks !== null
  const canRetake = !exhausted && !!submission && !result
  const revealAnswers = !!data.revealAnswers
  const answerByQ = new Map<string, { response: any; pointsAwarded: number | null; feedback: string | null }>()
  for (const a of submission?.answers ?? []) answerByQ.set(a.questionId, a)
  const answeredCount = questions.filter(q => answers[q.id] != null).length

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-3xl mx-auto">
          <Link href="/student/assignments" className="text-sm text-gray-500 hover:text-gray-800 mb-4 block">← Back to my assignments</Link>
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100 mb-4">
            <h1 className="text-xl font-bold text-gray-900 mb-1">📝 {assignment.title}</h1>
            <p className="text-xs text-gray-500">{questions.length} question(s) · {totalPoints} points total{assignment.dueDate ? ` · Due ${new Date(assignment.dueDate).toLocaleString()}` : ''}</p>
            {assignment.instructions && <p className="text-sm text-gray-600 mt-3 whitespace-pre-wrap">{assignment.instructions}</p>}
            {assignment.maxAttempts > 1 && <p className="text-xs text-gray-400 mt-2">Attempts: {attemptsUsed}/{assignment.maxAttempts}</p>}
            {timeLimit && remainingSec != null && isTakeable && (
              <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold ${remainingSec < 60 ? 'bg-red-100 text-red-700' : remainingSec < 300 ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                ⏱ Time remaining: {Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, '0')}
              </div>
            )}
            {timeLimit && !remainingSec && isTakeable && <p className="text-xs text-gray-400 mt-2">Time limit: {timeLimit} minutes — timer will start.</p>}
            {autoSubmittedReason && <p className="mt-2 text-xs text-red-600 font-semibold">{autoSubmittedReason}</p>}
            {isTakeable && questions.length > 0 && (
              <div className="mt-3">
                <ProgressBar pct={(answeredCount / (questions.length || 1)) * 100} label={`${answeredCount} of ${questions.length} answered`} color="bg-emerald-500" />
              </div>
            )}
          </div>

          {(result || alreadyGraded) && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-4">
              <p className="font-semibold text-emerald-800 mb-1">{alreadyGraded ? 'Graded' : 'Submitted'}{canRetake ? ' — you may retake below' : ''}</p>
              {result && (
                <p className="text-sm text-emerald-700">
                  Auto-graded score: {result.adjustedAutoScore.toFixed(2)} / {totalPoints}
                  {result.latePenaltyApplied ? ` (after −${result.latePenaltyApplied}% late penalty)` : ''}
                  {result.hasManualGrading ? ' — essay portion will be graded by your teacher.' : ''}
                </p>
              )}
              {alreadyGraded && submission?.marks != null && (
                <p className="text-sm text-emerald-700">Final score: {submission.marks} / {assignment.totalMarks}</p>
              )}
            </div>
          )}

          {submitError && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">{submitError}</div>}

          <div className="space-y-3">
            {questions.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <EmptyState icon="⏳" message="This quiz has no questions yet." />
              </div>
            )}
            {questions.map((q, i) => {
              const ans = answerByQ.get(q.id)
              return (
              <div key={q.id} className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700">{q.points} pt</span>
                  {revealAnswers && ans && ans.pointsAwarded != null && (
                    <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full font-semibold ${ans.pointsAwarded >= q.points ? 'bg-emerald-100 text-emerald-700' : ans.pointsAwarded > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>You: {ans.pointsAwarded}/{q.points}</span>
                  )}
                </div>
                <RichText as="div" className="text-sm text-gray-800 whitespace-pre-wrap mb-3" html={q.prompt} />
                <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} disabled={(exhausted && !!submission) || revealAnswers} />
                {revealAnswers && q.correctData && (
                  <CorrectAnswerPanel q={q} />
                )}
                {revealAnswers && ans?.feedback && (
                  <p className="text-xs text-gray-600 italic mt-2">Teacher feedback: “{ans.feedback}”</p>
                )}
              </div>
              )
            })}
          </div>

          {questions.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {exhausted ? 'No more attempts available.' : (submission ? 'Resubmitting starts a new attempt.' : 'Submit when you are ready.')}
              </p>
              <div className="flex items-center gap-2">
                {(exhausted || revealAnswers || (!!submission && !canRetake)) && (
                  <button
                    onClick={() => router.push('/student/assignments')}
                    className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-300">
                    ✅ Finish
                  </button>
                )}
                {!exhausted && (
                  <button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                    className="bg-sky-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
                    {submitMutation.isPending ? 'Submitting…' : (submission ? 'Resubmit Quiz' : 'Submit Quiz')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  )
}

function QuestionInput({ q, value, onChange, disabled }: { q: Question; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  switch (q.type) {
    case 'MCQ': {
      const choices: Array<{ id: string; text: string }> = q.data?.choices ?? []
      const multiple = !!q.data?.multiple
      const selected: string[] = Array.isArray(value) ? value : (value ? [value] : [])
      function toggle(id: string) {
        if (disabled) return
        if (multiple) {
          const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
          onChange(next)
        } else {
          onChange([id])
        }
      }
      return (
        <div className="space-y-2">
          {choices.map(c => (
            <label key={c.id} className={`flex items-center gap-2 text-sm cursor-pointer ${disabled ? 'opacity-60' : ''}`}>
              <input type={multiple ? 'checkbox' : 'radio'} name={q.id} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} disabled={disabled} />
              <MathText as="span" text={c.text} />
            </label>
          ))}
        </div>
      )
    }
    case 'TF':
      return (
        <div className="flex items-center gap-6 text-sm">
          <label className={`flex items-center gap-1 cursor-pointer ${disabled ? 'opacity-60' : ''}`}>
            <input type="radio" name={q.id} checked={value === true} onChange={() => onChange(true)} disabled={disabled} /> True
          </label>
          <label className={`flex items-center gap-1 cursor-pointer ${disabled ? 'opacity-60' : ''}`}>
            <input type="radio" name={q.id} checked={value === false} onChange={() => onChange(false)} disabled={disabled} /> False
          </label>
        </div>
      )
    case 'NUMERICAL':
      return <input type="number" step="any" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} disabled={disabled} className="w-full border rounded-lg px-3 py-2 text-sm" />
    case 'ESSAY':
      return <EssayInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'SORT_PARAGRAPHS':
      return <SortParagraphsInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'DRAG_WORDS':
      return <DragWordsInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'FILL_BLANKS':
      return <FillBlanksInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'DRAG_DROP':
      return <DragDropInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'SPEAK_WORDS':
      return <SpeakWordsInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'SPEAK_WORDS_SET':
      return <SpeakWordsSetInput data={q.data} value={value} onChange={onChange} disabled={disabled} />
    case 'DICTATION':
      return <DictationInput data={q.data} value={value} onChange={onChange} disabled={disabled} revealFeedback={disabled} />
    case 'MATCHING': {
      const left: Array<{ id: string; text: string }> = q.data?.left ?? []
      const right: Array<{ id: string; text: string }> = q.data?.right ?? []
      const given: Array<{ leftId: string; rightId: string }> = Array.isArray(value) ? value : []
      function setPair(leftId: string, rightId: string) {
        if (disabled) return
        const next = given.filter(p => p.leftId !== leftId)
        if (rightId) next.push({ leftId, rightId })
        onChange(next)
      }
      function pairFor(leftId: string) { return given.find(p => p.leftId === leftId)?.rightId ?? '' }
      return (
        <div className="space-y-2">
          {left.map(l => (
            <div key={l.id} className="flex items-center gap-2">
              <MathText as="span" className="text-sm text-slate-700 w-1/2 truncate" text={l.text} />
              <select value={pairFor(l.id)} onChange={e => setPair(l.id, e.target.value)} disabled={disabled} className="flex-1 border rounded-lg px-2 py-1 text-sm">
                <option value="">— choose —</option>
                {right.map(r => <option key={r.id} value={r.id}>{r.text}</option>)}
              </select>
            </div>
          ))}
        </div>
      )
    }
  }
  return null
}

function CorrectAnswerPanel({ q }: { q: Question }) {
  const cd = q.correctData
  if (!cd) return null
  let content: React.ReactNode = null
  switch (q.type) {
    case 'MCQ': {
      const choices: Array<{ id: string; text: string }> = q.data?.choices ?? []
      const correctIds: string[] = cd.correctIds ?? []
      content = (
        <ul className="list-disc list-inside text-sm text-emerald-700">
          {choices.filter(c => correctIds.includes(c.id)).map(c => <li key={c.id}><MathText as="span" text={c.text} /></li>)}
        </ul>
      )
      break
    }
    case 'TF':
      content = <p className="text-sm text-emerald-700 font-semibold">{cd.correct ? 'True' : 'False'}</p>
      break
    case 'NUMERICAL':
      content = <p className="text-sm text-emerald-700 font-semibold">{String(cd.correct)}{cd.tolerance ? ` (±${cd.tolerance})` : ''}</p>
      break
    case 'MATCHING': {
      const left: Array<{ id: string; text: string }> = q.data?.left ?? []
      const right: Array<{ id: string; text: string }> = q.data?.right ?? []
      const pairs: Array<{ leftId: string; rightId: string }> = cd.pairs ?? []
      const leftMap = new Map(left.map(l => [l.id, l.text]))
      const rightMap = new Map(right.map(r => [r.id, r.text]))
      content = (
        <ul className="text-sm text-emerald-700 space-y-0.5">
          {pairs.map((p, i) => <li key={i}>{leftMap.get(p.leftId) ?? p.leftId} → {rightMap.get(p.rightId) ?? p.rightId}</li>)}
        </ul>
      )
      break
    }
    case 'SORT_PARAGRAPHS': {
      const paragraphs: Array<{ id: string; text: string }> = cd.paragraphs ?? []
      content = (
        <ol className="list-decimal list-inside text-sm text-emerald-700 space-y-0.5">
          {paragraphs.map(p => <li key={p.id}><MathText as="span" text={p.text} /></li>)}
        </ol>
      )
      break
    }
    case 'DRAG_WORDS': {
      content = <p className="text-sm text-emerald-700 whitespace-pre-wrap">{cd.text}</p>
      break
    }
    case 'DRAG_DROP': {
      const zones: Array<{ id: string }> = q.data?.zones ?? []
      const items: Array<{ id: string; label: string; correctZoneId: string }> = cd.items ?? []
      content = (
        <ul className="text-sm text-emerald-700 space-y-0.5">
          {items.map(it => <li key={it.id}><MathText as="span" text={it.label} /> → Zone {zones.findIndex(z => z.id === it.correctZoneId) + 1}</li>)}
        </ul>
      )
      break
    }
    case 'SPEAK_WORDS': {
      const accepted: string[] = cd.acceptedAnswers ?? []
      content = <p className="text-sm text-emerald-700">{accepted.join(' / ')}</p>
      break
    }
    case 'SPEAK_WORDS_SET': {
      const items: Array<{ id: string; prompt: string; acceptedAnswers: string[] }> = cd.items ?? []
      content = (
        <ul className="text-sm text-emerald-700 space-y-0.5">
          {items.map(it => <li key={it.id}><MathText as="span" text={it.prompt} />: {it.acceptedAnswers.join(' / ')}</li>)}
        </ul>
      )
      break
    }
    case 'DICTATION': {
      content = <p className="text-sm text-emerald-700 whitespace-pre-wrap">{cd.script}</p>
      break
    }
    default:
      return null
  }
  return (
    <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
      <p className="text-[11px] uppercase font-semibold text-emerald-700 mb-1">✓ Correct answer</p>
      {content}
    </div>
  )
}
