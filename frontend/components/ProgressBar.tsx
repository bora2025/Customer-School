"use client"

/** Shared thin progress bar, generalized from the course lesson player's
 * original inline `Progress` component. Used anywhere a percentage needs a
 * visual meter instead of bare "{pct}%" text (course engagement reports,
 * lesson lists, attendance rates, etc). */
export default function ProgressBar({
  pct, label, color = 'bg-sky-500', trackColor = 'bg-slate-100', showPercent = true,
}: {
  pct: number
  label?: string
  color?: string
  trackColor?: string
  showPercent?: boolean
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div>
      {(label || showPercent) && (
        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
          <span>{label}</span>
          {showPercent && <span>{Math.round(clamped)}%</span>}
        </div>
      )}
      <div className={`h-2 w-full overflow-hidden rounded-full ${trackColor}`}>
        <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}
