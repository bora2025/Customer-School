"use client"

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import AuthGuard from '../../components/AuthGuard'
import Sidebar from '../../components/Sidebar'
import AnnouncementFeed from '../../components/AnnouncementFeed'
import { ChildTimetableGrid } from '../../components/TimetableGrid'
import { apiFetch, getCurrentUser } from '../../lib/api'

interface Child {
  id: string
  userId: string
  user: { id: string; name: string; photo: string | null }
  class: { name: string; subject: string } | null
}

const parentNav = [
  { label: 'Dashboard', href: '/parent', icon: 'dashboard' },
  { label: 'Attendance', href: '/parent/attendance', icon: 'calendar' },
  { label: 'Grades', href: '/parent/grades', icon: 'chart' },
  { label: 'Messages', href: '/parent/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'Fees', href: '/parent/fees', icon: 'money' },
  { label: 'Bus Tracker', href: '/parent/bus', icon: 'globe' },
]

export default function ParentDashboard() {
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [parentName, setParentName] = useState<string>('')

  useEffect(() => {
    getCurrentUser().then(u => { if (u) setParentName(u.name || '') })
  }, [])

  const { data: children = [] as Child[], isLoading, isError, refetch } = useQuery<Child[]>({
    queryKey: ['parent-children'],
    queryFn: async () => { const r = await apiFetch('/api/parent/children'); if (!r.ok) throw new Error(); return r.json() },
  })

  useEffect(() => {
    if (!selectedChildId && children.length > 0) setSelectedChildId(children[0].id)
  }, [children, selectedChildId])

  const selectedChild = children.find(c => c.id === selectedChildId) ?? null

  return (
    <AuthGuard allowedRoles={['PARENT', 'ADMIN']}>
      <div className="page-shell">
        <Sidebar title="Parent" subtitle="Portal" navItems={parentNav} accentColor="emerald" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />

          <div className="page-header">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
              👋 Hello{parentName ? `, ${parentName}` : ''}
            </h1>
            <p className="text-sm text-slate-500 mt-1">Stay connected with your child&apos;s school journey.</p>
          </div>

          <div className="page-body space-y-4 sm:space-y-6">
            {/* Quick Actions */}
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {[
                { href: '/parent/attendance', icon: '📅', label: 'Attendance', bg: 'from-emerald-500 to-teal-500' },
                { href: '/parent/grades', icon: '📊', label: 'Grades', bg: 'from-violet-500 to-purple-500' },
                { href: '/parent/messages', icon: '💬', label: 'Messages', bg: 'from-sky-500 to-blue-500' },
                { href: '/parent/fees', icon: '💰', label: 'Fees', bg: 'from-amber-500 to-orange-500' },
              ].map(a => (
                <Link key={a.href} href={a.href} className="group">
                  <div className={`rounded-2xl bg-gradient-to-br ${a.bg} p-3 sm:p-4 text-white shadow-sm active:scale-[0.97] transition-transform h-full flex flex-col items-center justify-center gap-1`}>
                    <span className="text-2xl sm:text-3xl" aria-hidden>{a.icon}</span>
                    <span className="text-[10px] sm:text-xs font-semibold text-center leading-tight">{a.label}</span>
                  </div>
                </Link>
              ))}
            </div>

            {/* My Children */}
            <section className="card p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">My Children</h2>
              {isLoading ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {[1, 2].map(i => <div key={i} className="w-28 h-28 bg-slate-100 rounded-2xl animate-pulse flex-shrink-0" />)}
                </div>
              ) : isError ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-red-600 text-sm mb-1">Failed to load children</p>
                  <button onClick={() => refetch()} className="text-xs text-red-500 underline">Retry</button>
                </div>
              ) : children.length === 0 ? (
                <div className="empty-state py-6">
                  <p className="text-3xl mb-2">👨‍👩‍👧</p>
                  <p className="text-sm text-slate-500">No students linked to your account.</p>
                  <p className="text-xs text-slate-400 mt-1">Contact your school administrator.</p>
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                  {children.map(child => {
                    const active = selectedChildId === child.id
                    return (
                      <button key={child.id} onClick={() => setSelectedChildId(child.id)}
                        className={`flex-shrink-0 flex flex-col items-center p-3 rounded-2xl border-2 transition-all min-w-[96px] ${active ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <div className="w-14 h-14 rounded-xl overflow-hidden bg-gradient-to-br from-emerald-400 to-teal-400 text-white flex items-center justify-center mb-2 shadow-sm">
                          {child.user.photo
                            ? <img src={child.user.photo} alt={child.user.name} className="w-full h-full object-cover" />
                            : <span className="text-lg font-bold">{(child.user.name || '?').charAt(0).toUpperCase()}</span>}
                        </div>
                        <p className="text-xs font-semibold text-slate-700 text-center max-w-[80px] truncate">{child.user.name}</p>
                        <p className="text-[10px] text-slate-400 text-center truncate max-w-[80px]">{child.class?.name ?? '—'}</p>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            {/* Announcements */}
            <section className="card p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">📣 Announcements</h2>
              <AnnouncementFeed accent="emerald" limit={5} />
            </section>

            {/* Selected child shortcuts */}
            {selectedChild && (
              <section className="card p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                    More — {selectedChild.user.name}
                  </h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Attendance', href: '/parent/attendance', icon: '📅', tint: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                    { label: 'Grades', href: '/parent/grades', icon: '📊', tint: 'bg-violet-50 border-violet-200 text-violet-700' },
                    { label: 'Messages', href: '/parent/messages', icon: '💬', tint: 'bg-sky-50 border-sky-200 text-sky-700' },
                    { label: 'Fees', href: '/parent/fees', icon: '💰', tint: 'bg-amber-50 border-amber-200 text-amber-700' },
                    { label: 'Bus Tracker', href: '/parent/bus', icon: '🚌', tint: 'bg-rose-50 border-rose-200 text-rose-700' },
                  ].map(item => (
                    <Link key={item.href} href={item.href}
                      className={`flex flex-col items-center justify-center p-4 rounded-xl border ${item.tint} font-medium text-sm hover:opacity-90 active:scale-[0.98] transition-all`}>
                      <span className="text-2xl mb-1" aria-hidden>{item.icon}</span>
                      {item.label}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Child schedule */}
            {selectedChild && (
              <section className="card p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  📅 {selectedChild.user.name}&apos;s Schedule
                </h2>
                <ChildTimetableGrid childUserId={selectedChild.user.id} />
              </section>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
