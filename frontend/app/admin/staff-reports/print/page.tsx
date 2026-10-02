'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'
import { useLanguage } from '../../../../lib/i18n'


// ── Summary-mode row (weekly / monthly / yearly / custom) ──
interface StaffPrintRow {
  userId: string
  staffNumber: string
  staffName: string
  role: string
  present: number
  late: number
  absent: number
  dayOff: number
}

interface StaffPrintData {
  startDate: string
  endDate: string
  staff: StaffPrintRow[]
}

// ── Daily-mode row (actual check-in/out times) ──
interface StaffDailyRow {
  userId: string
  staffNumber: string
  staffName: string
  role: string
  checkInMorning: string | null
  checkOutMorning: string | null
  checkInAfternoon: string | null
  checkOutAfternoon: string | null
  session1Status: string | null
  session2Status: string | null
  session3Status: string | null
  session4Status: string | null
  session1PermissionType: string | null
  session2PermissionType: string | null
  session3PermissionType: string | null
  session4PermissionType: string | null
  session1PermissionStartDate?: string | null
  session1PermissionEndDate?: string | null
  session2PermissionStartDate?: string | null
  session2PermissionEndDate?: string | null
  session3PermissionStartDate?: string | null
  session3PermissionEndDate?: string | null
  session4PermissionStartDate?: string | null
  session4PermissionEndDate?: string | null
  isHoliday?: boolean
}

function isDayOff(status: string | null | undefined) {
  return status === 'PERMISSION' || status === 'DAY_OFF'
}

function permissionLabel(row: StaffDailyRow): string | null {
  const statuses = [row.session1Status, row.session2Status, row.session3Status, row.session4Status]
  if (!statuses.some(s => isDayOff(s))) return null
  const types = [row.session1PermissionType, row.session2PermissionType, row.session3PermissionType, row.session4PermissionType]
  const t = types.find(Boolean)
  const fmtD = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  const startDate = [row.session1PermissionStartDate, row.session2PermissionStartDate, row.session3PermissionStartDate, row.session4PermissionStartDate].find(Boolean)
  const endDate = [row.session1PermissionEndDate, row.session2PermissionEndDate, row.session3PermissionEndDate, row.session4PermissionEndDate].find(Boolean)
  if (t === 'HALF_DAY_MORNING') return 'P Half AM'
  if (t === 'HALF_DAY_AFTERNOON') return 'P Half PM'
  if (t === 'FULL_DAY') return 'P Full Day'
  if (t === 'MULTI_DAY') {
    if (startDate && endDate) return `P ${fmtD(startDate)} – ${fmtD(endDate)}`
    return 'P Multi Day'
  }
  if (statuses.some(s => s === 'DAY_OFF')) return 'P Day Off'
  return 'P'
}

function TimeCell({ time, status }: { time: string | null; status: string | null }) {
  if (isDayOff(status)) return <span className="text-purple-500 font-bold text-xs">P</span>
  const isLate = status === 'LATE'
  if (time) return (
    <span className={`font-semibold text-xs tabular-nums ${isLate ? 'text-amber-600' : 'text-emerald-700'}`}>
      {isLate
        ? <><span className="font-bold">L</span> ({time})</>
        : <>✓ ({time})</>}
    </span>
  )
  if (isLate) return <span className="text-amber-600 font-bold text-xs">L</span>
  return <span className="text-red-500 text-xs">✗</span>
}

const PAPER_SIZES: Record<string, { width: string; minHeight: string }> = {
  A4: { width: '210mm', minHeight: '297mm' },
  Letter: { width: '215.9mm', minHeight: '279.4mm' },
  Legal: { width: '215.9mm', minHeight: '355.6mm' },
}

export default function StaffPrintReportPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>}>
      <StaffPrintReportContent />
    </Suspense>
  )
}

