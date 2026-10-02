'use client'

import { useState, useEffect } from 'react'
import Sidebar from '../../../components/Sidebar'
import { teacherNav } from '../../../lib/teacher-nav'
import { apiFetch, getCurrentUser } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { todayCambodia } from '../../../lib/dateUtils'

interface GridRow {
  studentId: string
  studentNumber: string
  studentName: string
  checkInMorning: string | null
  checkOutMorning: string | null
  checkInAfternoon: string | null
  checkOutAfternoon: string | null
  dayOff: boolean
  isHoliday?: boolean
  session1Status: string | null
  session2Status: string | null
  session3Status: string | null
  session4Status: string | null
  session1PermissionType?: string | null
  session2PermissionType?: string | null
  session3PermissionType?: string | null
  session4PermissionType?: string | null
}

function permissionTypeLabel(value?: string | null): string {
  if (value === 'HALF_DAY_MORNING') return 'Half Day (AM)'
  if (value === 'HALF_DAY_AFTERNOON') return 'Half Day (PM)'
  if (value === 'FULL_DAY') return 'Full Day'
  if (value === 'MULTI_DAY') return 'Many Days'
  return 'Permission'
}

function getRowPermissionLabel(row: GridRow): string | null {
  const s = [row.session1Status, row.session2Status, row.session3Status, row.session4Status]
  const hasPermission = s.some(st => st === 'PERMISSION' || st === 'DAY_OFF')
  if (!hasPermission) return null

  if (s.some(st => st === 'DAY_OFF')) return 'Day Off'

  const amPerm = s[0] === 'PERMISSION' || s[1] === 'PERMISSION'
  const pmPerm = s[2] === 'PERMISSION' || s[3] === 'PERMISSION'
  if (amPerm && pmPerm) {
    const types = [row.session1PermissionType, row.session2PermissionType, row.session3PermissionType, row.session4PermissionType]
    const t = types.find(Boolean)
    if (t === 'MULTI_DAY') return permissionTypeLabel('MULTI_DAY')
    return permissionTypeLabel('FULL_DAY')
  }
  if (amPerm) return permissionTypeLabel('HALF_DAY_MORNING')
  if (pmPerm) return permissionTypeLabel('HALF_DAY_AFTERNOON')
  return 'Permission'
}

interface TotalsRow {
  studentId: string
  studentNumber: string
  studentName: string
  week: { present: number; late: number; absent: number; dayOff: number }
  month: { present: number; late: number; absent: number; dayOff: number }
  year: { present: number; late: number; absent: number; dayOff: number }
}

interface ClassItem {
  id: string
  name: string
  subject: string | null
}

