"use client"

import React from 'react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import AuthGuard from '../../components/AuthGuard'
import Sidebar from '../../components/Sidebar'
import AnnouncementFeed from '../../components/AnnouncementFeed'
import TimetableGrid from '../../components/TimetableGrid'
import { teacherNav } from '../../lib/teacher-nav'
import { apiFetch, getCurrentUser } from '../../lib/api'
import { useLanguage } from '../../lib/i18n'
import { todayCambodia } from '../../lib/dateUtils'

interface Class {
  id: string
  name: string
  subject: string
  schedule: string | null
  teacher: {
    name: string
  }
}

interface ClassSummary {
  classId: string
  className: string
  subject: string | null
  totalStudents: number
  present: number
  absent: number
  late: number
  permission: number
  attendanceRate: number
}

export default function TeacherDashboard() {
  const [classes, setClasses] = useState<Class[]>([])
  const [teacherId, setTeacherId] = useState<string | null>(null)
  const [teacherName, setTeacherName] = useState<string>('')
  const [summaries, setSummaries] = useState<ClassSummary[]>([])
  const [selectedDate, setSelectedDate] = useState(() => todayCambodia())
  const [loadingSummary, setLoadingSummary] = useState(false)
  const { t } = useLanguage()

  useEffect(() => {
    getCurrentUser().then(user => {
      if (user) { setTeacherId(user.userId); setTeacherName(user.name || '') }
    })
  }, [])

  useEffect(() => {
    if (teacherId) {
      fetchClasses()
      fetchSummaries()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, selectedDate])

  const fetchClasses = async () => {
    try {
      const res = await apiFetch(`/api/classes?teacherId=${teacherId}`)
      const data = await res.json()
      setClasses(data)
    } catch (error) {
      console.error('Error fetching classes:', error)
    }
  }

  const fetchSummaries = async () => {
    if (!teacherId) return
    setLoadingSummary(true)
    try {
      const res = await apiFetch(`/api/reports/class-summaries?teacherId=${teacherId}&date=${selectedDate}`)
      if (res.ok) setSummaries(await res.json())
    } catch { /* ignore */ }
    setLoadingSummary(false)
  }

  const goDay = (offset: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + offset)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const formatSchedule = (schedule: string | null): string => {
    if (!schedule) return ''
    try {
      const parsed = JSON.parse(schedule)
      const abbr: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }
      const days = Object.entries(parsed)
        .filter(([, v]) => v !== 'day-off')
        .map(([k]) => abbr[k] || k)
      return days.join(', ')
    } catch {
      return schedule
    }
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      total: acc.total + s.totalStudents,
      present: acc.present + s.present,
      late: acc.late + s.late,
      absent: acc.absent + s.absent,
      permission: acc.permission + s.permission,
    }),
    { total: 0, present: 0, late: 0, absent: 0, permission: 0 },
  )

  return (
    <AuthGuard requiredRole="TEACHER">
      <div className="page-shell">
        <Sidebar title="Teacher Portal" subtitle="Wattanman" navItems={teacherNav} accentColor="emerald" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
              {teacherName ? `👋 ${t('common.hello') || 'Hello'}, ${teacherName}` : t('teacher.title')}
            </h1>
            <p className="text-sm text-slate-500 mt-1">{t('teacher.subtitle')}</p>
          </div>

          <div className="page-body space-y-4 sm:space-y-6">
            {/* Quick Actions */}
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {[
                { href: '/teacher/camera', icon: '📷', label: t('teacher.takeAttendance') || 'Attendance', bg: 'from-emerald-500 to-teal-500' },
                { href: '/teacher/messages', icon: '💬', label: 'Messages', bg: 'from-sky-500 to-blue-500' },
                { href: '/teacher/assignments', icon: '📝', label: 'Assignments', bg: 'from-violet-500 to-purple-500' },
                { href: '/teacher/gradebook', icon: '📊', label: 'Gradebook', bg: 'from-amber-500 to-orange-500' },
              ].map(a => (
                <Link key={a.href} href={a.href} className="group">
                  <div className={`rounded-2xl bg-gradient-to-br ${a.bg} p-3 sm:p-4 text-white shadow-sm active:scale-[0.97] transition-transform h-full flex flex-col items-center justify-center gap-1`}>
                    <span className="text-2xl sm:text-3xl" aria-hidden>{a.icon}</span>
                    <span className="text-[10px] sm:text-xs font-semibold text-center leading-tight">{a.label}</span>
                  </div>
                </Link>
              ))}
            </div>
            {/* Announcements */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">📣 Announcements</h3>
              </div>
              <AnnouncementFeed accent="emerald" limit={5} />
            </div>
            {/* Student Attendance Summary */}
            {classes.length > 0 && <div className="card p-4 space-y-4">
              {/* Date navigation */}
              <div className="flex items-center gap-2">
                <button onClick={() => goDay(-1)} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-sm transition-colors">◀</button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                />
                <button onClick={() => goDay(1)} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-sm transition-colors">▶</button>
              </div>

              {loadingSummary ? (
                <div className="flex justify-center py-6">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {/* Aggregate stat cards */}
                  <div className="grid grid-cols-4 gap-2 sm:gap-3">
                    <div className="rounded-2xl bg-emerald-50 p-3 text-center">
                      <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide mb-1">{t('common.present')}</p>
                      <p className="text-2xl font-extrabold text-emerald-700">{totals.present}</p>
                    </div>
                    <div className="rounded-2xl bg-amber-50 p-3 text-center">
                      <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">{t('common.late')}</p>
                      <p className="text-2xl font-extrabold text-amber-700">{totals.late}</p>
                    </div>
                    <div className="rounded-2xl bg-red-50 p-3 text-center">
                      <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mb-1">{t('common.absent')}</p>
                      <p className="text-2xl font-extrabold text-red-700">{totals.absent}</p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 p-3 text-center">
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-1">{t('common.dayOff')}</p>
                      <p className="text-2xl font-extrabold text-blue-700">{totals.permission}</p>
                    </div>
                  </div>

                  {/* Per-class breakdown */}
                  {summaries.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      {summaries.map(cls => (
                        <div key={cls.classId} className="border border-slate-100 rounded-xl overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                            <div>
                              <span className="font-semibold text-slate-800 text-sm">{cls.className}</span>
                              {cls.subject && <span className="text-xs text-slate-400 ml-2">{cls.subject}</span>}
                            </div>
                            <span className="text-xs text-slate-400">{cls.totalStudents} {t('teacher.students') || 'students'}</span>
                          </div>
                          <div className="px-3 py-2 flex gap-4 text-xs">
                            <span className="text-emerald-600 font-semibold">✓ {cls.present}</span>
                            <span className="text-amber-600 font-semibold">⏰ {cls.late}</span>
                            <span className="text-red-600 font-semibold">✗ {cls.absent}</span>
                            <span className="text-blue-600 font-semibold">📋 {cls.permission}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-sm text-slate-400">{t('reports.noAttendanceData') || 'No attendance data'}</div>
                  )}
                </>
              )}
            </div>}

            {/* Quick Action — Staff Attendance (desktop only) */}
            <Link href="/teacher/staff-attendance" className="hidden lg:block">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl p-4 sm:p-5 shadow-lg shadow-emerald-200/50 active:scale-[0.98] transition-transform">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-3xl shrink-0">
                    👔
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-bold text-lg">{t('teacher.staffAttendance')}</h3>
                    <p className="text-white/80 text-sm mt-0.5">{t('teacher.staffAttendanceDesc')}</p>
                  </div>
                  <div className="text-white/60 text-2xl shrink-0">→</div>
                </div>
              </div>
            </Link>

            {/* My Timetable Schedule */}
            {teacherId && (
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">📅 My Teaching Schedule</h3>
                <TimetableGrid userId={teacherId} role="teacher" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="stat-card">
                <p className="stat-label">{t('teacher.myClasses')}</p>
                <p className="stat-value">{classes.length}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">{t('teacher.today')}</p>
                <p className="stat-value text-base sm:text-lg">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
              </div>
            </div>

            {/* My Classes */}
            <div>
              <h2 className="text-lg font-semibold text-slate-700 mb-3 sm:mb-4">{t('teacher.myClasses')}</h2>
              {classes.length === 0 ? (
                <div className="card p-8 sm:p-12">
                  <div className="empty-state">
                    <p className="text-5xl mb-3">📚</p>
                    <p className="font-semibold text-slate-600">{t('teacher.noClasses')}</p>
                    <p className="text-sm text-slate-400 mt-1">{t('teacher.noClassesHint')}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {classes.map(cls => (
                    <div key={cls.id} className="card-hover p-4 sm:p-5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white text-lg shadow-sm mb-3">
                        📖
                      </div>
                      <h3 className="font-semibold text-slate-800 text-base sm:text-lg">{cls.name}</h3>
                      <p className="text-sm text-slate-500 mt-0.5">{cls.subject}</p>
                      {cls.schedule && (
                        <p className="text-xs text-slate-400 mt-2">🕐 {formatSchedule(cls.schedule)}</p>
                      )}
                      <div className="mt-4 pt-3 border-t border-slate-100">
                        <Link href={`/teacher/attendance?classId=${cls.id}`}>
                          <button className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-3 sm:py-2.5 px-4 rounded-xl shadow-md shadow-emerald-200 active:scale-[0.98] transition-all text-sm">
                            📷 {t('teacher.takeAttendance')}
                          </button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}