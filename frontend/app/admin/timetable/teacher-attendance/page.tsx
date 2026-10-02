'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import { pluginTimetableFetch } from '../../../../lib/timetable-plugin-api'

interface TimetableListItem { id: string; name: string; academicYear: string; periodsPerDay: number }
interface TTeacher {
  id: string; lastName: string; firstName: string; short: string; color: string | null
  attendances: Attendance[]
}
interface Attendance {
  id: string; date: string; period: number; status: string; checkIn: string | null
}

function toDateStr(d: Date): string { return d.toISOString().split('T')[0] }

export default function TeacherAttendancePage() {
  const router = useRouter()
  const pluginMode = useSearchParams().get('source') === 'plugin'
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const [timetables, setTimetables] = useState<TimetableListItem[]>([])
  const [selectedTT, setSelectedTT] = useState('')
  const [teachers, setTeachers] = useState<TTeacher[]>([])
  const [loading, setLoading] = useState(false)
  const [periods, setPeriods] = useState(8)

  const today = toDateStr(new Date())
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)

  // Manual mark modal
  const [showMarkModal, setShowMarkModal] = useState(false)
  const [markTeacherId, setMarkTeacherId] = useState('')
  const [markDate, setMarkDate] = useState(today)
  const [markPeriod, setMarkPeriod] = useState(1)
  const [markStatus, setMarkStatus] = useState('PRESENT')
  const [saving, setSaving] = useState(false)

  // QR scan modal
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrPeriod, setQrPeriod] = useState(1)
  const [qrInput, setQrInput] = useState('')
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const fetchTimetables = useCallback(async () => {
    const res = await timetableFetch('/api/timetable')
    if (res.ok) {
      const list = await res.json()
      setTimetables(list)
      if (list.length > 0 && !selectedTT) {
        setSelectedTT(list[0].id)
        setPeriods(list[0].periodsPerDay ?? 8)
      }
    }
  }, [selectedTT, timetableFetch])

  const fetchReport = useCallback(async () => {
    if (!selectedTT) return
    setLoading(true)
    const res = await timetableFetch(`/api/timetable/${selectedTT}/teacher-attendance?startDate=${startDate}&endDate=${endDate}`)
    if (res.ok) setTeachers(await res.json())
    setLoading(false)
  }, [selectedTT, startDate, endDate, timetableFetch])

  useEffect(() => { fetchTimetables() }, [fetchTimetables])
  useEffect(() => { fetchReport() }, [fetchReport])

  async function handleMark() {
    if (!markTeacherId) return
    setSaving(true)
    await timetableFetch('/api/timetable/teacher-attendance/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId: markTeacherId, date: markDate, period: markPeriod, status: markStatus }),
    })
    await fetchReport(); setShowMarkModal(false); setSaving(false)
  }

  async function handleScanQr() {
    if (!qrInput.trim()) return
    setScanning(true); setScanResult(null)
    const res = await timetableFetch('/api/timetable/teacher-attendance/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrCode: qrInput.trim(), period: qrPeriod }),
    })
    if (res.ok) {
      setScanResult('✓ Attendance marked successfully!')
      setQrInput('')
      await fetchReport()
    } else {
      const err = await res.json().catch(() => ({}))
      setScanResult('✗ ' + (err.message ?? 'QR code not found'))
    }
    setScanning(false)
  }

  function getStatus(teacher: TTeacher, dateStr: string, period: number): string {
    const att = teacher.attendances.find(
      a => a.date.startsWith(dateStr) && a.period === period
    )
    return att?.status ?? '—'
  }

  function statusColor(status: string) {
    if (status === 'PRESENT') return 'text-emerald-600 font-semibold'
    if (status === 'LATE') return 'text-amber-600 font-semibold'
    if (status === 'ABSENT') return 'text-red-600 font-semibold'
    return 'text-gray-300'
  }

  // Build date range array
  function dateRange(): string[] {
    const dates: string[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(toDateStr(new Date(d)))
    }
    return dates
  }
  const dates = dateRange()
  const periodArr = Array.from({ length: periods }, (_, i) => i + 1)

  return (
    <AuthGuard allowedRoles={['ADMIN']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-100 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div>
              <button onClick={() => router.push(pluginMode ? '/plugins/wattanam.timetable/teachers' : '/admin/timetable/teachers')} className="text-indigo-600 text-sm hover:underline mb-1">← Back to Teachers</button>
              <h1 className="text-xl font-bold text-gray-800">Teacher Attendance</h1>
              <p className="text-sm text-gray-500">Based on timetable — QR scan or manual mark</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowQrModal(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700">
                📷 Scan QR
              </button>
              <button onClick={() => setShowMarkModal(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
                ✎ Manual Mark
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 font-medium">Timetable:</label>
              <select className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={selectedTT} onChange={e => {
                  setSelectedTT(e.target.value)
                  const tt = timetables.find(t => t.id === e.target.value)
                  if (tt) setPeriods(tt.periodsPerDay)
                }}>
                {timetables.map(tt => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">From:</label>
              <input type="date" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">To:</label>
              <input type="date" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <button onClick={fetchReport} className="px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg text-sm font-medium hover:bg-indigo-100">
              Refresh
            </button>
          </div>

          {/* Report grid */}
          <div className="flex-1 overflow-auto p-4">
            {loading ? (
              <div className="text-gray-400 text-center py-20">Loading…</div>
            ) : teachers.length === 0 ? (
              <div className="text-center py-20 text-gray-400">No teachers in this timetable yet.</div>
            ) : (
              <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr className="bg-indigo-700 text-white">
                      <th className="border border-indigo-800 px-3 py-2 text-left sticky left-0 bg-indigo-700 min-w-[140px]">Teacher</th>
                      {dates.map(d => (
                        <th key={d} colSpan={periodArr.length}
                          className="border border-indigo-800 px-2 py-2 text-center min-w-[80px]">
                          {d}
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-indigo-600 text-white">
                      <th className="border border-indigo-700 px-3 py-1 text-left sticky left-0 bg-indigo-600" />
                      {dates.flatMap(d =>
                        periodArr.map(p => (
                          <th key={`${d}_${p}`} className="border border-indigo-700 px-1 py-1 text-center font-normal">
                            P{p}
                          </th>
                        ))
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50 even:bg-gray-50/30">
                        <td className="border border-gray-200 px-3 py-2 font-medium sticky left-0 bg-white">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color ?? '#22c55e' }} />
                            {t.lastName} {t.firstName}
                            <span className="text-gray-400 font-normal">({t.short})</span>
                          </div>
                        </td>
                        {dates.flatMap(d =>
                          periodArr.map(p => {
                            const status = getStatus(t, d, p)
                            return (
                              <td key={`${d}_${p}`} className="border border-gray-200 px-1 py-1 text-center">
                                <span className={`text-[10px] ${statusColor(status)}`}>
                                  {status === '—' ? '—' : status.slice(0, 1)}
                                </span>
                              </td>
                            )
                          })
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Legend */}
                <div className="px-4 py-2 border-t border-gray-100 flex gap-4 text-xs text-gray-500">
                  <span><span className="font-semibold text-emerald-600">P</span> = Present</span>
                  <span><span className="font-semibold text-amber-600">L</span> = Late</span>
                  <span><span className="font-semibold text-red-600">A</span> = Absent</span>
                  <span className="text-gray-300">— = Not recorded</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Manual mark modal */}
      {showMarkModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Manual Attendance Mark</h2>
              <button onClick={() => setShowMarkModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Teacher</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={markTeacherId} onChange={e => setMarkTeacherId(e.target.value)}>
                  <option value="">Select teacher</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.lastName} {t.firstName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
                <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={markDate} onChange={e => setMarkDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Period</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={markPeriod} onChange={e => setMarkPeriod(+e.target.value)}>
                  {periodArr.map(p => <option key={p} value={p}>Period {p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <div className="flex gap-3">
                  {['PRESENT','LATE','ABSENT'].map(s => (
                    <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="mark-status" value={s} checked={markStatus === s} onChange={() => setMarkStatus(s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowMarkModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={handleMark} disabled={saving || !markTeacherId}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Mark'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Scan modal */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Scan Teacher QR Code</h2>
              <button onClick={() => { setShowQrModal(false); setScanResult(null); setQrInput('') }}
                className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-500">Point a QR scanner at the teacher's QR code, or paste the code below.</p>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Period</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={qrPeriod} onChange={e => setQrPeriod(+e.target.value)}>
                  {periodArr.map(p => <option key={p} value={p}>Period {p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">QR Code</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={qrInput} onChange={e => setQrInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleScanQr() }}
                  placeholder="Scan or paste QR code here…"
                  autoFocus />
              </div>
              {scanResult && (
                <div className={`px-3 py-2 rounded-lg text-sm font-medium ${scanResult.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {scanResult}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => { setShowQrModal(false); setScanResult(null); setQrInput('') }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">Close</button>
              <button onClick={handleScanQr} disabled={scanning || !qrInput.trim()}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40">
                {scanning ? 'Scanning…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthGuard>
  )
}
