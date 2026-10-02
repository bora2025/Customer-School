'use client'

import { useState, useEffect, useCallback } from 'react'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { accounterNav } from '../../../lib/accounter-nav'
import { apiFetch } from '../../../lib/api'
import { useInstallationCurrency } from '../../../lib/installation'
import { formatMoneyMajor } from '../../../lib/formatMoney'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly'

interface BudgetSummary {
  totalCollected: number
  totalFees: number
  discountGiven: number
  outstanding: number
  collectionRate: number
  feeRecordsCreated: number
  paymentsCount: number
}

interface BreakdownItem { label: string; collected: number; fees: number }

interface PaymentRow {
  id: string
  studentName: string
  class: string
  amount: number
  note: string
  date: string
  time: string
}

interface BudgetReport {
  period: string
  dateRange: { start: string; end: string }
  summary: BudgetSummary
  breakdown: BreakdownItem[]
  payments: PaymentRow[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Set synchronously at the top of BudgetDashboard's render (not in an effect) so every
// sibling component below it in the same render pass -- BarChart, StatCard, etc. -- sees the
// current value the moment it's known, not one render behind.
let currentCurrency = 'USD'
const fmt = (n: number) => formatMoneyMajor(n, currentCurrency)

function anchorToday(): string {
  return new Date().toISOString().split('T')[0]
}

function navigateDate(period: Period, dateStr: string, dir: -1 | 1): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (period === 'daily')   date.setUTCDate(date.getUTCDate() + dir)
  else if (period === 'weekly')  date.setUTCDate(date.getUTCDate() + dir * 7)
  else if (period === 'monthly') date.setUTCMonth(date.getUTCMonth() + dir)
  else                           date.setUTCFullYear(date.getUTCFullYear() + dir)
  return date.toISOString().split('T')[0]
}

function formatRange(period: Period, start: string, end: string): string {
  const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const FMONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const DOW     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const sDate = new Date(Date.UTC(sy, sm - 1, sd))
  if (period === 'daily')   return `${DOW[sDate.getUTCDay()]}, ${MONTHS[sm-1]} ${sd}, ${sy}`
  if (period === 'weekly')  return `${MONTHS[sm-1]} ${sd} – ${MONTHS[em-1]} ${ed}, ${ey}`
  if (period === 'monthly') return `${FMONTHS[sm-1]} ${sy}`
  return `${sy}`
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BarChart({ breakdown }: { breakdown: BreakdownItem[] }) {
  const maxVal = Math.max(...breakdown.map(b => Math.max(b.collected, b.fees)), 1)
  const hasData = breakdown.some(b => b.collected > 0 || b.fees > 0)

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-36 text-sm text-gray-400 gap-2">
        <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        No activity this period
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" />Collected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-blue-300 inline-block" />Fees Created
        </span>
      </div>
      {/* bar area */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-end gap-px" style={{ minWidth: `${breakdown.length * 44}px`, height: '140px' }}>
          {breakdown.map((item, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5 flex-1 min-w-[40px]">
              <div className="flex items-end gap-0.5 w-full" style={{ height: '112px' }}>
                <div
                  className="flex-1 bg-emerald-400 hover:bg-emerald-500 rounded-t-sm transition-all duration-500 cursor-default"
                  style={{ height: `${Math.round((item.collected / maxVal) * 112)}px`, minHeight: item.collected > 0 ? '2px' : '0' }}
                  title={`Collected: ${fmt(item.collected)}`}
                />
                <div
                  className="flex-1 bg-blue-300 hover:bg-blue-400 rounded-t-sm transition-all duration-500 cursor-default"
                  style={{ height: `${Math.round((item.fees / maxVal) * 112)}px`, minHeight: item.fees > 0 ? '2px' : '0' }}
                  title={`Fees Created: ${fmt(item.fees)}`}
                />
              </div>
              <span className="text-[9px] text-gray-400 w-full text-center truncate leading-none">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, colorClass }: {
  label: string; value: string; sub: string; colorClass: string
}) {
  return (
    <div className={`rounded-2xl border p-5 ${colorClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">{label}</p>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="text-xs opacity-50 mt-1">{sub}</p>
    </div>
  )
}

// ─── Budget Dashboard ─────────────────────────────────────────────────────────

function BudgetDashboard() {
  currentCurrency = useInstallationCurrency()
  const [period, setPeriod] = useState<Period>('monthly')
  const [anchor, setAnchor] = useState(anchorToday())
  const [report, setReport] = useState<BudgetReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const load = useCallback(async (p: Period, a: string) => {
    setLoading(true); setError('')
    try {
      const res = await apiFetch(`/api/fees/budget-report?period=${p}&date=${a}`)
      if (res.ok) setReport(await res.json())
      else setError('Failed to load report')
    } catch { setError('Network error — please try again') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(period, anchor) }, [period, anchor, load])

  const PERIODS: { key: Period; label: string }[] = [
    { key: 'daily',   label: 'Daily' },
    { key: 'weekly',  label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'yearly',  label: 'Yearly' },
  ]

  function exportCSV() {
    if (!report) return
    const escape = (v: string | number) => {
      const s = String(v)
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = [
      ['Student', 'Class', 'Amount', 'Note', 'Date', 'Time'],
      ...report.payments.map(p => [p.studentName, p.class, p.amount, p.note, p.date, p.time]),
    ]
    const csv = '\uFEFF' + rows.map(r => r.map(escape).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `budget-${period}-${report.dateRange.start}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const s = report?.summary
  const rangeLabel = report
    ? formatRange(period, report.dateRange.start, report.dateRange.end)
    : '—'

  return (
    <main className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Budget Report</h1>
            <p className="text-sm text-gray-500 mt-0.5">Fee collection analytics</p>
          </div>
          {report && (
            <button onClick={exportCSV}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          )}
        </div>

        {/* Period tabs + date navigator */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {PERIODS.map(({ key, label }) => (
              <button key={key} onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  period === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {/* Date nav */}
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => setAnchor(a => navigateDate(period, a, -1))}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-gray-800 w-52 text-center">{rangeLabel}</span>
            <button onClick={() => setAnchor(a => navigateDate(period, a, 1))}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button onClick={() => setAnchor(anchorToday())}
              className="ml-2 px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              Today
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-500 text-sm">{error}</div>
        ) : s ? (
          <>
            {/* Summary stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Collected"
                value={fmt(s.totalCollected)}
                sub={`${s.paymentsCount} payment${s.paymentsCount !== 1 ? 's' : ''}`}
                colorClass="bg-emerald-50 border-emerald-100 text-emerald-900"
              />
              <StatCard
                label="Fees Created"
                value={fmt(s.totalFees)}
                sub={`${s.feeRecordsCreated} record${s.feeRecordsCreated !== 1 ? 's' : ''}`}
                colorClass="bg-blue-50 border-blue-100 text-blue-900"
              />
              <StatCard
                label="Outstanding"
                value={fmt(s.outstanding)}
                sub={`${s.collectionRate}% collection rate`}
                colorClass="bg-amber-50 border-amber-100 text-amber-900"
              />
              <StatCard
                label="Discount Given"
                value={fmt(s.discountGiven)}
                sub="on new records"
                colorClass="bg-purple-50 border-purple-100 text-purple-900"
              />
            </div>

            {/* Bar chart */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-gray-700">Collection Overview</h2>
                <span className="text-xs text-gray-400">{rangeLabel}</span>
              </div>
              <BarChart breakdown={report!.breakdown} />
            </div>

            {/* Payment table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">
                  Payments
                  <span className="ml-2 text-gray-400 font-normal">({report!.payments.length})</span>
                </h2>
              </div>
              {report!.payments.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-gray-400">
                  No payments recorded in this period
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Class</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Note</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Date / Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {report!.payments.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50/60 transition">
                          <td className="px-6 py-3.5 font-medium text-gray-900">{p.studentName}</td>
                          <td className="px-4 py-3.5 text-gray-500">{p.class || '—'}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-emerald-700">{fmt(p.amount)}</td>
                          <td className="px-4 py-3.5 text-gray-400 text-xs">{p.note || '—'}</td>
                          <td className="px-6 py-3.5 text-right text-xs text-gray-400 leading-relaxed">
                            {p.date}<br />{p.time}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50/70 border-t border-gray-200">
                      <tr>
                        <td colSpan={2} className="px-6 py-3 text-xs font-semibold text-gray-500">
                          Total — {report!.payments.length} payment{report!.payments.length !== 1 ? 's' : ''}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-800">{fmt(s.totalCollected)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  return (
    <AuthGuard allowedRoles={['ACCOUNTER', 'ADMIN']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Accounter" navItems={accounterNav} accentColor="emerald" />
        <BudgetDashboard />
      </div>
    </AuthGuard>
  )
}
