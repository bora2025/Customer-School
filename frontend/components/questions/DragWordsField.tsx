"use client"

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import MathText from '../MathText'
import { parseDragWordsText } from '../../lib/h5pQuestionLogic'

type Group = 'a' | 'b'
type Answer = { word: string; group: Group }

// Hoisted to a stable reference — dnd-kit's useSensor memoizes internally keyed
// on this options object, so passing a fresh literal on every render defeats
// that memoization and makes DndContext redo its setup on every re-render
// (visible as the drag-and-drop UI flashing/resetting on any parent re-render,
// e.g. an exam countdown timer ticking once a second).
const POINTER_ACTIVATION_CONSTRAINT = { activationConstraint: { distance: 4 } }

const BLANK_RE = /_{3,}/g

// data.text keeps storing the *word*/#word# markup as the single source of truth
// (grading and student rendering both parse it directly) — this editor is just a
// friendlier view on top: the sentence shows plain ___ placeholders, and the actual
// words live in a separate numbered answer table below, matching how a teacher
// thinks of it ("blank 1 = playing, blank 2 = their") rather than typing the answer
// inline inside the sentence.
function toSentenceAndAnswers(text: string): { sentence: string; answers: Answer[] } {
  const parsed = parseDragWordsText(text || '')
  let sentence = ''
  const answers: Answer[] = []
  for (const s of parsed) {
    if (s.type === 'text') sentence += s.value
    else { sentence += '___'; answers.push({ word: s.answer, group: s.group }) }
  }
  return { sentence, answers }
}

function toText(sentence: string, answers: Answer[]): string {
  let i = 0
  return sentence.replace(BLANK_RE, () => {
    const a = answers[i++]
    const word = (a?.word || '').trim()
    if (!word) return '___' // leave incomplete blanks as literal text rather than a blank nobody could ever guess
    const marker = a?.group === 'b' ? '#' : '*'
    return `${marker}${word}${marker}`
  })
}

/** Authoring editor for Drag the Words. `data: { text: string, distractors?: string[] }` —
 * see toSentenceAndAnswers/toText above for how the sentence+answer-table UI maps to it.
 * Each answer can be tagged group A (blue) or B (orange) — a purely visual hint so students
 * can tell blank types apart; both are graded identically. */
