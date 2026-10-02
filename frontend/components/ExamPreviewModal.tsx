"use client"

import { useMemo, useState } from 'react'
import { QuestionInput } from './ExamQuestionInput'
import RichText from './RichText'
import SectionPager from './SectionPager'
import { sanitizeForPreview, gradeQuestion, groupQuestionsBySection, TYPE_LABEL, type ExamQuestionDraft } from '../lib/examQuestionLogic'

/**
 * Lets a teacher/admin try an exam exactly as a student would, before publishing it.
 * Nothing here touches the backend — no attempt is created, nothing is persisted.
 * Correct-answer data is stripped via sanitizeForPreview before it reaches the
 * interactive input, and scoring is computed locally via gradeQuestion, mirroring
 * exactly what the real exam-taking flow and backend grader do. No countdown timer
 * here (unlike the real exam-taking page) — a per-second re-render on every open
 * preview isn't worth it for a mode where nothing is actually being timed or graded.
 */
export default function ExamPreviewModal({ questions, onClose }: { questions: ExamQuestionDraft[]; onClose: () => void }) {
  const [answers, setAnswers] = useState<Record<number, any>>({})
  const [checked, setChecked] = useState(false)
  const [page, setPage] = useState(0)

  // Computed once per modal open — re-deriving on every keystroke would reshuffle
  // Sort the Paragraphs / rebuild the Drag the Words word bank mid-interaction.
  const previewData = useMemo(() => questions.map(q => sanitizeForPreview(q.type, q.data)), [questions])

  // Consecutive questions sharing a section (e.g. "Listening") become one page —
  // an exam with no sections assigned collapses to a single page, so SectionPager
  // renders nothing and this behaves exactly like the old single-list preview.
  const pages = useMemo(() => groupQuestionsBySection(questions), [questions])
  const currentPage = pages[Math.min(page, pages.length - 1)] ?? { section: null, questions: [], startIndex: 0 }

  // TEXT (a reading passage) is never numbered as a question — students see "Q1,
  // Q2…" skip straight over it, same as a real exam paper would never label a
  // passage itself as a question.
  const displayNumbers = useMemo(() => {
    let n = 0
    return questions.map((q) => (q.type === 'TEXT' ? null : ++n))
  }, [questions])

  const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0)
  const results = questions.map((q, i) => gradeQuestion(q, answers[i]))
  const autoTotal = results.reduce((s, r) => s + (r.autoGraded ? (r.awarded ?? 0) : 0), 0)
  const hasManual = results.some(r => !r.autoGraded)

  function reset() {
    setAnswers({})
    setChecked(false)
    setPage(0)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl my-4 flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">👁 Exam Preview</h2>
            <p className="text-xs text-amber-600 mt-0.5">Preview mode — nothing here is saved or counted as a real attempt.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none flex-shrink-0">✕</button>
        </div>

        {pages.length > 1 && (
          <div className="px-5 pt-3 border-b border-slate-100">
            {currentPage.section && (
              <p className="text-center text-sm font-bold text-slate-700 mb-1">{currentPage.section}</p>
            )}
            <SectionPager labels={pages.map(p => p.section || 'Questions')} current={page} onChange={setPage} />
          </div>
        )}

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {questions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No questions to preview yet.</p>
          ) : currentPage.questions.map((q, localI) => {
            const i = currentPage.startIndex + localI
            const isPassage = q.type === 'TEXT'
            const result = checked ? results[i] : null
            const badgeClass = result?.autoGraded
              ? (result.awarded === q.marks ? 'bg-emerald-100 text-emerald-700' : (result.awarded ?? 0) > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')
              : ''
            const cardClass = isPassage
              ? 'border-slate-200 bg-slate-50/60'
              : result?.autoGraded
              ? (result.awarded === q.marks ? 'border-emerald-200 bg-emerald-50/40' : (result.awarded ?? 0) > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-red-200 bg-red-50/40')
              : 'border-slate-200'
            return (
              <div key={i} className={`rounded-xl border p-4 ${cardClass}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="font-semibold text-slate-800 text-sm">
                    <span>{isPassage ? '📖 Reading Passage' : `Q${displayNumbers[i]}.`}</span>
                    {q.text ? <RichText as="div" html={q.text} /> : <span className="text-slate-400 italic font-normal">(no question text yet)</span>}
                    {!isPassage && <span className="text-xs font-normal text-slate-400">{TYPE_LABEL[q.type]} · {q.marks} mark{q.marks !== 1 ? 's' : ''}</span>}
                  </div>
                  {!isPassage && checked && result && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${result.autoGraded ? badgeClass : 'bg-slate-100 text-slate-500'}`}>
                      {result.autoGraded ? `+${Math.round((result.awarded ?? 0) * 100) / 100} / ${q.marks}` : 'Manual grading'}
                    </span>
                  )}
                </div>
                <QuestionInput
                  q={{ id: `preview_${i}`, type: q.type, data: previewData[i] }}
                  value={answers[i]}
                  onChange={v => setAnswers(a => ({ ...a, [i]: v }))}
                />
              </div>
            )
          })}
        </div>

        <div className="p-5 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-slate-600">
            {checked ? (
              <span>
                Auto-graded score: <strong>{Math.round(autoTotal * 100) / 100}</strong> / {totalMarks}
                {hasManual && <span className="text-slate-400"> (some questions need manual grading)</span>}
              </span>
            ) : (
              <span className="text-slate-400">{totalMarks} mark{totalMarks !== 1 ? 's' : ''} total</span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="px-4 py-2 text-sm border rounded-lg">Reset</button>
            <button
              type="button"
              onClick={() => setChecked(true)}
              disabled={questions.length === 0}
              className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              Check Answers
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
