'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'

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

interface Payment {
  id: string
  studentName: string
  class: string
  amount: number
  note: string
  date: string
  time: string
}

interface BudgetReport {
  period: Period
  dateRange: { start: string; end: string }
  summary: BudgetSummary
  payments: Payment[]
}

interface SalarySummary {
  total: number
  totalNet: number
  paid: number
  unpaid: number
}

const PAPER_SIZES: Record<string, { width: string; minHeight: string }> = {
  A4: { width: '210mm', minHeight: '297mm' },
  Letter: { width: '215.9mm', minHeight: '279.4mm' },
  Legal: { width: '215.9mm', minHeight: '355.6mm' },
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

function periodLabel(period: Period, dateRange: { start: string; end: string }) {
  if (period === 'daily') return dateRange.start
  if (period === 'weekly') return `${dateRange.start} – ${dateRange.end}`
  if (period === 'monthly') {
    const d = new Date(dateRange.start + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  return dateRange.start.slice(0, 4)
}

export default function PrintBudgetReportPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>}>
      <PrintBudgetReportContent />
    </Suspense>
  )
}

function PrintBudgetReportContent() {
  const searchParams = useSearchParams()
  const period = (searchParams.get('period') || 'monthly') as Period
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0]
  const paperSize = searchParams.get('paper') || 'A4'
  const orgName = searchParams.get('orgName') || 'Wattaman School'
  const logoUrl = searchParams.get('logoUrl') || ''
  const logoTextLines: string[] = (() => {
    try { return JSON.parse(searchParams.get('logoTextLines') || '[]') }
    catch { return [] }
  })()
  const logoGap = parseInt(searchParams.get('logoGap') || '4')
  const logoTextGap = parseInt(searchParams.get('logoTextGap') || '4')
  const headerGap = parseInt(searchParams.get('headerGap') || '6')
  const headerLines: string[] = (() => {
    try { return JSON.parse(searchParams.get('headerLines') || '[]') }
    catch { return [] }
  })()
  const signers: string[] = (() => {
    try { return JSON.parse(searchParams.get('signers') || '[]') }
    catch { return ['Accountant', 'Director'] }
  })()

  const [report, setReport] = useState<BudgetReport | null>(null)
  const [salary, setSalary] = useState<SalarySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, date])

  const fetchData = async () => {
    try {
      const d = new Date(date + 'T00:00:00')
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const [r1, r2] = await Promise.all([
        apiFetch(`/api/fees/budget-report?period=${period}&date=${date}`),
        apiFetch(`/api/salary/summary?year=${year}&month=${month}`),
      ])
      if (r1.ok) {
        setReport(await r1.json())
      } else {
        setError('Failed to load report data')
      }
      if (r2.ok) setSalary(await r2.json())
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.A4

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-slate-500 mt-3">Loading…</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error || 'No data available for this range.'}</p>
          <button onClick={() => window.close()} className="mt-4 px-4 py-2 bg-slate-200 rounded-lg text-sm">Close</button>
        </div>
      </div>
    )
  }

  const s = report.summary
  const net = salary ? s.totalCollected - salary.totalNet : null

  return (
    <>
      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: ${paperSize === 'Letter' ? 'letter' : paperSize === 'Legal' ? 'legal' : 'A4'} portrait;
            margin: 15mm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .print-container {
            width: ${paper.width} !important;
            padding: 15mm !important;
            max-width: none !important;
            margin-top: 0 !important;
          }
          .table-scroll-wrapper {
            overflow: visible !important;
          }
        }
        @media screen {
          body {
            background: #f1f5f9;
          }
          .print-container {
            width: 100%;
            max-width: ${paper.width};
            padding: 16px;
            box-sizing: border-box;
          }
          .table-scroll-wrapper {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          .table-scroll-wrapper table {
            min-width: 480px;
          }
        }
        @media screen and (min-width: 900px) {
          .print-container {
            padding: 15mm;
          }
        }
        @media screen and (max-width: 640px) {
          .print-toolbar-center {
            display: none !important;
          }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print fixed top-0 left-0 right-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-50 shadow-sm gap-2">
        <button onClick={() => window.close()} className="flex-shrink-0 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">
          {'←'} Close
        </button>
        <div className="print-toolbar-center text-sm text-slate-500 truncate min-w-0 mx-1">
          Finance / Budget Report — {periodLabel(period, report.dateRange)} — {paperSize}
        </div>
        <button onClick={() => window.print()} className="flex-shrink-0 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm">
          {'🖨️'} Print
        </button>
      </div>

      {/* Print content */}
      <div
        className="print-container mx-auto bg-white"
        style={{
          minHeight: paper.minHeight,
          marginTop: '60px',
        }}
      >
        {/* Header Section — letter-head style */}
        <div className="mb-6 border-b-2 border-slate-800 pb-4">
          <div className="flex items-start gap-4">
            {logoUrl && (
              <div className="flex-shrink-0 pt-1 text-center">
                <img src={logoUrl} alt="Logo" className="h-20 w-20 object-contain" style={{ marginBottom: `${logoGap}px` }} />
                {logoTextLines.length > 0 && (
                  <div style={{ marginBottom: `${logoTextGap}px` }}>
                    {logoTextLines.map((line, idx) => (
                      <p key={idx} className="text-[9px] text-slate-600 leading-tight whitespace-nowrap">{line}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 text-center" style={{ marginBottom: `${headerGap}px` }}>
              {headerLines.map((line, idx) => (
                <p key={idx} className={`${idx === 0 ? 'text-base font-bold text-slate-900' : 'text-sm font-semibold text-slate-700'}`}>
                  {line}
                </p>
              ))}
              {orgName && (
                <p className="text-lg font-bold text-slate-900 uppercase tracking-wide mt-1">
                  {orgName}
                </p>
              )}
            </div>
            {/* Spacer to balance logo */}
            {logoUrl && <div className="w-20 flex-shrink-0" />}
          </div>
          <div className="text-center mt-3">
            <h2 className="text-lg font-semibold text-slate-700">
              Finance / Budget Report
            </h2>
            <div className="mt-2 flex flex-wrap justify-center gap-x-8 gap-y-1 text-sm text-slate-600">
              <span>
                <strong>Period:</strong> <span className="capitalize">{period}</span>
              </span>
              <span>
                <strong>Range:</strong> {report.dateRange.start === report.dateRange.end ? report.dateRange.start : `${report.dateRange.start} — ${report.dateRange.end}`}
              </span>
            </div>
          </div>
        </div>

        {/* Income Summary */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-2">Income Summary</h3>
          <table className="w-full border-collapse text-xs">
            <tbody>
              <tr className="bg-white">
                <td className="border border-slate-300 px-3 py-2 text-slate-600 w-1/2">Total Collected</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-emerald-700">${fmt(s.totalCollected)}</td>
              </tr>
              <tr className="bg-slate-50">
                <td className="border border-slate-300 px-3 py-2 text-slate-600">Outstanding</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-red-600">${fmt(s.outstanding)}</td>
              </tr>
              <tr className="bg-white">
                <td className="border border-slate-300 px-3 py-2 text-slate-600">Discount Given</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-blue-600">${fmt(s.discountGiven)}</td>
              </tr>
              <tr className="bg-slate-50">
                <td className="border border-slate-300 px-3 py-2 text-slate-600">Fee Records Created</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-slate-800">{s.feeRecordsCreated}</td>
              </tr>
              <tr className="bg-white">
                <td className="border border-slate-300 px-3 py-2 text-slate-600">Payments Count</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-slate-800">{s.paymentsCount}</td>
              </tr>
              <tr className="bg-slate-50">
                <td className="border border-slate-300 px-3 py-2 text-slate-600">Collection Rate</td>
                <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-violet-700">{s.collectionRate}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Expense Summary */}
        {salary && (
          <div className="mb-6">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-2">Expense Summary — Salary Payout</h3>
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr className="bg-white">
                  <td className="border border-slate-300 px-3 py-2 text-slate-600 w-1/2">Total Salary Payout</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-orange-700">${fmt(salary.totalNet)}</td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-3 py-2 text-slate-600">Paid Salaries</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-emerald-700">{salary.paid}</td>
                </tr>
                <tr className="bg-white">
                  <td className="border border-slate-300 px-3 py-2 text-slate-600">Unpaid Salaries</td>
                  <td className="border border-slate-300 px-3 py-2 text-right font-semibold text-amber-700">{salary.unpaid}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Net Balance */}
        {net !== null && (
          <div className={`mb-6 rounded-lg border px-4 py-3 flex items-center justify-between ${net >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <span className={`text-sm font-semibold ${net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              Net Balance — {net >= 0 ? 'Surplus' : 'Deficit'} (Income − Salary Payout)
            </span>
            <span className={`text-base font-extrabold tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {net < 0 ? '-' : '+'}${fmt(Math.abs(net))}
            </span>
          </div>
        )}

        {/* Payments Detail */}
        {report.payments.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-2">Payments — {periodLabel(period, report.dateRange)}</h3>
            <div className="table-scroll-wrapper">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="border border-slate-600 px-2 py-1.5 text-left font-semibold">Student</th>
                    <th className="border border-slate-600 px-2 py-1.5 text-left font-semibold">Class</th>
                    <th className="border border-slate-600 px-2 py-1.5 text-left font-semibold">Date</th>
                    <th className="border border-slate-600 px-2 py-1.5 text-left font-semibold">Time</th>
                    <th className="border border-slate-600 px-2 py-1.5 text-right font-semibold">Amount</th>
                    <th className="border border-slate-600 px-2 py-1.5 text-left font-semibold">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {report.payments.map((p, idx) => (
                    <tr key={p.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-800">{p.studentName}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-600">{p.class || '—'}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-600">{p.date}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-600">{p.time}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-semibold text-emerald-700">${fmt(p.amount)}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-500">{p.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100">
                    <td colSpan={4} className="border border-slate-300 px-2 py-1.5 font-bold text-slate-700 uppercase tracking-wide text-[10px]">Total</td>
                    <td className="border border-slate-300 px-2 py-1.5 text-right font-extrabold text-emerald-700">
                      ${fmt(report.payments.reduce((sum, p) => sum + p.amount, 0))}
                    </td>
                    <td className="border border-slate-300" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 flex justify-between items-end text-xs text-slate-400">
          <div>
            Print Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div>
            {orgName} {'—'} Finance / Budget Report
          </div>
        </div>

        {/* Signature area */}
        {signers.length > 0 && (
          <div className={`mt-12 flex ${signers.length <= 3 ? 'justify-between' : 'justify-around flex-wrap gap-y-8'} px-4`}>
            {signers.map((signer, idx) => (
              <div key={idx} className="text-center">
                <div className="border-b border-slate-400 w-28 sm:w-40 mb-1"></div>
                <p className="text-xs text-slate-500">{signer}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
