"use client"

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import AuthGuard from '../../../../components/AuthGuard'
import Sidebar from '../../../../components/Sidebar'
import StatCard from '../../../../components/StatCard'
import EmptyState from '../../../../components/EmptyState'
import ConfirmModal from '../../../../components/ConfirmModal'
import { teacherNav } from '../../../../lib/teacher-nav'
import { apiFetch } from '../../../../lib/api'
import { H5P_TYPE_LABEL, parseDragWordsText, parseFillBlanksText, diffWords } from '../../../../lib/h5pQuestionLogic'
import MathText from '../../../../components/MathText'
import RichText from '../../../../components/RichText'
interface Submission {
  id: string
  content: string | null
  attachmentUrl: string | null
  submittedAt: string
  status: string // SUBMITTED | LATE | GRADED
  attemptNumber: number
  latePenaltyApplied: number | null
  marks: number | null
  feedback: string | null
  gradedAt: string | null
  student: { user: { name: string; photo: string | null } }
}
interface AssignmentDetail {
  id: string
  title: string
  totalMarks: number
  type: string
  status: string
  latePenaltyPct: number
  maxAttempts: number
  attachmentUrl: string | null
  instructions: string | null
  dueDate: string | null
  class: { name: string; subject?: string }
}

export default function TeacherGradingPage() {
  const params = useParams()
  const assignmentId = params?.id as string
  const [gradingId, setGradingId] = useState<string | null>(null)
  const [perQId, setPerQId] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<Submission | null>(null)
  const qc = useQueryClient()

  const { data: assignment } = useQuery({
    queryKey: ['assignment-detail', assignmentId],
    queryFn: async () => { const r = await apiFetch(`/api/assignments/${assignmentId}`); if (!r.ok) throw new Error(); return r.json() as Promise<AssignmentDetail> },
    enabled: !!assignmentId,
  })
  const { data: submissions = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['submissions', assignmentId],
    queryFn: async () => { const r = await apiFetch(`/api/assignments/${assignmentId}`); if (!r.ok) throw new Error(); const data = await r.json(); return (data.submissions ?? []) as Submission[] },
    enabled: !!assignmentId,
  })

  const gradeMutation = useMutation({
    mutationFn: ({ submissionId, marks, feedback }: { submissionId: string; marks: number; feedback: string }) =>
      apiFetch(`/api/assignments/submissions/${submissionId}/grade`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marks, feedback }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['submissions', assignmentId] }); setGradingId(null) },
  })

  const resetMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const r = await apiFetch(`/api/assignments/submissions/${submissionId}/reset`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to reset submission')
      return r.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['submissions', assignmentId] }); setResetTarget(null) },
  })

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<{ marks: number; feedback: string }>()
  const onGrade = async (data: { marks: number; feedback: string }) => {
    if (!gradingId) return
    gradeMutation.mutate({ submissionId: gradingId, marks: Number(data.marks), feedback: data.feedback })
  }

  const gradedCount = submissions.filter(s => s.marks !== null).length
  const lateCount = submissions.filter(s => s.status === 'LATE').length

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Teacher" subtitle="Portal" navItems={teacherNav} accentColor="sky" />
        <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          <div>
            <Link href="/teacher/assignments" className="text-sm text-gray-500 hover:text-gray-800 mb-2 block">← Back to Assignments</Link>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Grade Submissions</h1>
            {assignment && (
              <div className="mt-1">
                <p className="text-sm text-gray-500">{assignment.title} · {assignment.class?.name} · {assignment.totalMarks} marks · {assignment.type}</p>
                {assignment.dueDate && <p className="text-xs text-gray-400 mt-0.5">Due: {new Date(assignment.dueDate).toLocaleString()}</p>}
                {assignment.latePenaltyPct > 0 && <p className="text-xs text-orange-600 mt-0.5">Late penalty: {assignment.latePenaltyPct}% off final score</p>}
                {assignment.attachmentUrl && (
                  <a href={assignment.attachmentUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-sky-600 underline mt-1">📎 Reference attachment</a>
                )}
                {assignment.type === 'QUIZ' && (
                  <Link href={`/teacher/assignments/${assignmentId}/quiz`} className="inline-block mt-3 bg-violet-600 text-white text-xs font-semibold px-3 py-1.5 rounded-xl hover:bg-violet-700">📝 Manage Quiz Questions</Link>
                )}
              </div>
            )}
          </div>

          {!isLoading && !isError && submissions.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Submissions" value={submissions.length} decimals={0} prefix="" color="bg-sky-100"
                icon={<svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>} />
              <StatCard label="Graded" value={gradedCount} decimals={0} prefix="" color="bg-emerald-100"
                icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
              <StatCard label="Late" value={lateCount} decimals={0} prefix="" color="bg-orange-100"
                icon={<svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-white h-24 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
              <p className="text-red-600 mb-2">Failed to load submissions</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : submissions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <EmptyState icon="📭" message="No submissions yet" />
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map(sub => (
                <div key={sub.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-semibold text-gray-900">{sub.student?.user?.name}</p>
                        {sub.status === 'LATE' && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Late</span>}
                        {sub.attemptNumber > 1 && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">Attempt {sub.attemptNumber}</span>}
                        {sub.marks !== null && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">Graded: {sub.marks}/{assignment?.totalMarks}</span>}
                        {sub.latePenaltyApplied != null && sub.latePenaltyApplied > 0 && (
                          <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full font-semibold">−{sub.latePenaltyApplied}% applied</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">Submitted: {new Date(sub.submittedAt).toLocaleString()}</p>
                      {sub.content && <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 whitespace-pre-wrap line-clamp-4">{sub.content}</p>}
                      {sub.attachmentUrl && (
                        <a href={sub.attachmentUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-sky-600 underline mt-1">📎 View attachment</a>
                      )}
                      {sub.feedback && <p className="text-xs text-gray-500 italic mt-1">Feedback: "{sub.feedback}"</p>}
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button onClick={() => setGradingId(sub.id === gradingId ? null : sub.id)}
                        className="text-xs bg-sky-100 text-sky-700 px-3 py-1.5 rounded-lg font-medium hover:bg-sky-200">
                        {sub.marks !== null ? 'Re-grade total' : 'Grade total'}
                      </button>
                      {assignment?.type === 'QUIZ' && (
                        <button onClick={() => setPerQId(sub.id === perQId ? null : sub.id)}
                          className="text-xs bg-violet-100 text-violet-700 px-3 py-1.5 rounded-lg font-medium hover:bg-violet-200">
                          {perQId === sub.id ? 'Hide answers' : 'Grade per Q'}
                        </button>
                      )}
                      <button onClick={() => setResetTarget(sub)}
                        className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-medium hover:bg-amber-200">
                        ↻ Re-Attempt
                      </button>
                    </div>
                  </div>

                  {perQId === sub.id && assignment?.type === 'QUIZ' && (
                    <PerQuestionGrader submissionId={sub.id} totalMarks={assignment.totalMarks} onGraded={() => qc.invalidateQueries({ queryKey: ['submissions', assignmentId] })} />
                  )}

                  {gradingId === sub.id && (
                    <form onSubmit={handleSubmit(onGrade)} className="mt-4 border-t border-gray-100 pt-4 flex gap-3 items-end">
                      <div className="flex-1">
                        <input type="number" {...register('marks', { required: true, min: 0, max: assignment?.totalMarks })}
                          placeholder={`Marks (0–${assignment?.totalMarks})`}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-sky-300" />
                        <input {...register('feedback')} placeholder="Feedback (optional)" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setGradingId(null)} className="text-xs border border-gray-200 rounded-xl px-3 py-2">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="text-xs bg-emerald-600 text-white px-3 py-2 rounded-xl font-medium disabled:opacity-60">Save</button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </main>
      </div>

      {resetTarget && (
        <ConfirmModal
          title="Allow re-attempt?"
          message={`This permanently deletes ${resetTarget.student?.user?.name}'s current submission${resetTarget.marks != null ? ` (marks: ${resetTarget.marks}/${assignment?.totalMarks})` : ''} so they can submit again from scratch. This can't be undone.`}
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

const Q_TYPE_LABEL: Record<string, string> = {
  MCQ: 'Multiple Choice', TF: 'True/False', MATCHING: 'Matching', NUMERICAL: 'Numerical',
  ...H5P_TYPE_LABEL,
}

function PerQuestionGrader({ submissionId, totalMarks, onGraded }: { submissionId: string; totalMarks: number; onGraded: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['submission-detail', submissionId],
    queryFn: async () => {
      const r = await apiFetch(`/api/assignments/submissions/${submissionId}/detail`)
      if (!r.ok) throw new Error('Failed to load')
      return r.json() as Promise<{
        submission: { id: string; status: string; marks: number | null; latePenaltyApplied: number | null }
        assignmentTotalMarks: number
        questions: Array<{ id: string; type: string; prompt: string; points: number; order: number; data: any }>
        answers: Array<{ id: string; questionId: string; response: any; pointsAwarded: number | null; autoGraded: boolean; feedback: string | null }>
      }>
    },
  })

  const gradeAns = useMutation({
    mutationFn: async ({ answerId, pointsAwarded, feedback }: { answerId: string; pointsAwarded: number | null; feedback: string | null }) => {
      const r = await apiFetch(`/api/assignments/answers/${answerId}/grade`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointsAwarded, feedback }),
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.message || 'Failed') }
      return r.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['submission-detail', submissionId] }); onGraded() },
  })

  if (isLoading) return <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">Loading answers…</div>
  if (isError || !data) return <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-red-500">Failed to load answers.</div>

  const answerByQ = new Map(data.answers.map(a => [a.questionId, a]))

  return (
    <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
      {data.questions.map((q, i) => {
        const a = answerByQ.get(q.id)
        return (
          <AnswerRow
            key={q.id}
            index={i + 1}
            question={q}
            answer={a}
            onSave={(pts, fb) => a && gradeAns.mutate({ answerId: a.id, pointsAwarded: pts, feedback: fb })}
          />
        )
      })}
      <p className="text-xs text-slate-500">Total: <strong>{data.submission.marks ?? '—'}</strong> / {data.assignmentTotalMarks}{data.submission.latePenaltyApplied ? ` (late −${data.submission.latePenaltyApplied}%)` : ''}</p>
    </div>
  )
}

function AnswerRow({ index, question, answer, onSave }: { index: number; question: { id: string; type: string; prompt: string; points: number; data: any }; answer: any; onSave: (pts: number | null, fb: string | null) => void }) {
  const [pts, setPts] = useState<string>(answer?.pointsAwarded != null ? String(answer.pointsAwarded) : '')
  const [fb, setFb] = useState<string>(answer?.feedback ?? '')
  const isCorrect = question.type === 'MCQ' && Array.isArray(question.data?.choices)
    ? question.data.choices.filter((c: any) => c.isCorrect).map((c: any) => c.id)
    : null

  function renderResponse() {
    const r = answer?.response
    if (r == null || r === '') return <span className="italic text-slate-400">(no answer)</span>
    if (question.type === 'MCQ') {
      const sel = Array.isArray(r) ? r : [r]
      const choices = question.data?.choices ?? []
      return (
        <ul className="space-y-0.5">
          {choices.map((c: any) => {
            const chosen = sel.includes(c.id)
            const correct = isCorrect?.includes(c.id)
            return <li key={c.id} className={`text-xs ${chosen ? (correct ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold') : (correct ? 'text-emerald-600' : 'text-slate-400')}`}>{chosen ? '●' : '○'} <MathText as="span" text={c.text} /> {correct && !chosen ? '(correct)' : ''}</li>
          })}
        </ul>
      )
    }
    if (question.type === 'TF') return <span>Student: <strong>{r === true ? 'True' : r === false ? 'False' : String(r)}</strong> · Correct: <strong>{question.data?.correct ? 'True' : 'False'}</strong></span>
    if (question.type === 'NUMERICAL') return <span>Student: <strong>{String(r)}</strong> · Correct: <strong>{question.data?.correct}</strong> ± {question.data?.tolerance ?? 0}</span>
    if (question.type === 'MATCHING') {
      const pairs = Array.isArray(r) ? r : []
      const leftMap = Object.fromEntries((question.data?.left ?? []).map((l: any) => [l.id, l.text]))
      const rightMap = Object.fromEntries((question.data?.right ?? []).map((r: any) => [r.id, r.text]))
      return <ul className="text-xs space-y-0.5">{pairs.map((p: any, i: number) => <li key={i}>{leftMap[p.leftId] ?? '?'} → {rightMap[p.rightId] ?? '(none)'}</li>)}</ul>
    }
    if (question.type === 'ESSAY') return <div className="text-xs bg-slate-50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-auto">{String(r)}</div>
    if (question.type === 'SORT_PARAGRAPHS') {
      const correctOrder: string[] = (question.data?.paragraphs ?? []).map((p: any) => p.id)
      const byId = Object.fromEntries((question.data?.paragraphs ?? []).map((p: any) => [p.id, p.text]))
      const given: string[] = Array.isArray(r) ? r : []
      return (
        <ol className="text-xs space-y-0.5 list-decimal list-inside">
          {given.map((id, i) => {
            const rightSpot = correctOrder[i] === id
            return <li key={id} className={rightSpot ? 'text-emerald-700' : 'text-red-600'}>{byId[id] ? <MathText as="span" text={byId[id]} /> : '(unknown)'}</li>
          })}
        </ol>
      )
    }
    if (question.type === 'DRAG_WORDS') {
      const blanks = parseDragWordsText(question.data?.text || '').filter((s): s is { type: 'blank'; id: string; answer: string; group: 'a' | 'b' } => s.type === 'blank')
      const given: Record<string, string> = r && typeof r === 'object' ? r : {}
      return (
        <div className="text-xs space-y-0.5">
          {blanks.map(b => {
            const val = given[b.id]
            const ok = (val || '').trim().toLowerCase() === b.answer.trim().toLowerCase()
            return <div key={b.id}>Blank &quot;{b.answer}&quot;: <span className={ok ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{val || '(blank)'}</span></div>
          })}
        </div>
      )
    }
    if (question.type === 'FILL_BLANKS') {
      const blanks = parseFillBlanksText(question.data?.text || '').filter((s): s is { type: 'blank'; id: string; answers: string[] } => s.type === 'blank')
      const given: Record<string, string> = r && typeof r === 'object' ? r : {}
      return (
        <div className="text-xs space-y-0.5">
          {blanks.map(b => {
            const val = given[b.id]
            const ok = b.answers.some((a) => (val || '').trim().toLowerCase() === a.trim().toLowerCase())
            return <div key={b.id}>Blank &quot;{b.answers.join(' / ')}&quot;: <span className={ok ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{val || '(blank)'}</span></div>
          })}
        </div>
      )
    }
    if (question.type === 'DRAG_DROP') {
      const items: Array<{ id: string; label: string; correctZoneId: string }> = question.data?.items ?? []
      const zones: Array<{ id: string }> = question.data?.zones ?? []
      const given: Record<string, string> = r && typeof r === 'object' ? r : {}
      return (
        <div className="text-xs space-y-0.5">
          {items.map(it => {
            const zoneId = given[it.id]
            const ok = zoneId === it.correctZoneId
            const zoneIdx = zones.findIndex(z => z.id === zoneId)
            return <div key={it.id}><MathText as="span" text={it.label} />: <span className={ok ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{zoneId ? `Zone ${zoneIdx + 1}` : '(not placed)'}</span></div>
          })}
        </div>
      )
    }
    if (question.type === 'SPEAK_WORDS') return <span>{String(r)}</span>
    if (question.type === 'SPEAK_WORDS_SET') {
      const items: Array<{ id: string; prompt: string }> = question.data?.items ?? []
      const given: Record<string, string> = r && typeof r === 'object' ? r : {}
      return (
        <div className="text-xs space-y-0.5">
          {items.map(it => <div key={it.id}><MathText as="span" text={it.prompt} />: <span className="text-slate-700">{given[it.id] || '(no answer)'}</span></div>)}
        </div>
      )
    }
    if (question.type === 'DICTATION') {
      return (
        <div className="text-xs space-y-0.5">
          {diffWords(question.data?.script || '', String(r)).map((d, i) => (
            <span key={i} className={`mr-1 ${d.match ? 'text-emerald-700' : 'text-red-600 line-through'}`}>{d.word}</span>
          ))}
        </div>
      )
    }
    return <span>{JSON.stringify(r)}</span>
  }

  const needsManualGrading = !answer?.autoGraded
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-[10px] uppercase font-semibold bg-slate-100 px-1.5 py-0.5 rounded">Q{index}</span>
        <span className="text-[10px] uppercase font-semibold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">{Q_TYPE_LABEL[question.type] ?? question.type}</span>
        <span className="text-[10px] uppercase font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">{question.points} pt</span>
        {answer?.autoGraded && <span className="text-[10px] uppercase font-semibold bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">auto</span>}
        {answer?.pointsAwarded == null && <span className="text-[10px] uppercase font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">needs grading</span>}
      </div>
      <RichText as="div" className="text-sm text-slate-800 mb-2 whitespace-pre-wrap" html={question.prompt} />
      <div className="mb-2">{renderResponse()}</div>
      <div className="flex gap-2 items-center mt-2">
        <input
          type="number" min={0} max={question.points} step="any"
          value={pts}
          onChange={e => setPts(e.target.value)}
          placeholder={`/ ${question.points}`}
          className={`w-20 border rounded-lg px-2 py-1 text-xs ${needsManualGrading ? 'border-amber-300' : ''}`}
        />
        <span className="text-xs text-slate-400">/ {question.points}</span>
        <input
          value={fb}
          onChange={e => setFb(e.target.value)}
          placeholder="Feedback (optional)"
          className="flex-1 border rounded-lg px-2 py-1 text-xs"
        />
        <button
          onClick={() => onSave(pts === '' ? null : Number(pts), fb || null)}
          className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-emerald-700"
        >Save</button>
      </div>
    </div>
  )
}
