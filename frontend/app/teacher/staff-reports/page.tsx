'use client'

import { useState, useEffect } from 'react'
import Sidebar from '../../../components/Sidebar'
import { teacherNav } from '../../../lib/teacher-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { todayCambodia } from '../../../lib/dateUtils'

interface StaffGridRow {
  userId: string
  staffNumber: string
  staffName: string
  role: string
  checkInMorning: string | null
  checkOutMorning: string | null
  checkInAfternoon: string | null
  checkOutAfternoon: string | null
  session1Status: string | null
  session2Status: string | null
  session3Status: string | null
  session4Status: string | null
  isHoliday?: boolean
  scanLatitude: number | null
  scanLongitude: number | null
  scanLocation: string | null
}

interface StaffTotalsRow {
  userId: string
  staffNumber: string
  staffName: string
  role: string
  week: { present: number; late: number; absent: number }
  month: { present: number; late: number; absent: number }
  year: { present: number; late: number; absent: number }
}

export default function TeacherStaffReports() {
  const { t } = useLanguage()
  const [selectedDate, setSelectedDate] = useState(() => todayCambodia())
  const [grid, setGrid] = useState<StaffGridRow[]>([])
  const [totals, setTotals] = useState<StaffTotalsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'totals'>('daily')


  useEffect(() => {
    if (selectedDate) fetchData()
  }, [selectedDate])

  const fetchData = async () => {
    setLoading(true)
    setError('')
    try {
      const [gridRes, totalsRes] = await Promise.all([
        apiFetch(`/api/reports/staff-attendance-daily-grid?date=${selectedDate}`),
        apiFetch(`/api/reports/staff-attendance-totals?date=${selectedDate}`),
      ])
      if (gridRes.ok) setGrid(await gridRes.json())
      else setError('Failed to load staff attendance data.')
      if (totalsRes.ok) setTotals(await totalsRes.json())
    } catch (err) {
      console.error('Error fetching staff report data:', err)
      setError('Failed to connect to server.')
    } finally {
      setLoading(false)
    }
  }

  const handleExportGrid = () => {
    apiFetch(`/api/reports/export-staff-grid?date=${selectedDate}`)
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `staff_attendance_${selectedDate}.csv`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => setError('Export failed'))
  }

  const goDay = (offset: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + offset)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const dayLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const isHolidayDate = grid.length > 0 && grid[0].isHoliday === true
  const dailyPresent = grid.filter(r => [r.session1Status, r.session2Status, r.session3Status, r.session4Status].some(s => s === 'PRESENT')).length
  const dailyLate = grid.filter(r => [r.session1Status, r.session2Status, r.session3Status, r.session4Status].some(s => s === 'LATE')).length
  const dailyAbsent = isHolidayDate ? 0 : grid.length - dailyPresent - dailyLate
  const totalStaff = grid.length

  return (
    <div className="page-shell">
      <Sidebar title="Teacher Panel" subtitle="Wattanman" navItems={teacherNav} accentColor="emerald" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">{t('reports.staffTitle')}</h1>
          <p className="text-sm text-slate-500 mt-1">Cambodia Time (GMT+7) · Staff & Admin only</p>
        </div>
        <div className="page-body space-y-6">
          {/* Controls */}
          <div className="card p-3 sm:p-4">
            <div className="space-y-3 lg:space-y-0 lg:flex lg:flex-wrap lg:gap-4 lg:items-end">
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => goDay(-1)} className="flex-shrink-0 px-2 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">◀</button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                  <button onClick={() => goDay(1)} className="flex-shrink-0 px-2 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">▶</button>
                  <button onClick={() => setSelectedDate(todayCambodia())} className="flex-shrink-0 btn-ghost btn-sm py-2.5">
                    📅 Today
                  </button>
                </div>
              </div>
              <button onClick={handleExportGrid} className="w-full lg:w-auto btn-primary btn-sm lg:ml-auto">
                📥 Export CSV
              </button>
            </div>
            <p className="mt-2 text-xs sm:text-sm font-medium text-slate-700">{dayLabel}</p>
          </div>

          {isHolidayDate && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2">
              <span className="text-lg">📅</span>
              <span>This date is a <strong>holiday</strong> — absent counts are excluded.</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">{error}</div>
          )}

          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-200 -mx-1 px-1 scrollbar-hide">
            <button
              onClick={() => setActiveTab('daily')}
              className={`flex-1 min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'daily' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              📋 Daily Attendance
            </button>
            <button
              onClick={() => setActiveTab('totals')}
              className={`flex-1 min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'totals' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              📊 Totals (Week / Month / Year)
            </button>
          </div>

          {loading ? (
            <div className="card p-12">
              <div className="empty-state">
                <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-sm text-slate-500 mt-3">Loading…</p>
              </div>
            </div>
          ) : activeTab === 'daily' ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                <div className="stat-card"><p className="stat-label">Total Staff</p><p className="stat-value">{totalStaff}</p></div>
                <div className="stat-card"><p className="stat-label">Present</p><p className="stat-value text-emerald-600">{dailyPresent}</p></div>
                <div className="stat-card"><p className="stat-label">Late</p><p className="stat-value text-amber-600">{dailyLate}</p></div>
                <div className="stat-card"><p className="stat-label">Not Recorded</p><p className="stat-value text-red-600">{dailyAbsent}</p></div>
              </div>

              {grid.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">👔</p>
                    <p className="font-semibold text-slate-600">No staff attendance data</p>
                    <p className="text-sm text-slate-400 mt-1">No records for {selectedDate}.</p>
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">Day</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">ID</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">Staff Name</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">Role</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">CheckIn</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">Morning</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">CheckOut</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">Morning</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">CheckIn</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">Afternoon</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">CheckOut</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">Afternoon</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center hidden sm:table-cell">
                            <div>📍 Location</div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {grid.map((row) => (
                          <tr key={row.userId} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-500 text-[10px] sm:text-xs hidden sm:table-cell">
                              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.staffNumber}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.staffName}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 hidden sm:table-cell">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                row.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'
                              }`}>
                                {row.role === 'ADMIN' ? '🛡️ Admin' : '👨‍🏫 Teacher'}
                              </span>
                            </td>
                            <SessionCell time={row.checkInMorning} status={row.session1Status} />
                            <SessionCell time={row.checkOutMorning} status={row.session2Status} />
                            <SessionCell time={row.checkInAfternoon} status={row.session3Status} />
                            <SessionCell time={row.checkOutAfternoon} status={row.session4Status} />
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center hidden sm:table-cell">
                              {row.scanLocation ? (
                                <a
                                  href={`https://www.google.com/maps?q=${row.scanLatitude},${row.scanLongitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                  title={`${row.scanLatitude}, ${row.scanLongitude}`}
                                >
                                  📍 {row.scanLocation}
                                </a>
                              ) : row.scanLatitude ? (
                                <a
                                  href={`https://www.google.com/maps?q=${row.scanLatitude},${row.scanLongitude}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  📍 {row.scanLatitude?.toFixed(4)}, {row.scanLongitude?.toFixed(4)}
                                </a>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {totals.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">📊</p>
                    <p className="font-semibold text-slate-600">No data</p>
                    <p className="text-sm text-slate-400 mt-1">No staff attendance totals available.</p>
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">ID</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">Staff Name</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">Role</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center" colSpan={3}><div>Week</div></th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center" colSpan={3}><div>Month</div></th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center" colSpan={3}><div>Year</div></th>
                        </tr>
                        <tr className="text-[9px] sm:text-[10px] text-slate-400 border-b border-slate-200">
                          <th className="px-2 sm:px-3 pb-2"></th>
                          <th className="px-2 sm:px-3 pb-2"></th>
                          <th className="px-2 sm:px-3 pb-2 hidden sm:table-cell"></th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-emerald-600 font-medium">Present</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-amber-500 font-medium">Late</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-red-500 font-medium">Absent</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-emerald-600 font-medium">Present</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-amber-500 font-medium">Late</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-red-500 font-medium">Absent</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-emerald-600 font-medium">Present</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-amber-500 font-medium">Late</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-red-500 font-medium">Absent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {totals.map(row => (
                          <tr key={row.userId} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.staffNumber}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.staffName}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 hidden sm:table-cell">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                row.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'
                              }`}>
                                {row.role === 'ADMIN' ? '🛡️' : '👨‍🏫'} {row.role}
                              </span>
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row.week.present}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row.week.late}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row.week.absent}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row.month.present}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row.month.late}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row.month.absent}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row.year.present}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row.year.late}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row.year.absent}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-700">
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5" colSpan={2}>Total</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 hidden sm:table-cell"></td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r.week.present, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + r.week.late, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r.week.absent, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r.month.present, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + r.month.late, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r.month.absent, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r.year.present, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + r.year.late, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r.year.absent, 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionCell({ time, status }: { time: string | null; status: string | null }) {
  if (!status || status === 'ABSENT') {
    return <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center"><span className="text-[10px] sm:text-xs text-red-400">✗</span></td>
  }
  return (
    <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center">
      <span className={`text-[10px] sm:text-xs font-mono font-medium ${
        status === 'LATE' ? 'text-amber-600' : 'text-emerald-700'
      }`}>
        {time || '✓'}
      </span>
      {status === 'LATE' && (
        <div className="text-[9px] sm:text-[10px] text-amber-500 font-medium">Late</div>
      )}
    </td>
  )
}
