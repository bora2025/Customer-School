'use client'

import { useEffect, useState } from 'react'
import { getAttendanceNetworkQuality, subscribeAttendanceNetwork, type AttendanceNetworkQuality } from '../lib/offline-attendance'

const styles: Record<AttendanceNetworkQuality['level'], { shell: string; dot: string; bars: number }> = {
  GOOD: { shell: 'border-emerald-400/40 bg-emerald-500/90 text-white', dot: 'bg-emerald-200', bars: 3 },
  FAIR: { shell: 'border-amber-400/50 bg-amber-500/95 text-slate-950', dot: 'bg-amber-100', bars: 2 },
  POOR: { shell: 'border-orange-400/50 bg-orange-600/95 text-white', dot: 'bg-orange-200', bars: 1 },
  OFFLINE: { shell: 'border-slate-500 bg-slate-700/95 text-white', dot: 'bg-slate-300', bars: 0 },
  UNKNOWN: { shell: 'border-sky-400/40 bg-sky-600/95 text-white', dot: 'bg-sky-200', bars: 2 },
}

export default function NetworkQualityBadge() {
  // Stable initial value prevents server/client hydration differences; the real
  // browser measurement is applied immediately after mount.
  const [quality, setQuality] = useState<AttendanceNetworkQuality>({
    level: 'GOOD', label: 'Checking internet…', detail: 'Measuring connection',
  })

  useEffect(() => {
    const update = () => setQuality(getAttendanceNetworkQuality())
    update()
    const unsubscribe = subscribeAttendanceNetwork(update)
    const interval = window.setInterval(update, 5000)
    return () => { unsubscribe(); window.clearInterval(interval) }
  }, [])

  const style = styles[quality.level]
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 shadow-lg backdrop-blur ${style.shell}`}
      title={`${quality.label} — ${quality.detail}`} aria-live="polite">
      <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3].map(bar => (
          <span key={bar} className={`w-1 rounded-sm ${bar <= style.bars ? style.dot : 'bg-current opacity-25'}`}
            style={{ height: `${bar * 4 + 2}px` }} />
        ))}
      </span>
      <span className="leading-tight">
        <span className="block text-[11px] font-extrabold">{quality.label}</span>
        <span className="hidden max-w-44 truncate text-[9px] opacity-85 sm:block">{quality.detail}</span>
      </span>
    </div>
  )
}
