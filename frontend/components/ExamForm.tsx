"use client"

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { apiFetch } from '../lib/api'
import { ExamQuestionsEditor, defaultQuestion, type ExamQuestionDraft } from './ExamQuestionsEditor'

export interface ExamClassItem { id: string; name: string; subject?: string }

export interface ExamEditInitialData {
  title: string; description: string; classId: string
  duration: number; totalMarks: number; passMark: number; maxAttempts: number
  questions: ExamQuestionDraft[]
}

/** Shared create/edit exam form — a page section (the caller owns the
 * Sidebar/breadcrumb chrome around it), used identically by admin's
 * Examinations page, the Manage Classes exams panel, and the teacher's own
 * Examinations page. Previously a modal dialog; moved to a real page since
 * even a near-fullscreen modal felt cramped and disorienting next to a normal
 * scrollable page once an exam had more than a handful of questions. */
export default function ExamForm({ classes, examId, initialData, defaultClassId, onCancel, onSuccess }: {
  classes: ExamClassItem[]
  examId?: string
  initialData?: ExamEditInitialData
  defaultClassId?: string
  onCancel: () => void
  onSuccess: () => void
}) {
  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm({
    defaultValues: initialData
      ? { title: initialData.title, description: initialData.description, classId: initialData.classId, duration: initialData.duration, totalMarks: initialData.totalMarks, passMark: initialData.passMark, allowRetake: initialData.maxAttempts !== 1, maxAttempts: initialData.maxAttempts }
      : { title: '', description: '', classId: defaultClassId || '', duration: 60, totalMarks: 100, passMark: 50, allowRetake: false, maxAttempts: 1 },
  })
  const watchAllowRetake = watch('allowRetake')
  const [questions, setQuestions] = useState<ExamQuestionDraft[]>(initialData?.questions?.length ? initialData.questions : [defaultQuestion()])
  const [formError, setFormError] = useState<string | null>(null)

  const onSubmit = async (data: any) => {
    setFormError(null)
    if (!data.allowRetake) data.maxAttempts = 1
    delete data.allowRetake
    const url = examId ? `/api/exams/${examId}` : '/api/exams'
    const method = examId ? 'PUT' : 'POST'
    const body = examId ? { ...data, questions } : { ...data, status: 'DRAFT', questions }
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      onSuccess()
    } else {
      const e = await res.json().catch(() => ({}))
      setFormError(Array.isArray(e?.message) ? e.message.join(', ') : (e?.message || `Failed to ${examId ? 'update' : 'create'} exam`))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-5">
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-500">Exam title *
            <input {...register('title', { required: true })} placeholder="e.g. Midterm — Algebra" className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </label>
          <label className="block text-xs font-semibold text-slate-500">Description
            <input {...register('description')} placeholder="Optional" className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block text-xs font-semibold text-slate-500 col-span-2 sm:col-span-4">Class
            <select {...register('classId')} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300">
              <option value="">All classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-500">Duration (min)
            <input type="number" {...register('duration', { valueAsNumber: true })} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </label>
          <label className="block text-xs font-semibold text-slate-500">Total marks
            <input type="number" {...register('totalMarks', { valueAsNumber: true })} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </label>
          <label className="block text-xs font-semibold text-slate-500">Pass mark
            <input type="number" {...register('passMark', { valueAsNumber: true })} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 grid grid-cols-2 gap-3 items-end">
          <label className="text-xs font-semibold text-slate-600 flex items-center gap-2 col-span-2">
            <input type="checkbox" {...register('allowRetake')} className="h-4 w-4" />
            <span>Allow students to <strong>retake</strong> this exam</span>
          </label>
          {watchAllowRetake ? (
            <label className="block text-xs font-semibold text-slate-500 col-span-2">Max attempts
              <input type="number" min={0} max={50} placeholder="0 = unlimited" {...register('maxAttempts', { valueAsNumber: true })} className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
            </label>
          ) : (
            <span className="text-[11px] text-slate-500 col-span-2">Students get a single attempt.</span>
          )}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <ExamQuestionsEditor questions={questions} onChange={setQuestions} />
        </div>
      </div>

      {/* Sticky within the page's own scroll container (not a fixed overlay) —
          stays reachable no matter how long the question list gets. Flexbox
          already keeps this column clear of the sidebar, so no manual width
          offset is needed. */}
      <div className="sticky bottom-0 mt-6 border border-slate-200 bg-white/95 backdrop-blur rounded-xl px-4 py-3 space-y-2 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        {formError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2">{formError}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="px-4 py-2.5 text-sm font-medium border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 bg-white">Cancel</button>
          <button type="submit" disabled={isSubmitting}
            className="px-4 py-2.5 text-sm bg-sky-600 text-white rounded-xl font-semibold hover:bg-sky-700 disabled:opacity-60 shadow-sm">
            {isSubmitting ? 'Saving…' : (examId ? 'Save Changes' : 'Create Exam')}
          </button>
        </div>
      </div>
    </form>
  )
}