function StaffPrintReportContent() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const startDate = searchParams.get('startDate') || ''
  const endDate = searchParams.get('endDate') || ''
  const period = searchParams.get('period') || 'daily'
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
  const logoText = searchParams.get('logoText') || ''
  const deptName = searchParams.get('dept') || ''
  const headerLines: string[] = (() => {
    try { return JSON.parse(searchParams.get('headerLines') || '[]') }
    catch { return [] }
  })()
  const signers: string[] = (() => {
    try { return JSON.parse(searchParams.get('signers') || '[]') }
    catch { return ['Admin', 'Director'] }
  })()

  const isDaily = period === 'daily'

  const [data, setData] = useState<StaffPrintData | null>(null)
  const [dailyRows, setDailyRows] = useState<StaffDailyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!startDate || !endDate) {
      setError('Missing required parameters')
      setLoading(false)
      return
    }
    fetchData()
  }, [startDate, endDate, period])

  const fetchData = async () => {
    try {
      if (isDaily) {
        // For daily view use the grid endpoint which has actual times
        const res = await apiFetch(
          `/api/reports/staff-attendance-daily-grid?date=${encodeURIComponent(startDate)}`
        )
        if (res.ok) {
          setDailyRows(await res.json())
        } else {
          setError('Failed to load report data')
        }
      } else {
        const res = await apiFetch(
          `/api/reports/staff-print-report-data?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
        )
        if (res.ok) {
          setData(await res.json())
        } else {
          setError('Failed to load report data')
        }
      }
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  // User clicks "Print Report" button to print manually

  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.A4

  const getPeriodLabel = () => {
    switch (period) {
      case 'daily': return t('reports.daily')
      case 'weekly': return t('reports.weekly')
      case 'monthly': return t('reports.monthly')
      case 'yearly': return t('reports.yearly')
      default: return t('reports.customRange')
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-slate-500 mt-3">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  if (error || (isDaily ? dailyRows.length === 0 && error : !data)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error || t('reports.noDataForRange')}</p>
          <button onClick={() => window.close()} className="mt-4 px-4 py-2 bg-slate-200 rounded-lg text-sm">{t('common.close')}</button>
        </div>
      </div>
    )
  }

  // Summary totals (non-daily) — sum of each staff member's individual day counts
  const summaryTotals = { present: 0, late: 0, absent: 0, dayOff: 0 }
  if (!isDaily && data) {
    for (const s of data.staff) {
      summaryTotals.present += s.present
      summaryTotals.late += s.late
      summaryTotals.absent += s.absent
      summaryTotals.dayOff += s.dayOff ?? 0
    }
  }

  // Daily totals
  const dailyTotals = { present: 0, late: 0, absent: 0, permission: 0 }
  if (isDaily) {
    for (const r of dailyRows) {
      const statuses = [r.session1Status, r.session2Status, r.session3Status, r.session4Status]
      if (statuses.some(s => isDayOff(s))) dailyTotals.permission += 1
      else if (statuses.some(s => s === 'PRESENT')) dailyTotals.present += 1
      else if (statuses.some(s => s === 'LATE')) dailyTotals.late += 1
      else if (statuses.some(s => s === 'ABSENT')) dailyTotals.absent += 1
    }
  }

  return (
    <>
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
            min-width: 520px;
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
          ← {t('common.close')}
        </button>
        <div className="print-toolbar-center text-sm text-slate-500 truncate min-w-0 mx-1">
          {t('reports.staffAttendance')} — {getPeriodLabel()} — {paperSize}
        </div>
        <button onClick={() => window.print()} className="flex-shrink-0 px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 shadow-sm">
          🖨️ {t('reports.printReport')}
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
        {/* Header Section — Khmer letter-head style */}
        <div className="mb-6 border-b-2 border-slate-800 pb-4">
          <div className="flex items-start gap-4">
            {logoUrl && (
              <div className="flex-shrink-0 pt-1 text-center">
                <img src={logoUrl} alt="Logo" className="h-20 w-20 object-contain" style={{ marginBottom: `${logoGap}px` }} />
                {(logoTextLines.length > 0 || logoText) && (
                  <div style={{ marginBottom: `${logoTextGap}px` }}>
                    {logoTextLines.length > 0 ? logoTextLines.map((line, idx) => (
                      <p key={idx} className="text-[9px] text-slate-600 leading-tight whitespace-nowrap">{line}</p>
                    )) : logoText && <p className="text-[9px] text-slate-600 leading-tight whitespace-nowrap">{logoText}</p>}
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
              {t('reports.attendanceReport')} — {t('reports.staffAttendance')}
            </h2>
            <div className="mt-2 flex flex-wrap justify-center gap-x-8 gap-y-1 text-sm text-slate-600">
              <span>
                <strong>{t('reports.reportPeriod')}:</strong> {getPeriodLabel()}
              </span>
              <span>
                <strong>{t('reports.dateRange')}:</strong>{' '}
                {startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} — ${formatDate(endDate)}`}
              </span>
            </div>
            {deptName && (
              <div className="mt-2 text-sm text-slate-600">
                <strong>{t('common.department')}:</strong> {deptName}
              </div>
            )}
          </div>
        </div>

        {/* Body Section — Report Table */}
        <div className="table-scroll-wrapper">
        <table className="w-full border-collapse text-xs">
          <thead>
            {isDaily ? (
              /* ── Daily header: two-row span for morning/afternoon ── */
              <>
                <tr className="bg-slate-800 text-white">
                  <th className="border border-slate-600 px-2 py-1.5 text-center font-semibold" rowSpan={2}>
                    {t('common.id')}
                  </th>
                  <th className="border border-slate-600 px-2 py-1.5 text-left font-semibold" rowSpan={2}>
                    {t('common.name')}
                  </th>
                  <th className="border border-slate-600 px-2 py-1.5 text-center font-semibold" rowSpan={2}>
                    {t('common.role')}
                  </th>
                  <th className="border border-slate-600 px-2 py-1.5 text-center font-semibold" colSpan={2}>
                    Morning
                  </th>
                  <th className="border border-slate-600 px-2 py-1.5 text-center font-semibold" colSpan={2}>
                    Afternoon
                  </th>
                </tr>
                <tr className="bg-slate-700 text-white">
                  <th className="border border-slate-600 px-2 py-1 text-center font-medium w-16">Check-In</th>
                  <th className="border border-slate-600 px-2 py-1 text-center font-medium w-16">Check-Out</th>
                  <th className="border border-slate-600 px-2 py-1 text-center font-medium w-16">Check-In</th>
                  <th className="border border-slate-600 px-2 py-1 text-center font-medium w-16">Check-Out</th>
                </tr>
              </>
            ) : (
              /* ── Summary header (weekly/monthly/etc.) ── */
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-2 py-2 text-center font-semibold text-slate-700 w-12">
                  {t('common.id')}
                </th>
                <th className="border border-slate-400 px-3 py-2 text-left font-semibold text-slate-700">
                  {t('common.name')}
                </th>
                <th className="border border-slate-400 px-2 py-2 text-center font-semibold text-slate-700 w-20">
                  {t('common.role')}
                </th>
                <th className="border border-slate-400 px-2 py-2 text-center font-semibold text-emerald-700 w-16">
                  {t('reports.colPresent')}
                </th>
                <th className="border border-slate-400 px-2 py-2 text-center font-semibold text-amber-700 w-16">
                  {t('reports.colLate')}
                </th>
                <th className="border border-slate-400 px-2 py-2 text-center font-semibold text-red-700 w-16">
                  {t('reports.colAbsent')}
                </th>
                <th className="border border-slate-400 px-2 py-2 text-center font-semibold text-purple-700 w-16">
                  {t('reports.colPermission')}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {isDaily ? (
              <>
                {dailyRows.map((row, idx) => {
                  const isHoliday = row.isHoliday
                  return (
                    <tr key={row.userId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="border border-slate-300 px-2 py-1.5 text-center font-mono">{row.staffNumber}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-800">{row.staffName}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-center text-slate-600">
                        {t('role.' + (row.role || '').toLowerCase()) || row.role}
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-center">
                        {isHoliday ? <span className="text-slate-400">—</span> : <TimeCell time={row.checkInMorning} status={row.session1Status} />}
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-center">
                        {isHoliday ? <span className="text-slate-400">—</span> : <TimeCell time={row.checkOutMorning} status={row.session2Status} />}
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-center">
                        {isHoliday ? <span className="text-slate-400">—</span> : <TimeCell time={row.checkInAfternoon} status={row.session3Status} />}
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-center">
                        {isHoliday ? <span className="text-slate-400">—</span> : <TimeCell time={row.checkOutAfternoon} status={row.session4Status} />}
                      </td>
                    </tr>
                  )
                })}

              </>
            ) : (
              <>
                {(data?.staff ?? []).map((row, idx) => (
                  <tr key={row.userId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-mono">
                      {row.staffNumber}
                    </td>
                    <td className="border border-slate-300 px-3 py-1.5 text-slate-800">
                      {row.staffName}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center text-slate-600">
                      {t('role.' + (row.role || '').toLowerCase()) || row.role}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-emerald-700">
                      {row.present}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-amber-600">
                      {row.late}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-red-600">
                      {row.absent}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-purple-600">
                      {row.dayOff ?? 0}
                    </td>
                  </tr>
                ))}

              </>
            )}
          </tbody>
        </table>
        </div>

        {/* Footer */}
        <div className="mt-8 flex justify-between items-end text-xs text-slate-400">
          <div>
            {t('reports.printDate')}: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div>
            {orgName} — {t('reports.staffAttendance')}
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