export function DragWordsEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const distractors: string[] = data?.distractors ?? []

  // sentence/answers are real local state, not re-derived from data.text on every
  // render: an in-progress blank with no answer yet can't round-trip through the
  // *word*/#word# markup (there's no valid way to encode "blank with an empty
  // answer"), so re-parsing after every keystroke would make a freshly-added blank's
  // row disappear before the teacher had a chance to type into it. We only resync
  // from data.text when the parent hands us a genuinely different question's data
  // (e.g. switching selection in an index-keyed list) — never in response to our
  // own edits echoing back through onChange.
  const initial = toSentenceAndAnswers(data?.text ?? '')
  const [sentence, setSentenceState] = useState(initial.sentence)
  const [answers, setAnswersState] = useState<Answer[]>(initial.answers)
  const lastEmitted = useRef<string>(data?.text ?? '')

  useEffect(() => {
    const incoming = data?.text ?? ''
    if (incoming !== lastEmitted.current) {
      const parsed = toSentenceAndAnswers(incoming)
      setSentenceState(parsed.sentence)
      setAnswersState(parsed.answers)
      lastEmitted.current = incoming
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.text])

  function emit(newSentence: string, newAnswers: Answer[]) {
    const nextText = toText(newSentence, newAnswers)
    lastEmitted.current = nextText
    onChange({ ...data, text: nextText })
  }

  function setSentence(newSentence: string) {
    const blankCount = (newSentence.match(BLANK_RE) || []).length
    const newAnswers = Array.from({ length: blankCount }, (_, i) => answers[i] || { word: '', group: 'a' as Group })
    setSentenceState(newSentence)
    setAnswersState(newAnswers)
    emit(newSentence, newAnswers)
  }

  function updateAnswer(i: number, patch: Partial<Answer>) {
    const newAnswers = answers.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    setAnswersState(newAnswers)
    emit(sentence, newAnswers)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Type the sentence with <code className="bg-slate-100 px-1 rounded">___</code> where each blank goes, then fill in the answer for each blank below — e.g. &quot;John likes ___ football with ___ friends.&quot;
      </p>
      <textarea value={sentence} onChange={e => setSentence(e.target.value)} rows={3} placeholder="John likes ___ football with ___ friends." className="w-full border rounded-lg px-3 py-2 text-sm resize-none" />

      {answers.length > 0 && (
        <div className="space-y-1.5">
          {answers.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-14 shrink-0">Blank {i + 1}</span>
              <input
                type="text"
                value={a.word}
                onChange={e => updateAnswer(i, { word: e.target.value })}
                placeholder="Correct word"
                className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {sentence && (
        <div className="text-sm bg-white border rounded-lg p-2 leading-relaxed">
          {(() => {
            const parts = sentence.split(BLANK_RE)
            const out: ReactNode[] = []
            parts.forEach((part, i) => {
              out.push(<span key={`t${i}`}>{part}</span>)
              if (i < parts.length - 1) {
                const a = answers[i]
                const filled = (a?.word || '').trim()
                out.push(
                  <span key={`b${i}`} className={`inline-block px-1.5 py-0.5 rounded mx-0.5 font-medium ${a?.group === 'b' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                    {filled || `blank ${i + 1}`}
                  </span>
                )
              }
            })
            return out
          })()}
        </div>
      )}

      <div>
        <label className="text-xs text-slate-500 block mb-1">Extra decoy words <span className="text-slate-400">(optional, comma-separated — shown in the word bank but don&apos;t fit any blank)</span></label>
        <input
          type="text"
          value={distractors.join(',')}
          onChange={e => onChange({ ...data, distractors: e.target.value.split(',') })}
          placeholder="e.g. Cardiff, Cork, Derry"
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
      </div>
    </div>
  )
}

/** Student-facing input for Drag the Words. `data: { segments, wordBank }` (student-safe shape,
 * segments' blanks and wordBank entries each carry a `group: 'a'|'b'` for color hinting),
 * `value: Record<blankId, string>` (word placed in each blank, or empty). */
export function DragWordsInput({ data, value, onChange, disabled }: { data: any; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const segments: Array<{ type: 'text'; value: string } | { type: 'blank'; id: string; group: Group }> = data?.segments ?? []
  const wordBank: Array<{ word: string; group: Group }> = data?.wordBank ?? []
  const filled: Record<string, string> = value && typeof value === 'object' ? value : {}
  const placedWords = Object.values(filled)
  const sensors = useSensors(useSensor(PointerSensor, POINTER_ACTIVATION_CONSTRAINT))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const word = String(active.id).split('::')[0]
    const overId = String(over.id)
    if (!overId.startsWith('blank::')) return
    const blankId = overId.slice('blank::'.length)
    onChange({ ...filled, [blankId]: word })
  }

  function clearBlank(id: string) {
    const next = { ...filled }
    delete next[id]
    onChange(next)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className={disabled ? 'pointer-events-none opacity-60' : undefined}>
        <div className="text-base leading-loose mb-4">
          {segments.map((seg, i) =>
            seg.type === 'text'
              ? <MathText key={i} as="span" text={seg.value} />
              : <DroppableBlank key={seg.id} id={seg.id} group={seg.group} word={filled[seg.id]} onClear={() => clearBlank(seg.id)} />
          )}
        </div>
        <p className="text-xs text-slate-500 mb-2">Drag a word into each blank (tap a filled blank to clear it).</p>
        <div className="flex flex-wrap gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          {wordBank.length === 0 && <span className="text-xs text-slate-400">No words</span>}
          {wordBank.map((w, i) => (
            <DraggableWord key={`${w.word}::${i}`} id={`${w.word}::${i}`} word={w.word} group={w.group} used={placedWords.includes(w.word)} />
          ))}
        </div>
      </div>
    </DndContext>
  )
}

function DraggableWord({ id, word, group, used }: { id: string; word: string; group: Group; used: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: { word } })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  const colorClass = used
    ? 'border-slate-200 bg-slate-100 text-slate-400'
    : group === 'b'
      ? 'border-amber-300 bg-amber-50 text-amber-700'
      : 'border-sky-300 bg-sky-50 text-sky-700'
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium cursor-grab active:cursor-grabbing touch-none select-none ${colorClass} ${isDragging ? 'opacity-50 z-50 relative' : ''}`}
    >
      {word}
    </button>
  )
}

function DroppableBlank({ id, group, word, onClear }: { id: string; group: Group; word?: string; onClear: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `blank::${id}` })
  const emptyClass = group === 'b' ? 'border-dashed border-slate-300 bg-slate-100 text-slate-400' : 'border-dashed border-slate-300 bg-white text-slate-300'
  return (
    <span
      ref={setNodeRef}
      onClick={word ? onClear : undefined}
      className={`inline-flex items-center justify-center min-w-[70px] mx-1 px-2 py-0.5 rounded-md border-2 align-middle ${isOver ? 'border-sky-500 bg-sky-50' : word ? 'border-solid bg-emerald-50 border-emerald-300 text-emerald-700 font-medium cursor-pointer' : emptyClass}`}
      title={word ? 'Click to clear' : 'Drop a word here'}
    >
      {word || '______'}
    </span>
  )
}
