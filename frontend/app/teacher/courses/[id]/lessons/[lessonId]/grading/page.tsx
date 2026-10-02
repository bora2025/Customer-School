"use client"

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../../../components/AuthGuard'
import { apiFetch } from '../../../../../../../lib/api'
import MathText from '../../../../../../../components/MathText'
import RichText from '../../../../../../../components/RichText'

interface PendingResponse {
  id: string
  answer: any
  page: { id: string; title: string; content: { prompt?: string; points?: number; explanation?: string } }
}
interface PendingAttempt {
  id: string
  studentId: string
  score: number
  maxScore: number
  completedAt: string | null
  responses: PendingResponse[]
  student: { user: { name: string } } | null
}

export default function CourseGradingPage() {
  const params = useParams<{ id: string; lessonId: string }>()
  const courseId = params?.id
  const lessonId = params?.lessonId
  const qc = useQueryClient()

  const { data: attempts = [], isLoading } = useQuery({
    queryKey: ['course-pending-grading', lessonId],
    queryFn: async () => {
      const r = await apiFetch(`/api/courses/lessons/${lessonId}/pending-grading`)
      if (!r.ok) throw new Error('Failed to load')
      return r.json() as Promise<PendingAttempt[]>
    },
    enabled: !!lessonId,
  })

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="min-h-screen bg-slate-50 px-4 sm:px-6 pt-6 pb-[88px] lg:pb-6">
        <div className="max-w-3xl mx-auto">
          <Link href={`/teacher/courses/${courseId}`} className="text-sm text-sky-600 mb-4 block">← Back to course</Link>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mb-1">📝 Grade Pending Answers</h1>
          <p className="text-xs text-slate-500 mb-6">Essay (and other manually-graded) questions awaiting review.</p>

          {isLoading ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="bg-white h-24 rounded-2xl animate-pulse border border-gray-100" />)}</div>
          ) : attempts.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-slate-400">Nothing pending grading right now.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {attempts.map(att => (
                <div key={att.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <p className="font-semibold text-slate-800 mb-3">{att.student?.user?.name ?? 'Unknown student'}</p>
                  <div className="space-y-3">
                    {att.responses.map(resp => (
                      <ResponseRow
                        key={resp.id}
                        response={resp}
                        onGraded={() => qc.invalidateQueries({ queryKey: ['course-pending-grading', lessonId] })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  )
}

function ResponseRow({ response, onGraded }: { response: PendingResponse; onGraded: () => void }) {
  const points = response.page.content?.points ?? 1
  const [pts, setPts] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const answerText = typeof response.answer?.h5pResponse === 'string' ? response.answer.h5pResponse : JSON.stringify(response.answer)

  const gradeMutation = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`/api/courses/responses/${response.id}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointsAwarded: Number(pts) || 0 }),
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.message || 'Failed to save') }
      return r.json()
    },
    onSuccess: onGraded,
    onError: (e: any) => setError(e?.message || 'Failed to save'),
  })

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <p className="text-sm font-semibold text-slate-800 mb-1">{response.page.title}</p>
      <RichText as="div" className="text-xs text-slate-500 mb-2 whitespace-pre-wrap" html={response.page.content?.prompt} />
      <div className="text-sm bg-slate-50 border border-slate-200 rounded p-2 whitespace-pre-wrap mb-2">{answerText ? <MathText as="span" text={answerText} /> : <span className="text-slate-400 italic">(no answer)</span>}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={points}
          step="any"
          value={pts}
          onChange={e => setPts(e.target.value)}
          placeholder="0"
          className="w-20 border border-slate-300 rounded-md px-2 py-1 text-sm"
        />
        <span className="text-xs text-slate-400">/ {points}</span>
        <button
          onClick={() => gradeMutation.mutate()}
          disabled={gradeMutation.isPending}
          className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60"
        >
          {gradeMutation.isPending ? 'Saving…' : 'Save grade'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