export default function TeacherReports() {
  const { t } = useLanguage()
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [selectedDate, setSelectedDate] = useState(() => todayCambodia())
  const [grid, setGrid] = useState<GridRow[]>([])
  const [totals, setTotals] = useState<TotalsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'totals'>('daily')
  const [sessionConfigs, setSessionConfigs] = useState<Array<{session: number; type: string; startTime: string; endTime: string}>>([])
  const [caseStudyABEnabled, setCaseStudyABEnabled] = useState(true)

  useEffect(() => {
    fetchClasses()
  }, [])

  useEffect(() => {
    if (selectedClassId && selectedDate) {
      fetchData()
    }
  }, [selectedClassId, selectedDate])

  useEffect(() => {
    fetchSessionConfigs(selectedClassId || undefined)
  }, [selectedClassId])

  const fetchSessionConfigs = async (classId?: string) => {
    try {
      const url = classId ? `/api/session-config?classId=${classId}` : '/api/session-config/global'
      const res = await apiFetch(url)
      if (res.ok) setSessionConfigs(await res.json())
    } catch (e) { console.error('Error fetching session configs:', e) }
  }

  const fetchClasses = async () => {
    try {
      const user = await getCurrentUser()
      if (!user) return
      const res = await apiFetch(`/api/classes?teacherId=${user.userId}`)
      if (res.ok) {
        const data = await res.json()
        setClasses(data)
        if (data.length > 0) setSelectedClassId(data[0].id)
      }
    } catch (e) {
      console.error('Error fetching classes:', e)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setError('')
    try {
      const [gridRes, totalsRes, classRuleRes] = await Promise.all([
        apiFetch(`/api/reports/attendance-grid?classId=${selectedClassId}&date=${selectedDate}`),
        apiFetch(`/api/reports/attendance-totals?classId=${selectedClassId}&date=${selectedDate}`),
        apiFetch('/api/session-config/format-rules?scope=CLASS'),
      ])
      if (gridRes.ok) setGrid(await gridRes.json())
      else setError('Failed to load attendance data.')
      if (totalsRes.ok) setTotals(await totalsRes.json())
      if (classRuleRes.ok) {
        const rule = await classRuleRes.json()
        setCaseStudyABEnabled(rule.caseStudyABEnabled ?? true)
      }
    } catch (err) {
      console.error('Error fetching report data:', err)
      setError('Failed to connect to server.')
    } finally {
      setLoading(false)
    }
  }

  const handleExportGrid = () => {
    if (!selectedClassId) return
    apiFetch(`/api/reports/export-grid?classId=${selectedClassId}&date=${selectedDate}`)
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `attendance_${selectedDate}.csv`
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

  const selectedClassName = classes.find(c => c.id === selectedClassId)?.name || ''

  const sessionDefs = [
    { session: 1, field: 'checkInMorning', statusField: 'session1Status' },
    { session: 2, field: 'checkOutMorning', statusField: 'session2Status' },
    { session: 3, field: 'checkInAfternoon', statusField: 'session3Status' },
    { session: 4, field: 'checkOutAfternoon', statusField: 'session4Status' },
  ]
  const activeSessions = sessionDefs.filter(sd => {
    const cfg = sessionConfigs.find(c => c.session === sd.session)
    return !cfg || cfg.startTime !== cfg.endTime
  })
  const getSessionLabel = (sessionNum: number) => {
    const cfg = sessionConfigs.find(c => c.session === sessionNum)
    if (!cfg) return sessionNum <= 2 ? 'Morning' : 'Afternoon'
    const h = parseInt(cfg.startTime.split(':')[0])
    const eh = parseInt(cfg.endTime.split(':')[0])
    // If startTime is early-midnight (00:00–05:59) but endTime extends past noon,
    // the session is misconfigured — use the session-number default instead of calling it "Morning".
    if (h < 6 && eh >= 12) return sessionNum <= 2 ? 'Morning' : 'Afternoon'
    return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'
  }

  // Daily summary counts
  const isHolidayDate = grid.length > 0 && grid[0].isHoliday === true
  const getStatus = (r: GridRow, field: typeof activeSessions[number]['statusField']) => (r as any)[field] as string | null
  const permissionBlocks = [{ sessions: [1, 2] }, { sessions: [3, 4] }]
  const dailyTotals = grid.reduce((acc, row) => {
    for (const block of permissionBlocks) {
      const blockDefs = activeSessions.filter(sd => block.sessions.includes(sd.session))
      if (blockDefs.length === 0) continue
      const statuses = blockDefs.map(sd => getStatus(row, sd.statusField)).filter(Boolean) as string[]
      if (statuses.length === 0) continue

      const hasPresent = statuses.some(s => s === 'PRESENT')
      const hasLate = statuses.some(s => s === 'LATE')
      const hasPermission = statuses.some(s => s === 'PERMISSION' || s === 'DAY_OFF')
      const hasAbsent = statuses.some(s => s === 'ABSENT')

      if (hasPresent) acc.present += 0.5
      else if (hasLate) acc.late += 0.5
      else if (caseStudyABEnabled) {
        if (hasPermission) acc.permission += 0.5
        else if (hasAbsent) acc.absent += 0.5
      } else {
        if (hasAbsent) acc.absent += 0.5
        else if (hasPermission) acc.permission += 0.5
      }
    }
    return acc
  }, { present: 0, late: 0, absent: 0, permission: 0 })

  const dailyLate = dailyTotals.late
  const dailyPresent = dailyTotals.present
  const dailyAbsent = isHolidayDate ? 0 : dailyTotals.absent
  const totalStudents = grid.length

  return (
    <div className="page-shell">
      <Sidebar title="Teacher Portal" subtitle="Wattanman" navItems={teacherNav} accentColor="emerald" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <h1 className="text-2xl font-bold text-slate-800">{t('reports.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('reports.cambodiaTime')}</p>
        </div>
        <div className="page-body space-y-6">
          {/* Controls */}
          <div className="card p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('common.class')}</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                >
                  {classes.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name} — {cls.subject || 'N/A'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{t('common.date')}</label>
                <div className="flex items-center gap-1">
                  <button onClick={() => goDay(-1)} className="px-3 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-sm transition-colors">◀</button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                  />
                  <button onClick={() => goDay(1)} className="px-3 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-sm transition-colors">▶</button>
                </div>
              </div>
              <div className="flex items-end">
                <button onClick={() => setSelectedDate(todayCambodia())} className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-sm font-medium transition-colors">
                  📅 {t('common.today')}
                </button>
              </div>
              <div className="flex items-end">
                <button onClick={handleExportGrid} className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl shadow-md shadow-emerald-200 active:scale-[0.98] transition-all text-sm">
                  📥 Export CSV
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-700">{dayLabel} — {selectedClassName}</p>
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

          <div className="flex overflow-x-auto border-b border-slate-200 -mx-1 px-1 scrollbar-hide">
            <button
              onClick={() => setActiveTab('daily')}
              className={`flex-1 min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'daily' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              📋 {t('reports.dailyAttendance')}
            </button>
            <button
              onClick={() => setActiveTab('totals')}
              className={`flex-1 min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'totals' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              📊 {t('reports.totals')}
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
              {/* Day stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <div className="stat-card"><p className="stat-label">{t('reports.totalStudents')}</p><p className="stat-value">{totalStudents}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.present')}</p><p className="stat-value text-emerald-600">{dailyPresent}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.late')}</p><p className="stat-value text-amber-600">{dailyLate}</p></div>
                <div className="stat-card"><p className="stat-label">{t('reports.absentDayOff')}</p><p className="stat-value text-red-600">{dailyAbsent}</p></div>
              </div>

              {grid.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">📊</p>
                    <p className="font-semibold text-slate-600">{t('reports.noAttendanceData')}</p>
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
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.studentName')}</th>
                          {activeSessions.map(sd => {
                            const cfg = sessionConfigs.find(c => c.session === sd.session)
                            return (
                              <th key={sd.session} className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                                <div className="text-[10px] sm:text-xs">{cfg?.type === 'CHECK_OUT' ? t('common.checkOut') : t('common.checkIn')}</div>
                                <div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">{getSessionLabel(sd.session)}</div>
                              </th>
                            )
                          })}
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.absentDayOff')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grid.map((row, i) => (
                          <tr key={row.studentId} className={`border-t border-slate-100 ${row.dayOff ? 'bg-red-50/40' : 'hover:bg-slate-50'}`}>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-500 text-[10px] sm:text-xs hidden sm:table-cell">
                              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.studentNumber}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.studentName}</td>
                            {activeSessions.map(sd => (
                              <SessionCell key={sd.session} time={(row as any)[sd.field]} status={(row as any)[sd.statusField]} />
                            ))}
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center">
                              {(() => {
                                const label = getRowPermissionLabel(row)
                                return label ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">📋 {label}</span>
                                ) : (
                                  <span className="text-[10px] sm:text-xs text-slate-400">—</span>
                                )
                              })()}
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
            /* Totals Tab */
            <>
              {totals.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">📊</p>
                    <p className="font-semibold text-slate-600">{t('common.noData')}</p>
                    <p className="text-sm text-slate-400 mt-1">{t('reports.selectClassTotals')}</p>
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.id')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.studentName')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center" colSpan={4}>
                            <div>{t('common.week')}</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center" colSpan={4}>
                            <div>{t('common.month')}</div>
                          </th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center" colSpan={4}>
                            <div>{t('common.year')}</div>
                          </th>
                        </tr>
                        <tr className="text-[9px] sm:text-[10px] text-slate-400 border-b border-slate-200">
                          <th className="px-2 sm:px-3 pb-2"></th>
                          <th className="px-2 sm:px-3 pb-2"></th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-emerald-600 font-medium">{t('common.present')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-amber-500 font-medium">{t('common.late')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-red-500 font-medium">{t('common.absent')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-purple-500 font-medium">{t('common.dayOff')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-emerald-600 font-medium">{t('common.present')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-amber-500 font-medium">{t('common.late')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-red-500 font-medium">{t('common.absent')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-purple-500 font-medium">{t('common.dayOff')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-emerald-600 font-medium">{t('common.present')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-amber-500 font-medium">{t('common.late')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-red-500 font-medium">{t('common.absent')}</th>
                          <th className="px-2 sm:px-3 pb-2 text-center text-purple-500 font-medium">{t('common.dayOff')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {totals.map(row => (
                          <tr key={row.studentId} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.studentNumber}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.studentName}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row.week.present}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row.week.late || 0}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row.week.absent}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600 font-semibold">{row.week.dayOff || 0}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row.month.present}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row.month.late || 0}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row.month.absent}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600 font-semibold">{row.month.dayOff || 0}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row.year.present}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row.year.late || 0}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600 font-semibold">{row.year.absent}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600 font-semibold">{row.year.dayOff || 0}</td>
                          </tr>
                        ))}
                        {/* Totals footer */}
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-700">
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5" colSpan={2}>{t('common.total')}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r.week.present, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + (r.week.late || 0), 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r.week.absent, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600">{totals.reduce((s, r) => s + (r.week.dayOff || 0), 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r.month.present, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + (r.month.late || 0), 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r.month.absent, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600">{totals.reduce((s, r) => s + (r.month.dayOff || 0), 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r.year.present, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + (r.year.late || 0), 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-red-600">{totals.reduce((s, r) => s + r.year.absent, 0)}</td>
                          <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-purple-600">{totals.reduce((s, r) => s + (r.year.dayOff || 0), 0)}</td>
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
  if (status === 'DAY_OFF' || status === 'PERMISSION') {
    return <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center"><span className="text-[10px] sm:text-xs text-purple-500 font-medium">🏖</span></td>
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