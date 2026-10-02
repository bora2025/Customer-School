"use client"

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts'
import Sidebar from '../../components/Sidebar'
import AuthGuard from '../../components/AuthGuard'
import { adminNav, classAdminNav } from '../../lib/admin-nav'
import { apiFetch } from '../../lib/api'
import { useLanguage } from '../../lib/i18n'
import { todayCambodia } from '../../lib/dateUtils'
import { frontendDistribution } from '../../lib/navigation-registry'
import CoreAdminDashboard from '../../components/CoreAdminDashboard'

interface PermissionBreakdown { halfDayMorning: number; halfDayAfternoon: number; fullDay: number; multiDay: number; unknown: number }
interface GroupSummary {
  total: number
  present: number
  absent: number
  late: number
  permission: number
  permissionBreakdown?: PermissionBreakdown
}
interface DetailRow { id: string; name: string; role: string; group: string; present: number; absent: number; late: number; permission: number; address?: string }
interface DashboardData {
  students: GroupSummary
  staff: GroupSummary
  details: DetailRow[]
  filters: { classes: { id: string; name: string }[]; departments: { id: string; name: string }[] }
}
interface PlatformBillingInvoice { id: string; invoiceNumber: string; status: string; currency: string; amountMinor: number; paidMinor: number; dueAt: string }
interface PlatformBillingControl {
  access: string
  reason?: string | null
  warningsJson: string
  lastVerifiedAt?: string | null
  billing?: { currency?: string; outstandingMinor?: number; invoices?: PlatformBillingInvoice[] }
}
interface BillingBanner { tone: 'danger' | 'warning' | 'notice'; title: string; body: string; lines: string[] }

/**
 * What the dashboard says about the platform bill.
 *
 * The banner used to appear only on suspension or on the final notice, which is three days before
 * lock-out -- so an ordinary unpaid invoice was invisible here for its whole life and the first
 * thing an administrator saw was a countdown. The third tier is the quiet one: it states the
 * balance and the nearest due date without alarm, which is the point at which saying something is
 * still useful.
 */
function billingBanner(control: PlatformBillingControl | null): BillingBanner | null {
  if (!control) return null
  let warnings: Array<{ invoiceId: string; invoiceNumber: string; currency: string; outstandingMinor: number; suspendAt: string }> = []
  try { warnings = JSON.parse(control.warningsJson || '[]') } catch { warnings = [] }
  if (control.access === 'SUSPENDED') return {
    tone: 'danger', title: 'School access suspended',
    body: control.reason || 'A Wattanam Marketplace invoice is unpaid. Settle it to restore access.',
    lines: warnings.map(w => `Invoice ${w.invoiceNumber}: ${(w.outstandingMinor / 100).toFixed(2)} ${w.currency} outstanding`),
  }
  if (warnings.length > 0) return {
    tone: 'warning', title: 'Final platform billing notice',
    body: control.reason || 'Payment is required within three days of the final notice to prevent suspension.',
    lines: warnings.map(w => `Invoice ${w.invoiceNumber}: ${(w.outstandingMinor / 100).toFixed(2)} ${w.currency} outstanding · suspension ${new Date(w.suspendAt).toLocaleString()}`),
  }
  const outstanding = control.billing?.outstandingMinor || 0
  if (outstanding <= 0) return null
  const currency = control.billing?.currency || control.billing?.invoices?.[0]?.currency || 'USD'
  // The invoice that runs out first is the one worth naming; the rest are on the billing page.
  const open = (control.billing?.invoices || []).filter(invoice => invoice.amountMinor > invoice.paidMinor && invoice.status !== 'VOID')
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  return {
    tone: 'notice', title: 'Platform invoice outstanding',
    body: `${(outstanding / 100).toFixed(2)} ${currency} is owed on your Wattanam subscription.`,
    lines: open.slice(0, 3).map(invoice => `Invoice ${invoice.invoiceNumber}: ${((invoice.amountMinor - invoice.paidMinor) / 100).toFixed(2)} ${invoice.currency} due ${new Date(invoice.dueAt).toLocaleDateString()}`),
  }
}

const billingTones: Record<BillingBanner['tone'], string> = {
  danger: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  notice: 'border-slate-300 bg-white text-slate-800',
}
type StatusFilter = 'all' | 'present' | 'absent' | 'late' | 'permission'

const roleLabels: Record<string, string> = {
  ADMIN:'Admin',TEACHER:'Teacher',PRIMARY_SCHOOL_PRINCIPAL:'Primary School Principal',
  SECONDARY_SCHOOL_PRINCIPAL:'Secondary School Principal',HIGH_SCHOOL_PRINCIPAL:'High School Principal',
  UNIVERSITY_RECTOR:'University Rector',OFFICER:'Officer',STAFF:'Staff',
  OFFICE_HEAD:'Office Head',DEPUTY_OFFICE_HEAD:'Deputy Office Head',
  DEPARTMENT_HEAD:'Department Head',DEPUTY_DEPARTMENT_HEAD:'Deputy Department Head',
  GENERAL_DEPARTMENT_DIRECTOR:'General Dept. Director',
  DEPUTY_GENERAL_DEPARTMENT_DIRECTOR:'Deputy General Dept. Director',
  COMPANY_CEO:'CEO',CREDIT_OFFICER:'Credit Officer',SECURITY_GUARD:'Security Guard',
  JANITOR:'Janitor',PROJECT_MANAGER:'Project Manager',BRANCH_MANAGER:'Branch Manager',
  EXECUTIVE_DIRECTOR:'Executive Director',HR_MANAGER:'HR Manager',
  ATHLETE_MALE:'Athlete (M)',ATHLETE_FEMALE:'Athlete (F)',TRAINER:'Trainer',
  BARISTA:'Barista',CASHIER:'Cashier',RECEPTIONIST:'Receptionist',GENERAL_MANAGER:'General Manager',
  WATTAMAN:'Wattaman',
}
function getRoleLabel(role: string): string {
  if (role === 'Student') return 'Student'
  return roleLabels[role] || role
}

