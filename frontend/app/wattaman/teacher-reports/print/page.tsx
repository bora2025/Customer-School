'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'
import { formatCambodiaTime } from '../../../../lib/dateUtils'

interface TeacherAttendanceRecord {
  id: string
  date: string
  period: number
  status: string
  checkIn: string | null
}

interface TeacherPrintRow {
  id: string
  name: string
  short: string
  color: string | null
  weeklyLessons: number
  lessons: { subjectName: string; className: string; perWeek: number }[]
  present: number
  late: number
  absent: number
  total: number
  attendances: TeacherAttendanceRecord[]
}

const paperSizes: Record<string, { width: string; height: string }> = {
  A4: { width: '210mm', height: '297mm' },
  Letter: { width: '215.9mm', height: '279.4mm' },
  Legal: { width: '215.9mm', height: '355.6mm' },
}

function statusText(status: string) {
  if (status === 'PRESENT') return 'P'
  if (status === 'LATE') return 'L'
  if (status === 'ABSENT') return 'A'
  return status
}

function PrintContent() {
  const searchParams = useSearchParams()
  const timetableId = searchParams.get('timetableId') ?? ''
  const startDate = searchParams.get('startDate') ?? ''
  const endDate = searchParams.get('endDate') ?? ''
  const paper = searchParams.get('paper') ?? 'A4'
  const orgName = searchParams.get('orgName') ?? 'School'
  const timetableName = searchParams.get('timetableName') ?? ''

  const [teachers, setTeachers] = useState<TeacherPrintRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const ps = paperSizes[paper] ?? paperSizes.A4

  useEffect(() => {
    if (!timetableId) return
    apiFetch(`/api/timetable/${timetableId}/teacher-attendance/monthly?startDate=${startDate}&endDate=${endDate}`)
      .then(r => r.ok ? r.json() : Promise.reject('Failed to load'))
      .then((data: TeacherPrintRow[]) => {
        setTeachers(data)
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load report data.')
        setLoading(false)
      })
  }, [timetableId, startDate, endDate])

  useEffect(() => {
    if (!loading && !error && teachers.length > 0) {
      const timer = setTimeout(() => window.print(), 400)
      return () => clearTimeout(timer)
    }
  }, [loading, error, teachers])

  const monthLabel = startDate
    ? new Date(startDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''

  const totalPresent = teachers.reduce((s, t) => s + t.present, 0)
  const totalLate = teachers.reduce((s, t) => s + t.late, 0)
  const totalAbsent = teachers.reduce((s, t) => s + t.absent, 0)
  const totalScans = teachers.reduce((s, t) => s + t.total, 0)

  const printedAt = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading report…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-red-600 font-medium">{error}</p>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: ${ps.width} ${ps.height};
            margin: 15mm 12mm;
          }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #e2e8f0; padding: 4px 6px; }
        th { background: #f8fafc; font-size: 9pt; font-weight: 600; }
        .status-P { color: #059669; font-weight: bold; }
        .status-L { color: #d97706; font-weight: bold; }
        .status-A { color: #dc2626; font-weight: bold; }
        .summary-section { margin-bottom: 24px; }
        .detail-section { margin-bottom: 32px; }
        .section-title { font-size: 11pt; font-weight: 700; margin-bottom: 8px; color: #0f172a; border-bottom: 2px solid #00C9A7; padding-bottom: 3px; }
      `}</style>

      {/* No-print toolbar */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
        <button onClick={() => window.print()} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          🖨️ Print
        </button>
        <button onClick={() => window.close()} className="text-slate-600 hover:text-slate-800 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
          ✕ Close
        </button>
        <span className="text-xs text-slate-400 ml-2">Paper: {paper} · {startDate} → {endDate}</span>
      </div>

      <div className="no-print h-14" />

      {/* Print body */}
      <div style={{ maxWidth: ps.width, margin: '0 auto', padding: '0 4mm' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <h1 style={{ fontSize: '14pt', fontWeight: 800, margin: 0, color: '#0f172a' }}>{orgName}</h1>
          <h2 style={{ fontSize: '12pt', fontWeight: 700, margin: '4px 0 2px', color: '#1e293b' }}>Teacher Attendance Report</h2>
          {timetableName && <p style={{ fontSize: '9pt', color: '#64748b', margin: 0 }}>Timetable: {timetableName}</p>}
          <p style={{ fontSize: '9pt', color: '#64748b', margin: '2px 0 0' }}>
            Period: {monthLabel} ({startDate} → {endDate})
          </p>
          <p style={{ fontSize: '8pt', color: '#94a3b8', margin: '2px 0 0' }}>Printed: {printedAt}</p>
        </div>

        {/* Summary totals */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {[
            { label: 'Teachers', value: teachers.length, color: '#1e293b' },
            { label: 'Total Scans', value: totalScans, color: '#1e293b' },
            { label: 'Present', value: totalPresent, color: '#059669' },
            { label: 'Late', value: totalLate, color: '#d97706' },
            { label: 'Absent', value: totalAbsent, color: '#dc2626' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 8px', background: '#f8fafc', textAlign: 'center' }}>
              <div style={{ fontSize: '7.5pt', color: '#64748b', marginBottom: '2px' }}>{s.label}</div>
              <div style={{ fontSize: '13pt', fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Summary table */}
        <div className="summary-section">
          <div className="section-title">Monthly Summary — All Teachers</div>
          <table>
            <thead>
              <tr>
                <th style={{ width: '28px', textAlign: 'center' }}>No.</th>
                <th>Teacher Name</th>
                <th style={{ textAlign: 'center' }}>Short</th>
                <th style={{ textAlign: 'center' }}>Lessons/wk</th>
                <th style={{ textAlign: 'center', color: '#059669' }}>Present</th>
                <th style={{ textAlign: 'center', color: '#d97706' }}>Late</th>
                <th style={{ textAlign: 'center', color: '#dc2626' }}>Absent</th>
                <th style={{ textAlign: 'center' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t, i) => (
                <tr key={t.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ textAlign: 'center', color: '#64748b' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td style={{ textAlign: 'center', color: '#64748b' }}>{t.short}</td>
                  <td style={{ textAlign: 'center' }}>{t.weeklyLessons}</td>
                  <td className="status-P" style={{ textAlign: 'center' }}>{t.present}</td>
                  <td className="status-L" style={{ textAlign: 'center' }}>{t.late}</td>
                  <td className="status-A" style={{ textAlign: 'center' }}>{t.absent}</td>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{t.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                <td colSpan={4} style={{ textAlign: 'right', paddingRight: '8px' }}>Total</td>
                <td className="status-P" style={{ textAlign: 'center' }}>{totalPresent}</td>
                <td className="status-L" style={{ textAlign: 'center' }}>{totalLate}</td>
                <td className="status-A" style={{ textAlign: 'center' }}>{totalAbsent}</td>
                <td style={{ textAlign: 'center' }}>{totalScans}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Per-teacher detail pages */}
        {teachers.filter(t => t.attendances.length > 0).map((t, ti) => (
          <div key={t.id} className={ti > 0 ? 'page-break detail-section' : 'detail-section'} style={{ marginTop: ti === 0 ? '16px' : 0 }}>
            <div className="section-title">
              {t.name} ({t.short}) — Period Detail
              <span style={{ float: 'right', fontSize: '8pt', color: '#64748b', fontWeight: 400 }}>
                {t.lessons.map(l => `${l.subjectName}/${l.className}`).join(', ')} · {t.weeklyLessons} lessons/wk
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '28px', textAlign: 'center' }}>No.</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'center' }}>Period</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th>Check-In Time</th>
                </tr>
              </thead>
              <tbody>
                {t.attendances.map((a, ai) => (
                  <tr key={a.id} style={{ background: ai % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ textAlign: 'center', color: '#64748b' }}>{ai + 1}</td>
                    <td>
                      {new Date(a.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ textAlign: 'center' }}>P{a.period}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`status-${statusText(a.status)}`}>{statusText(a.status)}</span>
                    </td>
                    <td>
                      {a.checkIn
                        ? formatCambodiaTime(a.checkIn, true)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f1f5f9', fontWeight: 600, fontSize: '9pt' }}>
                  <td colSpan={3} style={{ textAlign: 'right', paddingRight: '8px' }}>Totals</td>
                  <td colSpan={2}>
                    <span className="status-P">{t.present}P</span>
                    {' · '}
                    <span className="status-L">{t.late}L</span>
                    {' · '}
                    <span className="status-A">{t.absent}A</span>
                    {' · '}
                    {t.total} total
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}

        {/* Footer */}
        <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', color: '#94a3b8' }}>
          <span>Generated by Wattaman QR Attendance System</span>
          <span>Printed: {printedAt}</span>
        </div>
      </div>
    </>
  )
}

export default function TeacherReportsPrintPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PrintContent />
    </Suspense>
  )
}
