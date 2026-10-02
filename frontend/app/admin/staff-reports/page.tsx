'use client'

import { useState, useEffect } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { reporterNav } from '../../../lib/reporter-nav'
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
  week: { present: number; late: number; absent: number; dayOff: number; convertedAbsentFromPermission?: number; convertedAbsentHalfFromLate?: number }
  month: { present: number; late: number; absent: number; dayOff: number; convertedAbsentFromPermission?: number; convertedAbsentHalfFromLate?: number }
  year: { present: number; late: number; absent: number; dayOff: number; convertedAbsentFromPermission?: number; convertedAbsentHalfFromLate?: number }
}

function StaffReportsContent() {
  const { t } = useLanguage()
  const [selectedDate, setSelectedDate] = useState(() => todayCambodia())
  const [grid, setGrid] = useState<StaffGridRow[]>([])
  const [totals, setTotals] = useState<StaffTotalsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily')

  // Export form state
  const [showExportForm, setShowExportForm] = useState(false)
  const [exportPeriod, setExportPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily')
  const [exportDate, setExportDate] = useState(() => todayCambodia())
  const [exportDateEnd, setExportDateEnd] = useState(() => todayCambodia())
  const [exportUseCustomRange, setExportUseCustomRange] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [absentThreshold, setAbsentThreshold] = useState(0)  // 0 = disabled (Mostly Absent rule)

  // Print report state
  const [showPrintForm, setShowPrintForm] = useState(false)


  useEffect(() => {
    if (selectedDate) fetchData()
  }, [selectedDate])

  const fetchData = async () => {
    setLoading(true)
    setError('')
    try {
      const [gridRes, totalsRes, ruleRes] = await Promise.all([
        apiFetch(`/api/reports/staff-attendance-daily-grid?date=${selectedDate}`),
        apiFetch(`/api/reports/staff-attendance-totals?date=${selectedDate}`),
        apiFetch('/api/session-config/format-rules?scope=STAFF'),
      ])
      if (gridRes.ok) setGrid(await gridRes.json())
      else setError('Failed to load staff attendance data.')
      if (totalsRes.ok) setTotals(await totalsRes.json())
      if (ruleRes.ok) {
        const rule = await ruleRes.json()
        setAbsentThreshold(rule.enabled ? (rule.absentSessionsForDayAbsent ?? 0) : 0)
      }
    } catch (err) {
      console.error('Error fetching staff report data:', err)
      setError('Failed to connect to server.')
    } finally {
      setLoading(false)
    }
  }

  // Compute the date range for the export preview
  const getExportDateRange = () => {
    if (exportUseCustomRange) {
      return { start: exportDate, end: exportDateEnd, label: `${exportDate} to ${exportDateEnd}` }
    }
    const base = new Date(exportDate + 'T00:00:00Z')
    const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate()
    switch (exportPeriod) {
      case 'weekly': {
        const dayOfWeek = base.getUTCDay()
        const monday = new Date(Date.UTC(y, m, d - ((dayOfWeek + 6) % 7)))
        const sunday = new Date(Date.UTC(y, m, d - ((dayOfWeek + 6) % 7) + 6))
        return {
          start: monday.toISOString().split('T')[0],
          end: sunday.toISOString().split('T')[0],
          label: `${monday.toISOString().split('T')[0]} to ${sunday.toISOString().split('T')[0]} (Mon–Sun)`
        }
      }
      case 'monthly': {
        const first = new Date(Date.UTC(y, m, 1))
        const last = new Date(Date.UTC(y, m + 1, 0))
        return {
          start: first.toISOString().split('T')[0],
          end: last.toISOString().split('T')[0],
          label: `${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
        }
      }
      case 'yearly':
        return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Year ${y}` }
      default:
        return { start: exportDate, end: exportDate, label: exportDate }
    }
  }

  const handleExportReport = async () => {
    setExporting(true)
    setExportMessage('')
    try {
      const res = await apiFetch(`/api/reports/export-staff-xlsx?date=${exportDate}&period=${exportPeriod}`)
      if (!res.ok) throw new Error('Failed to export')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `staff_attendance_${exportPeriod}_${exportDate}.xlsx`
      a.click()
      URL.revokeObjectURL(a.href)
      setExportMessage('✅ Export complete — file downloaded')
    } catch (err: any) {
      setExportMessage(`❌ ${err.message || 'Export failed'}`)
    } finally {
      setExporting(false)
    }
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
  const totalStaff = grid.length

  // Daily headcount — each staff counted exactly once based on dominant status for the day.
  // Precedence: PRESENT > LATE > PERMISSION > ABSENT.
  // Staff with no recorded statuses count as ABSENT on a normal day, 0 on a holiday.
  // Result: dailyPresent + dailyLate + dailyPermission + dailyAbsent === totalStaff (whole numbers).
  const dailyTotals = grid.reduce((acc, r) => {
    const statuses = [r.session1Status, r.session2Status, r.session3Status, r.session4Status]
      .filter(Boolean) as string[]
    const hasPresent    = statuses.some(s => s === 'PRESENT')
    const hasLate       = statuses.some(s => s === 'LATE')
    const hasPermission = statuses.some(s => s === 'PERMISSION' || s === 'DAY_OFF')
    const hasAbsent     = statuses.some(s => s === 'ABSENT')
    const absentCount   = statuses.filter(s => s === 'ABSENT').length

    // "Mostly Absent" override — if absent sessions >= threshold, whole day counts as Absent
    if (absentThreshold > 0 && absentCount >= absentThreshold) {
      if (!isHolidayDate) acc.absent += 1
    }
    else if (hasPresent) acc.present += 1
    else if (hasLate) acc.late += 1
    else if (hasPermission) acc.permission += 1
    else if (hasAbsent) acc.absent += 1
    else if (!isHolidayDate) acc.absent += 1   // no records on a school day → absent
    return acc
  }, { present: 0, late: 0, absent: 0, permission: 0 })

  const dailyPresent = dailyTotals.present
  const dailyLate = dailyTotals.late
  const dailyPermission = dailyTotals.permission
  const dailyAbsent = isHolidayDate ? 0 : dailyTotals.absent

  return (
    <div className="page-shell">
      <Sidebar
        title={typeof window !== 'undefined' && localStorage.getItem('role') === 'WATTAMAN_REPORTER' ? 'Reporter' : 'Admin Panel'}
        subtitle="Wattaman"
        navItems={typeof window !== 'undefined' && localStorage.getItem('role') === 'WATTAMAN_REPORTER' ? reporterNav : adminNav}
        accentColor={typeof window !== 'undefined' && localStorage.getItem('role') === 'WATTAMAN_REPORTER' ? 'teal' : 'indigo'}
      />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">{t('reports.staffTitle')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('reports.cambodiaTime')} · {t('reports.staffAndAdmin')}</p>
        </div>
        <div className="page-body space-y-6">
          {/* Controls */}
          <div className="card p-3 sm:p-4">
            <div className="space-y-3 lg:space-y-0 lg:flex lg:flex-wrap lg:gap-4 lg:items-end">
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('common.date')}</label>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => goDay(-1)} className="flex-shrink-0 px-2 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">◀</button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                  />
                  <button onClick={() => goDay(1)} className="flex-shrink-0 px-2 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm">▶</button>
                  <button onClick={() => setSelectedDate(todayCambodia())} className="flex-shrink-0 btn-ghost btn-sm py-2.5">
                    📅 {t('common.today')}
                  </button>
                </div>
              </div>
              <button onClick={() => setShowPrintForm(true)} className="w-full lg:w-auto btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700">
                🖨️ {t('reports.printReport')}
              </button>
              <button onClick={() => { setExportDate(selectedDate); setShowExportForm(true) }} className="w-full lg:w-auto btn-primary btn-sm lg:ml-auto">
                📊 {t('common.exportReport')}
              </button>
            </div>
            <p className="mt-2 text-xs sm:text-sm font-medium text-slate-700">{dayLabel}</p>
          </div>

          {isHolidayDate && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2">
              <span className="text-lg">📅</span>
              <span dangerouslySetInnerHTML={{ __html: t('reports.holidayNotice') }} />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium">{error}</div>
          )}

          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-200 -mx-1 px-1 scrollbar-hide">
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'daily' ? `📋 ${t('reports.daily')}` : tab === 'weekly' ? `📅 ${t('reports.weekly')}` : tab === 'monthly' ? `📆 ${t('reports.monthly')}` : `📊 ${t('reports.yearly')}`}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="card p-12">
              <div className="empty-state">
                <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-sm text-slate-500 mt-3">Loading…</p>
              </div>
            </div>
          ) : activeTab === 'daily' ? (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-4">
                <div className="stat-card col-span-3 sm:col-span-1"><p className="stat-label">{t('reports.totalStaff')}</p><p className="stat-value">{totalStaff}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.present')}</p><p className="stat-value text-emerald-600">{dailyPresent}</p></div>
                <div className="stat-card"><p className="stat-label">{t('reports.presentLate')}</p><p className="stat-value text-amber-600">{dailyLate}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.absent')}</p><p className="stat-value text-red-600">{dailyAbsent}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.permission')}</p><p className="stat-value text-purple-600">{dailyPermission}</p></div>
              </div>

              {grid.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">👔</p>
                    <p className="font-semibold text-slate-600">{t('reports.noStaffData')}</p>
                    <p className="text-sm text-slate-400 mt-1">{t('reports.noRecordsDay')}</p>
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">{t('common.day')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.id')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.staffName')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">{t('common.position')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">{t('common.checkIn')}</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">{t('reports.morning')}</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">{t('common.checkOut')}</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">{t('reports.morning')}</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">{t('common.checkIn')}</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">{t('reports.afternoon')}</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                            <div className="text-[10px] sm:text-xs">{t('common.checkOut')}</div><div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">{t('reports.afternoon')}</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center hidden sm:table-cell">
                            <div>📍 {t('common.location')}</div>
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
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700">
                                {t('role.' + (row.role || '').toLowerCase()) || row.role}
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
            /* Period Totals Tab (Weekly / Monthly / Yearly) */
            <>
              {totals.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">📊</p>
                    <p className="font-semibold text-slate-600">{t('common.noData')}</p>
                    <p className="text-sm text-slate-400 mt-1">{t('reports.noStaffTotals')}</p>
                  </div>
                </div>
              ) : (() => {
                const periodKey = activeTab === 'weekly' ? 'week' : activeTab === 'monthly' ? 'month' : 'year';
                const periodLabel = activeTab === 'weekly' ? t('reports.weekly') : activeTab === 'monthly' ? t('reports.monthly') : t('reports.yearly');
                return (
                  <div className="card overflow-hidden">
                    <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-slate-50 border-b border-slate-200">
                      <h3 className="text-xs sm:text-sm font-semibold text-slate-700">{periodLabel} {t('reports.attendanceTotals')}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      {(() => {
                        const hasFormatRules = totals.length > 0 && totals.some(r => (r[periodKey].convertedAbsentFromPermission || 0) > 0 || (r[periodKey].convertedAbsentHalfFromLate || 0) > 0);
                        return (
                      <table className="w-full text-xs sm:text-sm">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.id')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.name')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">{t('common.position')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.totalPresent')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.totalPresentLate')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.totalAbsent')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.totalPermission')}</th>
                            {hasFormatRules && (
                              <>
                                <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center text-orange-600 text-[10px] sm:text-xs">Perm→Absent</th>
                                <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center text-orange-600 text-[10px] sm:text-xs">Late→½Absent</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {totals.map(row => (
                            <tr key={row.userId} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.staffNumber}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.staffName}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 hidden sm:table-cell"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-700">{t('role.' + (row.role || '').toLowerCase()) || row.role}</span></td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row[periodKey].present}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row[periodKey].late}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row[periodKey].absent}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600 font-semibold">{row[periodKey].dayOff || 0}</td>
                              {hasFormatRules && (
                                <>
                                  <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-orange-700 font-semibold">{row[periodKey].convertedAbsentFromPermission || 0}</td>
                                  <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-orange-600 font-semibold">{row[periodKey].convertedAbsentHalfFromLate || 0}</td>
                                </>
                              )}
                            </tr>
                          ))}
                          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-700">
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5" colSpan={2}>{t('common.total')}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 hidden sm:table-cell"></td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r[periodKey].present, 0)}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + r[periodKey].late, 0)}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r[periodKey].absent, 0)}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600">{totals.reduce((s, r) => s + (r[periodKey].dayOff || 0), 0)}</td>
                            {hasFormatRules && (
                              <>
                                <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-orange-700">{totals.reduce((s, r) => s + (r[periodKey].convertedAbsentFromPermission || 0), 0)}</td>
                                <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-orange-600">{totals.reduce((s, r) => s + (r[periodKey].convertedAbsentHalfFromLate || 0), 0)}</td>
                              </>
                            )}
                          </tr>
                        </tbody>
                      </table>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* Export Report Modal */}
      {showExportForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setShowExportForm(false); setExportMessage('') }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-white rounded-t-2xl">
              <div>
                <h2 className="text-lg font-bold text-slate-800">📊 {t('reports.exportStaffReport')}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{t('reports.choosePeriodCSV')}</p>
              </div>
              <button onClick={() => { setShowExportForm(false); setExportMessage('') }} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-sm">✕</button>
            </div>

            <div className="p-6 space-y-5">
              {/* Period Selector */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">📅 {t('reports.period')}</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => { setExportPeriod(p); setExportUseCustomRange(false) }}
                      disabled={exportUseCustomRange}
                      className={`px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                        !exportUseCustomRange && exportPeriod === p
                          ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } ${exportUseCustomRange ? 'opacity-50' : ''}`}
                    >
                      {p === 'daily' ? `📋 ${t('reports.daily')}` : p === 'weekly' ? `📅 ${t('common.week')}` : p === 'monthly' ? `📆 ${t('common.month')}` : `📊 ${t('common.year')}`}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportUseCustomRange}
                    onChange={e => setExportUseCustomRange(e.target.checked)}
                    className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm text-slate-600">{t('reports.customDateRange')}</span>
                </label>
              </div>

              {/* Date Picker(s) */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {exportUseCustomRange ? `📆 ${t('reports.startDate')}` : `📆 ${t('common.date')}`}
                </label>
                <input
                  type="date"
                  value={exportDate}
                  onChange={e => setExportDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                />
                {exportUseCustomRange && (
                  <div className="mt-3">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">📆 {t('reports.endDate')}</label>
                    <input
                      type="date"
                      value={exportDateEnd}
                      onChange={e => setExportDateEnd(e.target.value)}
                      min={exportDate}
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Preview/Summary */}
              {(() => {
                const range = getExportDateRange()
                return (
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400">{t('reports.exportPreview')}</h4>
                    <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                      <span className="text-slate-500">{t('reports.type')}:</span>
                      <span className="font-medium text-slate-800">{t('reports.staffAttendance')}</span>
                      <span className="text-slate-500">{t('reports.period')}:</span>
                      <span className="font-medium text-slate-800">{exportUseCustomRange ? t('reports.customRange') : exportPeriod.charAt(0).toUpperCase() + exportPeriod.slice(1)}</span>
                      <span className="text-slate-500">{t('reports.dateRange')}:</span>
                      <span className="font-medium text-slate-800">{range.label}</span>
                    </div>
                  </div>
                )
              })()}

              {/* Export Message */}
              {exportMessage && (
                <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
                  exportMessage.includes('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {exportMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowExportForm(false); setExportMessage('') }} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleExportReport}
                  disabled={exporting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2"
                >
                  {exporting ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t('reports.exporting')}</>
                  ) : (
                    <>📥 {t('reports.downloadXLSX')}</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Report Modal */}
      {showPrintForm && (
        <StaffPrintReportModal
          onClose={() => setShowPrintForm(false)}
          defaultDate={selectedDate}
        />
      )}
    </div>
  )
}

/* ============ STAFF PRINT REPORT MODAL ============ */
function StaffPrintReportModal({
  onClose, defaultDate,
}: {
  onClose: () => void; defaultDate: string
}) {
  const { t } = useLanguage()
  const [printPeriod, setPrintPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>('daily')
  const [printDate, setPrintDate] = useState(defaultDate)
  const [printStartDate, setPrintStartDate] = useState(defaultDate)
  const [printEndDate, setPrintEndDate] = useState(defaultDate)
  const [paperSize, setPaperSize] = useState('A4')
  const [orgName, setOrgName] = useState('Wattaman School')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoTextLines, setLogoTextLines] = useState<string[]>([''])
  const [headerLines, setHeaderLines] = useState<string[]>(['ព្រះរាជាណាចក្រកម្ពុជា', 'ជាតិ សាសនា ព្រះមហាក្សត្រ'])
  const [logoGap, setLogoGap] = useState('4')
  const [logoTextGap, setLogoTextGap] = useState('4')
  const [headerGap, setHeaderGap] = useState('6')
  const [signers, setSigners] = useState<string[]>(['Admin', 'Director'])
  const [studyYears, setStudyYears] = useState<Array<{ year: number; startDate?: string; endDate?: string }>>([])

  // Fetch study years once so yearly period uses the correct startDate/endDate
  useEffect(() => {
    apiFetch('/api/study-years').then(r => r.ok ? r.json() : []).then(setStudyYears).catch(() => {})
  }, [])

  const getDateRange = () => {
    if (printPeriod === 'custom') {
      return { start: printStartDate, end: printEndDate }
    }
    const base = new Date(printDate + 'T00:00:00Z')
    const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate()
    switch (printPeriod) {
      case 'weekly': {
        const dow = base.getUTCDay()
        const monday = new Date(Date.UTC(y, m, d - ((dow + 6) % 7)))
        const sunday = new Date(Date.UTC(y, m, d - ((dow + 6) % 7) + 6))
        return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] }
      }
      case 'monthly': {
        const first = new Date(Date.UTC(y, m, 1))
        const last = new Date(Date.UTC(y, m + 1, 0))
        return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] }
      }
      case 'yearly': {
        const sy = studyYears.find(s => s.year === y)
        const start = sy?.startDate ? sy.startDate.split('T')[0] : `${y}-01-01`
        const end = sy?.endDate ? sy.endDate.split('T')[0] : `${y}-12-31`
        return { start, end }
      }
      default:
        return { start: printDate, end: printDate }
    }
  }

  const handlePrint = () => {
    const { start, end } = getDateRange()
    const params = new URLSearchParams({
      startDate: start,
      endDate: end,
      period: printPeriod,
      paper: paperSize,
      orgName,
      logoUrl,
      logoTextLines: JSON.stringify(logoTextLines.filter(l => l.trim())),
      headerLines: JSON.stringify(headerLines.filter(l => l.trim())),
      logoGap,
      logoTextGap,
      headerGap,
      signers: JSON.stringify(signers.filter(s => s.trim())),
    })
    window.open(`/admin/staff-reports/print?${params.toString()}`, '_blank')
    onClose()
  }

  const { start: previewStart, end: previewEnd } = getDateRange()

  const periodOptions = [
    { value: 'daily', label: t('reports.daily'), icon: '📅' },
    { value: 'weekly', label: t('reports.weekly'), icon: '📆' },
    { value: 'monthly', label: t('reports.monthly'), icon: '🗓️' },
    { value: 'yearly', label: t('reports.yearly'), icon: '📊' },
    { value: 'custom', label: t('reports.customRange'), icon: '🔧' },
  ] as const

  const paperOptions = [
    { value: 'A4', label: 'A4', desc: '210 × 297 mm' },
    { value: 'Letter', label: 'Letter', desc: '8.5 × 11 in' },
    { value: 'Legal', label: 'Legal', desc: '8.5 × 14 in' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-white rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800">🖨️ {t('reports.printAttendanceReport')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('reports.selectOptionsAndPrint')} — {t('reports.staffAttendance')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-sm">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Period Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">📋 {t('reports.reportPeriod')}</label>
            <div className="grid grid-cols-3 gap-2">
              {periodOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPrintPeriod(opt.value)}
                  className={`flex items-center gap-1.5 p-2.5 rounded-xl border text-left transition-all text-sm ${
                    printPeriod === opt.value
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span className={`font-semibold ${printPeriod === opt.value ? 'text-emerald-700' : 'text-slate-700'}`}>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Date Picker(s) */}
          {printPeriod === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">{t('reports.startDate')}</label>
                <input
                  type="date"
                  value={printStartDate}
                  onChange={e => setPrintStartDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">{t('reports.endDate')}</label>
                <input
                  type="date"
                  value={printEndDate}
                  onChange={e => setPrintEndDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">📆 {t('common.date')}</label>
              <input
                type="date"
                value={printDate}
                onChange={e => setPrintDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>
          )}

          {/* Paper Size */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">📄 {t('reports.paperSize')}</label>
            <div className="flex gap-2">
              {paperOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPaperSize(opt.value)}
                  className={`flex-1 p-2.5 rounded-xl border text-center transition-all ${
                    paperSize === opt.value
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className={`text-sm font-semibold ${paperSize === opt.value ? 'text-emerald-700' : 'text-slate-700'}`}>{opt.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Letter Header Customization */}
          <div className="space-y-3 p-4 bg-amber-50/50 rounded-xl border border-amber-200">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">📜 Letter Header</h3>

            {/* Logo URL */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Logo URL</label>
              <input
                type="text"
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            {/* Spacing below logo */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Spacing Below Logo (px)</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="20" step="1" value={logoGap} onChange={e => setLogoGap(e.target.value)} className="flex-1 accent-emerald-500" />
                <span className="text-xs text-slate-500 w-8 text-center">{logoGap}</span>
              </div>
            </div>

            {/* Logo Text Lines (below logo) */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Text Below Logo</label>
              <div className="space-y-1.5">
                {logoTextLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={line}
                      onChange={e => { const l = [...logoTextLines]; l[idx] = e.target.value; setLogoTextLines(l) }}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      placeholder={`Line ${idx + 1}`}
                    />
                    {logoTextLines.length > 1 && (
                      <button onClick={() => setLogoTextLines(logoTextLines.filter((_, i) => i !== idx))} className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center text-xs">✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setLogoTextLines([...logoTextLines, ''])} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">+ Add line</button>
              </div>
            </div>

            {/* Spacing below logo text */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Spacing Below Logo Text (px)</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="20" step="1" value={logoTextGap} onChange={e => setLogoTextGap(e.target.value)} className="flex-1 accent-emerald-500" />
                <span className="text-xs text-slate-500 w-8 text-center">{logoTextGap}</span>
              </div>
            </div>

            {/* Header Lines */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Header Lines (top → bottom)</label>
              <div className="space-y-1.5">
                {headerLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={line}
                      onChange={e => { const h = [...headerLines]; h[idx] = e.target.value; setHeaderLines(h) }}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-center"
                      placeholder={`Line ${idx + 1}`}
                    />
                    {headerLines.length > 1 && (
                      <button onClick={() => setHeaderLines(headerLines.filter((_, i) => i !== idx))} className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center text-xs">✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setHeaderLines([...headerLines, ''])} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">+ Add line</button>
              </div>
            </div>

            {/* Spacing below header lines */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Spacing Below Header Lines (px)</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="20" step="1" value={headerGap} onChange={e => setHeaderGap(e.target.value)} className="flex-1 accent-emerald-500" />
                <span className="text-xs text-slate-500 w-8 text-center">{headerGap}</span>
              </div>
            </div>

            {/* Organization Name */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Organization Name</label>
              <input
                type="text"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>
          </div>

          {/* Signers */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">✍️ Signers</label>
            <div className="space-y-2">
              {signers.map((signer, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={signer}
                    onChange={e => { const s = [...signers]; s[idx] = e.target.value; setSigners(s) }}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    placeholder={`Signer ${idx + 1}`}
                  />
                  {signers.length > 1 && (
                    <button onClick={() => setSigners(signers.filter((_, i) => i !== idx))} className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center text-sm">✕</button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setSigners([...signers, ''])}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                + Add signer
              </button>
            </div>
          </div>

          {/* Preview/Summary */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400">{t('reports.exportPreview')}</h4>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm">
              <span className="text-slate-500">{t('reports.type')}:</span>
              <span className="font-medium text-slate-800">{t('reports.staffAttendance')}</span>
              <span className="text-slate-500">{t('reports.dateRange')}:</span>
              <span className="font-medium text-slate-800">
                {previewStart === previewEnd ? previewStart : `${previewStart} → ${previewEnd}`}
              </span>
              <span className="text-slate-500">{t('reports.paperSize')}:</span>
              <span className="font-medium text-emerald-600">{paperSize}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              {t('common.cancel')}
            </button>
            <button
              onClick={handlePrint}
              className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              🖨️ {t('reports.preview')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SessionCell({ time, status }: { time: string | null; status: string | null }) {
  if (!status) {
    return <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center"></td>
  }
  if (status === 'ABSENT') {
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

export default function AdminStaffReports() {
  return (
    <AuthGuard allowedRoles={['ADMIN', 'WATTAMAN_REPORTER']}>
      <StaffReportsContent />
    </AuthGuard>
  )
}