function StatRing({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  const r = 18, c = 2 * Math.PI * r, offset = c - (pct / 100) * c
  const sc: Record<string,string> = { green:'#10B981', red:'#EF4444', orange:'#F59E0B', blue:'#3B82F6' }
  return (
    <svg width="48" height="48" className="shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#F3F4F6" strokeWidth="4"/>
      <circle cx="24" cy="24" r={r} fill="none" stroke={sc[color]} strokeWidth="4"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform="rotate(-90 24 24)" className="transition-all duration-700 ease-out"/>
      <text x="24" y="24" textAnchor="middle" dominantBaseline="central"
        className="text-[10px] font-bold fill-gray-600">{pct > 0 ? `${Math.round(pct)}%` : '0'}</text>
    </svg>
  )
}

function CardIcon({ color }: { color: string }) {
  const cls: Record<string,string> = { green:'text-emerald-500', red:'text-red-500', orange:'text-amber-500', blue:'text-blue-500' }
  const paths: Record<string,React.ReactNode> = {
    green:<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>,
    red:<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>,
    orange:<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>,
    blue:<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>,
  }
  return (<svg className={`w-5 h-5 ${cls[color]}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">{paths[color]}</svg>)
}

function DashboardContent() {
  const { t } = useLanguage()
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [billingControl, setBillingControl] = useState<PlatformBillingControl | null>(null)
  const [prevData, setPrevData] = useState<DashboardData | null>(null) // previous day for delta
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  const [mounted, setMounted] = useState(false)
  const [roleFilter, setRoleFilter] = useState<'all'|'Student'|'Staff'>('all')
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [drillRole, setDrillRole] = useState<'Student'|'Staff'|null>(null)
  const [tableExpanded, setTableExpanded] = useState(false)
  const [visibleCount, setVisibleCount] = useState(100)
  const [clockStr, setClockStr] = useState('')
  const [density, setDensity] = useState<'comfortable'|'compact'>('comfortable')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [agoStr, setAgoStr] = useState('')
  // Per-class real-time progress
  interface ClassProgressRow { classId: string; className: string; total: number; present: number; late: number; absent: number; permission: number; scanned: number; pctPresent: number; pctScanned: number }

  useEffect(() => {
    apiFetch('/api/admin/marketplace/billing-control')
      .then(async response => response.ok ? setBillingControl(await response.json()) : undefined)
      .catch(() => undefined)
  }, [])
  const banner = useMemo(() => billingBanner(billingControl), [billingControl])
  const [classProgress, setClassProgress] = useState<ClassProgressRow[]>([])
  const [classProgressLoading, setClassProgressLoading] = useState(false)
  const [classProgressFlash, setClassProgressFlash] = useState<Record<string, number>>({}) // classId -> timestamp of last update for flash highlight
  const [classProgressSearch, setClassProgressSearch] = useState('')
  const [classProgressSort, setClassProgressSort] = useState<'name'|'pctAsc'|'pctDesc'>('name')
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Absent students modal
  const [absentModal, setAbsentModal] = useState(false)
  const [absentModalRole, setAbsentModalRole] = useState<'Student'|'Staff'>('Student')
  const [absentAddressFilter, setAbsentAddressFilter] = useState('')
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Monthly trend
  const [trendData, setTrendData] = useState<{ day: number; studentPresent: number; studentAbsent: number; staffPresent: number; staffAbsent: number }[]>([])
  const [trendYear, setTrendYear] = useState(new Date().getFullYear())
  const [trendMonth, setTrendMonth] = useState(new Date().getMonth() + 1)

  useEffect(() => {
    setSelectedDate(todayCambodia())
    setMounted(true)
    try {
      const saved = localStorage.getItem('admin-dashboard-density')
      if (saved === 'compact' || saved === 'comfortable') setDensity(saved)
    } catch {}
  }, [])

  // CLASS_ADMIN has no dashboard — send straight to class management
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('role') === 'CLASS_ADMIN') {
      router.replace('/admin/classes')
    }
  }, [router])

  const currentNav = typeof window !== 'undefined' && localStorage.getItem('role') === 'CLASS_ADMIN' ? classAdminNav : adminNav
  useEffect(() => { if (selectedDate) fetchDashboard() }, [selectedDate])
  useEffect(() => { if (selectedDate) fetchClassProgress() }, [selectedDate])
  useEffect(() => { fetchTrend() }, [trendYear, trendMonth])

  /* Live Cambodia clock for hero */
  useEffect(() => {
    const tick = () => {
      const cam = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
      const hh = String(cam.getUTCHours()).padStart(2, '0')
      const mm = String(cam.getUTCMinutes()).padStart(2, '0')
      const ss = String(cam.getUTCSeconds()).padStart(2, '0')
      setClockStr(`${hh}:${mm}:${ss}`)
      // Update "x seconds ago" label
      if (lastUpdated) {
        const diff = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
        if (diff < 5) setAgoStr('just now')
        else if (diff < 60) setAgoStr(`${diff}s ago`)
        else if (diff < 3600) setAgoStr(`${Math.floor(diff / 60)}m ago`)
        else setAgoStr(`${Math.floor(diff / 3600)}h ago`)
      } else {
        setAgoStr('')
      }
    }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [lastUpdated])

  /* Tab visibility refresh — refresh when the user returns to the tab.
     The 30s background poll was removed in favor of socket.io push updates below;
     we still re-fetch on tab focus so stale data is replaced immediately. */
  useEffect(() => {
    if (!selectedDate) return
    if (selectedDate !== todayCambodia()) return
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        fetchDashboard({ silent: true })
        fetchClassProgress({ silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  /* Push-based real-time updates via socket.io — instant refresh on student scans */
  useEffect(() => {
    if (!selectedDate) return
    if (selectedDate !== todayCambodia()) return
    const base = process.env.NEXT_PUBLIC_API_URL || ''
    let socket: Socket | null = null
    try {
      socket = io(base || undefined, { transports: ['websocket', 'polling'], withCredentials: true })
      socket.on('connect', () => { socket?.emit('joinDashboard') })
      socket.on('dashboardUpdate', (payload: { classId?: string }) => {
        // Flash the affected class row
        if (payload?.classId) {
          setClassProgressFlash(prev => ({ ...prev, [payload.classId!]: Date.now() }))
        }
        // Debounce rapid scans into a single refresh
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = setTimeout(() => {
          fetchDashboard({ silent: true })
          fetchClassProgress({ silent: true })
        }, 600)
      })
    } catch (err) {
      console.error('Socket.io connection failed', err)
    }
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      try { socket?.emit('leaveDashboard'); socket?.disconnect() } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  /* Keyboard shortcuts: T=today, R=refresh, /=focus search, ESC=clear drill */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === '/' && !inField) {
        e.preventDefault()
        setTableExpanded(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
      } else if ((e.key === 't' || e.key === 'T') && !inField) {
        setSelectedDate(todayCambodia())
      } else if ((e.key === 'r' || e.key === 'R') && !inField) {
        fetchDashboard()
      } else if (e.key === 'Escape' && drillRole) {
        clearDrill()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillRole, selectedDate])

  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact'
    setDensity(next)
    try { localStorage.setItem('admin-dashboard-density', next) } catch {}
  }

  const fetchDashboard = async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      // Fetch today + previous day in parallel for delta indicator
      const prevDate = new Date(selectedDate)
      prevDate.setDate(prevDate.getDate() - 1)
      const prevStr = prevDate.toISOString().split('T')[0]
      const [res, prevRes] = await Promise.all([
        apiFetch(`/api/reports/dashboard-summary?date=${selectedDate}`),
        apiFetch(`/api/reports/dashboard-summary?date=${prevStr}`),
      ])
      if (res.ok) setData(await res.json())
      else console.error('Dashboard API error:', res.status)
      if (prevRes.ok) setPrevData(await prevRes.json())
      else setPrevData(null)
      setLastUpdated(new Date())
    } catch (err) { console.error('Failed to fetch dashboard data', err) }
    finally { if (!opts.silent) setLoading(false) }
  }

  const fetchClassProgress = async (opts: { silent?: boolean } = {}) => {
    if (!selectedDate) return
    if (!opts.silent) setClassProgressLoading(true)
    try {
      const res = await apiFetch(`/api/reports/class-attendance-progress?date=${selectedDate}`)
      if (res.ok) {
        const json = await res.json()
        setClassProgress(json.rows || [])
      }
    } catch (err) { console.error('Failed to fetch class progress', err) }
    finally { if (!opts.silent) setClassProgressLoading(false) }
  }

  const fetchTrend = async () => {
    try {
      const res = await apiFetch(`/api/reports/monthly-trend?year=${trendYear}&month=${trendMonth}`)
      if (res.ok) { const json = await res.json(); setTrendData(json.data || []) }
    } catch (err) { console.error('Failed to fetch trend', err) }
  }

  const handleCardClick = (role: 'Student'|'Staff', status: StatusFilter) => {
    setDrillRole(role); setRoleFilter(role === 'Student' ? 'Student' : 'Staff')
    setStatusFilter(status); setGroupFilter(''); setSearchQuery(''); setTableExpanded(true)
    if (status === 'absent') {
      setAbsentModalRole(role)
      setAbsentAddressFilter('')
      setAbsentModal(true)
    } else {
      document.getElementById('detail-table')?.scrollIntoView({ behavior: 'smooth' })
    }
  }
  const clearDrill = () => { setDrillRole(null); setRoleFilter('all'); setStatusFilter('all'); setGroupFilter(''); setSearchQuery('') }

  const filteredDetails = useMemo(() => {
    setVisibleCount(100)
    if (!data) return []
    return data.details.filter(row => {
      if (roleFilter === 'Student' && row.role !== 'Student') return false
      if (roleFilter === 'Staff' && row.role === 'Student') return false
      if (groupFilter && row.group !== groupFilter) return false
      if (statusFilter === 'present' && row.present === 0) return false
      if (statusFilter === 'absent' && row.absent === 0) return false
      if (statusFilter === 'late' && row.late === 0) return false
      if (statusFilter === 'permission' && row.permission === 0) return false
      if (searchQuery) { const q = searchQuery.toLowerCase(); if (!row.name.toLowerCase().includes(q) && !row.id.toLowerCase().includes(q)) return false }
      return true
    })
  }, [data, roleFilter, groupFilter, statusFilter, searchQuery])

  const studentPieData = useMemo(() => {
    if (!data) return []
    return [
      { name: t('common.present'), value: data.students.present, color: '#10B981' },
      { name: t('common.absent'), value: data.students.absent, color: '#EF4444' },
      { name: t('common.late'), value: data.students.late, color: '#F59E0B' },
      { name: t('common.permission'), value: data.students.permission, color: '#3B82F6' },
    ].filter(d => d.value > 0)
  }, [data, t])

  const staffPieData = useMemo(() => {
    if (!data) return []
    return [
      { name: t('common.present'), value: data.staff.present, color: '#10B981' },
      { name: t('common.absent'), value: data.staff.absent, color: '#EF4444' },
      { name: t('common.late'), value: data.staff.late, color: '#F59E0B' },
      { name: t('common.permission'), value: data.staff.permission, color: '#3B82F6' },
    ].filter(d => d.value > 0)
  }, [data, t])

  /* ── Hero KPIs: combined attendance rate + delta vs yesterday ── */
  const heroStats = useMemo(() => {
    const stu = data?.students || { total: 0, present: 0, late: 0, absent: 0, permission: 0 }
    const stf = data?.staff || { total: 0, present: 0, late: 0, absent: 0, permission: 0 }
    const total = stu.total + stf.total
    const presentTotal = stu.present + stf.present + stu.late + stf.late // counted as attending
    const rate = total > 0 ? Math.round((presentTotal / total) * 1000) / 10 : 0
    let delta: number | null = null
    if (prevData) {
      const pStu = prevData.students || { total: 0, present: 0, late: 0 }
      const pStf = prevData.staff || { total: 0, present: 0, late: 0 }
      const pTot = pStu.total + pStf.total
      const pPresent = pStu.present + pStf.present + pStu.late + pStf.late
      const pRate = pTot > 0 ? (pPresent / pTot) * 100 : 0
      if (pTot > 0) delta = Math.round((rate - pRate) * 10) / 10
    }
    return { total, presentTotal, rate, delta, absentTotal: stu.absent + stf.absent, lateTotal: stu.late + stf.late, permissionTotal: stu.permission + stf.permission }
  }, [data, prevData])

  /* ── Today's Insights: computed from details ── */
  const insights = useMemo(() => {
    if (!data || !data.details.length) return null
    // Group by row.group
    const groupMap = new Map<string, { present: number; absent: number; late: number; permission: number; total: number; name: string }>()
    for (const r of data.details) {
      if (!r.group) continue
      const g = groupMap.get(r.group) || { present: 0, absent: 0, late: 0, permission: 0, total: 0, name: r.group }
      g.present += r.present; g.absent += r.absent; g.late += r.late; g.permission += r.permission
      g.total += (r.present > 0 || r.late > 0 || r.absent > 0 || r.permission > 0) ? 1 : 0
      groupMap.set(r.group, g)
    }
    const groups = Array.from(groupMap.values()).filter(g => g.total > 0)
    const perfect = groups.filter(g => g.absent === 0 && g.late === 0 && g.present > 0).length
    const worst = groups.length
      ? groups.reduce((best, cur) => (cur.absent > best.absent ? cur : best), groups[0])
      : null
    const perfectAttendees = data.details.filter(r => r.present > 0 && r.absent === 0 && r.late === 0 && r.permission === 0).length
    const pendingPermissions = data.details.filter(r => r.permission > 0).length
    return {
      perfectGroups: perfect,
      worstGroup: worst && worst.absent > 0 ? worst : null,
      perfectAttendees,
      pendingPermissions,
      totalGroups: groups.length,
    }
  }, [data])

  const exportCSV = () => {
    if (!filteredDetails.length) return
    const headers = [t('common.id'),t('common.name'),t('common.role'),t('dashboard.classOrDept'),t('common.present'),t('common.absent'),t('common.late'),t('common.permission')]
    const rows = filteredDetails.map(r => [r.id,r.name,getRoleLabel(r.role),r.group,r.present,r.absent,r.late,r.permission])
    const csv = '\uFEFF' + [headers,...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `attendance_${selectedDate}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const SummaryCard = ({ label, value, total, color, onClick }: { label:string; value:number; total:number; color:string; onClick?:()=>void }) => {
    const bg: Record<string,string> = {
      green:'from-emerald-50 to-emerald-100/50 border-emerald-200/60 hover:border-emerald-300 hover:shadow-emerald-100/40',
      red:'from-red-50 to-red-100/50 border-red-200/60 hover:border-red-300 hover:shadow-red-100/40',
      orange:'from-amber-50 to-amber-100/50 border-amber-200/60 hover:border-amber-300 hover:shadow-amber-100/40',
      blue:'from-blue-50 to-blue-100/50 border-blue-200/60 hover:border-blue-300 hover:shadow-blue-100/40',
    }
    const num: Record<string,string> = { green:'text-emerald-700', red:'text-red-700', orange:'text-amber-700', blue:'text-blue-700' }
    return (
      <button onClick={onClick} className={`bg-gradient-to-br ${bg[color]} relative border rounded-2xl p-4 text-left transition-all duration-200 cursor-pointer hover:shadow-lg active:scale-[0.97]`}>
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5"><CardIcon color={color}/><span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label}</span></div>
            <div className={`text-3xl font-extrabold tracking-tight ${num[color]}`}>{value}</div>
          </div>
          <StatRing value={value} total={total} color={color}/>
        </div>
        <div className="mt-1.5 text-[11px] text-gray-400 font-medium">of {total} total</div>
      </button>
    )
  }

  if (!mounted || loading) return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={currentNav} accentColor="indigo"/>
      <div className="page-content">
        <div className="h-14 lg:hidden"/>
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <div className="relative"><div className="w-10 h-10 rounded-full border-[3px] border-indigo-100"/><div className="absolute inset-0 w-10 h-10 rounded-full border-[3px] border-indigo-500 border-t-transparent animate-spin"/></div>
          <span className="text-sm text-gray-400">{t('common.loading') || 'Loading'}...</span>
        </div>
      </div>
    </div>
  )

  const stu = data?.students || { total:0,present:0,absent:0,late:0,permission:0 }
  const stf = data?.staff || { total:0,present:0,absent:0,late:0,permission:0 }

  // Greeting based on Cambodia time hour
  const greetingHour = (() => {
    if (!clockStr) return 12
    return parseInt(clockStr.split(':')[0] || '12', 10)
  })()
  const greeting = greetingHour < 12 ? (t('dashboard.goodMorning') || 'Good morning')
    : greetingHour < 18 ? (t('dashboard.goodAfternoon') || 'Good afternoon')
    : (t('dashboard.goodEvening') || 'Good evening')
  const greetingEmoji = greetingHour < 12 ? '☀️' : greetingHour < 18 ? '🌤️' : '🌙'

  const selectedDateObj = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date()
  const isToday = selectedDate === todayCambodia()

  // Quick Action shortcuts — most common admin tasks
  const quickActions: { label: string; href: string; emoji: string; color: string }[] = [
    { label: 'Take Attendance', href: '/admin/camera',                emoji: '📷', color: 'from-purple-500 to-fuchsia-500' },
    { label: 'Edit Attendance', href: '/admin/attendance/edit',       emoji: '✏️', color: 'from-indigo-500 to-blue-500' },
    { label: 'Reports',         href: '/admin/reports',               emoji: '📊', color: 'from-emerald-500 to-teal-500' },
    { label: 'Staff Reports',   href: '/admin/staff-reports',         emoji: '👥', color: 'from-cyan-500 to-sky-500' },
    { label: 'Classes',         href: '/admin/classes',               emoji: '🏫', color: 'from-amber-500 to-orange-500' },
    { label: 'Holidays',        href: '/admin/holidays',              emoji: '🎉', color: 'from-rose-500 to-pink-500' },
    { label: 'Sessions',        href: '/admin/session-settings',      emoji: '⏰', color: 'from-violet-500 to-purple-500' },
    { label: 'Notifications',   href: '/admin/notifications',         emoji: '🔔', color: 'from-yellow-500 to-amber-500' },
  ]

  // Spacing scale per density
  const sp = density === 'compact' ? 'space-y-3' : 'space-y-5'

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={currentNav} accentColor="indigo"/>
      <div className="page-content">
        <div className="h-14 lg:hidden"/>

        {/* ── Sticky compact header (mobile) ── */}
        <div className="sticky top-14 lg:top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2.5 bg-white/85 backdrop-blur-md border-b border-slate-200/70 flex items-center gap-2 lg:hidden">
          <span className="text-xs font-semibold text-slate-500 mr-auto truncate">
            {selectedDateObj.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="appearance-none bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none"/>
          <button onClick={() => setSelectedDate(todayCambodia())}
            className="px-2.5 py-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
            {t('common.today') || 'Today'}
          </button>
        </div>

        {/* ── Modern Hero Panel ── */}
        <div className="page-body">
          {banner && <div role={banner.tone === 'notice' ? undefined : 'alert'} className={`mb-5 rounded-2xl border p-5 ${billingTones[banner.tone]}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{banner.title}</h2><p className="mt-1 text-sm">{banner.body}</p>{banner.lines.map(line => <p key={line} className="mt-2 text-sm font-semibold">{line}</p>)}</div><Link href="/admin/platform-billing" className="rounded-lg border border-current px-4 py-2 text-sm font-semibold">View billing</Link></div></div>}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-xl">
            {/* decorative blobs */}
            <div aria-hidden className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-fuchsia-300/20 blur-3xl" />

            <div className="relative px-5 sm:px-7 py-5 sm:py-6 flex flex-col lg:flex-row lg:items-center gap-5">
              {/* Left: greeting + date + clock */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-white/80 font-medium uppercase tracking-wider">
                  <span>{greetingEmoji}</span><span>{greeting} · Admin</span>
                </div>
                <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                  {selectedDateObj.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </h1>
                <div className="mt-1.5 flex items-center gap-3 text-white/80 text-sm">
                  <span className="font-mono font-semibold tabular-nums text-base">{clockStr || '00:00:00'}</span>
                  <span className="text-white/40">·</span>
                  <span className="text-xs">Cambodia · ICT</span>
                  {isToday && (
                    <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] font-semibold bg-emerald-400/20 border border-emerald-300/40 px-2 py-0.5 rounded-full" title={agoStr ? `Updated ${agoStr}` : 'Live updates every 30s'}>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                      </span>
                      Live{agoStr ? ` · ${agoStr}` : ''}
                    </span>
                  )}
                  {!isToday && (
                    <button onClick={() => setSelectedDate(todayCambodia())}
                      className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold bg-white/15 hover:bg-white/25 backdrop-blur-sm px-2.5 py-1 rounded-full transition-colors">
                      ⏎ Jump to today
                    </button>
                  )}
                </div>

                {/* Hero desktop date picker */}
                <div className="mt-4 hidden lg:flex items-center gap-2">
                  <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                    className="appearance-none bg-white/15 backdrop-blur-sm border border-white/25 text-white rounded-xl px-3.5 py-2 text-sm font-medium placeholder:text-white/50 focus:ring-2 focus:ring-white/40 focus:border-white/50 outline-none transition-all cursor-pointer [color-scheme:dark]"/>
                  <button onClick={() => setSelectedDate(todayCambodia())}
                    className="px-3 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl transition-colors">
                    {t('common.today') || 'Today'}
                  </button>
                  <button onClick={() => fetchDashboard()} title="Refresh (R)"
                    className="px-3 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl transition-colors flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    Refresh
                  </button>
                  <button onClick={toggleDensity} title="Density"
                    className="px-3 py-2 text-xs font-semibold text-white bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-xl transition-colors flex items-center gap-1.5">
                    {density === 'compact' ? '☰ Comfortable' : '≡ Compact'}
                  </button>
                </div>
              </div>

              {/* Right: attendance rate ring + KPI chips */}
              <div className="flex items-center gap-5 flex-shrink-0">
                {/* Gauge */}
                <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0">
                  {(() => {
                    const pct = heroStats.rate
                    const r = 52, c = 2 * Math.PI * r
                    const off = c - (Math.min(100, pct) / 100) * c
                    return (
                      <svg width="100%" height="100%" viewBox="0 0 128 128">
                        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="10" />
                        <circle cx="64" cy="64" r={r} fill="none" stroke="white" strokeWidth="10" strokeLinecap="round"
                          strokeDasharray={c} strokeDashoffset={off}
                          transform="rotate(-90 64 64)"
                          className="transition-all duration-700 ease-out" />
                      </svg>
                    )
                  })()}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none">{heroStats.rate}%</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/70 mt-0.5">Attendance</span>
                    {heroStats.delta !== null && (
                      <span className={`text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded-full ${heroStats.delta >= 0 ? 'bg-emerald-400/25 text-emerald-100' : 'bg-rose-400/25 text-rose-100'}`}>
                        {heroStats.delta >= 0 ? '↑' : '↓'} {Math.abs(heroStats.delta).toFixed(1)}% vs yesterday
                      </span>
                    )}
                  </div>
                </div>
                {/* mini KPIs */}
                <div className="hidden sm:grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white/12 backdrop-blur-sm rounded-xl px-3 py-2">
                    <div className="text-white/70 uppercase tracking-wider text-[10px] font-semibold">Total</div>
                    <div className="text-lg font-bold tabular-nums">{heroStats.total}</div>
                  </div>
                  <div className="bg-white/12 backdrop-blur-sm rounded-xl px-3 py-2">
                    <div className="text-white/70 uppercase tracking-wider text-[10px] font-semibold">Present</div>
                    <div className="text-lg font-bold tabular-nums">{heroStats.presentTotal}</div>
                  </div>
                  <div className="bg-white/12 backdrop-blur-sm rounded-xl px-3 py-2">
                    <div className="text-white/70 uppercase tracking-wider text-[10px] font-semibold">Absent</div>
                    <div className="text-lg font-bold tabular-nums">{heroStats.absentTotal}</div>
                  </div>
                  <div className="bg-white/12 backdrop-blur-sm rounded-xl px-3 py-2">
                    <div className="text-white/70 uppercase tracking-wider text-[10px] font-semibold">Late</div>
                    <div className="text-lg font-bold tabular-nums">{heroStats.lateTotal}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`page-body ${sp}`}>
          {/* ── Quick Actions ── */}
          <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
            {quickActions.map(a => (
              <Link key={a.href} href={a.href}
                className="group relative overflow-hidden rounded-2xl bg-white border border-slate-200/70 hover:border-transparent hover:shadow-lg active:scale-[0.97] transition-all p-3 sm:p-4 flex flex-col items-center justify-center gap-1.5 text-center">
                <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br ${a.color}`} aria-hidden />
                <span className="relative text-2xl sm:text-3xl transition-transform group-hover:scale-110">{a.emoji}</span>
                <span className="relative text-[10px] sm:text-xs font-semibold text-slate-700 group-hover:text-white transition-colors leading-tight">{a.label}</span>
              </Link>
            ))}
          </div>

          {/* ── Today's Insights (auto-computed) ── */}
          {insights && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-3.5">
                <div className="flex items-center gap-2 text-emerald-700">
                  <span className="text-xl">🏆</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Perfect Groups</span>
                </div>
                <div className="text-2xl font-extrabold text-emerald-800 mt-1">{insights.perfectGroups}<span className="text-sm font-medium text-emerald-600">/{insights.totalGroups}</span></div>
                <div className="text-[11px] text-emerald-600/80 mt-0.5">No absent or late today</div>
              </div>
              <div className="rounded-2xl border border-blue-200/70 bg-gradient-to-br from-blue-50 to-blue-100/40 p-3.5">
                <div className="flex items-center gap-2 text-blue-700">
                  <span className="text-xl">✨</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Perfect Attendees</span>
                </div>
                <div className="text-2xl font-extrabold text-blue-800 mt-1">{insights.perfectAttendees}</div>
                <div className="text-[11px] text-blue-600/80 mt-0.5">Present all sessions, no late</div>
              </div>
              <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-amber-100/40 p-3.5">
                <div className="flex items-center gap-2 text-amber-700">
                  <span className="text-xl">📨</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Permissions</span>
                </div>
                <div className="text-2xl font-extrabold text-amber-800 mt-1">{insights.pendingPermissions}</div>
                <div className="text-[11px] text-amber-600/80 mt-0.5">People with permission today</div>
              </div>
              <button onClick={() => insights.worstGroup && handleCardClick(insights.worstGroup.name.toLowerCase().includes('class') || insights.worstGroup.name.match(/^\d/) ? 'Student' : 'Staff', 'absent')}
                disabled={!insights.worstGroup}
                className="text-left rounded-2xl border border-rose-200/70 bg-gradient-to-br from-rose-50 to-rose-100/40 p-3.5 hover:shadow-md hover:border-rose-300 transition-all disabled:cursor-default disabled:hover:shadow-none">
                <div className="flex items-center gap-2 text-rose-700">
                  <span className="text-xl">⚠️</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Needs Attention</span>
                </div>
                {insights.worstGroup ? (
                  <>
                    <div className="text-base font-extrabold text-rose-800 mt-1 truncate">{insights.worstGroup.name}</div>
                    <div className="text-[11px] text-rose-600/80 mt-0.5">{insights.worstGroup.absent} absent · tap to view</div>
                  </>
                ) : (
                  <>
                    <div className="text-base font-extrabold text-emerald-700 mt-1">All Good</div>
                    <div className="text-[11px] text-rose-600/80 mt-0.5">No groups flagged today</div>
                  </>
                )}
              </button>
            </div>
          )}

          {data && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 rounded-full bg-purple-500"/><h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">{t('dashboard.studentSummary')}</h2>
                  <span className="ml-1 text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{stu.total}</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <SummaryCard label={t('common.present')} value={stu.present} total={stu.total} color="green" onClick={() => handleCardClick('Student','present')}/>
                  <SummaryCard label={t('common.absent')} value={stu.absent} total={stu.total} color="red" onClick={() => handleCardClick('Student','absent')}/>
                  <SummaryCard label={t('common.late')} value={stu.late} total={stu.total} color="orange" onClick={() => handleCardClick('Student','late')}/>
                  <SummaryCard label={t('common.permission')} value={stu.permission} total={stu.total} color="blue" onClick={() => handleCardClick('Student','permission')}/>
                </div>
                {stu.permissionBreakdown && (
                  <div className="mt-2 text-xs text-slate-500">
                    Permission Types: Morning Half={stu.permissionBreakdown.halfDayMorning} | Afternoon Half={stu.permissionBreakdown.halfDayAfternoon} | Full Day={stu.permissionBreakdown.fullDay} | Many Day={stu.permissionBreakdown.multiDay}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 rounded-full bg-cyan-500"/><h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">{t('dashboard.staffSummary')}</h2>
                  <span className="ml-1 text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{stf.total}</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <SummaryCard label={t('common.present')} value={stf.present} total={stf.total} color="green" onClick={() => handleCardClick('Staff','present')}/>
                  <SummaryCard label={t('common.absent')} value={stf.absent} total={stf.total} color="red" onClick={() => handleCardClick('Staff','absent')}/>
                  <SummaryCard label={t('common.late')} value={stf.late} total={stf.total} color="orange" onClick={() => handleCardClick('Staff','late')}/>
                  <SummaryCard label={t('common.permission')} value={stf.permission} total={stf.total} color="blue" onClick={() => handleCardClick('Staff','permission')}/>
                </div>
                {stf.permissionBreakdown && (
                  <div className="mt-2 text-xs text-slate-500">
                    Permission Types: Morning Half={stf.permissionBreakdown.halfDayMorning} | Afternoon Half={stf.permissionBreakdown.halfDayAfternoon} | Full Day={stf.permissionBreakdown.fullDay} | Many Day={stf.permissionBreakdown.multiDay}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Class Attendance Progress (real-time) ── */}
          <ClassProgressPanel
            rows={classProgress}
            loading={classProgressLoading}
            flash={classProgressFlash}
            search={classProgressSearch}
            setSearch={setClassProgressSearch}
            sortMode={classProgressSort}
            setSortMode={setClassProgressSort}
            isToday={isToday}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Student Attendance Distribution */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center gap-2 px-5 pt-5">
                <div className="w-1 h-5 rounded-full bg-purple-500"/>
                <h3 className="text-sm font-bold text-gray-700">{t('dashboard.studentSummary')} - {t('dashboard.attendanceDistribution')}</h3>
              </div>
              <div className="px-5 pb-5" style={{ height: '280px' }}>
                {studentPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={studentPieData} cx="50%" cy="50%" labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent ? (percent*100).toFixed(0) : '0')}%`}
                        outerRadius={85} innerRadius={50} dataKey="value" stroke="none" animationDuration={800}>
                        {studentPieData.map((entry,i) => <Cell key={i} fill={entry.color}/>)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius:'12px', border:'1px solid #E5E7EB', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', fontSize:'13px' }}
                        formatter={(value,name) => { const v = Number(value)||0; const tot = studentPieData.reduce((s,d)=>s+d.value,0); return [`${v} (${tot>0?((v/tot)*100).toFixed(1):0}%)`,name] }}/>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:'12px', paddingTop:'8px' }}/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>
                    <span className="text-sm">{t('common.noData')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Staff Attendance Distribution */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center gap-2 px-5 pt-5">
                <div className="w-1 h-5 rounded-full bg-cyan-500"/>
                <h3 className="text-sm font-bold text-gray-700">{t('dashboard.staffSummary')} - {t('dashboard.attendanceDistribution')}</h3>
              </div>
              <div className="px-5 pb-5" style={{ height: '280px' }}>
                {staffPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={staffPieData} cx="50%" cy="50%" labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent ? (percent*100).toFixed(0) : '0')}%`}
                        outerRadius={85} innerRadius={50} dataKey="value" stroke="none" animationDuration={800}>
                        {staffPieData.map((entry,i) => <Cell key={i} fill={entry.color}/>)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius:'12px', border:'1px solid #E5E7EB', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', fontSize:'13px' }}
                        formatter={(value,name) => { const v = Number(value)||0; const tot = staffPieData.reduce((s,d)=>s+d.value,0); return [`${v} (${tot>0?((v/tot)*100).toFixed(1):0}%)`,name] }}/>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:'12px', paddingTop:'8px' }}/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"/></svg>
                    <span className="text-sm">{t('common.noData')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Monthly Line Chart ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-5 pt-5 gap-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 rounded-full bg-indigo-500"/>
                <h3 className="text-sm font-bold text-gray-700">{t('dashboard.monthlyTrend') || 'Monthly Attendance Trend'}</h3>
              </div>
              <div className="flex items-center gap-2">
                <select value={trendMonth} onChange={e => setTrendMonth(Number(e.target.value))}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 cursor-pointer focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all">
                  {Array.from({length:12},(_,i)=>i+1).map(m => (
                    <option key={m} value={m}>{new Date(2000,m-1).toLocaleString('default',{month:'long'})}</option>
                  ))}
                </select>
                <select value={trendYear} onChange={e => setTrendYear(Number(e.target.value))}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-gray-600 cursor-pointer focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all">
                  {Array.from({length:5},(_,i)=>new Date().getFullYear()-i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-5 pb-5 pt-2" style={{ height: '320px' }}>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false}/>
                    <XAxis dataKey="day" tick={{ fontSize:11, fill:'#9CA3AF' }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fontSize:11, fill:'#9CA3AF' }} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{ borderRadius:'12px', border:'1px solid #E5E7EB', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', fontSize:'13px' }}/>
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:'12px', paddingTop:'8px' }}/>
                    <Line type="monotone" dataKey="studentPresent" name={`${t('common.students')} - ${t('common.present')}`} stroke="#8B5CF6" strokeWidth={2} dot={false} activeDot={{ r:4 }}/>
                    <Line type="monotone" dataKey="studentAbsent" name={`${t('common.students')} - ${t('common.absent')}`} stroke="#A78BFA" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r:4 }}/>
                    <Line type="monotone" dataKey="staffPresent" name={`${t('dashboard.staff')} - ${t('common.present')}`} stroke="#06B6D4" strokeWidth={2} dot={false} activeDot={{ r:4 }}/>
                    <Line type="monotone" dataKey="staffAbsent" name={`${t('dashboard.staff')} - ${t('common.absent')}`} stroke="#67E8F9" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r:4 }}/>
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/></svg>
                  <span className="text-sm">{t('common.noData')}</span>
                </div>
              )}
            </div>
          </div>

          <div id="detail-table" className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setTableExpanded(prev => !prev)}
              className="w-full p-4 sm:p-5 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-gray-700">{t('dashboard.detailedTable')}</h3>
                <span className="text-[11px] bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{filteredDetails.length}</span>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${tableExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </button>

            {tableExpanded && (<>
            <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3">
                <div className="flex items-center gap-3">
                  {drillRole && (
                    <button onClick={clearDrill} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full hover:bg-indigo-100 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                      {t('dashboard.clearFilter')}
                    </button>
                  )}
                  <span className="text-[11px] bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{filteredDetails.length}</span>
                </div>
                <button onClick={exportCSV} disabled={filteredDetails.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  {t('common.exportCSV')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <div className="relative flex-1 min-w-[120px] sm:flex-none sm:w-52">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  <input ref={searchInputRef} type="text" placeholder={`${t('common.search')}... (press /)`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 focus:bg-white transition-all"/>
                </div>
                <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value as any); setDrillRole(null) }}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 cursor-pointer transition-all">
                  <option value="all">{t('common.all')} {t('common.role')}</option>
                  <option value="Student">{t('common.students')}</option>
                  <option value="Staff">{t('dashboard.staff')}</option>
                </select>
                <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 cursor-pointer transition-all">
                  <option value="">{t('dashboard.allClassesDepts')}</option>
                  {data?.filters.classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  {data?.filters.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              {/* Status filter pills — more touchable & visible */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {([
                  { v:'all',        label: t('common.all') || 'All',           cls:'bg-slate-100 text-slate-700 ring-slate-200',     active:'bg-slate-900 text-white ring-slate-900' },
                  { v:'present',    label: t('common.present'),                cls:'bg-emerald-50 text-emerald-700 ring-emerald-200', active:'bg-emerald-600 text-white ring-emerald-600' },
                  { v:'absent',     label: t('common.absent'),                 cls:'bg-rose-50 text-rose-700 ring-rose-200',          active:'bg-rose-600 text-white ring-rose-600' },
                  { v:'late',       label: t('common.late'),                   cls:'bg-amber-50 text-amber-700 ring-amber-200',       active:'bg-amber-600 text-white ring-amber-600' },
                  { v:'permission', label: t('common.permission'),             cls:'bg-blue-50 text-blue-700 ring-blue-200',          active:'bg-blue-600 text-white ring-blue-600' },
                ] as { v: StatusFilter; label: string; cls: string; active: string }[]).map(pill => (
                  <button key={pill.v} onClick={() => setStatusFilter(pill.v)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold ring-1 transition-all ${statusFilter === pill.v ? pill.active + ' shadow-sm' : pill.cls + ' hover:ring-2'}`}>
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{t('common.name')}</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{t('common.role')}</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">{t('dashboard.classOrDept')}</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">{t('common.present')}</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-red-600 uppercase tracking-wider">{t('common.absent')}</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-amber-600 uppercase tracking-wider">{t('common.late')}</th>
                    <th className="text-center px-3 py-3 text-[11px] font-semibold text-blue-600 uppercase tracking-wider">{t('common.permission')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredDetails.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-gray-300">
                      <svg className="w-10 h-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
                      <span className="text-sm">{t('common.noData')}</span>
                    </td></tr>
                  ) : filteredDetails.slice(0, visibleCount).map((row, i) => (
                    <tr key={`${row.id}-${i}`} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3"><div className="font-medium text-gray-900 text-sm">{row.name}</div><div className="text-[11px] text-gray-400 md:hidden">{row.group||''}</div></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${row.role==='Student'?'bg-purple-50 text-purple-700 ring-1 ring-purple-200/60':'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200/60'}`}>
                          {row.role === 'Student' ? t('common.students') : getRoleLabel(row.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">{row.group||'-'}</td>
                      <td className="text-center px-3 py-3">{row.present>0?<span className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold ring-1 ring-emerald-200/50">{row.present}</span>:<span className="text-gray-200">-</span>}</td>
                      <td className="text-center px-3 py-3">{row.absent>0?<span className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg bg-red-50 text-red-700 text-xs font-bold ring-1 ring-red-200/50">{row.absent}</span>:<span className="text-gray-200">-</span>}</td>
                      <td className="text-center px-3 py-3">{row.late>0?<span className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold ring-1 ring-amber-200/50">{row.late}</span>:<span className="text-gray-200">-</span>}</td>
                      <td className="text-center px-3 py-3">{row.permission>0?<span className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold ring-1 ring-blue-200/50">{row.permission}</span>:<span className="text-gray-200">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredDetails.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                <span className="text-[11px] text-gray-400 font-medium">{t('common.showing')} {Math.min(visibleCount, filteredDetails.length)} / {filteredDetails.length} {t('common.results')}</span>
                {visibleCount < filteredDetails.length && (
                  <button onClick={() => setVisibleCount(v => v + 100)}
                    className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl hover:bg-indigo-100 transition-colors">
                    Show more ({filteredDetails.length - visibleCount} remaining)
                  </button>
                )}
              </div>
            )}
            </>)}
          </div>
        </div>
      </div>

      {/* ── Absent Students Modal ── */}
      {absentModal && (() => {
        const absentRows = (data?.details || []).filter(r => {
          if (absentModalRole === 'Student' && r.role !== 'Student') return false
          if (absentModalRole === 'Staff' && r.role === 'Student') return false
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
            getRoleLabel(r.role),
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

        return (
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
                {/* Address search — icon is outside the input so it never overlaps text */}
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
                  <div className="flex flex-col items-center justify-center py-16 text-slate-300 gap-2">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
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
              {absentRows.length > 0 && (
                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{absentRows.length} record{absentRows.length !== 1 ? 's' : ''}{absentAddressFilter ? ' (filtered by address)' : ''}</span>
                  <button onClick={() => setAbsentModal(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-xl hover:bg-slate-100 transition-colors">Close</button>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function AdminPage() {
  const core = frontendDistribution() === 'core'
  return (
    <AuthGuard allowedRoles={['ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN', 'CLASS_ADMIN']}>
      {core ? <CoreAdminDashboard /> : <DashboardContent/>}
    </AuthGuard>
  )
}

/* ── Class Attendance Progress Panel ───────────────────────────────
   Renders one row per class with a stacked progress bar:
   green = present, amber = late, purple = permission, red = absent.
   Flashes briefly when a student scan event arrives for the class. */
interface ClassProgressRow { classId: string; className: string; total: number; present: number; late: number; absent: number; permission: number; scanned: number; pctPresent: number; pctScanned: number }
interface ClassProgressPanelProps {
  rows: ClassProgressRow[]
  loading: boolean
  flash: Record<string, number>
  search: string
  setSearch: (s: string) => void
  sortMode: 'name' | 'pctAsc' | 'pctDesc'
  setSortMode: (m: 'name' | 'pctAsc' | 'pctDesc') => void
  isToday: boolean
}
function ClassProgressPanel({ rows, loading, flash, search, setSearch, sortMode, setSortMode, isToday }: ClassProgressPanelProps) {
  const now = Date.now()
  const filtered = rows.filter(r => r.className.toLowerCase().includes(search.trim().toLowerCase()))
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'name') return a.className.localeCompare(b.className, undefined, { numeric: true })
    if (sortMode === 'pctAsc') return a.pctPresent - b.pctPresent
    return b.pctPresent - a.pctPresent
  })
  // Aggregate
  const agg = rows.reduce((acc, r) => {
    acc.total += r.total; acc.present += r.present; acc.late += r.late; acc.permission += r.permission; acc.absent += r.absent; acc.scanned += r.scanned
    return acc
  }, { total: 0, present: 0, late: 0, permission: 0, absent: 0, scanned: 0 })
  const aggPctPresent = agg.total > 0 ? Math.round((agg.present / agg.total) * 100) : 0
  const aggPctScanned = agg.total > 0 ? Math.round((agg.scanned / agg.total) * 100) : 0

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h3 className="text-sm font-bold text-slate-800">Class Attendance Progress</h3>
          {isToday && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
          )}
          {loading && <span className="text-[10px] text-slate-400">refreshing…</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search class…"
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none w-32 sm:w-44"
          />
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as any)}
            className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white outline-none"
          >
            <option value="name">Name</option>
            <option value="pctDesc">Present % ↓</option>
            <option value="pctAsc">Present % ↑</option>
          </select>
        </div>
      </div>

      {/* Overall summary */}
      <div className="px-4 py-3 bg-gradient-to-br from-slate-50 to-white border-b border-slate-100 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Classes</div><div className="text-lg font-bold text-slate-800">{rows.length}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-slate-500">Students</div><div className="text-lg font-bold text-slate-800">{agg.total}</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-emerald-600">Scanned</div><div className="text-lg font-bold text-emerald-700">{agg.scanned}<span className="text-xs font-medium text-emerald-500"> ({aggPctScanned}%)</span></div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-emerald-600">Present</div><div className="text-lg font-bold text-emerald-700">{agg.present}<span className="text-xs font-medium text-emerald-500"> ({aggPctPresent}%)</span></div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-rose-600">Absent</div><div className="text-lg font-bold text-rose-700">{agg.absent}</div></div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
        {sorted.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">No classes match.</div>
        )}
        {sorted.length === 0 && loading && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">Loading classes…</div>
        )}
        {sorted.map(row => {
          const flashTime = flash[row.classId]
          const flashing = flashTime && (now - flashTime) < 2500
          const pctP = row.total > 0 ? (row.present / row.total) * 100 : 0
          const pctL = row.total > 0 ? (row.late / row.total) * 100 : 0
          const pctPerm = row.total > 0 ? (row.permission / row.total) * 100 : 0
          const pctA = row.total > 0 ? (row.absent / row.total) * 100 : 0
          return (
            <div key={row.classId} className={`px-4 py-2.5 transition-colors ${flashing ? 'bg-emerald-50/70' : 'hover:bg-slate-50/60'}`}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-shrink-0 w-32 sm:w-40">
                  <div className="text-sm font-semibold text-slate-800 truncate" title={row.className}>{row.className}</div>
                  <div className="text-[10px] text-slate-500">{row.total} student{row.total === 1 ? '' : 's'}</div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="relative h-5 rounded-full bg-slate-100 overflow-hidden flex">
                    {pctP > 0 && <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${pctP}%` }} title={`Present: ${row.present}`} />}
                    {pctL > 0 && <div className="h-full bg-gradient-to-r from-amber-300 to-amber-500" style={{ width: `${pctL}%` }} title={`Late: ${row.late}`} />}
                    {pctPerm > 0 && <div className="h-full bg-gradient-to-r from-purple-300 to-purple-500" style={{ width: `${pctPerm}%` }} title={`Permission: ${row.permission}`} />}
                    {pctA > 0 && <div className="h-full bg-gradient-to-r from-rose-300 to-rose-500" style={{ width: `${pctA}%` }} title={`Absent: ${row.absent}`} />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                    <span className="text-emerald-700">● {row.present} present</span>
                    {row.late > 0 && <span className="text-amber-700">● {row.late} late</span>}
                    {row.permission > 0 && <span className="text-purple-700">● {row.permission} perm</span>}
                    {row.absent > 0 && <span className="text-rose-700">● {row.absent} absent</span>}
                  </div>
                </div>

                <div className="flex-shrink-0 w-14 text-right">
                  <div className={`text-lg font-extrabold tabular-nums ${row.pctPresent >= 80 ? 'text-emerald-600' : row.pctPresent >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{row.pctPresent}%</div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">present</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
