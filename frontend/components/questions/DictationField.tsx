"use client"

import { useRef, useState } from 'react'
import { diffWords } from '../../lib/h5pQuestionLogic'

/** Authoring editor for Dictation. `data: { script: string, audioUrl?: string }`. */
export function DictationEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-slate-500">Script (read aloud to the student)
        <textarea value={data?.script ?? ''} onChange={e => onChange({ ...data, script: e.target.value })} rows={3} placeholder="The text students must type back correctly." className="mt-1 w-full border rounded-lg px-3 py-2 text-sm resize-none" />
      </label>
      <label className="block text-xs text-slate-500">Audio URL (optional — plays a real recording instead of text-to-speech)
        <input value={data?.audioUrl ?? ''} onChange={e => onChange({ ...data, audioUrl: e.target.value })} placeholder="https://example.com/dictation.mp3" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
      </label>
      <p className="text-[11px] text-slate-400">If no audio URL is set, the browser reads the script aloud (text-to-speech) instead.</p>
    </div>
  )
}

/** Student-facing input for Dictation. `data: { script, audioUrl? }`, `value: string` (typed text).
 * `revealFeedback` (set by the parent once the attempt is submitted/reviewed) switches to a
 * word-level diff view — the script itself is never rendered as visible text before that,
 * only ever passed to the audio engine, to avoid defeating the listening exercise. */
export function DictationInput({ data, value, onChange, revealFeedback, disabled }: { data: any; value: any; onChange: (v: any) => void; revealFeedback?: boolean; disabled?: boolean }) {
  const [plays, setPlays] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const text = typeof value === 'string' ? value : ''

  function play() {
    setPlays(p => p + 1)
    if (data?.audioUrl) {
      audioRef.current?.play().catch(() => {})
      return
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && data?.script) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(data.script)
      window.speechSynthesis.speak(utterance)
    }
  }

  if (revealFeedback) {
    const diff = diffWords(data?.script || '', text)
    return (
      <div>
        <p className="text-xs text-slate-500 mb-2">Correct words are highlighted green, misses are red:</p>
        <div className="text-sm bg-slate-50 border rounded-lg p-3 leading-relaxed">
          {diff.map((d, i) => (
            <span key={i} className={`mr-1.5 ${d.match ? 'text-emerald-700' : 'text-red-600 line-through'}`}>{d.word}</span>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">Your answer:</p>
        <p className="text-sm bg-white border rounded-lg p-2 mt-1 whitespace-pre-wrap">{text || <span className="text-slate-400 italic">(no answer)</span>}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {data?.audioUrl && <audio ref={audioRef} src={data.audioUrl} className="hidden" />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={play} disabled={disabled} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-100 text-sky-700 text-sm font-medium disabled:opacity-50">
          ▶ Play{plays > 0 ? ` (${plays})` : ''}
        </button>
        <span className="text-xs text-slate-400">Listen, then type exactly what you hear.</span>
      </div>
      <textarea
        value={text}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder="Type what you hear..."
        className="w-full border rounded-lg px-3 py-2 text-sm resize-none disabled:opacity-60 disabled:bg-slate-50"
      />
    </div>
  )
}
