'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Sidebar from '../../../components/Sidebar'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { frontendDistribution } from '../../../lib/navigation-registry'
import CorePluginSearch from '../../../components/CorePluginSearch'

interface StudentProfile {
  id: string
  studentNumber: string | null
  sex: string | null
  photo: string | null
  dateOfBirth: string | null
  address: string | null
  class: { id: string; name: string } | null
}

interface SearchResult {
  id: string
  email: string
  name: string
  phone: string | null
  photo: string | null
  role: string
  createdAt: string
  department: { id: string; name: string } | null
  studentProfile: StudentProfile | null
}

interface AttendanceRecord {
  date: string
  session: number
  status: string
  checkInTime: string | null
  permissionType: string | null
}

interface FeePayment {
  id: string
  amount: number
  note: string | null
  createdAt: string
}

interface FeeRecord {
  id: string
  totalAmount: number
  paidAmount: number
  dueDate: string
  term: string | null
  notes: string | null
  createdAt: string
  payments: FeePayment[]
}

interface ScoreEntryData {
  score: number | null
  subject: { name: string; maxScore: number; color: string }
  examTab: { id: string; label: string; type: string; order: number; scoreSheet: { id: string; name: string } }
}

interface ScheduleEntry {
  day: number
  period: number
  subject: { name: string; short: string; color: string | null }
  teacher: { firstName: string; lastName: string; short: string; color: string | null }
  classroom: { name: string; short: string } | null
}

interface ScheduleData {
  id: string
  name: string
  short: string
  timetable: {
    id: string; name: string; academicYear: string; status: string
    periodsPerDay: number; numberOfDays: number
    periodTimes: string | null; weekend: string[]
  }
  entries: ScheduleEntry[]
}

interface ScheduleDebug {
  studentClass: string | null
  reason: string
  allClasses?: { className: string; timetableName: string; status: string }[]
}

interface FullProfile {
  id: string
  email: string
  name: string
  phone: string | null
  photo: string | null
  role: string
  createdAt: string
  department: { id: string; name: string; nameKh: string | null } | null
  staffAttendances: AttendanceRecord[]
  scoreEntries: ScoreEntryData[]
  rankingMap: Record<string, { rank: number; total: number }>
  studentProfile: {
    id: string
    studentNumber: string | null
    sex: string | null
    photo: string | null
    dateOfBirth: string | null
    address: string | null
    class: { id: string; name: string } | null
    feeRecords: FeeRecord[]
    attendances: AttendanceRecord[]
  } | null
}

const roleBadge: Record<string, string> = {
  ADMIN: 'badge-blue',
  TEACHER: 'badge-green',
  STUDENT: 'badge-yellow',
  PARENT: 'badge-gray',
}


const statusColors: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700',
  LATE: 'bg-amber-100 text-amber-700',
  ABSENT: 'bg-red-100 text-red-700',
  PERMISSION: 'bg-blue-100 text-blue-700',
  DAY_OFF: 'bg-slate-100 text-slate-500',
}

const statusKeys: Record<string, string> = {
  PRESENT: 'status.present',
  LATE: 'status.late',
  ABSENT: 'status.absent',
  PERMISSION: 'status.permission',
  DAY_OFF: 'status.dayOff',
}

const roleKeyMap: Record<string, string> = {
  ADMIN: 'role.admin',
  TEACHER: 'role.teacher',
  STUDENT: 'role.student',
  PARENT: 'role.parent',
}

/** Convert Google Drive sharing URLs to direct image URLs */
function normalizePhotoUrl(url: string): string {
  if (!url) return url
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/)
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`
  const m3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/)
  if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`
  return url
}

