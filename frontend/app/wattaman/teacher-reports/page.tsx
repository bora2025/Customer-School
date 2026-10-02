'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { wattamanNav } from '../../../lib/wattaman-nav'
import { reporterNav } from '../../../lib/reporter-nav'
import { apiFetch } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import Link from 'next/link'

interface TeacherAttendanceRecord {
  id: string
  date: string
  period: number
  status: string
  checkIn: string | null
}

interface TeacherMonthlyRow {
  id: string
  name: string
  short: string
  color: string | null
  weeklyLessons: number
  lessons: { subjectName: string; className: string; perWeek: number }[]
  present: number
  late: number
  absent: number
  total: number
  attendances: TeacherAttendanceRecord[]
}

interface TimetableInfo {
  id: string
  name: string
  academicYear: string
  status: string
}

function statusBadge(status: string) {
  if (status === 'PRESENT') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">✓ Present</span>
  if (status === 'LATE') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">⚠ Late</span>
  if (status === 'ABSENT') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">✗ Absent</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">{status}</span>
}

function TeacherReportsContent() {
  const searchParams = useSearchParams()
  const preselectedTimetableId = searchParams.get('timetableId') ?? ''
  const [timetables, setTimetables] = useState<TimetableInfo[]>([])
  const [selectedTimetableId, setSelectedTimetableId] = useState('')
  const [teachers, setTeachers] = useState<TeacherMonthlyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const now = new Date()
  const defaultStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().split('T')[0]
  const defaultEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)

  // Load timetable list on mount
  useEffect(() => {
    apiFetch('/api/timetable')
      .then(r => r.ok ? r.json() : [])
      .then((data: TimetableInfo[]) => {
        setTimetables(data)
        const published = preselectedTimetableId
          ? (data.find(t => t.id === preselectedTimetableId) ?? data.find(t => t.status === 'PUBLISHED') ?? data[0])
          : (data.find(t => t.status === 'PUBLISHED') ?? data[0])
        if (published) setSelectedTimetableId(published.id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedTimetableId) fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTimetableId, startDate, endDate])

  const fetchReport = async () => {
    if (!selectedTimetableId) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(
        `/api/timetable/${selectedTimetableId}/teacher-attendance/monthly?startDate=${startDate}&endDate=${endDate}`
      )
      if (!res.ok) throw new Error('Failed to load report')
      setTeachers(await res.json())
    } catch {
      setError('Failed to load teacher attendance report.')
    } finally {
      setLoading(false)
    }
  }

  const goMonth = (offset: number) => {
    const d = new Date(startDate + 'T00:00:00Z')
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + offset
    const first = new Date(Date.UTC(y, m, 1))
    const last = new Date(Date.UTC(y, m + 1, 0))
    setStartDate(first.toISOString().split('T')[0])
    setEndDate(last.toISOString().split('T')[0])
  }

  const monthLabel = new Date(startDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const totalPresent = teachers.reduce((s, t) => s + t.present, 0)
  const totalLate = teachers.reduce((s, t) => s + t.late, 0)
  const totalAbsent = teachers.reduce((s, t) => s + t.absent, 0)
  const totalScans = teachers.reduce((s, t) => s + t.total, 0)

  const printUrl = `/wattaman/teacher-reports/print?timetableId=${selectedTimetableId}&startDate=${startDate}&endDate=${endDate}&timetableName=${encodeURIComponent(timetables.find(t => t.id === selectedTimetableId)?.name ?? '')}`

  const isReporter = typeof window !== 'undefined' && localStorage.getItem('role') === 'WATTAMAN_REPORTER'

  return (
    <div className="page-shell">
      <Sidebar
        title={isReporter ? 'Reporter' : 'Wattaman'}
        subtitle="QR Attendance"
        navItems={isReporter ? reporterNav : wattamanNav}
        accentColor={isReporter ? 'teal' : 'emerald'}
        bottomTabs={isReporter ? undefined : ['/wattaman', '/wattaman/scan', '/wattaman/usb-scan', '/wattaman/teacher-scan', '/wattaman/teacher-reports']}
      />
      <div className="page-content">
        <div className="h-14 lg:hidden" />

        <div className="page-header">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Teacher Attendance Reports</h1>
              <p className="text-sm text-slate-500 mt-1">Monthly totals · Based on timetable schedule</p>
            </div>
            <Link
              href={printUrl}
              target="_blank"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
              </svg>
              Print
            </Link>
          </div>
        </div>

        <div className="page-body space-y-6">

          {/* Controls */}
          <div className="card p-3 sm:p-4">
            <div className="space-y-3 lg:space-y-0 lg:flex lg:flex-wrap lg:gap-4 lg:items-end">
              {/* Timetable selector */}
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">Timetable</label>
                <select
                  value={selectedTimetableId}
                  onChange={e => setSelectedTimetableId(e.target.value)}
                  className="w-full lg:w-56 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-400 outline-none"
                >
                  {timetables.map(tt => (
                    <option key={tt.id} value={tt.id}>{tt.name} ({tt.academicYear}) {tt.status === 'PUBLISHED' ? '✓' : '(draft)'}</option>
                  ))}
                </select>
              </div>

              {/* Month selector */}
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">Month</label>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => goMonth(-1)} className="flex-shrink-0 px-2 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">◀</button>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => {
                      const d = new Date(e.target.value + 'T00:00:00Z')
                      const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
                      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
                      setStartDate(first.toISOString().split('T')[0])
                      setEndDate(last.toISOString().split('T')[0])
                    }}
                    className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-400 outline-none"
                  />
                  <button onClick={() => goMonth(1)} className="flex-shrink-0 px-2 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">▶</button>
                </div>
              </div>

              {/* Custom date range */}
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">Custom End</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full lg:w-40 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-400 outline-none"
                />
              </div>
            </div>
            <p className="mt-2 text-xs sm:text-sm font-medium text-slate-700">{monthLabel} · {startDate} → {endDate}</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Scans', value: totalScans, color: 'text-slate-700' },
              { label: 'Present', value: totalPresent, color: 'text-emerald-600' },
              { label: 'Late', value: totalLate, color: 'text-amber-600' },
              { label: 'Absent', value: totalAbsent, color: 'text-red-600' },
            ].map(s => (
              <div key={s.label} className="card p-3 sm:p-4">
                <p className="text-xs text-slate-500 font-medium">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Teacher table */}
          {loading ? (
            <div className="card p-12 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : teachers.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="font-semibold text-slate-600">No attendance records</p>
              <p className="text-sm text-slate-400 mt-1">No teacher attendance found for this period.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="card overflow-hidden hidden sm:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                        <th className="px-4 py-3 font-semibold">Teacher</th>
                        <th className="px-4 py-3 font-semibold text-center">Lessons/wk</th>
                        <th className="px-4 py-3 font-semibold text-center text-emerald-700">Present</th>
                        <th className="px-4 py-3 font-semibold text-center text-amber-700">Late</th>
                        <th className="px-4 py-3 font-semibold text-center text-red-700">Absent</th>
                        <th className="px-4 py-3 font-semibold text-center">Total</th>
                        <th className="px-4 py-3 font-semibold text-center">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teachers.map(t => (
                        <>
                          <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: t.color || '#00C9A7' }}>
                                  {t.short?.charAt(0) ?? t.name.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-800">{t.name}</p>
                                  <p className="text-xs text-slate-400">{t.lessons.map(l => `${l.subjectName}/${l.className}`).join(', ')}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center font-semibold text-slate-600">{t.weeklyLessons}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-lg font-bold text-emerald-600">{t.present}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-lg font-bold text-amber-600">{t.late}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-lg font-bold text-red-600">{t.absent}</span>
                            </td>
                            <td className="px-4 py-3 text-center font-semibold text-slate-600">{t.total}</td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                                className="text-xs text-emerald-600 hover:text-emerald-800 font-medium underline"
                              >
                                {expandedId === t.id ? 'Hide' : 'Show'} ({t.attendances.length})
                              </button>
                            </td>
                          </tr>
                          {expandedId === t.id && t.attendances.length > 0 && (
                            <tr key={`${t.id}-detail`} className="bg-slate-50 border-t border-slate-100">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                  {t.attendances.map(a => (
                                    <div key={a.id} className="bg-white rounded-lg border border-slate-200 px-2.5 py-2 text-xs">
                                      <p className="text-slate-500 mb-1">
                                        {new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · P{a.period}
                                      </p>
                                      {statusBadge(a.status)}
                                      {a.checkIn && (
                                        <p className="text-slate-400 mt-1">{formatCambodiaTime(a.checkIn)}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                      <tr className="text-sm font-semibold">
                        <td className="px-4 py-3 text-slate-700">Total ({teachers.length} teachers)</td>
                        <td className="px-4 py-3 text-center text-slate-600">—</td>
                        <td className="px-4 py-3 text-center text-emerald-700">{totalPresent}</td>
                        <td className="px-4 py-3 text-center text-amber-700">{totalLate}</td>
                        <td className="px-4 py-3 text-center text-red-700">{totalAbsent}</td>
                        <td className="px-4 py-3 text-center text-slate-700">{totalScans}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 sm:hidden">
                {teachers.map(t => (
                  <div key={t.id} className="card overflow-hidden">
                    <button
                      className="w-full text-left p-4 flex items-center gap-3"
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: t.color || '#00C9A7' }}>
                        {t.short?.charAt(0) ?? t.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{t.name}</p>
                        <div className="flex gap-2 mt-1 text-xs">
                          <span className="text-emerald-600 font-semibold">{t.present}P</span>
                          <span className="text-amber-600 font-semibold">{t.late}L</span>
                          <span className="text-red-600 font-semibold">{t.absent}A</span>
                          <span className="text-slate-400">· {t.total} total</span>
                        </div>
                      </div>
                      <svg className={`flex-shrink-0 text-slate-400 transition-transform ${expandedId === t.id ? 'rotate-180' : ''}`} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                    {expandedId === t.id && t.attendances.length > 0 && (
                      <div className="border-t border-slate-100 p-4">
                        <div className="grid grid-cols-2 gap-2">
                          {t.attendances.map(a => (
                            <div key={a.id} className="bg-slate-50 rounded-lg px-2.5 py-2 text-xs">
                              <p className="text-slate-500 mb-1">
                                {new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · P{a.period}
                              </p>
                              {statusBadge(a.status)}
                              {a.checkIn && (
                                <p className="text-slate-400 mt-1">{formatCambodiaTime(a.checkIn)}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Quick link to scan */}
          <Link href="/wattaman/teacher-scan" className="block">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-800">Scan Teacher Now</p>
                <p className="text-xs text-emerald-600">Open camera to record teacher attendance</p>
              </div>
              <svg className="ml-auto text-emerald-400" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>

        </div>
      </div>
    </div>
  )
}

export default function TeacherReportsPage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN', 'ADMIN', 'WATTAMAN_REPORTER']}>
      <Suspense>
        <TeacherReportsContent />
      </Suspense>
    </AuthGuard>
  )
}
