'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

interface ScheduleEntry {
  day: number
  period: number
  subject: { name: string; short: string; color: string | null }
  teacher?: { firstName: string; lastName: string; short: string; color: string | null }
  class?: { name: string; short: string; color: string | null }
  classroom: { name: string; short: string } | null
}

interface ScheduleData {
  timetable: {
    name: string; academicYear: string; status: string
    periodsPerDay: number; numberOfDays: number
    periodTimes: string | null
  }
  entries: ScheduleEntry[]
}

interface TimetableGridProps {
  /** The user ID to fetch schedule for */
  userId: string
  /** 'student' shows teacher name in cell; 'teacher' shows class name in cell */
  role: 'student' | 'teacher'
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function TimetableGrid({ userId, role }: TimetableGridProps) {
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [debug, setDebug] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    const endpoint =
      role === 'teacher'
        ? '/api/auth/my-teacher-schedule'
        : role === 'student'
        ? '/api/auth/my-schedule'
        : `/api/auth/child-schedule/${userId}`

    setLoading(true)
    setData(null)
    setDebug(null)
    apiFetch(endpoint)
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (!json || json._debug) {
          setDebug(json?._debug?.reason ?? 'No schedule found')
          setData(null)
        } else {
          setData(json)
        }
      })
      .catch(() => setDebug('Failed to load schedule'))
      .finally(() => setLoading(false))
  }, [userId, role])

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <div className="w-7 h-7 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-4 text-sm text-slate-400">
        📅 {debug ?? 'No schedule found'}
      </div>
    )
  }

  const tt = data.timetable
  const periodTimes: string[] = tt.periodTimes ? (() => { try { return JSON.parse(tt.periodTimes!) } catch { return [] } })() : []
  const dayNums = Array.from({ length: tt.numberOfDays }, (_, i) => i + 1)
  const periods = Array.from({ length: tt.periodsPerDay }, (_, i) => i + 1)
  const entryMap: Record<string, ScheduleEntry> = {}
  data.entries.forEach(e => { entryMap[`${e.day}_${e.period}`] = e })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">{tt.name} · {tt.academicYear}</p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          tt.status === 'PUBLISHED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {tt.status === 'PUBLISHED' ? 'Published' : 'Draft'}
        </span>
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs border-collapse min-w-[320px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 font-medium w-10 text-center">#</th>
              {dayNums.map(d => (
                <th key={d} className="px-2 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 font-semibold text-center min-w-[68px]">
                  {ALL_DAYS[d - 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => (
              <tr key={p}>
                <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-400 font-medium bg-slate-50">
                  <div className="font-semibold">{p}</div>
                  {periodTimes[p - 1] && (
                    <div className="text-[9px] text-slate-300 leading-tight">{periodTimes[p - 1]}</div>
                  )}
                </td>
                {dayNums.map(d => {
                  const entry = entryMap[`${d}_${p}`]
                  if (!entry) return <td key={d} className="px-1 py-1 border border-slate-100 bg-white" />
                  const bg = entry.subject.color ? `${entry.subject.color}22` : '#f1f5f9'
                  const fg = entry.subject.color || '#475569'
                  const secondLine =
                    role === 'teacher'
                      ? (entry.class?.short ?? entry.class?.name ?? '')
                      : entry.teacher
                      ? [entry.teacher.firstName, entry.teacher.lastName].filter(Boolean).join(' ')
                      : ''
                  return (
                    <td key={d} className="px-1 py-1 border border-slate-100 align-top" style={{ backgroundColor: bg }}>
                      <div className="font-semibold truncate" style={{ color: fg }}>{entry.subject.short}</div>
                      {secondLine && <div className="text-slate-500 truncate">{secondLine}</div>}
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
}

/** Variant that fetches a specific child's schedule (for parent portal) */
export function ChildTimetableGrid({ childUserId }: { childUserId: string }) {
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [debug, setDebug] = useState<string | null>(null)

  useEffect(() => {
    if (!childUserId) return
    setLoading(true)
    setData(null)
    setDebug(null)
    apiFetch(`/api/auth/child-schedule/${childUserId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (!json || json._debug) {
          setDebug(json?._debug?.reason ?? 'No schedule found')
          setData(null)
        } else {
          setData(json)
        }
      })
      .catch(() => setDebug('Failed to load schedule'))
      .finally(() => setLoading(false))
  }, [childUserId])

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <div className="w-7 h-7 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-4 text-sm text-slate-400">
        📅 {debug ?? 'No schedule found'}
      </div>
    )
  }

  const tt = data.timetable
  const periodTimes: string[] = tt.periodTimes ? (() => { try { return JSON.parse(tt.periodTimes!) } catch { return [] } })() : []
  const dayNums = Array.from({ length: tt.numberOfDays }, (_, i) => i + 1)
  const periods = Array.from({ length: tt.periodsPerDay }, (_, i) => i + 1)
  const entryMap: Record<string, ScheduleEntry> = {}
  data.entries.forEach(e => { entryMap[`${e.day}_${e.period}`] = e })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">{tt.name} · {tt.academicYear}</p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          tt.status === 'PUBLISHED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {tt.status === 'PUBLISHED' ? 'Published' : 'Draft'}
        </span>
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs border-collapse min-w-[320px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 font-medium w-10 text-center">#</th>
              {dayNums.map(d => (
                <th key={d} className="px-2 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 font-semibold text-center min-w-[68px]">
                  {ALL_DAYS[d - 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => (
              <tr key={p}>
                <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-400 font-medium bg-slate-50">
                  <div className="font-semibold">{p}</div>
                  {periodTimes[p - 1] && (
                    <div className="text-[9px] text-slate-300 leading-tight">{periodTimes[p - 1]}</div>
                  )}
                </td>
                {dayNums.map(d => {
                  const entry = entryMap[`${d}_${p}`]
                  if (!entry) return <td key={d} className="px-1 py-1 border border-slate-100 bg-white" />
                  const bg = entry.subject.color ? `${entry.subject.color}22` : '#f1f5f9'
                  const fg = entry.subject.color || '#475569'
                  const teacherName = entry.teacher
                    ? [entry.teacher.firstName, entry.teacher.lastName].filter(Boolean).join(' ')
                    : ''
                  return (
                    <td key={d} className="px-1 py-1 border border-slate-100 align-top" style={{ backgroundColor: bg }}>
                      <div className="font-semibold truncate" style={{ color: fg }}>{entry.subject.short}</div>
                      {teacherName && <div className="text-slate-500 truncate">{teacherName}</div>}
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
}
