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

interface Grade { id: string; marks: number; feedback: string | null; gradedAt: string; assignment: { title: string; totalMarks: number; class: { name: string; subject: string } } }
interface Child { id: string; user: { name: string } }

export default function ParentGradesPage() {
  const [childId, setChildId] = useState<string>('')

  const { data: children = [] as Child[] } = useQuery<Child[]>({
    queryKey: ['parent-children'],
    queryFn: async () => { const r = await apiFetch('/api/parent/children'); if (!r.ok) throw new Error(); return r.json() },
  })

  if (!childId && children.length) setChildId(children[0].id)

  const { data: grades = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['parent-grades', childId],
    queryFn: async () => { const r = await apiFetch(`/api/parent/children/${childId}/grades`); if (!r.ok) throw new Error(); return r.json() as Promise<Grade[]> },
    enabled: !!childId,
  })

  const avg = grades.length
    ? Math.round(grades.reduce((s, g) => s + (g.marks / g.assignment.totalMarks) * 100, 0) / grades.length)
    : null

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
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mb-4">📊 Grades & Progress</h1>

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

          {avg !== null && (
            <div className="bg-white rounded-xl shadow-sm p-4 mb-6 flex items-center gap-4 border border-slate-100">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white ${avg >= 70 ? 'bg-emerald-500' : avg >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}>
                {avg}%
              </div>
              <div>
                <p className="font-semibold text-slate-800">Overall Average</p>
                <p className="text-sm text-slate-500">{grades.length} graded assignment(s)</p>
              </div>
            </div>
          )}

          {!childId ? (
            <p className="text-slate-400 text-center py-12">Select a child to view grades</p>
          ) : isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white h-16 rounded-xl animate-pulse" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-red-600 text-sm mb-1">Failed to load grades</p>
              <button onClick={() => refetch()} className="text-xs text-red-500 underline">Retry</button>
            </div>
          ) : grades.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-slate-400">No grades recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {grades.map(g => {
                const pct = Math.round((g.marks / g.assignment.totalMarks) * 100)
                return (
                  <div key={g.id} className="bg-white rounded-xl shadow-sm p-4 border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-slate-800">{g.assignment.title}</p>
                        <p className="text-xs text-slate-400">{g.assignment.class.name} · {g.assignment.class.subject}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg text-slate-800">{g.marks}<span className="text-sm text-slate-400">/{g.assignment.totalMarks}</span></p>
                        <span className={`text-xs font-semibold ${pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    {g.feedback && <p className="text-xs text-slate-500 mt-2 italic">"{g.feedback}"</p>}
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
