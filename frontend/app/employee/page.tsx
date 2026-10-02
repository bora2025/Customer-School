"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Sidebar from '../../components/Sidebar'
import AuthGuard from '../../components/AuthGuard'
import { employeeNav } from '../../lib/employee-nav'
import { apiFetch } from '../../lib/api'
import { useLanguage } from '../../lib/i18n'
import { formatCambodiaTime } from '../../lib/dateUtils'
import { IconCamera, IconChart, IconIdCard, IconSettings } from '../../components/Icons'

interface AttendanceRecord {
  id: string
  date: string
  session: number
  status: string
  checkInTime: string | null
  checkOutTime: string | null
  scanLatitude: number | null
  scanLongitude: number | null
  scanLocation: string | null
}

interface AttendanceData {
  records: AttendanceRecord[]
  todayRecords: AttendanceRecord[]
  summary: { total: number; present: number; late: number; absent: number }
}

const sessionLabels: Record<number, string> = {
  1: 'employee.session1',
  2: 'employee.session2',
  3: 'employee.session3',
  4: 'employee.session4',
}

const statusColors: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700',
  LATE: 'bg-amber-100 text-amber-700',
  ABSENT: 'bg-red-100 text-red-700',
  PERMISSION: 'bg-blue-100 text-blue-700',
  DAY_OFF: 'bg-slate-100 text-slate-500',
}

const statusIcons: Record<string, string> = {
  PRESENT: '✅',
  LATE: '⏰',
  ABSENT: '❌',
  PERMISSION: '🏖',
  DAY_OFF: '📅',
}

