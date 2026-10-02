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

interface Fee { id: string; amount: number; feeType: string; dueDate: string | null; paidAt: string | null; status: string; description: string | null }
interface Child { id: string; user: { name: string } }

const STATUS_COLOR: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  OVERDUE: 'bg-red-100 text-red-700',
  WAIVED: 'bg-slate-100 text-slate-500',
}

export default function ParentFeesPage() {
  const [childId, setChildId] = useState<string>('')

  const { data: children = [] as Child[] } = useQuery<Child[]>({
    queryKey: ['parent-children'],
    queryFn: async () => { const r = await apiFetch('/api/parent/children'); if (!r.ok) throw new Error(); return r.json() },
  })

  if (!childId && children.length) setChildId(children[0].id)

  const { data: fees = [] as Fee[], isLoading, isError, refetch } = useQuery<Fee[]>({
    queryKey: ['parent-fees', childId],
    queryFn: async () => { const r = await apiFetch(`/api/parent/children/${childId}/fees`); if (!r.ok) throw new Error(); return r.json() },
    enabled: !!childId,
  })

  const totalDue = fees.filter(f => f.status === 'PENDING' || f.status === 'OVERDUE').reduce((s, f) => s + f.amount, 0)

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
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mb-4">💰 Fees & Payments</h1>

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

          {totalDue > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between">
              <div>
                <p className="font-semibold text-amber-800">Outstanding Balance</p>
                <p className="text-2xl font-bold text-amber-700">{totalDue.toLocaleString()} THB</p>
              </div>
              <button className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700">
                Pay Now (Coming Soon)
              </button>
            </div>
          )}

          {!childId ? (
            <p className="text-slate-400 text-center py-12">Select a child to view fees</p>
          ) : isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bg-white h-16 rounded-xl animate-pulse" />)}</div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-red-600 text-sm mb-1">Failed to load fees</p>
              <button onClick={() => refetch()} className="text-xs text-red-500 underline">Retry</button>
            </div>
          ) : fees.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-slate-400">No fee records found</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              {fees.map(fee => (
                <div key={fee.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{fee.feeType}</p>
                    {fee.description && <p className="text-xs text-slate-400">{fee.description}</p>}
                    {fee.dueDate && <p className="text-xs text-slate-400">Due: {new Date(fee.dueDate).toLocaleDateString()}</p>}
                    {fee.paidAt && <p className="text-xs text-emerald-500">Paid: {new Date(fee.paidAt).toLocaleDateString()}</p>}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="font-bold text-slate-800">{fee.amount.toLocaleString()} ฿</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLOR[fee.status] ?? 'bg-slate-100 text-slate-500'}`}>{fee.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
