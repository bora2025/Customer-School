"use client"

import { uid } from '../../lib/h5pQuestionLogic'
import { AcceptedAnswersEditor, SpeechCaptureInput } from './SpeakWordsField'
import MathText from '../MathText'

interface SetItem { id: string; prompt: string; acceptedAnswers: string[] }

/** Authoring editor for Speak the Words Set. `data: { items: [{id, prompt, acceptedAnswers}] }` —
 * one question card holding a sequence of prompts answered in turn. */
export function SpeakWordsSetEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const items: SetItem[] = data?.items ?? []

  function addItem() { onChange({ items: [...items, { id: uid('sw'), prompt: '', acceptedAnswers: [''] }] }) }
  function updateItem(i: number, patch: Partial<SetItem>) { onChange({ items: items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }) }
  function removeItem(i: number) { onChange({ items: items.filter((_, idx) => idx !== i) }) }

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={it.id} className="border rounded-lg p-2 bg-white space-y-1.5 relative">
          <button type="button" onClick={() => removeItem(i)} disabled={items.length <= 1} className="absolute top-1.5 right-1.5 text-red-400 text-xs disabled:opacity-30">✕</button>
          <label className="block text-[11px] text-slate-500">Prompt {i + 1}
            <input value={it.prompt} onChange={e => updateItem(i, { prompt: e.target.value })} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <AcceptedAnswersEditor answers={it.acceptedAnswers} onChange={a => updateItem(i, { acceptedAnswers: a })} />
        </div>
      ))}
      <button type="button" onClick={addItem} className="text-xs text-sky-600 hover:underline">+ Add prompt</button>
    </div>
  )
}

/** Student-facing input for Speak the Words Set. `data: { items: [{id, prompt}] }`,
 * `value: Record<itemId, string>` (transcript per item). */
export function SpeakWordsSetInput({ data, value, onChange, disabled }: { data: any; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const items: { id: string; prompt: string }[] = data?.items ?? []
  const answers: Record<string, string> = value && typeof value === 'object' ? value : {}

  return (
    <div className="space-y-4">
      {items.map((it, i) => (
        <div key={it.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
          <p className="text-sm font-medium text-slate-800 mb-2">{i + 1}. <MathText as="span" text={it.prompt} /></p>
          <SpeechCaptureInput
            value={answers[it.id] || ''}
            onChange={v => onChange({ ...answers, [it.id]: v })}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  )
}