export default function EmployeeDashboard() {
  const [data, setData] = useState<AttendanceData | null>(null)
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    apiFetch('/api/auth/me').then(async (res) => {
      if (res.ok) {
        const user = await res.json()
        setUserName(user.name)
        setUserRole(user.role)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetchRecords()
  }, [selectedMonth])

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/attendance/employee/my-records?month=${selectedMonth}`)
      if (res.ok) {
        setData(await res.json())
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  const formatTime = (iso: string | null) => formatCambodiaTime(iso)

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // Group records by date
  const groupedByDate = (data?.records || []).reduce((acc, r) => {
    const dateKey = r.date.split('T')[0]
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(r)
    return acc
  }, {} as Record<string, AttendanceRecord[]>)

  const dateKeys = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a))

  return (
    <AuthGuard allowedRoles={['EMPLOYEE']}>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar title="Employee" subtitle={userName || 'Portal'} navItems={employeeNav} accentColor="emerald" />

        <main className="flex-1 lg:ml-0">
          <div className="lg:hidden h-14" />
          <div className="page-shell">
            <div className="page-content">
              {/* Header */}
              <div className="page-header flex items-center justify-between">
                <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">📊 {t('employee.title')}</h1>
                <p className="text-sm text-slate-500 mt-1">{t('employee.welcome')}, {userName || '...'}</p>
                </div>
                <Link href="/employee/scan" className="btn-primary hidden lg:inline-flex">
                  📷 {t('employee.scanNow')}
                </Link>
              </div>

              <div className="page-body space-y-6">

                {/* Mobile Quick Actions (matches mobile app 4-col grid) */}
                <div className="grid grid-cols-4 gap-3 lg:hidden">
                  <Link href="/employee/scan" className="action-card-mobile">
                    <span className="action-icon" style={{ color: 'var(--color-icon)' }}><IconCamera size={26} /></span>
                    <span className="action-label">{t('employee.scanNow')}</span>
                  </Link>
                  <Link href="/employee/reports" className="action-card-mobile">
                    <span className="action-icon" style={{ color: 'var(--color-icon)' }}><IconChart size={26} /></span>
                    <span className="action-label">{t('nav.myReports')}</span>
                  </Link>
                  <Link href="/employee/my-card" className="action-card-mobile">
                    <span className="action-icon" style={{ color: 'var(--color-icon)' }}><IconIdCard size={26} /></span>
                    <span className="action-label">{t('employee.myIdCard')}</span>
                  </Link>
                  <Link href="/employee" className="action-card-mobile">
                    <span className="action-icon" style={{ color: 'var(--color-icon)' }}><IconSettings size={26} /></span>
                    <span className="action-label">{t('nav.settings')}</span>
                  </Link>
                </div>

                {/* Today's Status */}
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('employee.todayAttendance')}</h2>
                  {data?.todayRecords && data.todayRecords.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[1, 2, 3, 4].map(session => {
                        const rec = data.todayRecords.find(r => r.session === session)
                        return (
                          <div key={session} className={`rounded-lg p-3 text-center ${rec ? statusColors[rec.status] || 'bg-slate-50' : 'bg-slate-50 text-slate-300'}`}>
                            <p className="text-xs font-medium opacity-70 mb-1">{t(sessionLabels[session])}</p>
                            {rec ? (
                              <>
                                <p className="text-lg font-bold">{statusIcons[rec.status]} {rec.status}</p>
                                <p className="text-xs mt-1">
                                  {rec.checkInTime ? formatTime(rec.checkInTime) : ''}
                                  {rec.checkOutTime ? ` → ${formatTime(rec.checkOutTime)}` : ''}
                                </p>
                              </>
                            ) : (
                              <p className="text-sm">—</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-slate-400">
                      <p className="text-3xl mb-2">📭</p>
                      <p className="text-sm">No attendance recorded today</p>
                      <Link href="/employee/scan" className="btn-primary btn-sm mt-3 inline-block">
                        📷 Scan to Check In
                      </Link>
                    </div>
                  )}
                </div>

                {/* Monthly Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="card p-4 text-center">
                    <p className="text-3xl font-bold text-slate-800">{data?.summary.total ?? 0}</p>
                    <p className="text-xs text-slate-500 mt-1">{t('employee.totalRecords')}</p>
                  </div>
                  <div className="card p-4 text-center">
                    <p className="text-3xl font-bold text-emerald-600">{data?.summary.present ?? 0}</p>
                    <p className="text-xs text-slate-500 mt-1">{t('common.present')}</p>
                  </div>
                  <div className="card p-4 text-center">
                    <p className="text-3xl font-bold text-amber-600">{data?.summary.late ?? 0}</p>
                    <p className="text-xs text-slate-500 mt-1">{t('common.late')}</p>
                  </div>
                  <div className="card p-4 text-center">
                    <p className="text-3xl font-bold text-red-600">{data?.summary.absent ?? 0}</p>
                    <p className="text-xs text-slate-500 mt-1">{t('common.absent')}</p>
                  </div>
                </div>

                {/* Quick Access - ID Card (desktop only, mobile has action grid) */}
                <Link href="/employee/my-card" className="card p-5 hidden lg:flex items-center gap-4 hover:shadow-md transition-shadow group">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">🪪</div>
                  <div>
                    <h3 className="font-semibold text-slate-800">{t('employee.myIdCard')}</h3>
                    <p className="text-xs text-slate-500">View and download your employee ID card</p>
                  </div>
                  <span className="ml-auto text-slate-300 group-hover:text-slate-500 transition-colors">→</span>
                </Link>

                {/* Month Picker + History */}
                <div className="card">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-700">{t('employee.attendanceHistory')}</h2>
                    <input
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                    />
                  </div>

                  {loading ? (
                    <div className="p-8 text-center">
                      <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-sm text-slate-500 mt-2">{t('common.loading')}</p>
                    </div>
                  ) : dateKeys.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">
                      <p className="text-3xl mb-2">📭</p>
                      <p className="text-sm">{t('employee.noRecords')}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {dateKeys.map(dateKey => (
                        <div key={dateKey} className="p-4">
                          <p className="text-xs font-semibold text-slate-500 mb-2">{formatDate(dateKey)}</p>
                          <div className="flex flex-wrap gap-2">
                            {groupedByDate[dateKey].sort((a, b) => a.session - b.session).map(rec => (
                              <div key={rec.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[rec.status] || 'bg-slate-100 text-slate-600'}`}>
                                <span>{statusIcons[rec.status]}</span>
                                <span>S{rec.session}</span>
                                <span className="opacity-60">
                                  {rec.checkInTime ? formatTime(rec.checkInTime) : ''}
                                  {rec.checkOutTime ? ` → ${formatTime(rec.checkOutTime)}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
