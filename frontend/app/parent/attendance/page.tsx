"use client"

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { apiFetch } from '../../../lib/api'

const parentNav = [
  { label: 'Dashboard', href: '/parent', icon: 'dashboard' },
  { label: 'Attendance', href: '/parent/attendance', icon: 'calendar' },
  { label: 'Grades', href: '/parent/grades', icon: 'chart' },
  { label: 'Messages', href: '/parent/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'Fees', href: '/parent/fees', icon: 'money' },
  { label: 'Bus Tracker', href: '/parent/bus', icon: 'globe' },
]

interface AttendanceRecord { id: string; date: string; status: string; class: { name: string } }
interface Child { id: string; user: { name: string } }

const STATUS = { PRESENT: { label: 'Present', color: 'bg-emerald-500' }, LATE: { label: 'Late', color: 'bg-amber-400' }, ABSENT: { label: 'Absent', color: 'bg-red-500' }, DAY_OFF: { label: 'Day Off', color: 'bg-slate-400' } }

export default function ParentAttendancePage() {
  const [childId, setChildId] = useState<string>('')

  const { data: children = [] as Child[] } = useQuery<Child[]>({
    queryKey: ['parent-children'],
    queryFn: async () => { const r = await apiFetch('/api/parent/children'); if (!r.ok) throw new Error(); return r.json() },
  })

  if (!childId && children.length) setChildId(children[0].id)

  const { data: attendance = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['parent-attendance', childId],
    queryFn: async () => { const r = await apiFetch(`/api/parent/children/${childId}/attendance`); if (!r.ok) throw new Error(); return r.json() as Promise<AttendanceRecord[]> },
    enabled: !!childId,
  })

  const present = attendance.filter(a => a.status === 'PRESENT').length
  const late = attendance.filter(a => a.status === 'LATE').length
  const absent = attendance.filter(a => a.status === 'ABSENT').length

  return (
    <AuthGuard requiredRole="PARENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Parent" subtitle="Portal" navItems={parentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />
        <aside className="hidden lg:block w-44 bg-white border-r border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-600 mb-2">Select Child</p>
          {children.map(c => (
            <button key={c.id} onClick={() => setChildId(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${childId === c.id ? 'bg-emerald-100 text-emerald-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
              {c.user.name}
            </button>
          ))}
        </aside>

        <main className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mb-4">📅 Attendance History</h1>

          {/* Mobile child chips */}
          {children.length > 1 && (
            <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
              {children.map(c => (
                <button key={c.id} onClick={() => setChildId(c.id)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-all ${childId === c.id ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}>
                  {c.user.name}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{present}</p>
              <p className="text-sm text-emerald-600">Present</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{late}</p>
              <p className="text-sm text-amber-600">Late</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-700">{absent}</p>
              <p className="text-sm text-red-600">Absent</p>
            </div>
          </div>

          {!childId ? (
            <p className="text-slate-400 text-center py-12">Select a child to view attendance</p>
          ) : isLoading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="bg-white h-12 rounded-xl animate-pulse" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-red-600 text-sm mb-1">Failed to load attendance</p>
              <button onClick={() => refetch()} className="text-xs text-red-500 underline">Retry</button>
            </div>
          ) : attendance.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-slate-400">No attendance records found</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              {attendance.map(record => {
                const meta = STATUS[record.status as keyof typeof STATUS] ?? { label: record.status, color: 'bg-slate-300' }
                return (
                  <div key={record.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${meta.color}`} />
                      <div>
                        <p className="text-sm font-medium text-slate-700">{new Date(record.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                        <p className="text-xs text-slate-400">{record.class?.name}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${meta.color} text-white`}>{meta.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
