"use client"

import { optionLabel, type QType, type LabelStyle } from '../lib/examQuestionLogic'
import MathText from './MathText'
import { EssayInput } from './questions/EssayField'
import { SortParagraphsInput } from './questions/SortParagraphsField'
import { DragWordsInput } from './questions/DragWordsField'
import { FillBlanksInput } from './questions/FillBlanksField'
import { DragDropInput } from './questions/DragDropField'
import { SpeakWordsInput } from './questions/SpeakWordsField'
import { SpeakWordsSetInput } from './questions/SpeakWordsSetField'
import { DictationInput } from './questions/DictationField'

/** Minimal question shape the interactive input needs — callers may pass richer objects. */
export interface QuestionInputQuestion {
  id: string
  type: QType
  data: any
}

/** Student-facing interactive input for a single exam question, switched by type. Used both
 * by the real exam-taking page and the teacher-facing preview modal. */
export function QuestionInput({ q, value, onChange }: { q: QuestionInputQuestion; value: any; onChange: (v: any) => void }) {
  if (q.type === 'MCQ') {
    const choices: { id: string; text: string }[] = q.data?.choices ?? []
    const multiple = !!q.data?.multiple
    const labelStyle: LabelStyle | undefined = q.data?.labelStyle
    const selected: string[] = Array.isArray(value) ? value : []
    const toggle = (id: string) => {
      if (multiple) {
        onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
      } else {
        onChange([id])
      }
    }
    return (
      <div className="space-y-2">
        {choices.map((c, i) => {
          const isSelected = selected.includes(c.id)
          const label = optionLabel(labelStyle, i)
          return (
            <label key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${isSelected ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <input type={multiple ? 'checkbox' : 'radio'} name={q.id} checked={isSelected} onChange={() => toggle(c.id)} className="sr-only" />
              <div className={`w-5 h-5 border-2 flex items-center justify-center flex-shrink-0 ${multiple ? 'rounded' : 'rounded-full'} ${isSelected ? 'border-sky-500' : 'border-slate-300'}`}>
                {isSelected && <div className={`bg-sky-500 ${multiple ? 'w-2.5 h-2.5 rounded-sm' : 'w-2.5 h-2.5 rounded-full'}`} />}
              </div>
              {label && <span className="text-sm font-semibold text-slate-400 flex-shrink-0">{label}.</span>}
              <MathText as="span" className="text-sm text-slate-700" text={c.text} />
            </label>
          )
        })}
      </div>
    )
  }

  if (q.type === 'TF') {
    return (
      <div className="flex gap-3">
        {[true, false].map((v) => (
          <label key={String(v)} className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-colors ${value === v ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
            <input type="radio" name={q.id} checked={value === v} onChange={() => onChange(v)} className="sr-only" />
            <span className="text-sm font-medium text-slate-700">{v ? 'True' : 'False'}</span>
          </label>
        ))}
      </div>
    )
  }

  if (q.type === 'TEXT') return null // a passage has no answer — its content is the question's own text, shown by the caller
  if (q.type === 'ESSAY') return <EssayInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'SORT_PARAGRAPHS') return <SortParagraphsInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'DRAG_WORDS') return <DragWordsInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'FILL_BLANKS') return <FillBlanksInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'DRAG_DROP') return <DragDropInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'SPEAK_WORDS') return <SpeakWordsInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'SPEAK_WORDS_SET') return <SpeakWordsSetInput data={q.data} value={value} onChange={onChange} />
  if (q.type === 'DICTATION') return <DictationInput data={q.data} value={value} onChange={onChange} />

  return <p className="text-xs text-red-500">Unsupported question type</p>
}
