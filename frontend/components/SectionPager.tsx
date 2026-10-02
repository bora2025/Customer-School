"use client"

/** Previous/Next + numbered page pills for stepping through an exam's sections
 * (e.g. Listening, Reading). Purely presentational — the caller owns which page
 * is "current" and supplies each page's label for the heading/tooltip. */
export default function SectionPager({
  labels, current, onChange,
}: { labels: string[]; current: number; onChange: (i: number) => void }) {
  if (labels.length <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap py-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, current - 1))}
        disabled={current === 0}
        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
      >
        ← Previous
      </button>
      <div className="flex items-center gap-1">
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            title={label}
            aria-current={i === current ? 'page' : undefined}
            className={`w-8 h-8 rounded-full text-sm font-semibold transition-colors ${i === current ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(labels.length - 1, current + 1))}
        disabled={current === labels.length - 1}
        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
      >
        Next →
      </button>
    </div>
  )
}
