"use client"

import { useState } from 'react'
import { type QType, type ExamQuestionDraft, type LabelStyle, TYPE_LABEL, LABEL_STYLES, LABEL_STYLE_NAME, optionLabel, uid, defaultData, defaultQuestion } from '../lib/examQuestionLogic'
import RichTextEditor from './RichTextEditor'
import { EssayEditor } from './questions/EssayField'
import { SortParagraphsEditor } from './questions/SortParagraphsField'
import { DragWordsEditor } from './questions/DragWordsField'
import { FillBlanksEditor } from './questions/FillBlanksField'
import { DragDropEditor } from './questions/DragDropField'
import { SpeakWordsEditor } from './questions/SpeakWordsField'
import { SpeakWordsSetEditor } from './questions/SpeakWordsSetField'
import { DictationEditor } from './questions/DictationField'
import ExamPreviewModal from './ExamPreviewModal'

export type { QType, ExamQuestionDraft }
export { TYPE_LABEL, uid, defaultData, defaultQuestion }
export interface Choice { id: string; text: string; isCorrect: boolean }

// Guards against a common mistake: pasting/typing a section name the way it'd be
// written in a list elsewhere (e.g. "Listening", with a wrapping quote and trailing
// comma copied along) — each question gets its OWN plain section name, not a
// combined list, so a stray quote/comma would otherwise become part of the label
// and silently stop two questions meant to share a section from matching.
function cleanSectionLabel(raw: string): string {
  return raw.replace(/^[\s"'“”‘’]+|[\s"'“”‘’,]+$/g, '')
}

/** Small icon-only action button shared by the question toolbar (move/duplicate/delete). */
function ToolbarButton({ onClick, disabled, title, danger, children }: { onClick: () => void; disabled?: boolean; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`w-7 h-7 flex items-center justify-center rounded-lg disabled:opacity-25 disabled:pointer-events-none transition-colors ${danger ? 'text-red-400 hover:bg-red-50 hover:text-red-600' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'}`}
    >
      {children}
    </button>
  )
}

const IconChevronUp = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
const IconChevronDown = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
const IconDuplicate = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
const IconTrash = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>

/** Renders the full "Questions" section: type-switching list + add/remove, for authoring an exam. */
export function ExamQuestionsEditor({ questions, onChange }: { questions: ExamQuestionDraft[]; onChange: (qs: ExamQuestionDraft[]) => void }) {
  const [previewOpen, setPreviewOpen] = useState(false)

  function updateQuestion(i: number, patch: Partial<ExamQuestionDraft>) {
    onChange(questions.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  }
  function changeType(i: number, type: QType) {
    // A Text Passage is never gradable — force marks to 0 so it can't accidentally
    // eat into the exam's total (the marks input is hidden for this type below too).
    updateQuestion(i, { type, data: defaultData(type), marks: type === 'TEXT' ? 0 : questions[i].marks })
  }
  function addQuestion() { onChange([...questions, defaultQuestion()]) }
  function insertQuestionAt(i: number) { onChange([...questions.slice(0, i), defaultQuestion(), ...questions.slice(i)]) }
  function removeQuestion(i: number) { onChange(questions.filter((_, idx) => idx !== i)) }
  function duplicateQuestion(i: number) {
    const copy: ExamQuestionDraft = { ...questions[i], data: JSON.parse(JSON.stringify(questions[i].data ?? {})) }
    onChange([...questions.slice(0, i + 1), copy, ...questions.slice(i + 1)])
  }
  function moveQuestion(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= questions.length) return
    const next = [...questions]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  // Section names already used elsewhere in this exam, offered via a datalist so
  // a teacher typing "Listening" for a 2nd/3rd time gets it spelled consistently —
  // consecutive questions with matching section text become one page for students
  // (see groupQuestionsBySection), so a typo would silently split what was meant
  // to be a single section into two.
  const sectionNames = Array.from(new Set(questions.map(q => (q.section || '').trim()).filter(Boolean)))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-slate-700">Questions</p>
        <button type="button" onClick={() => setPreviewOpen(true)} disabled={questions.length === 0} className="text-xs text-emerald-700 hover:underline disabled:opacity-40">
          👁 Preview
        </button>
      </div>
      <datalist id="exam-section-names">
        {sectionNames.map(name => <option key={name} value={name} />)}
      </datalist>
      <div className="space-y-0">
        {questions.map((q, i) => {
          const section = (q.section || '').trim()
          const prevSection = (questions[i - 1]?.section || '').trim()
          const showSectionDivider = section && section !== prevSection
          return (
          <div key={i}>
            {/* Hover-revealed insert point — lets a question be added at an exact
                position instead of only ever appending at the very end. Always
                occupies real layout space (no negative-margin/zero-height tricks),
                just visually near-empty until hovered. */}
            <div className="group/insert flex items-center h-5 px-1">
              <button
                type="button"
                onClick={() => insertQuestionAt(i)}
                title="Insert question here"
                aria-label="Insert question here"
                className="flex-1 flex items-center opacity-0 group-hover/insert:opacity-100 focus:opacity-100 transition-opacity"
              >
                <span className="flex-1 h-px bg-sky-300" />
                <span className="mx-1.5 w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs leading-none shrink-0">+</span>
                <span className="flex-1 h-px bg-sky-300" />
              </button>
            </div>
            {showSectionDivider && (
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-bold text-sky-700 uppercase tracking-wide">{section}</span>
                <div className="flex-1 h-px bg-sky-200" />
              </div>
            )}
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
            {/* Stacked on mobile — cramming the type/marks grid AND the 4-button
                toolbar into one non-wrapping row squeezed the <select> until it
                visibly truncated ("Multi-Choi…") on narrow phones. */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
              <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
                <select value={q.type} onChange={e => changeType(i, e.target.value as QType)} className="col-span-2 border rounded px-2 py-1 text-sm min-w-0">
                  {(Object.keys(TYPE_LABEL) as QType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
                {q.type === 'TEXT' ? (
                  <span className="border rounded px-2 py-1 text-sm text-slate-400 bg-slate-100 text-center" title="A passage isn't scored">not scored</span>
                ) : (
                  <input type="number" step="any" min={0} value={q.marks} onChange={e => updateQuestion(i, { marks: Number(e.target.value) || 0 })} placeholder="Marks" className="border rounded px-2 py-1 text-sm min-w-0" />
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0 border border-slate-200 rounded-lg bg-white p-0.5 self-start">
                <ToolbarButton onClick={() => moveQuestion(i, -1)} disabled={i === 0} title="Move up"><IconChevronUp /></ToolbarButton>
                <ToolbarButton onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} title="Move down"><IconChevronDown /></ToolbarButton>
                <ToolbarButton onClick={() => duplicateQuestion(i)} title="Duplicate"><IconDuplicate /></ToolbarButton>
                <ToolbarButton onClick={() => removeQuestion(i)} disabled={questions.length <= 1} title="Delete" danger><IconTrash /></ToolbarButton>
              </div>
            </div>
            <input
              type="text"
              list="exam-section-names"
              value={q.section || ''}
              onChange={e => updateQuestion(i, { section: cleanSectionLabel(e.target.value) })}
              placeholder="Section this question belongs to (optional) — e.g. Listening"
              title="One section name per question — questions in a row sharing the same name become one page for students. Leave blank for questions with no section."
              className="w-full border rounded px-2 py-1 text-xs mb-2 text-slate-600"
            />
            <RichTextEditor value={q.text} onChange={text => updateQuestion(i, { text })} placeholder={q.type === 'TEXT' ? `Passage ${i + 1}: paste or write the reading text here` : `Q${i + 1}: Question text`} />

            {q.type === 'MCQ' && (
              <McqEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'TF' && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-500">Correct answer:</span>
                <label className="flex items-center gap-1"><input type="radio" checked={q.data?.correct === true} onChange={() => updateQuestion(i, { data: { correct: true } })} /> True</label>
                <label className="flex items-center gap-1"><input type="radio" checked={q.data?.correct === false} onChange={() => updateQuestion(i, { data: { correct: false } })} /> False</label>
              </div>
            )}
            {q.type === 'ESSAY' && (
              <EssayEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'SORT_PARAGRAPHS' && (
              <SortParagraphsEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'DRAG_WORDS' && (
              <DragWordsEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'FILL_BLANKS' && (
              <FillBlanksEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'DRAG_DROP' && (
              <DragDropEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'SPEAK_WORDS' && (
              <SpeakWordsEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'SPEAK_WORDS_SET' && (
              <SpeakWordsSetEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            {q.type === 'DICTATION' && (
              <DictationEditor data={q.data} onChange={d => updateQuestion(i, { data: d })} />
            )}
            </div>
          </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={addQuestion}
        className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50/50 transition-colors"
      >
        <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xs leading-none">+</span>
        Add Question
      </button>
      {previewOpen && <ExamPreviewModal questions={questions} onClose={() => setPreviewOpen(false)} />}
    </div>
  )
}

function McqEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const choices: Choice[] = data?.choices ?? []
  const multiple = !!data?.multiple
  const labelStyle: LabelStyle = LABEL_STYLES.includes(data?.labelStyle) ? data.labelStyle : 'ALPHA'
  function setChoice(i: number, patch: Partial<Choice>) {
    const next = choices.map((c, idx) => idx === i ? { ...c, ...patch } : c)
    onChange({ ...data, choices: next })
  }
  function addChoice() { onChange({ ...data, choices: [...choices, { id: uid('c'), text: '', isCorrect: false }] }) }
  function removeChoice(i: number) { onChange({ ...data, choices: choices.filter((_, idx) => idx !== i) }) }
  function toggleCorrect(i: number) {
    if (multiple) {
      setChoice(i, { isCorrect: !choices[i].isCorrect })
    } else {
      onChange({ ...data, choices: choices.map((c, idx) => ({ ...c, isCorrect: idx === i })) })
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={multiple} onChange={e => onChange({ ...data, multiple: e.target.checked })} /> Allow multiple correct answers
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Answer labels
          <select value={labelStyle} onChange={e => onChange({ ...data, labelStyle: e.target.value })} className="border rounded-lg px-2 py-1 text-xs">
            {LABEL_STYLES.map(s => <option key={s} value={s}>{LABEL_STYLE_NAME[s]}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-slate-400">Choices are shown to students in random order every time — labels always match what they see.</p>
      {choices.map((c, i) => {
        const label = optionLabel(labelStyle, i)
        return (
          <div key={c.id} className="flex items-center gap-2">
            <input type={multiple ? 'checkbox' : 'radio'} checked={c.isCorrect} onChange={() => toggleCorrect(i)} title="Mark as correct" />
            {label && <span className="text-xs font-semibold text-slate-400 w-5 text-center flex-shrink-0">{label}.</span>}
            <input value={c.text} onChange={e => setChoice(i, { text: e.target.value })} placeholder={`Choice ${i + 1}`} className="flex-1 border rounded-lg px-3 py-1.5 text-sm" />
            <button type="button" onClick={() => removeChoice(i)} disabled={choices.length <= 2} className="text-xs text-red-500 disabled:opacity-30">✕</button>
          </div>
        )
      })}
      <button type="button" onClick={addChoice} className="text-xs text-sky-600 hover:underline">+ Add choice</button>
    </div>
  )
}

