'use client'

import { useState, useEffect, useCallback } from 'react'
import AuthGuard from '../../components/AuthGuard'
import Sidebar from '../../components/Sidebar'
import { wattamanNav } from '../../lib/wattaman-nav'
import Link from 'next/link'
import { getCurrentUser } from '../../lib/api'
import { todayCambodia } from '../../lib/dateUtils'

interface TodayStat { total: number; present: number; late: number; already: number }

function WattamanDashboardContent() {
  const [userName, setUserName] = useState('')
  const [stats, setStats] = useState<TodayStat>({ total: 0, present: 0, late: 0, already: 0 })

  const now = new Date()
  const cambodiaNow = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const hour = cambodiaNow.getUTCHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const todayLabel = cambodiaNow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const loadStats = useCallback(() => {
    try {
      const today = todayCambodia()
      const saved: Array<{ action: string; status: string }> = JSON.parse(
        localStorage.getItem(`wattaman_scans_${today}`) || '[]'
      )
      let total = 0, present = 0, late = 0, already = 0
      saved.forEach(r => {
        total++
        if (r.action === 'ALREADY_RECORDED') already++
        else if (r.status === 'PRESENT') present++
        else if (r.status === 'LATE') late++
      })
      setStats({ total, present, late, already })
    } catch { /* storage unavailable */ }
  }, [])

  useEffect(() => {
    getCurrentUser().then(u => { if (u) setUserName(u.email.split('@')[0]) })
    loadStats()
    // Poll every 3s so stats update even if Next.js router cache prevents remount
    const interval = setInterval(loadStats, 3000)
    const onFocus = () => loadStats()
    const onVisible = () => { if (document.visibilityState === 'visible') loadStats() }
    const onStorage = (e: StorageEvent) => { if (e.key?.startsWith('wattaman_scans_')) loadStats() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadStats])

  return (
    <div className="page-shell">
      <Sidebar title="Wattaman" subtitle="QR Attendance" navItems={wattamanNav} accentColor="emerald" bottomTabs={['/wattaman', '/wattaman/scan', '/wattaman/usb-scan', '/wattaman/teacher-scan', '/wattaman/teacher-reports']} />
      <div className="page-content">
        <div className="h-14 lg:hidden" />

        {/* Greeting */}
        <div className="page-header pb-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-600">{greeting} 👋</p>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mt-0.5">
                {userName ? userName.charAt(0).toUpperCase() + userName.slice(1) : 'Wattaman'}
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">{todayLabel}</p>
            </div>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-lg" style={{ background: 'linear-gradient(135deg,#00C9A7,#00a88a)' }}>
              📷
            </div>
          </div>
        </div>

        <div className="page-body space-y-5">

          {/* Big scan CTA */}
          <Link href="/wattaman/scan" className="block active:scale-[0.98] transition-transform">
            <div className="relative overflow-hidden rounded-2xl shadow-lg p-6 text-white" style={{ background: 'linear-gradient(135deg,#00C9A7 0%,#00a88a 50%,#008f75 100%)' }}>
              <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
              <div className="absolute -right-2 top-8 w-20 h-20 rounded-full bg-white/10" />
              <div className="relative z-10 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white/80 text-sm font-medium">Ready to scan</p>
                  <h2 className="text-2xl font-bold mt-0.5">Open Scanner</h2>
                  <p className="text-white/70 text-xs mt-1">No class selection needed</p>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1.5 text-sm font-semibold">
                    <span>Start Scanning</span>
                    <span>→</span>
                  </div>
                </div>
                <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-4xl flex-shrink-0">📷</div>
              </div>
            </div>
          </Link>

          {/* Today's stats */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Today's scans</p>
              <button onClick={loadStats} className="text-xs text-emerald-600 font-medium active:scale-95 transition-transform">↻ Refresh</button>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {[
              { label: 'Scanned', value: stats.total, gradient: 'from-teal-400 to-emerald-500', icon: '📊' },
              { label: 'Present', value: stats.present, gradient: 'from-green-400 to-emerald-500', icon: '✅' },
              { label: 'Late', value: stats.late, gradient: 'from-amber-400 to-orange-500', icon: '⚠️' },
              { label: 'Again', value: stats.already, gradient: 'from-indigo-400 to-violet-500', icon: '↩' },
            ].map(c => (
              <div key={c.label} className={`rounded-2xl p-2.5 sm:p-4 text-white bg-gradient-to-br ${c.gradient} shadow-sm`}>
                <div className="text-lg sm:text-xl mb-1">{c.icon}</div>
                <div className="text-xl sm:text-2xl font-bold leading-none">{c.value}</div>
                <div className="text-xs text-white/80 mt-0.5">{c.label}</div>
              </div>
            ))}
            </div>
          </div>

          {/* Guide */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <h3 className="font-semibold text-slate-700 text-sm mb-3">How it works</h3>
            <div className="space-y-3">
              {[
                { icon: '📷', title: 'Open Scanner', desc: 'Tap the button above' },
                { icon: '🪪', title: 'Point at Student Card', desc: 'Aim at the QR code on the student ID card' },
                { icon: '✅', title: 'Instant Record', desc: 'Attendance recorded automatically — session & status included' },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-lg flex-shrink-0">{step.icon}</div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">{step.title}</p>
                    <p className="text-xs text-slate-400">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

export default function WattamanDashboardPage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN', 'ADMIN']}>
      <WattamanDashboardContent />
    </AuthGuard>
  )
}
