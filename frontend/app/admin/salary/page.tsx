"use client"

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────
interface SalaryRecord {
  id: string
  userId: string
  month: number
  year: number
  baseSalary: number
  allowances: number
  deductions: number
  netSalary: number
  isPaid: boolean
  paidAt: string | null
  notes: string | null
  user: { id: string; name: string; role: string; photo: string | null }
}

interface Staff { id: string; name: string; role: string }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const now = new Date()

// ─── API helpers ─────────────────────────────────────────────────────────────
const fetchSalaries = async (year: number, month: number) => {
  const res = await apiFetch(`/api/salary?year=${year}&month=${month}`)
  if (!res.ok) throw new Error('Failed to load salaries')
  return res.json() as Promise<SalaryRecord[]>
}
const fetchSummary = async (year: number, month: number) => {
  const res = await apiFetch(`/api/salary/summary?year=${year}&month=${month}`)
  if (!res.ok) throw new Error('Failed to load summary')
  return res.json() as Promise<{ total: number; totalNet: number; paid: number; unpaid: number }>
}
const fetchStaff = async () => {
  const res = await apiFetch('/api/salary/staff')
  if (!res.ok) throw new Error('Failed to load staff')
  return res.json() as Promise<Staff[]>
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SumCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`rounded-xl p-4 ${color} shadow-sm`}>
      <p className="text-xs font-medium text-white/80 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

function StatusBadge({ isPaid }: { isPaid: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {isPaid ? 'Paid' : 'Unpaid'}
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SalaryPage() {
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: salaries = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['salaries', year, month],
    queryFn: () => fetchSalaries(year, month),
  })
  const { data: summary } = useQuery({
    queryKey: ['salary-summary', year, month],
    queryFn: () => fetchSummary(year, month),
  })
  const { data: staff = [] } = useQuery({ queryKey: ['salary-staff'], queryFn: fetchStaff })

  const paidMutation = useMutation({
    mutationFn: ({ id, isPaid }: { id: string; isPaid: boolean }) =>
      apiFetch(`/api/salary/${id}/paid`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPaid }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salaries'] }); qc.invalidateQueries({ queryKey: ['salary-summary'] }) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/salary/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salaries'] }); qc.invalidateQueries({ queryKey: ['salary-summary'] }) },
  })

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
          <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Salary Management</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm bg-white">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={e => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm bg-white">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button onClick={() => { setEditId(null); setShowForm(true) }}
                className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                + Add Salary
              </button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {summary ? (
              <>
                <SumCard label="Total Records" value={summary.total} color="bg-slate-700" />
                <SumCard label="Total Net" value={`$${summary.totalNet.toLocaleString()}`} color="bg-sky-600" />
                <SumCard label="Paid" value={summary.paid} color="bg-emerald-600" />
                <SumCard label="Unpaid" value={summary.unpaid} color="bg-amber-500" />
              </>
            ) : (
              [1,2,3,4].map(i => <div key={i} className="rounded-xl bg-slate-200 animate-pulse h-20" />)
            )}
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="bg-white rounded-xl h-14 animate-pulse" />)}
            </div>
          ) : isError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-600 font-medium mb-2">Failed to load salary data</p>
              <button onClick={() => refetch()} className="text-sm text-red-500 underline">Retry</button>
            </div>
          ) : salaries.length === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center shadow-sm">
              <p className="text-slate-400 text-lg">No salaries for {MONTHS[month - 1]} {year}</p>
              <button onClick={() => { setEditId(null); setShowForm(true) }}
                className="mt-4 text-sky-600 text-sm underline">Create first salary record</button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-3">Staff</th>
                    <th className="text-left px-4 py-3">Role</th>
                    <th className="text-right px-4 py-3">Base</th>
                    <th className="text-right px-4 py-3">Allowances</th>
                    <th className="text-right px-4 py-3">Deductions</th>
                    <th className="text-right px-4 py-3 font-bold">Net</th>
                    <th className="text-center px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salaries.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{s.user.name}</td>
                      <td className="px-4 py-3 text-slate-500">{s.user.role}</td>
                      <td className="px-4 py-3 text-right">${s.baseSalary.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">+${s.allowances.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-red-500">-${s.deductions.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">${s.netSalary.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => paidMutation.mutate({ id: s.id, isPaid: !s.isPaid })}
                          disabled={paidMutation.isPending}
                          className="cursor-pointer">
                          <StatusBadge isPaid={s.isPaid} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => { setEditId(s.id); setShowForm(true) }}
                            className="text-sky-600 hover:underline text-xs">Edit</button>
                          <button onClick={() => { if (confirm('Delete this record?')) deleteMutation.mutate(s.id) }}
                            className="text-red-500 hover:underline text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Form Modal */}
        {showForm && (
          <SalaryFormModal
            editId={editId}
            staff={staff}
            year={year}
            month={month}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false)
              qc.invalidateQueries({ queryKey: ['salaries'] })
              qc.invalidateQueries({ queryKey: ['salary-summary'] })
            }}
          />
        )}
      </div>
    </AuthGuard>
  )
}

// ─── Form Modal ───────────────────────────────────────────────────────────────
function SalaryFormModal({ editId, staff, year, month, onClose, onSuccess }: {
  editId: string | null
  staff: Staff[]
  year: number
  month: number
  onClose: () => void
  onSuccess: () => void
}) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({
    defaultValues: { userId: '', baseSalary: 0, allowances: 0, deductions: 0, notes: '' },
  })
  const base = Number(watch('baseSalary') ?? 0)
  const allow = Number(watch('allowances') ?? 0)
  const deduct = Number(watch('deductions') ?? 0)
  const net = base + allow - deduct

  const onSubmit = async (data: any) => {
    const url = editId ? `/api/salary/${editId}` : '/api/salary'
    const method = editId ? 'PUT' : 'POST'
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, year, month }),
    })
    if (res.ok) onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">{editId ? 'Edit' : 'Add'} Salary Record</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {!editId && (
            <div>
              <label className="text-sm font-medium text-slate-700">Staff Member</label>
              <select {...register('userId', { required: true })}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                <option value="">Select staff...</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}
              </select>
              {errors.userId && <p className="text-red-500 text-xs mt-1">Required</p>}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700">Base Salary</label>
              <input type="number" min="0" {...register('baseSalary', { required: true, min: 0 })}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Allowances</label>
              <input type="number" min="0" {...register('allowances')}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Deductions</label>
              <input type="number" min="0" {...register('deductions')}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            Net Salary: <span className="font-bold text-slate-800">${net.toLocaleString()}</span>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Notes</label>
            <textarea {...register('notes')} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1 resize-none" />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm border rounded-lg text-slate-600">Cancel</button>
            <button type="submit" disabled={isSubmitting}
              className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium disabled:opacity-60">
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