function LegacySearchPage() {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [fullProfile, setFullProfile] = useState<FullProfile | null>(null)
  const [fullProfileLoading, setFullProfileLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'profile' | 'attendance' | 'fees' | 'scores' | 'schedule'>('profile')
  const [scheduleData, setScheduleData] = useState<ScheduleData | null | undefined>(undefined)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleDebug, setScheduleDebug] = useState<ScheduleDebug | null>(null)

  const doSearch = useCallback(async (q: string, role: string) => {
    setLoading(true)
    setHasSearched(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (role !== 'ALL') params.set('role', role)
      const res = await apiFetch(`/api/auth/users/search?${params}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search on query/filter change
  useEffect(() => {
    const timeout = setTimeout(() => {
      doSearch(query, roleFilter)
    }, 300)
    return () => clearTimeout(timeout)
  }, [query, roleFilter, doSearch])

  const handleSelectUser = async (user: SearchResult) => {
    setSelected(user)
    setFullProfile(null)
    setScheduleData(undefined)
    setScheduleDebug(null)
    setActiveTab('profile')
    // Start full-profile fetch in the background — modal opens immediately
    setFullProfileLoading(true)
    apiFetch(`/api/auth/users/${user.id}/full-profile`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setFullProfile(data) })
      .catch(() => {})
      .finally(() => setFullProfileLoading(false))
  }

  const handleTabChange = async (tab: typeof activeTab) => {
    setActiveTab(tab)
    if (tab === 'schedule' && selected && scheduleData === undefined) {
      setScheduleLoading(true)
      try {
        const res = await apiFetch(`/api/auth/users/${selected.id}/schedule`)
        if (res.ok) {
          const json = await res.json()
          if (json && json._debug) {
            setScheduleDebug(json._debug)
            setScheduleData(null)
          } else {
            setScheduleData(json)
            setScheduleDebug(null)
          }
        } else {
          setScheduleData(null)
        }
      } catch {
        setScheduleData(null)
      } finally {
        setScheduleLoading(false)
      }
    }
  }

  const InfoBox = ({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) => (
    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
      {icon && <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-slate-700 break-all">{value}</p>
      </div>
    </div>
  )

  const infoIcons = {
    email: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
    phone: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    id: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
    sex: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-3.314 0-6 2.686-6 6s2.686 6 6 6 6-2.686 6-6-2.686-6-6-6zm0 0V2m0 0h3m-3 0l4 4" /></svg>,
    cake: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10a1 1 0 011 1v7a1 1 0 01-1 1H7a1 1 0 01-1-1v-7a1 1 0 011-1z" /></svg>,
    class: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s4.332.477 5.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
    address: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    position: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m-4 6h16a1 1 0 011 1v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a1 1 0 011-1z" /></svg>,
    department: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2M19 21H5m0 0H3m8-16h.01M11 8h.01M11 12h.01M11 16h.01M15 8h.01M15 12h.01M15 16h.01M7 8h.01M7 12h.01M7 16h.01" /></svg>,
    joined: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  }

  const roleFilters = ['ALL', 'STUDENT', 'TEACHER', 'ADMIN', 'PARENT'] as const

  // Memoize per-role counts so they don't recompute on every render
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: results.length }
    for (const r of ['STUDENT', 'TEACHER', 'ADMIN', 'PARENT']) {
      counts[r] = results.filter(u => u.role === r).length
    }
    return counts
  }, [results])

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{t('search.title')}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{t('search.subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="page-body space-y-5">
          {/* Search Bar */}
          <div className="card p-1.5 sm:p-2">
            <div className="flex items-center gap-3 px-3">
              <svg className="w-5 h-5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                className="flex-1 py-3 bg-transparent border-0 outline-none focus:ring-0 text-sm text-slate-800 placeholder:text-slate-400"
                autoFocus
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-slate-400 hover:text-slate-600 flex-shrink-0 w-6 h-6 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          </div>

          {/* Role Filter Tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {roleFilters.map(r => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all inline-flex items-center gap-1.5 ${
                  roleFilter === r
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/50'
                }`}
              >
                {r === 'ALL' ? t('common.all') : t(roleKeyMap[r] || '')}
                <span className={`text-[11px] font-semibold rounded-full px-1.5 leading-4 ${roleFilter === r ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
                  {r === 'ALL' ? roleCounts.ALL : (roleCounts[r] ?? 0)}
                </span>
              </button>
            ))}
          </div>

          {/* Results */}
          {loading ? (
            <div className="text-center py-12 text-slate-400">
              <div className="inline-block w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mb-2" />
              <p className="text-sm">{t('search.searching')}</p>
            </div>
          ) : hasSearched && results.length === 0 ? (
            <div className="empty-state">
              <p className="text-lg">{t('search.noResults')}</p>
              <p className="text-sm text-slate-400 mt-1">{t('search.noResultsHint')}</p>
            </div>
          ) : results.length > 0 ? (
            (() => {
              // Detect duplicates: same name + same class within the current result set
              const dupKeys = new Set<string>()
              const seenKeys = new Map<string, number>()
              for (const u of results) {
                const classId = u.studentProfile?.class?.id
                if (!classId) continue
                const key = `${u.name.trim().toLowerCase()}||${classId}`
                seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1)
              }
              for (const [key, count] of seenKeys) {
                if (count >= 2) dupKeys.add(key)
              }
              const isDup = (u: SearchResult) => {
                const classId = u.studentProfile?.class?.id
                if (!classId) return false
                return dupKeys.has(`${u.name.trim().toLowerCase()}||${classId}`)
              }
              const hasDuplicates = dupKeys.size > 0
              return (
            <>
              {/* Duplicate student warning */}
              {hasDuplicates && (
                <div className="mb-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                  <span className="text-base shrink-0">⚠️</span>
                  <div>
                    <strong>Duplicate students detected.</strong> Students highlighted in orange share the same name and class — likely caused by a CSV re-import. The QR scanner may identify the wrong student. Please remove the old duplicate record from Admin → Students.
                  </div>
                </div>
              )}
              {/* Mobile card list */}
              <div className="flex flex-col gap-2 sm:hidden">
                {results.map(user => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className={`w-full text-left rounded-2xl shadow-sm border px-4 py-3 flex items-center gap-3 active:bg-indigo-50 transition-colors ${isDup(user) ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-100'}`}
                  >
                    <div className="relative flex-shrink-0">
                      {user.photo || user.studentProfile?.photo ? (
                        <img
                          src={normalizePhotoUrl(user.photo || user.studentProfile?.photo || '')}
                          alt={user.name}
                          loading="lazy"
                          className="w-12 h-12 rounded-xl object-cover border border-slate-200"
                          onError={e => {
                            e.currentTarget.style.display = 'none';
                            const el = e.currentTarget.nextElementSibling as HTMLElement | null;
                            if (el) el.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div
                        className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-lg font-bold"
                        style={{ display: (user.photo || user.studentProfile?.photo) ? 'none' : 'flex' }}
                      >
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800 text-sm truncate">{user.name}</span>
                        <span className={`${roleBadge[user.role] || 'badge-gray'} text-[10px] flex-shrink-0`}>{t(roleKeyMap[user.role] || '')}</span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">{user.email}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {(user.studentProfile?.class?.name || user.department?.name) && (
                          <span className="text-[11px] text-slate-500">{user.studentProfile?.class?.name || user.department?.name}</span>
                        )}
                        {user.phone && (
                          <a href={`tel:${user.phone}`} onClick={e => e.stopPropagation()} className="text-[11px] text-indigo-500 font-medium inline-flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                            {user.phone}
                          </a>
                        )}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                ))}
                <p className="text-center text-xs text-slate-400 py-1">{t('common.showing')} {results.length} {results.length !== 1 ? t('common.results') : t('common.result')}</p>
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block table-container">
                <table>
                  <thead>
                    <tr>
                      <th>{t('search.user')}</th>
                      <th>{t('common.email')}</th>
                      <th>{t('common.phone')}</th>
                      <th>{t('common.role')}</th>
                      <th>{t('search.classDept')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(user => (
                      <tr key={user.id} className={`cursor-pointer ${isDup(user) ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-indigo-50/50'}`} onClick={() => handleSelectUser(user)}>
                        <td>
                          <div className="flex items-center gap-3">
                            {user.photo || user.studentProfile?.photo ? (
                              <img
                                src={normalizePhotoUrl(user.photo || user.studentProfile?.photo || '')}
                                alt={user.name}
                                loading="lazy"
                                className="w-9 h-9 rounded-full object-cover border-2 border-slate-200"
                                onError={e => {
                                  e.currentTarget.style.display = 'none'
                                  const el = e.currentTarget.nextElementSibling as HTMLElement | null
                                  if (el) el.style.display = 'flex'
                                }}
                              />
                            ) : null}
                            <div
                              className="avatar avatar-sm"
                              style={{ display: (user.photo || user.studentProfile?.photo) ? 'none' : 'flex' }}
                            >
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-slate-800">{user.name}</span>
                                {isDup(user) && <span className="text-[10px] font-semibold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">DUPLICATE</span>}
                              </div>
                              {user.studentProfile?.studentNumber && (
                                <p className="text-xs text-slate-400">#{user.studentProfile.studentNumber}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="text-slate-500 text-sm">{user.email}</td>
                        <td className="text-slate-500 text-sm" onClick={e => e.stopPropagation()}>
                          {user.phone
                            ? <a href={`tel:${user.phone}`} className="text-indigo-600 hover:underline font-medium">{user.phone}</a>
                            : '—'}
                        </td>
                        <td><span className={roleBadge[user.role] || 'badge-gray'}>{t(roleKeyMap[user.role] || '')}</span></td>
                        <td className="text-slate-500 text-sm">{user.studentProfile?.class?.name || user.department?.name || '—'}</td>
                        <td>
                          <button
                            onClick={e => { e.stopPropagation(); handleSelectUser(user) }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                          >
                            {t('common.view')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
                  {t('common.showing')} {results.length} {results.length !== 1 ? t('common.results') : t('common.result')}
                </div>
              </div>
            </>
              )
            })()
          ) : null}
        </div>
      </div>

      {/* Detail Drawer — slides in from the right instead of a centered modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-end"
          onClick={() => { setSelected(null); setFullProfile(null) }}
        >
          <div
            className="bg-white w-full sm:w-[440px] h-full flex flex-col shadow-2xl animate-drawer-in overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-4 pt-5 pb-5 sm:px-5 flex-shrink-0 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-indigo-500 to-violet-600" />
              <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, white 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
              <div className="relative flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  {(selected.photo || selected.studentProfile?.photo) ? (
                    <img
                      src={normalizePhotoUrl(selected.photo || selected.studentProfile?.photo || '')}
                      alt={selected.name}
                      loading="lazy"
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border-2 border-white/70 shadow-lg"
                      onError={e => {
                        e.currentTarget.style.display = 'none'
                        const el = e.currentTarget.nextElementSibling as HTMLElement | null
                        if (el) el.style.display = 'flex'
                      }}
                    />
                  ) : null}
                  <div
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/20 backdrop-blur text-white border-2 border-white/70 shadow-lg flex items-center justify-center text-2xl font-bold flex-shrink-0"
                    style={{ display: (selected.photo || selected.studentProfile?.photo) ? 'none' : 'flex' }}
                  >
                    {selected.name.charAt(0).toUpperCase()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-lg sm:text-xl leading-tight truncate">{selected.name}</h3>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wide bg-white/20 text-white backdrop-blur px-2 py-0.5 rounded-full">{t(roleKeyMap[selected.role] || '')}</span>
                        {selected.studentProfile?.class && <span className="text-xs text-white/85 truncate">📖 {selected.studentProfile.class.name}</span>}
                        {!selected.studentProfile && selected.department && <span className="text-xs text-white/85 truncate">🏢 {selected.department.name}</span>}
                        {selected.studentProfile?.studentNumber && <span className="text-xs text-white/70">#{selected.studentProfile.studentNumber}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {selected.role !== 'STUDENT' && selected.role !== 'PARENT' && (
                        <Link
                          href={`/admin/employees/${selected.id}/cv`}
                          title="Curriculum Vitae"
                          className="p-1.5 rounded-xl hover:bg-white/15 text-white/80 hover:text-white"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </Link>
                      )}
                      <button
                        onClick={() => { setSelected(null); setFullProfile(null) }}
                        className="p-1.5 rounded-xl hover:bg-white/15 text-white/80 hover:text-white"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs + Content */}
            {(() => {
              const isStudent = !!selected.studentProfile
              const tabIcons: Record<string, React.ReactNode> = {
                profile: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
                attendance: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
                schedule: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
                fees: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 10v-2m0-8a9 9 0 110 8" /></svg>,
                scores: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
              }
              const tabs: { id: 'profile' | 'attendance' | 'fees' | 'scores' | 'schedule'; label: string }[] = [
                { id: 'profile', label: 'Profile' },
                { id: 'attendance', label: 'Attendance (30d)' },
                ...(isStudent ? [{ id: 'schedule' as const, label: 'Schedule' }] : []),
                ...(isStudent ? [{ id: 'fees' as const, label: 'Fees' }] : []),
                ...(isStudent ? [{ id: 'scores' as const, label: 'Scores' }] : []),
              ]
              return (
                <>
                  <div className="border-b border-slate-100 px-3 sm:px-4 py-2 flex-shrink-0 bg-slate-50/60">
                    <div className="flex gap-1 overflow-x-auto scrollbar-none">
                      {tabs.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => handleTabChange(tab.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                            activeTab === tab.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                          }`}
                        >
                          {tabIcons[tab.id]}
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0">
                    {fullProfileLoading ? (
                      <div className="text-center py-10">
                        <div className="inline-block w-7 h-7 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                        <p className="text-sm text-slate-400 mt-2">Loading…</p>
                      </div>
                    ) : fullProfile ? (
                      <>
                        {/* ── Profile Tab ── */}
                        {activeTab === 'profile' && (
                          <div className="grid grid-cols-2 gap-3">
                            <InfoBox icon={infoIcons.email} label={t('common.email')} value={fullProfile.email} />
                            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
                              <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5">{infoIcons.phone}</span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">{t('common.phone')}</p>
                                {fullProfile.phone
                                  ? <a href={`tel:${fullProfile.phone}`} className="text-sm font-semibold text-indigo-600 hover:underline">{fullProfile.phone}</a>
                                  : <p className="text-sm font-semibold text-slate-700">—</p>}
                              </div>
                            </div>
                            {fullProfile.studentProfile ? (
                              <>
                                <InfoBox icon={infoIcons.id} label={t('search.studentId')} value={`#${fullProfile.studentProfile.studentNumber || '—'}`} />
                                <InfoBox icon={infoIcons.sex} label={t('common.sex')} value={
                                  fullProfile.studentProfile.sex === 'MALE' ? `♂ ${t('common.male')}` :
                                  fullProfile.studentProfile.sex === 'FEMALE' ? `♀ ${t('common.female')}` : '—'
                                } />
                                <InfoBox icon={infoIcons.cake} label={t('common.dateOfBirth')} value={
                                  fullProfile.studentProfile.dateOfBirth
                                    ? new Date(fullProfile.studentProfile.dateOfBirth).toLocaleDateString()
                                    : '—'
                                } />
                                <InfoBox icon={infoIcons.class} label={t('common.class')} value={fullProfile.studentProfile.class?.name || t('search.unassigned')} />
                                <div className="col-span-2">
                                  <InfoBox icon={infoIcons.address} label={t('common.address')} value={fullProfile.studentProfile.address || '—'} />
                                </div>
                              </>
                            ) : (
                              <>
                                <InfoBox icon={infoIcons.position} label={t('common.position')} value={t(roleKeyMap[fullProfile.role] || '')} />
                                <InfoBox icon={infoIcons.department} label={t('common.department')} value={fullProfile.department?.name || '—'} />
                                <InfoBox icon={infoIcons.joined} label={t('common.joined')} value={new Date(fullProfile.createdAt).toLocaleDateString()} />
                              </>
                            )}
                          </div>
                        )}

                        {/* ── Attendance Tab ── */}
                        {activeTab === 'attendance' && (() => {
                          const records = fullProfile.studentProfile
                            ? fullProfile.studentProfile.attendances
                            : fullProfile.staffAttendances
                          const byDate: Record<string, typeof records> = {}
                          records.forEach(r => {
                            const day = (r.date as string).slice(0, 10)
                            if (!byDate[day]) byDate[day] = []
                            byDate[day].push(r)
                          })
                          const days = Object.keys(byDate).sort().reverse()
                          const counts = {
                            PRESENT: records.filter(r => r.status === 'PRESENT').length,
                            LATE: records.filter(r => r.status === 'LATE').length,
                            ABSENT: records.filter(r => r.status === 'ABSENT').length,
                            PERMISSION: records.filter(r => r.status === 'PERMISSION').length,
                          }
                          return (
                            <div className="space-y-4">
                              <div className="grid grid-cols-4 gap-2">
                                {(Object.entries(counts) as [string, number][]).map(([st, cnt]) => (
                                  <div key={st} className={`rounded-xl p-3 text-center ${statusColors[st] || 'bg-slate-50 text-slate-500'}`}>
                                    <p className="text-xl font-bold">{cnt}</p>
                                    <p className="text-xs font-medium mt-0.5">{t(statusKeys[st] || '') || st}</p>
                                  </div>
                                ))}
                              </div>
                              {days.length === 0 ? (
                                <p className="text-center text-sm text-slate-400 py-4">{t('search.noAttendanceData')}</p>
                              ) : (
                                <div className="space-y-1">
                                  {days.map(day => (
                                    <div key={day} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                                      <span className="text-xs text-slate-500 w-28 flex-shrink-0">
                                        {new Date(day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}
                                      </span>
                                      <div className="flex gap-1 flex-wrap">
                                        {[1, 2, 3, 4].map(s => {
                                          const rec = byDate[day]?.find(r => r.session === s)
                                          return rec ? (
                                            <span key={s} className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusColors[rec.status] || 'bg-slate-100 text-slate-500'}`}>
                                              S{s} {t(statusKeys[rec.status] || '') || rec.status}
                                            </span>
                                          ) : null
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        {/* ── Fees Tab ── */}
                        {activeTab === 'fees' && fullProfile.studentProfile && (() => {
                          const records = fullProfile.studentProfile.feeRecords
                          const totalBilled = records.reduce((s, r) => s + r.totalAmount, 0)
                          const totalPaid = records.reduce((s, r) => s + r.paidAmount, 0)
                          const getFeeStatus = (r: FeeRecord) => {
                            if (r.paidAmount >= r.totalAmount) return 'PAID'
                            if (r.paidAmount > 0) return 'PARTIAL'
                            if (new Date(r.dueDate) < new Date()) return 'OVERDUE'
                            return 'UNPAID'
                          }
                          const feeStatusColor: Record<string, string> = {
                            PAID: 'bg-emerald-100 text-emerald-700',
                            PARTIAL: 'bg-amber-100 text-amber-700',
                            OVERDUE: 'bg-red-100 text-red-700',
                            UNPAID: 'bg-slate-100 text-slate-500',
                          }
                          return (
                            <div className="space-y-4">
                              <div className="grid grid-cols-3 gap-3">
                                <div className="bg-slate-50 rounded-xl p-3 text-center">
                                  <p className="text-xl font-bold text-slate-700">{records.length}</p>
                                  <p className="text-xs text-slate-400">Records</p>
                                </div>
                                <div className="bg-blue-50 rounded-xl p-3 text-center">
                                  <p className="text-xl font-bold text-blue-700">${totalBilled.toFixed(0)}</p>
                                  <p className="text-xs text-blue-400">Billed</p>
                                </div>
                                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                                  <p className="text-xl font-bold text-emerald-700">${totalPaid.toFixed(0)}</p>
                                  <p className="text-xs text-emerald-400">Paid</p>
                                </div>
                              </div>
                              {records.length === 0 ? (
                                <p className="text-center text-sm text-slate-400 py-4">No fee records</p>
                              ) : (
                                <div className="space-y-2">
                                  {records.map(r => {
                                    const st = getFeeStatus(r)
                                    const pct = r.totalAmount > 0 ? Math.min(100, Math.round((r.paidAmount / r.totalAmount) * 100)) : 0
                                    return (
                                      <div key={r.id} className="border border-slate-200 rounded-xl p-3">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                          <div>
                                            <p className="text-sm font-semibold text-slate-700">{r.term || 'General'}</p>
                                            <p className="text-xs text-slate-400">Due: {new Date(r.dueDate).toLocaleDateString()}</p>
                                          </div>
                                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${feeStatusColor[st]}`}>{st}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mb-1.5">
                                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                                          </div>
                                          <span className="text-xs text-slate-500 flex-shrink-0">${r.paidAmount.toFixed(0)} / ${r.totalAmount.toFixed(0)}</span>
                                        </div>
                                        {r.payments.length > 0 && (
                                          <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                                            {r.payments.map(p => (
                                              <div key={p.id} className="flex items-center justify-between text-xs text-slate-500">
                                                <span>{new Date(p.createdAt).toLocaleDateString()}{p.note ? ` — ${p.note}` : ''}</span>
                                                <span className="text-emerald-600 font-medium">+${p.amount.toFixed(0)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        {/* ── Scores Tab ── */}
                        {activeTab === 'scores' && fullProfile.studentProfile && (() => {
                          const entries = fullProfile.scoreEntries
                          if (entries.length === 0) {
                            return <p className="text-center text-sm text-slate-400 py-4">No score data</p>
                          }
                          type SheetMap = Record<string, { sheetName: string; tabs: Record<string, { tabLabel: string; tabId: string; order: number; entries: ScoreEntryData[] }> }>
                          const bySheet: SheetMap = {}
                          entries.forEach(e => {
                            const sid = e.examTab.scoreSheet.id
                            if (!bySheet[sid]) bySheet[sid] = { sheetName: e.examTab.scoreSheet.name, tabs: {} }
                            const tid = e.examTab.id
                            if (!bySheet[sid].tabs[tid]) bySheet[sid].tabs[tid] = { tabLabel: e.examTab.label, tabId: tid, order: e.examTab.order, entries: [] }
                            bySheet[sid].tabs[tid].entries.push(e)
                          })
                          return (
                            <div className="space-y-5">
                              {Object.values(bySheet).map(sheet => (
                                <div key={sheet.sheetName}>
                                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{sheet.sheetName}</p>
                                  <div className="space-y-3">
                                    {Object.values(sheet.tabs).sort((a, b) => a.order - b.order).map(tab => {
                                      const ranking = fullProfile.rankingMap[tab.tabId]
                                      const totalScore = tab.entries.reduce((s, e) => s + (e.score ?? 0), 0)
                                      const maxTotal = tab.entries.reduce((s, e) => s + e.subject.maxScore, 0)
                                      return (
                                        <div key={tab.tabId} className="border border-slate-200 rounded-xl p-3">
                                          <div className="flex items-center justify-between mb-3">
                                            <p className="text-sm font-semibold text-slate-700">{tab.tabLabel}</p>
                                            <div className="flex items-center gap-2">
                                              {ranking && ranking.rank > 0 && (
                                                <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                                                  🏆 #{ranking.rank}/{ranking.total}
                                                </span>
                                              )}
                                              <span className="text-sm font-bold text-slate-700">{totalScore.toFixed(1)}/{maxTotal}</span>
                                            </div>
                                          </div>
                                          <div className="space-y-1.5">
                                            {tab.entries.map((e, i) => {
                                              const pct = e.subject.maxScore > 0 ? Math.min(100, (e.score ?? 0) / e.subject.maxScore * 100) : 0
                                              return (
                                                <div key={i} className="flex items-center gap-2">
                                                  <span className="text-xs text-slate-600 w-28 truncate flex-shrink-0">{e.subject.name}</span>
                                                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: e.subject.color || '#6366f1' }} />
                                                  </div>
                                                  <span className="text-xs text-slate-700 font-medium w-14 text-right flex-shrink-0">
                                                    {e.score !== null ? e.score : '—'}/{e.subject.maxScore}
                                                  </span>
                                                </div>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        })()}
                        {/* ── Schedule Tab ── */}
                        {activeTab === 'schedule' && fullProfile.studentProfile && (() => {
                          if (scheduleLoading || scheduleData === undefined) return (
                            <div className="text-center py-10">
                              <div className="inline-block w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                              <p className="text-sm text-slate-400 mt-2">Loading schedule…</p>
                            </div>
                          )
                          if (!scheduleData) return (
                            <div className="space-y-3">
                              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                <p className="text-sm font-semibold text-amber-800 mb-1">No timetable schedule found</p>
                                {scheduleDebug?.studentClass ? (
                                  <p className="text-xs text-amber-700">Student class: <strong>{scheduleDebug.studentClass}</strong></p>
                                ) : (
                                  <p className="text-xs text-amber-700">Student has no class assigned.</p>
                                )}
                                <p className="text-xs text-amber-600 mt-1">{scheduleDebug?.reason}</p>
                              </div>
                              {scheduleDebug?.allClasses && scheduleDebug.allClasses.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Available timetable classes</p>
                                  <div className="space-y-1 max-h-48 overflow-y-auto">
                                    {scheduleDebug.allClasses.map((c, i) => (
                                      <div key={i} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-xs">
                                        <span className="font-medium text-slate-700">{c.className}</span>
                                        <div className="flex items-center gap-2 text-slate-400">
                                          <span>{c.timetableName}</span>
                                          <span className={`px-1.5 py-0.5 rounded font-semibold ${
                                            c.status === 'PUBLISHED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                                          }`}>{c.status}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <p className="text-[11px] text-slate-400 mt-2">
                                    To fix: rename the timetable class to match <strong>{scheduleDebug.studentClass}</strong>, or publish the timetable.
                                  </p>
                                </div>
                              )}
                            </div>
                          )
                          const tt = scheduleData.timetable
                          const periodTimes: string[] = tt.periodTimes ? JSON.parse(tt.periodTimes) : []
                          const allDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                          const dayNums = Array.from({ length: tt.numberOfDays }, (_, i) => i + 1)
                          const periods = Array.from({ length: tt.periodsPerDay }, (_, i) => i + 1)
                          const entryMap: Record<string, ScheduleEntry> = {}
                          scheduleData.entries.forEach(e => { entryMap[`${e.day}_${e.period}`] = e })
                          return (
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-xs text-slate-500">{tt.name} · {tt.academicYear}</p>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  scheduleData.timetable.status === 'PUBLISHED'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-amber-100 text-amber-700'
                                }`}>{scheduleData.timetable.status === 'PUBLISHED' ? 'Published' : 'Draft'}</span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr>
                                      <th className="px-2 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 font-medium w-10 text-center">#</th>
                                      {dayNums.map(d => (
                                        <th key={d} className="px-2 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 font-semibold text-center">{allDays[d - 1]}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {periods.map(p => (
                                      <tr key={p}>
                                        <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-400 font-medium bg-slate-50">
                                          <div>{p}</div>
                                          {periodTimes[p - 1] && <div className="text-[9px] text-slate-300">{periodTimes[p - 1]}</div>}
                                        </td>
                                        {dayNums.map(d => {
                                          const entry = entryMap[`${d}_${p}`]
                                          if (!entry) return (
                                            <td key={d} className="px-1 py-1 border border-slate-100 bg-white" />
                                          )
                                          const bg = entry.subject.color ? `${entry.subject.color}22` : '#f1f5f9'
                                          const fg = entry.subject.color || '#475569'
                                          return (
                                            <td key={d} className="px-1 py-1 border border-slate-100" style={{ backgroundColor: bg }}>
                                              <div className="font-semibold truncate" style={{ color: fg }}>{entry.subject.short}</div>
                                              <div className="text-slate-500 truncate">{[entry.teacher.firstName, entry.teacher.lastName].filter(Boolean).join(' ')}</div>
                                              {entry.classroom && <div className="text-slate-400 truncate">{entry.classroom.short}</div>}
                                            </td>
                                          )
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )
                        })()}
                      </>
                    ) : (
                      <p className="text-center text-sm text-slate-400 py-6">Could not load profile data.</p>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return frontendDistribution() === 'core' ? <CorePluginSearch /> : <LegacySearchPage />
}
