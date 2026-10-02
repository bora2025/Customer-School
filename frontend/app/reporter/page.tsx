'use client'

import Link from 'next/link'
import AuthGuard from '../../components/AuthGuard'
import Sidebar from '../../components/Sidebar'
import { reporterNav } from '../../lib/reporter-nav'
import { apiFetch, getCurrentUser } from '../../lib/api'
import { useState, useEffect } from 'react'
import { todayCambodia } from '../../lib/dateUtils'

interface GroupSummary {
  total: number
  present: number
  absent: number
  late: number
  permission: number
}
interface DetailRow { id: string; name: string; role: string; group: string; present: number; absent: number; late: number; permission: number; address?: string }
interface DashboardData {
  students: GroupSummary
  staff: GroupSummary
  details: DetailRow[]
}

function StatCard({
  label, value, total, color, icon, onClick,
}: {
  label: string; value: number; total: number
  color: 'green' | 'red' | 'amber' | 'blue'
  icon: string; onClick?: () => void
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const styles = {
    green: { bg: 'from-emerald-50 to-emerald-100/50 border-emerald-200/60 hover:border-emerald-300', num: 'text-emerald-700', bar: 'bg-emerald-500' },
    red:   { bg: 'from-red-50 to-red-100/50 border-red-200/60 hover:border-red-300',                 num: 'text-red-700',     bar: 'bg-red-500' },
    amber: { bg: 'from-amber-50 to-amber-100/50 border-amber-200/60 hover:border-amber-300',         num: 'text-amber-700',   bar: 'bg-amber-500' },
    blue:  { bg: 'from-blue-50 to-blue-100/50 border-blue-200/60 hover:border-blue-300',             num: 'text-blue-700',    bar: 'bg-blue-500' },
  }
  const s = styles[color]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`bg-gradient-to-br ${s.bg} border rounded-2xl p-4 flex flex-col gap-2 text-left w-full transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-md active:scale-[0.97]' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-500">{icon} {label}</span>
        <span className="text-xs text-slate-400">{pct}%</span>
      </div>
      <div className={`text-3xl font-extrabold tracking-tight ${s.num}`}>{value}</div>
      <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
        <div className={`h-full ${s.bar} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[11px] text-slate-400">of {total} total{onClick ? ' · tap to view' : ''}</div>
    </Tag>
  )
}

