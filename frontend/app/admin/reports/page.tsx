'use client'

import { useState, useEffect } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { reporterNav } from '../../../lib/reporter-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { todayCambodia } from '../../../lib/dateUtils'

interface GridRow {
  studentId: string
  studentNumber: string
  studentName: string
  address?: string | null
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

interface TotalsRow {
  studentId: string
  studentNumber: string
  studentName: string
  week: { present: number; late: number; absent: number; dayOff: number; convertedAbsentFromPermission?: number; convertedAbsentHalfFromLate?: number }
  month: { present: number; late: number; absent: number; dayOff: number; convertedAbsentFromPermission?: number; convertedAbsentHalfFromLate?: number }
  year: { present: number; late: number; absent: number; dayOff: number; convertedAbsentFromPermission?: number; convertedAbsentHalfFromLate?: number }
}

interface ClassItem {
  id: string
  name: string
  subject: string | null
  schedule?: string | null
}

interface SessionConfigItem {
  session: number
  type: string
  startTime: string
  endTime: string
}

const ATTENDANCE_PRESETS = [
  { id: 'global-default', name: 'Global Default', icon: '🌐', color: 'bg-slate-100 text-slate-600', configs: [] as SessionConfigItem[] },
  { id: 'full-day', name: 'Full Day', icon: '☀️', color: 'bg-indigo-100 text-indigo-700', configs: [
    { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
    { session: 2, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:15' },
    { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
    { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:15' },
  ]},
  { id: 'morning-only', name: 'Morning Only', icon: '🌅', color: 'bg-amber-100 text-amber-700', configs: [
    { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
    { session: 2, type: 'CHECK_OUT', startTime: '11:45', endTime: '12:00' },
    { session: 3, type: 'CHECK_IN', startTime: '12:00', endTime: '12:00' },
    { session: 4, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:00' },
  ]},
  { id: 'afternoon-only', name: 'Afternoon Only', icon: '🌤️', color: 'bg-orange-100 text-orange-700', configs: [
    { session: 1, type: 'CHECK_IN', startTime: '13:00', endTime: '13:00' },
    { session: 2, type: 'CHECK_OUT', startTime: '13:00', endTime: '13:00' },
    { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
    { session: 4, type: 'CHECK_OUT', startTime: '17:15', endTime: '17:30' },
  ]},
  { id: 'evening', name: 'Evening', icon: '🌆', color: 'bg-purple-100 text-purple-700', configs: [
    { session: 1, type: 'CHECK_IN', startTime: '18:00', endTime: '18:15' },
    { session: 2, type: 'CHECK_OUT', startTime: '20:45', endTime: '21:00' },
    { session: 3, type: 'CHECK_IN', startTime: '21:00', endTime: '21:00' },
    { session: 4, type: 'CHECK_OUT', startTime: '21:00', endTime: '21:00' },
  ]},
  { id: 'night-shift', name: 'Night Shift', icon: '🌙', color: 'bg-slate-200 text-slate-700', configs: [
    { session: 1, type: 'CHECK_IN', startTime: '18:00', endTime: '18:15' },
    { session: 2, type: 'CHECK_OUT', startTime: '23:45', endTime: '23:59' },
    { session: 3, type: 'CHECK_IN', startTime: '00:00', endTime: '00:15' },
    { session: 4, type: 'CHECK_OUT', startTime: '05:45', endTime: '06:00' },
  ]},
];

const DAYS_OF_WEEK = [
  { key: 'MON', label: 'M', full: 'Monday' },
  { key: 'TUE', label: 'T', full: 'Tuesday' },
  { key: 'WED', label: 'W', full: 'Wednesday' },
  { key: 'THU', label: 'T', full: 'Thursday' },
  { key: 'FRI', label: 'F', full: 'Friday' },
  { key: 'SAT', label: 'S', full: 'Saturday' },
  { key: 'SUN', label: 'S', full: 'Sunday' },
];

const DAY_FORMAT_STYLES: Record<string, { bg: string; icon: string; label: string }> = {
  same: { bg: 'bg-slate-100 text-slate-500', icon: '📋', label: 'Same as class' },
  'day-off': { bg: 'bg-red-100 text-red-600', icon: '🚫', label: 'Day Off' },
  'full-day': { bg: 'bg-indigo-100 text-indigo-600', icon: '☀️', label: 'Full Day' },
  'morning-only': { bg: 'bg-amber-100 text-amber-600', icon: '🌅', label: 'Morning Only' },
  'afternoon-only': { bg: 'bg-orange-100 text-orange-600', icon: '🌤️', label: 'Afternoon Only' },
  evening: { bg: 'bg-purple-100 text-purple-600', icon: '🌆', label: 'Evening' },
  'night-shift': { bg: 'bg-slate-200 text-slate-600', icon: '🌙', label: 'Night Shift' },
};

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

  // Infer the actual scope from which sessions carry PERMISSION status
  const amPerm = s[0] === 'PERMISSION' || s[1] === 'PERMISSION'
  const pmPerm = s[2] === 'PERMISSION' || s[3] === 'PERMISSION'
  if (amPerm && pmPerm) {
    // Full day — confirm via stored type in case it's MULTI_DAY
    const types = [row.session1PermissionType, row.session2PermissionType, row.session3PermissionType, row.session4PermissionType]
    const t = types.find(Boolean)
    if (t === 'MULTI_DAY') return permissionTypeLabel('MULTI_DAY')
    return permissionTypeLabel('FULL_DAY')
  }
  if (amPerm) return permissionTypeLabel('HALF_DAY_MORNING')
  if (pmPerm) return permissionTypeLabel('HALF_DAY_AFTERNOON')
  return 'Permission'
}

export default function AdminReports() {
  const { t } = useLanguage()
  const [classes, setClasses] = useState<ClassItem[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [selectedDate, setSelectedDate] = useState(() => todayCambodia())
  const [grid, setGrid] = useState<GridRow[]>([])
  const [totals, setTotals] = useState<TotalsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily')
  const [sessionConfigs, setSessionConfigs] = useState<Array<{session: number; type: string; startTime: string; endTime: string}>>([])
  const [classPreset, setClassPreset] = useState<{ id: string; name: string; icon: string; color: string }>({ id: 'global-default', name: 'Global Default', icon: '🌐', color: 'bg-slate-100 text-slate-600' })
  const [weeklySchedule, setWeeklySchedule] = useState<Record<string, string> | null>(null)

  // Export form state
  const [showExportForm, setShowExportForm] = useState(false)
  const [exportClassId, setExportClassId] = useState('')
  const [exportPeriod, setExportPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily')
  const [exportDate, setExportDate] = useState(() => todayCambodia())
  const [exportDateEnd, setExportDateEnd] = useState(() => todayCambodia())
  const [exportUseCustomRange, setExportUseCustomRange] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [caseStudyABEnabled, setCaseStudyABEnabled] = useState(true)
  const [absentThreshold, setAbsentThreshold] = useState(0)  // 0 = disabled

  // Print report state
  const [showPrintForm, setShowPrintForm] = useState(false)


  useEffect(() => {
    fetchClasses()
  }, [])

  useEffect(() => {
    if (selectedClassId) {
      fetchSessionConfigs()
    }
  }, [selectedClassId])

  useEffect(() => {
    if (selectedClassId && selectedDate) {
      fetchData()
    }
  }, [selectedClassId, selectedDate])

  const detectPreset = (configs: any[]): { id: string; name: string; icon: string; color: string } => {
    for (const preset of ATTENDANCE_PRESETS) {
      if (preset.id === 'global-default' || preset.configs.length === 0) continue
      const match = preset.configs.every(pc => {
        const c = configs.find((x: any) => x.session === pc.session)
        return c && c.type === pc.type && c.startTime === pc.startTime && c.endTime === pc.endTime
      })
      if (match) return { id: preset.id, name: preset.name, icon: preset.icon, color: preset.color }
    }
    return { id: 'custom', name: 'Custom', icon: '🔧', color: 'bg-amber-100 text-amber-700' }
  }

  const fetchClasses = async () => {
    try {
      const res = await apiFetch('/api/classes')
      if (res.ok) {
        const data = await res.json()
        setClasses(data)
        if (data.length > 0) setSelectedClassId(data[0].id)
      }
    } catch (e) {
      console.error('Error fetching classes:', e)
    }
  }

  const fetchSessionConfigs = async () => {
    try {
      const url = selectedClassId ? `/api/session-config?classId=${selectedClassId}` : '/api/session-config/global'
      const res = await apiFetch(url)
      if (res.ok) {
        const configs = await res.json()
        setSessionConfigs(configs)
        // Detect preset
        if (configs.length > 0 && configs[0].classId) {
          setClassPreset(detectPreset(configs))
        } else {
          setClassPreset({ id: 'global-default', name: 'Global Default', icon: '🌐', color: 'bg-slate-100 text-slate-600' })
        }
      }
    } catch (e) { console.error('Error fetching session configs:', e) }
  }

  // Load weekly schedule from class data when class changes
  useEffect(() => {
    const cls = classes.find(c => c.id === selectedClassId)
    if (cls?.schedule) {
      try { setWeeklySchedule(JSON.parse(cls.schedule)) } catch { setWeeklySchedule(null) }
    } else {
      setWeeklySchedule(null)
    }
  }, [selectedClassId, classes])

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
        setAbsentThreshold(rule.enabled ? (rule.absentSessionsForDayAbsent ?? 0) : 0)
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
    apiFetch(`/api/reports/export-xlsx?classId=${selectedClassId}&date=${selectedDate}`)
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `attendance_${selectedDate}.xlsx`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => setError('Export failed'))
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
      const classIds = exportClassId ? [exportClassId] : classes.map(c => c.id)
      for (const cid of classIds) {
        const className = classes.find(c => c.id === cid)?.name || 'class'
        const safeName = className.replace(/[^a-zA-Z0-9_-]/g, '_')

        // Export with selected period filter
        const res = await apiFetch(`/api/reports/export-xlsx?classId=${cid}&date=${exportDate}&period=${exportPeriod}`)
        if (!res.ok) throw new Error(`Failed to export for ${className}`)
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `attendance_${safeName}_${exportPeriod}_${exportDate}.xlsx`
        a.click()
        URL.revokeObjectURL(a.href)

        // Small delay between multiple downloads
        if (classIds.length > 1) await new Promise(r => setTimeout(r, 300))
      }
      setExportMessage(`✅ Export complete — ${classIds.length} file(s) downloaded`)
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

  const selectedClass = classes.find(c => c.id === selectedClassId)
  const selectedClassName = selectedClass?.name || ''

  // Get the day-of-week key for the selected date
  const dateObj = new Date(selectedDate + 'T00:00:00')
  const dayKeys = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const selectedDayKey = dayKeys[dateObj.getDay()]
  const todayDayFormat = weeklySchedule ? weeklySchedule[selectedDayKey] || 'same' : null
  const isScheduleDayOff = todayDayFormat === 'day-off'

  // Determine active sessions from configs
  const sessionDefs = [
    { session: 1, field: 'checkInMorning' as const, statusField: 'session1Status' as const },
    { session: 2, field: 'checkOutMorning' as const, statusField: 'session2Status' as const },
    { session: 3, field: 'checkInAfternoon' as const, statusField: 'session3Status' as const },
    { session: 4, field: 'checkOutAfternoon' as const, statusField: 'session4Status' as const },
  ]
  const activeSessions = sessionConfigs.length > 0
    ? sessionDefs.filter(sd => {
        const cfg = sessionConfigs.find(c => c.session === sd.session)
        return cfg && cfg.startTime !== cfg.endTime
      })
    : sessionDefs // show all 4 if no configs loaded

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

  const isHolidayDate = grid.length > 0 && grid[0].isHoliday === true
  const totalStudents = grid.length
  const getStatus = (r: GridRow, field: typeof activeSessions[number]['statusField']) => (r as any)[field] as string | null

  // Daily headcount — each student counted exactly once based on dominant status for the day.
  // Precedence: PRESENT > LATE > PERMISSION > ABSENT.
  // Students with no recorded statuses count as ABSENT on a normal day, 0 on a holiday.
  // Result: dailyPresent + dailyLate + dailyPermission + dailyAbsent === totalStudents (whole numbers).
  const dailyTotals = grid.reduce((acc, row) => {
    const statuses = activeSessions
      .map(sd => getStatus(row, sd.statusField))
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
    else if (caseStudyABEnabled) {
      if (hasPermission) acc.permission += 1
      else if (hasAbsent) acc.absent += 1
      else if (!isHolidayDate) acc.absent += 1   // no records on a school day → absent
    } else {
      if (hasAbsent) acc.absent += 1
      else if (hasPermission) acc.permission += 1
      else if (!isHolidayDate) acc.absent += 1
    }
    return acc
  }, { present: 0, late: 0, absent: 0, permission: 0 })

  const dailyPresent = dailyTotals.present
  const dailyLate = dailyTotals.late
  const dailyPermission = dailyTotals.permission
  const dailyAbsent = isHolidayDate ? 0 : dailyTotals.absent

  return (
    <AuthGuard allowedRoles={['ADMIN', 'WATTAMAN_REPORTER']}>
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
          <h1 className="text-2xl font-bold text-slate-800">{t('reports.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('reports.cambodiaTime')}</p>
        </div>
        <div className="page-body space-y-4 lg:space-y-6">
          {/* Controls */}
          <div className="card p-3 sm:p-4">
            <div className="space-y-3 lg:space-y-0 lg:flex lg:flex-wrap lg:gap-4 lg:items-end">
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('common.class')}</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="w-full lg:w-auto rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                >
                  {classes.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name} — {cls.subject || 'N/A'}</option>
                  ))}
                </select>
              </div>
              <div className="w-full lg:w-auto">
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('common.date')}</label>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => goDay(-1)} className="px-3 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm flex-shrink-0">◀</button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="flex-1 lg:flex-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                  <button onClick={() => goDay(1)} className="px-3 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm flex-shrink-0">▶</button>
                  <button onClick={() => setSelectedDate(todayCambodia())} className="px-3 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm flex-shrink-0 whitespace-nowrap">
                    📅 {t('common.today')}
                  </button>
                </div>
              </div>
              <div className="w-full lg:w-auto lg:ml-auto flex gap-2">
                <button onClick={() => { setShowPrintForm(true) }} className="btn-primary btn-sm w-full lg:w-auto bg-emerald-600 hover:bg-emerald-700">
                  🖨️ {t('reports.printReport')}
                </button>
                <button onClick={() => { setExportClassId(selectedClassId); setExportDate(selectedDate); setShowExportForm(true) }} className="btn-primary btn-sm w-full lg:w-auto">
                  📊 {t('common.exportReport')}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs sm:text-sm font-medium text-slate-700">{dayLabel} — {selectedClassName}</p>
          </div>

          {/* Class Config Info Card */}
          {selectedClassId && sessionConfigs.length > 0 && (
            <div className="card p-3 sm:p-4">
              <div className="space-y-3 lg:space-y-0 lg:flex lg:flex-wrap lg:items-center lg:gap-4">
                {/* Attendance Format Badge */}
                <div className="flex items-center gap-3 lg:block">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold lg:mb-1">{t('reports.attendanceFormat')}</p>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-semibold ${classPreset.color}`}>
                    <span>{classPreset.icon}</span> {classPreset.name}
                  </span>
                </div>

                {/* Session Time Ranges */}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">{t('reports.sessionTimes')}</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
                    {activeSessions.map(sd => {
                      const cfg = sessionConfigs.find(c => c.session === sd.session)
                      if (!cfg) return null
                      return (
                        <span key={sd.session} className="inline-flex items-center gap-1 text-[11px] sm:text-xs px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                          <span className="font-medium">{cfg.type === 'CHECK_OUT' ? '🔴' : '🟢'}</span>
                          <span className="font-semibold">{cfg.type === 'CHECK_OUT' ? t('common.checkOut') : t('common.checkIn')}</span>
                          <span className="text-slate-400">{cfg.startTime}–{cfg.endTime}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>

                {/* Weekly Schedule Strip */}
                {weeklySchedule && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">{t('reports.weeklySchedule')}</p>
                    <div className="flex gap-1">
                      {DAYS_OF_WEEK.map(day => {
                        const fmt = weeklySchedule[day.key] || 'same'
                        const style = DAY_FORMAT_STYLES[fmt] || DAY_FORMAT_STYLES.same
                        const isToday = day.key === selectedDayKey
                        return (
                          <div
                            key={day.key}
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-[10px] sm:text-xs font-bold ${style.bg} ${isToday ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                            title={`${day.full}: ${style.label}`}
                          >
                            {style.icon}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Today's Format Indicator */}
                {todayDayFormat && todayDayFormat !== 'same' && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{t('reports.todayFormat')}</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${DAY_FORMAT_STYLES[todayDayFormat]?.bg || 'bg-slate-100 text-slate-600'}`}>
                      {DAY_FORMAT_STYLES[todayDayFormat]?.icon} {DAY_FORMAT_STYLES[todayDayFormat]?.label || todayDayFormat}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {isHolidayDate && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2">
              <span className="text-lg">📅</span>
              <span dangerouslySetInnerHTML={{ __html: t('reports.holidayNotice') }} />
            </div>
          )}

          {isScheduleDayOff && !isHolidayDate && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">🚫</span>
                <span dangerouslySetInnerHTML={{ __html: `${t('reports.scheduledDayOff')} <strong>${selectedClassName}</strong> ${t('reports.perWeeklySchedule')}` }} />
              </div>
              <a href="/admin/classes" className="shrink-0 text-xs underline underline-offset-2 hover:text-red-900 whitespace-nowrap">
                Edit schedule →
              </a>
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
                  activeTab === tab ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'daily' ? `📋 ${t('reports.daily')}` : tab === 'weekly' ? `📅 ${t('reports.weekly')}` : tab === 'monthly' ? `📆 ${t('reports.monthly')}` : `📊 ${t('reports.yearly')}`}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="card p-12">
              <div className="empty-state">
                <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-sm text-slate-500 mt-3">Loading…</p>
              </div>
            </div>
          ) : activeTab === 'daily' ? (
            <>
              {/* Day stats */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-4">
                <div className="stat-card col-span-3 sm:col-span-1"><p className="stat-label">{t('reports.totalStudents')}</p><p className="stat-value">{totalStudents}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.present')}</p><p className="stat-value text-emerald-600">{dailyPresent}</p></div>
                <div className="stat-card"><p className="stat-label">{t('reports.presentLate')}</p><p className="stat-value text-amber-600">{dailyLate}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.absent')}</p><p className="stat-value text-red-600">{dailyAbsent}</p></div>
                <div className="stat-card"><p className="stat-label">{t('common.permission')}</p><p className="stat-value text-purple-600">{dailyPermission}</p></div>
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
                  <div className="overflow-x-auto -mx-0">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">{t('common.day')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.id')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.studentName')}</th>
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold hidden sm:table-cell">{t('common.address')}</th>
                          {activeSessions.map(sd => {
                            const cfg = sessionConfigs.find(c => c.session === sd.session)
                            return (
                              <th key={sd.session} className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">
                                <div className="text-[10px] sm:text-xs">{cfg?.type === 'CHECK_OUT' ? t('common.checkOut') : t('common.checkIn')}</div>
                                <div className="text-[9px] sm:text-[10px] normal-case font-normal text-slate-400 hidden sm:block">{getSessionLabel(sd.session)}</div>
                                {cfg && <div className="text-[8px] sm:text-[9px] normal-case font-normal text-slate-300 hidden sm:block">{cfg.startTime}–{cfg.endTime}</div>}
                              </th>
                            )
                          })}
                          <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('common.permission')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grid.map((row) => (
                          <tr key={row.studentId} className={`border-t border-slate-100 ${row.dayOff ? 'bg-red-50/40' : 'hover:bg-slate-50'}`}>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-500 text-[10px] sm:text-xs hidden sm:table-cell">
                              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                            </td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.studentNumber}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.studentName}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 text-[10px] sm:text-xs hidden sm:table-cell">{row.address || '—'}</td>
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
            /* Period Totals Tab (Weekly / Monthly / Yearly) */
            <>
              {totals.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">📊</p>
                    <p className="font-semibold text-slate-600">{t('common.noData')}</p>
                    <p className="text-sm text-slate-400 mt-1">{t('reports.selectClassTotals')}</p>
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
                        const hasFormatRules = totals.length > 0 && totals[0][periodKey].convertedAbsentFromPermission !== undefined && (totals[0][periodKey].convertedAbsentFromPermission! > 0 || totals[0][periodKey].convertedAbsentHalfFromLate! > 0 || totals.some(r => (r[periodKey].convertedAbsentFromPermission || 0) > 0 || (r[periodKey].convertedAbsentHalfFromLate || 0) > 0));
                        return (
                      <table className="w-full text-xs sm:text-sm">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-[10px] sm:text-xs text-slate-500 uppercase tracking-wide">
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.id')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold">{t('common.name')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.totalPresent')}</th>
                            <th className="px-2 sm:px-3 py-2.5 sm:py-3 font-semibold text-center">{t('reports.totalLate')}</th>
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
                            <tr key={row.studentId} className="border-t border-slate-100 hover:bg-slate-50">
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-600 font-mono text-[10px] sm:text-xs">{row.studentNumber}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-slate-800 font-medium text-xs sm:text-sm">{row.studentName}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700 font-semibold">{row[periodKey].present}</td>
                              <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600 font-semibold">{row[periodKey].late || 0}</td>
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
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-emerald-700">{totals.reduce((s, r) => s + r[periodKey].present, 0)}</td>
                            <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center text-amber-600">{totals.reduce((s, r) => s + (r[periodKey].late || 0), 0)}</td>
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
      <ExportReportModal
        show={showExportForm}
        onClose={() => { setShowExportForm(false); setExportMessage('') }}
        classes={classes}
        exportClassId={exportClassId}
        setExportClassId={setExportClassId}
        exportPeriod={exportPeriod}
        setExportPeriod={setExportPeriod}
        exportDate={exportDate}
        setExportDate={setExportDate}
        exporting={exporting}
        exportMessage={exportMessage}
        handleExportReport={handleExportReport}
      />

      {/* Print Report Modal */}
      <PrintReportModal
        show={showPrintForm}
        onClose={() => setShowPrintForm(false)}
        classes={classes}
        defaultClassId={selectedClassId}
        defaultDate={selectedDate}
      />
    </div>
    </AuthGuard>
  )
}

/* ============ EXPORT REPORT MODAL ============ */
function ExportReportModal({
  show, onClose, classes, exportClassId, setExportClassId,
  exportPeriod, setExportPeriod,
  exportDate, setExportDate,
  exporting, exportMessage, handleExportReport,
}: {
  show: boolean; onClose: () => void
  classes: ClassItem[]; exportClassId: string; setExportClassId: (v: string) => void
  exportPeriod: string; setExportPeriod: (v: 'daily' | 'weekly' | 'monthly' | 'yearly') => void
  exportDate: string; setExportDate: (v: string) => void
  exporting: boolean; exportMessage: string
  handleExportReport: () => void
}) {
  const { t } = useLanguage()
  if (!show) return null
  const selectedClassName = exportClassId ? classes.find(c => c.id === exportClassId)?.name || '' : t('reports.allClasses')

  const periodOptions = [
    { value: 'daily', label: t('reports.daily'), icon: '📅', desc: t('reports.sessionDetailsDay') },
    { value: 'weekly', label: t('reports.weekly'), icon: '📆', desc: t('reports.weeklyTotals') },
    { value: 'monthly', label: t('reports.monthly'), icon: '🗓️', desc: t('reports.monthlyTotals') },
    { value: 'yearly', label: t('reports.yearly'), icon: '📊', desc: t('reports.yearlyTotals') },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800">📊 {t('reports.exportAttendanceReport')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('reports.selectPeriodDownload')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-sm">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Class Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">📖 {t('common.class')}</label>
            <select
              value={exportClassId}
              onChange={e => setExportClassId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
            >
              <option value="">{t('reports.allClasses')} ({classes.length})</option>
              {classes.map(cls => (
                <option key={cls.id} value={cls.id}>{cls.name} — {cls.subject || 'N/A'}</option>
              ))}
            </select>
          </div>

          {/* Period Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">📋 {t('reports.reportPeriod')}</label>
            <div className="grid grid-cols-2 gap-2">
              {periodOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setExportPeriod(opt.value)}
                  className={`flex items-start gap-2 p-3 rounded-xl border text-left transition-all ${
                    exportPeriod === opt.value
                      ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <div>
                    <div className={`text-sm font-semibold ${exportPeriod === opt.value ? 'text-indigo-700' : 'text-slate-700'}`}>{opt.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Date Picker */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">📆 {t('common.date')}</label>
            <input
              type="date"
              value={exportDate}
              onChange={e => setExportDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>

          {/* Preview/Summary */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <h4 className="text-xs uppercase tracking-wider font-semibold text-slate-400">{t('reports.exportPreview')}</h4>
            <div className="grid grid-cols-2 gap-y-1.5 text-sm">
              <span className="text-slate-500">{t('common.class')}:</span>
              <span className="font-medium text-slate-800">{selectedClassName}</span>
              <span className="text-slate-500">{t('common.date')}:</span>
              <span className="font-medium text-slate-800">{exportDate}</span>
              <span className="text-slate-500">{t('reports.reportPeriod')}:</span>
              <span className="font-medium text-indigo-600 capitalize">{exportPeriod}</span>
              <span className="text-slate-500">{t('reports.format')}:</span>
              <span className="font-medium text-indigo-600">XLSX</span>
              {!exportClassId && (
                <>
                  <span className="text-slate-500">{t('reports.files')}:</span>
                  <span className="font-medium text-indigo-600">{classes.length} XLSX {t('reports.files')}</span>
                </>
              )}
            </div>
          </div>

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
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleExportReport}
              disabled={exporting}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2"
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
  )
}

function SessionCell({ time, status }: { time: string | null; status: string | null }) {
  if (!status) {
    return <td className="px-2 sm:px-3 py-2 sm:py-2.5 text-center"></td>
  }
  if (status === 'ABSENT') {
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

/* ============ PRINT REPORT MODAL ============ */
function PrintReportModal({
  show, onClose, classes, defaultClassId, defaultDate,
}: {
  show: boolean; onClose: () => void
  classes: ClassItem[]; defaultClassId: string; defaultDate: string
}) {
  const { t } = useLanguage()
  const [printClassId, setPrintClassId] = useState(defaultClassId)
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
  const [signers, setSigners] = useState<string[]>(['Teacher', 'Admin'])
  const [studyYears, setStudyYears] = useState<Array<{ year: number; startDate?: string; endDate?: string }>>([])

  // Fetch study years once so yearly period uses the correct startDate/endDate
  useEffect(() => {
    apiFetch('/api/study-years').then(r => r.ok ? r.json() : []).then(setStudyYears).catch(() => {})
  }, [])

  // Sync defaults when modal opens
  useEffect(() => {
    if (show) {
      setPrintClassId(defaultClassId)
      setPrintDate(defaultDate)
      setPrintStartDate(defaultDate)
      setPrintEndDate(defaultDate)
    }
  }, [show, defaultClassId, defaultDate])

  if (!show) return null

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
    if (!printClassId) return
    const { start, end } = getDateRange()
    const params = new URLSearchParams({
      classId: printClassId,
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
    window.open(`/admin/reports/print?${params.toString()}`, '_blank')
    onClose()
  }

  const selectedClassName = printClassId ? classes.find(c => c.id === printClassId)?.name || '' : ''
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
            <p className="text-xs text-slate-500 mt-0.5">{t('reports.selectOptionsAndPrint')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-sm">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Class Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">📖 {t('common.class')}</label>
            <select
              value={printClassId}
              onChange={e => setPrintClassId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
            >
              <option value="">— {t('common.class')} —</option>
              {classes.map(cls => (
                <option key={cls.id} value={cls.id}>{cls.name} — {cls.subject || 'N/A'}</option>
              ))}
            </select>
          </div>

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
              {printPeriod === 'yearly' && (() => {
                const base = new Date(printDate + 'T00:00:00Z')
                const y = base.getUTCFullYear()
                const sy = studyYears.find(s => s.year === y)
                const start = sy?.startDate ? new Date(sy.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `Jan 1, ${y}`
                const end = sy?.endDate ? new Date(sy.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `Dec 31, ${y}`
                return (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 mt-2">
                    📅 Study Year {y}{sy?.endDate ? `–${new Date(sy.endDate).getUTCFullYear()}` : ''}: {start} – {end}
                  </p>
                )
              })()}
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
              <span className="text-slate-500">{t('common.class')}:</span>
              <span className="font-medium text-slate-800">{selectedClassName || '—'}</span>
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
              disabled={!printClassId}
              className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2"
            >
              🖨️ {t('reports.preview')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
