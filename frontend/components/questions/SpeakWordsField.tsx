"use client"

import { useEffect } from 'react'
import { useSpeechRecognition } from '../../lib/useSpeechRecognition'
import MathText from '../MathText'

/** Repeatable "accepted answers" list, shared by the Speak the Words editor and
 * (per-item) by the Speak the Words Set editor. */
export function AcceptedAnswersEditor({ answers, onChange }: { answers: string[]; onChange: (a: string[]) => void }) {
  const list = answers.length ? answers : ['']
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-slate-500">Accepted answers</label>
      {list.map((a, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={a}
            onChange={e => { const next = [...list]; next[i] = e.target.value; onChange(next) }}
            placeholder={`Accepted answer ${i + 1}`}
            className="flex-1 border rounded-lg px-2 py-1 text-sm"
          />
          {list.length > 1 && (
            <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))} className="text-xs text-red-500">✕</button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, ''])} className="text-xs text-sky-600 hover:underline">+ Add accepted answer</button>
    </div>
  )
}

/** Authoring editor for Speak the Words. `data: { prompt: string, acceptedAnswers: string[] }`. */
export function SpeakWordsEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-500">Prompt (what the student should say)
        <input value={data?.prompt ?? ''} onChange={e => onChange({ ...data, prompt: e.target.value })} placeholder="e.g. Say the word for 'apple' in French" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
      </label>
      <AcceptedAnswersEditor answers={data?.acceptedAnswers ?? ['']} onChange={a => onChange({ ...data, acceptedAnswers: a })} />
    </div>
  )
}

/** Mic-capture UI shared by Speak the Words and (per-item) Speak the Words Set. Always
 * offers a typed-text fallback since browser speech recognition support (esp. Safari)
 * is inconsistent, and scoring is only as accurate as what the recognizer heard. */
export function SpeechCaptureInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { supported, listening, transcript, error, start, stop } = useSpeechRecognition()

  useEffect(() => {
    if (transcript) onChange(transcript)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript])

  return (
    <div className="space-y-2">
      {supported ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={listening ? stop : start}
            disabled={disabled}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${listening ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'}`}
          >
            {listening ? '⏹ Stop' : '🎤 Record'}
          </button>
          {listening && <span className="text-xs text-slate-400 animate-pulse">Listening…</span>}
        </div>
      ) : (
        <p className="text-xs text-amber-600">Your browser doesn&apos;t support voice input — try Chrome, or type your answer below.</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <input
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder="Your answer (spoken transcript appears here, or type it)"
        className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-60 disabled:bg-slate-50"
      />
      <p className="text-[11px] text-slate-400">Grading is based on what your browser&apos;s speech recognizer heard — it isn&apos;t always perfect.</p>
    </div>
  )
}

/** Student-facing input for Speak the Words. `data: { prompt: string }`, `value: string` (transcript). */
export function SpeakWordsInput({ data, value, onChange, disabled }: { data: any; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  return (
    <div>
      <MathText as="p" className="text-sm font-medium text-slate-800 mb-2" text={data?.prompt} />
      <SpeechCaptureInput value={typeof value === 'string' ? value : ''} onChange={onChange} disabled={disabled} />
    </div>
  )
}