function ReporterDashboardContent() {
  const [userName, setUserName] = useState('')
  const [selectedDate, setSelectedDate] = useState(todayCambodia())
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // Absent modal state
  const [absentModal, setAbsentModal] = useState(false)
  const [absentModalRole, setAbsentModalRole] = useState<'Student' | 'Staff'>('Student')
  const [absentAddressFilter, setAbsentAddressFilter] = useState('')

  useEffect(() => {
    getCurrentUser().then(u => { if (u?.name) setUserName(u.name) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedDate) return
    setLoading(true)
    apiFetch(`/api/reports/dashboard-summary?date=${selectedDate}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedDate])

  const stu = data?.students ?? { total: 0, present: 0, absent: 0, late: 0, permission: 0 }
  const stf = data?.staff    ?? { total: 0, present: 0, absent: 0, late: 0, permission: 0 }

  const openAbsent = (role: 'Student' | 'Staff') => {
    setAbsentModalRole(role)
    setAbsentAddressFilter('')
    setAbsentModal(true)
  }

  // Rows shown in the modal
  const absentRows = (data?.details || []).filter(r => {
    if (absentModalRole === 'Student' && r.role !== 'Student') return false
    if (absentModalRole === 'Staff'   && r.role === 'Student') return false
    if (r.absent === 0) return false
    if (absentAddressFilter.trim()) {
      const q = absentAddressFilter.trim().toLowerCase()
      if (!(r.address || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const exportAbsentCSV = () => {
    if (!absentRows.length) return
    const headers = ['Name', 'Role', 'Class / Dept', 'Address', 'Absent Sessions']
    const rows = absentRows.map(r => [
      `"${r.name}"`,
      r.role,
      `"${r.group || ''}"`,
      `"${r.address || ''}"`,
      r.absent,
    ])
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `absent_${absentModalRole.toLowerCase()}s_${selectedDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reports = [
    { title: 'My Attendance Scan',        desc: 'Scan your QR card to record your own daily attendance.',            href: '/employee/scan',               icon: '📷' },
    { title: 'Staff Attendance Report',   desc: 'Daily, weekly, monthly, and yearly reports for all staff.',         href: '/admin/staff-reports',         icon: '📋' },
    { title: 'Student Attendance Report', desc: 'Attendance records for students, grouped by class.',                 href: '/admin/reports',               icon: '🎓' },
    { title: 'Teacher Attendance Report', desc: 'Teacher lesson attendance and monthly summaries.',                   href: '/wattaman/teacher-reports',    icon: '📚' },
    { title: 'Edit Staff Attendance',     desc: 'Manually add, update, or clear daily records for staff members.',   href: '/admin/staff-attendance/edit', icon: '✏️' },
    { title: 'Edit Student Attendance',   desc: 'Manually add, update, or clear per-session records for students.',  href: '/admin/attendance/edit',       icon: '📝' },
  ]

  return (
    <div className="page-shell">
      <Sidebar title="Reporter" subtitle="Wattaman" navItems={reporterNav} accentColor="teal" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />

        {/* Header */}
        <div className="page-header">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">
                {userName ? `Welcome, ${userName}` : 'Reporter Portal'}
              </h1>
              <p className="text-sm text-slate-500 mt-1">Attendance overview and reports</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="appearance-none bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-400 outline-none"
              />
              <button
                onClick={() => setSelectedDate(todayCambodia())}
                className="px-3 py-2 text-xs font-semibold text-teal-600 bg-teal-50 rounded-xl hover:bg-teal-100 transition-colors"
              >
                Today
              </button>
            </div>
          </div>
        </div>

        <div className="page-body space-y-6">

          {/* ── Student Stat Cards ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full bg-purple-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Students</h2>
              <span className="text-xs bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">{stu.total}</span>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Present"    value={stu.present}    total={stu.total} color="green" icon="✅" />
                <StatCard label="Absent"     value={stu.absent}     total={stu.total} color="red"   icon="❌" onClick={() => openAbsent('Student')} />
                <StatCard label="Late"       value={stu.late}       total={stu.total} color="amber" icon="⏰" />
                <StatCard label="Permission" value={stu.permission} total={stu.total} color="blue"  icon="📋" />
              </div>
            )}
          </section>

          {/* ── Staff Stat Cards ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full bg-cyan-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Staff</h2>
              <span className="text-xs bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">{stf.total}</span>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Present"    value={stf.present}    total={stf.total} color="green" icon="✅" />
                <StatCard label="Absent"     value={stf.absent}     total={stf.total} color="red"   icon="❌" onClick={() => openAbsent('Staff')} />
                <StatCard label="Late"       value={stf.late}       total={stf.total} color="amber" icon="⏰" />
                <StatCard label="Permission" value={stf.permission} total={stf.total} color="blue"  icon="📋" />
              </div>
            )}
          </section>

          {/* ── Quick-access report links ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full bg-teal-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Quick Access</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {reports.map(r => (
                <Link key={r.href} href={r.href} className="card p-5 hover:shadow-md transition-shadow group block">
                  <div className="text-2xl mb-2">{r.icon}</div>
                  <h3 className="text-sm font-semibold text-slate-800 group-hover:text-teal-600 transition-colors mb-1">{r.title}</h3>
                  <p className="text-xs text-slate-500">{r.desc}</p>
                  <div className="mt-3 text-xs font-medium text-teal-600 group-hover:underline">Open →</div>
                </Link>
              ))}
            </div>
          </section>

        </div>
      </div>

      {/* ── Absent Modal ── */}
      {absentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setAbsentModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-800">
                  Absent {absentModalRole === 'Student' ? 'Students' : 'Staff'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">{selectedDate} · {absentRows.length} record{absentRows.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportAbsentCSV}
                  disabled={absentRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-600 text-white text-xs font-semibold rounded-xl hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Export CSV
                </button>
                <button onClick={() => setAbsentModal(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-center">
              <div className="flex flex-1 min-w-[200px] items-center gap-0 rounded-xl border border-slate-200 bg-slate-50 focus-within:bg-white focus-within:border-rose-400 focus-within:ring-2 focus-within:ring-rose-500/20 transition-all overflow-hidden">
                <span className="flex items-center justify-center w-10 h-10 shrink-0 text-slate-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </span>
                <input
                  type="text"
                  placeholder="Filter by address..."
                  value={absentAddressFilter}
                  onChange={e => setAbsentAddressFilter(e.target.value)}
                  className="flex-1 bg-transparent py-2 pr-3 text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                />
                {absentAddressFilter && (
                  <button onClick={() => setAbsentAddressFilter('')} className="flex items-center justify-center w-8 h-8 mr-1 shrink-0 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
              <div className="flex gap-1.5">
                {(['Student', 'Staff'] as const).map(r => (
                  <button key={r} onClick={() => setAbsentModalRole(r)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold ring-1 transition-all ${absentModalRole === r ? 'bg-rose-600 text-white ring-rose-600' : 'bg-rose-50 text-rose-700 ring-rose-200 hover:ring-2'}`}>
                    {r === 'Student' ? 'Students' : 'Staff'}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {absentRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <svg className="w-10 h-10 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  <span className="text-sm text-slate-400">No absent {absentModalRole === 'Student' ? 'students' : 'staff'} found</span>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">{absentModalRole === 'Student' ? 'Class' : 'Dept'}</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Address</th>
                      <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-rose-500 uppercase tracking-wider">Absent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {absentRows.map((row, i) => (
                      <tr key={`${row.id}-${i}`} className="hover:bg-rose-50/40 transition-colors">
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-800">{row.name}</div>
                          <div className="text-[11px] text-slate-400 sm:hidden">{row.group || '-'}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-500 hidden sm:table-cell">{row.group || '-'}</td>
                        <td className="px-3 py-3 text-xs text-slate-500">{row.address || <span className="text-slate-300 italic">—</span>}</td>
                        <td className="text-center px-3 py-3">
                          <span className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg bg-red-50 text-red-700 text-xs font-bold ring-1 ring-red-200/50">{row.absent}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {absentRows.length} record{absentRows.length !== 1 ? 's' : ''}{absentAddressFilter ? ' (filtered by address)' : ''}
              </span>
              <button onClick={() => setAbsentModal(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-xl hover:bg-slate-100 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReporterPage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN_REPORTER', 'ADMIN']}>
      <ReporterDashboardContent />
    </AuthGuard>
  )
}