"use client"

/** Authoring editor for the Essay question type. `data: { minWords: number }`. */
export function EssayEditor({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  return (
    <label className="text-xs text-slate-500 block">Minimum words (optional)
      <input
        type="number"
        min={0}
        value={data?.minWords ?? 0}
        onChange={e => onChange({ minWords: Number(e.target.value) || 0 })}
        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
      />
      <p className="text-[11px] text-slate-400 mt-1">Essay answers must be graded manually.</p>
    </label>
  )
}

/** Student-facing input for Essay. `value: string` (free text). */
export function EssayInput({ data, value, onChange, disabled }: { data: any; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const text = typeof value === 'string' ? value : ''
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
  const minWords = data?.minWords || 0
  return (
    <div>
      <textarea
        value={text}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        placeholder="Write your answer here..."
        className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-60 disabled:bg-slate-50"
      />
      <p className={`text-xs mt-1 ${minWords > 0 && wordCount < minWords ? 'text-amber-600' : 'text-slate-400'}`}>
        {wordCount} word{wordCount !== 1 ? 's' : ''}{minWords > 0 ? ` · minimum ${minWords}` : ''} · graded manually by your teacher
      </p>
    </div>
  )
}
