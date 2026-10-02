"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'
import Sidebar from '../../components/Sidebar'
import AuthGuard from '../../components/AuthGuard'
import { accounterNav } from '../../lib/accounter-nav'
import { apiFetch } from '../../lib/api'
import { todayCambodia } from '../../lib/dateUtils'
import { useInstallationCurrency } from '../../lib/installation'
import { formatMoneyMajor } from '../../lib/formatMoney'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudentInfo {
  id: string
  name: string
  class: string
  studentNumber: string
}

interface FeePayment {
  id: string
  amount: number
  date: string
  note?: string
  createdBy?: string
}

interface FeeRecord {
  id: string
  studentId: string
  studentName: string
  studentNumber?: string
  class: string
  totalAmount: number
  discount: number
  discountReason: string
  effectiveAmount: number
  paidAmount: number
  dueDate: string
  term: string
  subject: string
  feeClass: string
  notes?: string
  payments: FeePayment[]
}

type FeeStatus = 'all' | 'paid' | 'partial' | 'pending' | 'overdue'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatus(r: FeeRecord): 'paid' | 'partial' | 'pending' | 'overdue' {
  const balance = r.effectiveAmount - r.paidAmount
  if (balance <= 0) return 'paid'
  if (new Date(r.dueDate) < new Date() && balance > 0) return 'overdue'
  if (r.paidAmount > 0) return 'partial'
  return 'pending'
}

// Set synchronously at the top of AccounterDashboard's render (not in an effect) so every
// sibling component below it in the same render pass -- PaymentModal, InvoiceModal, etc. --
// sees the current value the moment it's known, not one render behind.
let currentCurrency = 'USD'
function fmt(n: number) { return formatMoneyMajor(n, currentCurrency) }

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-gray-900 text-white',
  partial: 'bg-gray-200 text-gray-700',
  pending: 'bg-gray-100 text-gray-600',
  overdue: 'bg-red-500 text-white',
}
const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', pending: 'Pending', overdue: 'Overdue',
}

// ─── QR Scanner Modal ─────────────────────────────────────────────────────────

function QRScannerModal({ records, students, onClose, onPayRecord, onStudentNotFound }: {
  records: FeeRecord[]
  students: StudentInfo[]
  onClose: () => void
  onPayRecord: (r: FeeRecord) => void
  onStudentNotFound: (student: StudentInfo) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const camIdxRef = useRef(0)
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('Starting camera…')
  const [loadingStudent, setLoadingStudent] = useState<{ name: string; allPaid: boolean } | null>(null)
  const cancelledRef = useRef(false)
  const processingRef = useRef(false)

  // Keep ref current so stale closures inside decodeFromVideoDevice always
  // read the latest props/state values.
  const recordsRef = useRef(records)
  const studentsRef = useRef(students)
  useEffect(() => { recordsRef.current = records }, [records])
  useEffect(() => { studentsRef.current = students }, [students])

  const beep = useCallback((ok: boolean) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(ok ? 880 : 300, ctx.currentTime)
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25)
    } catch { /* ignore */ }
  }, [])

  const startCamera = useCallback(async (cams: MediaDeviceInfo[]) => {
    const videoEl = videoRef.current
    if (!videoEl || cancelledRef.current) return
    try {
      if (readerRef.current) { readerRef.current.reset(); readerRef.current = null }
      videoEl.pause()
      if (videoEl.srcObject) {
        (videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop())
        videoEl.srcObject = null
      }
      await new Promise(r => setTimeout(r, 300))
      if (cancelledRef.current) return
      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader
      reader.timeBetweenDecodingAttempts = 150
      let devs = cams
      if (devs.length === 0) {
        devs = await reader.listVideoInputDevices()
        devs.sort((a, b) => (/back|rear|environment/i.test(a.label) ? 0 : 1) - (/back|rear|environment/i.test(b.label) ? 0 : 1))
        if (!cancelledRef.current) setCameras(devs)
      }
      if (cancelledRef.current) return
      const idx = camIdxRef.current
      const deviceId = devs.length > 0 && idx < devs.length ? devs[idx].deviceId : undefined
      await reader.decodeFromVideoDevice(deviceId || null, videoEl, (result) => {
        if (!cancelledRef.current && result) handleScannedRef.current(result.getText())
      })
      if (!cancelledRef.current) { setScanning(true); setMessage('Camera ready — scan student ID card') }
    } catch (err: any) {
      if (!cancelledRef.current) setMessage('Camera error: ' + (err?.message ?? 'Permission denied'))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    startCamera([])
    return () => {
      cancelledRef.current = true
      if (readerRef.current) { readerRef.current.reset(); readerRef.current = null }
      const v = videoRef.current
      if (v?.srcObject) { (v.srcObject as MediaStream).getTracks().forEach(t => t.stop()); v.srcObject = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScanned(text: string) {
    if (processingRef.current) return   // ignore while loading/transitioning

    // Guard: data not yet loaded
    if (recordsRef.current.length === 0 && studentsRef.current.length === 0) {
      beep(false)
      setMessage('Fee data is loading — please wait a moment and try again')
      return
    }

    let studentId: string | null = null
    try { const p = JSON.parse(text); studentId = p.studentId ?? null } catch { studentId = text.trim() }
    if (!studentId) { beep(false); setMessage('Invalid QR — not a student card'); return }

    const hits = recordsRef.current.filter(r => r.studentId === studentId || r.studentNumber === studentId)
    if (hits.length === 0) {
      // No fee records — look up student to offer quick-create
      const student = studentsRef.current.find(s => s.id === studentId || s.studentNumber === studentId)
      if (student) {
        beep(true)
        processingRef.current = true
        setLoadingStudent({ name: student.name, allPaid: false })
        setMessage('')
        setTimeout(() => {
          if (cancelledRef.current) return
          processingRef.current = false
          onStudentNotFound(student)
          onClose()
        }, 600)
      } else {
        beep(false)
        setMessage('Student not found — check card or register student first')
        console.warn('[QR Scan] studentId not in records or students:', studentId,
          '| records:', recordsRef.current.length, '| students:', studentsRef.current.length)
      }
      return
    }

    beep(true)
    processingRef.current = true

    const unpaid = hits
      .filter(r => r.effectiveAmount - r.paidAmount > 0)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

    setLoadingStudent({ name: hits[0].studentName, allPaid: unpaid.length === 0 })
    setMessage('')

    if (unpaid.length > 0) {
      // Show "loading" overlay → open payment form after brief delay
      setTimeout(() => {
        if (cancelledRef.current) return
        processingRef.current = false
        onPayRecord(unpaid[0])
        onClose()
      }, 700)
    } else {
      // All fees already paid — show confirmation then reset
      setTimeout(() => {
        if (cancelledRef.current) return
        setLoadingStudent(null)
        processingRef.current = false
        setMessage('All fees paid ✓ — scan next student')
      }, 2000)
    }
  }

  // Stable ref so the decodeFromVideoDevice callback always calls the latest handleScanned
  const handleScannedRef = useRef(handleScanned)
  useEffect(() => { handleScannedRef.current = handleScanned })

  function switchCamera() {
    const next = (camIdxRef.current + 1) % Math.max(cameras.length, 1)
    camIdxRef.current = next
    setLoadingStudent(null)
    processingRef.current = false
    setMessage('Switching camera…')
    startCamera(cameras)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Scan Student ID Card</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {records.length > 0 ? `${records.length} fee record${records.length > 1 ? 's' : ''} loaded — scan to pay` : 'Loading fee data…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cameras.length > 1 && (
              <button onClick={switchCamera} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition" title="Switch camera">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Camera viewport */}
        <div className="relative bg-black" style={{ aspectRatio: '4/3' }}>
          <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />

          {/* Scan guide corners — hidden while loading overlay is shown */}
          {!loadingStudent && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-52 h-52">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-white rounded-tl-md" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-white rounded-tr-md" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-white rounded-bl-md" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white rounded-br-md" />
                {scanning && <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-400" style={{ animation: 'scanLine 2s linear infinite' }} />}
              </div>
            </div>
          )}

          {/* Loading / success overlay — shown after successful scan */}
          {loadingStudent && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75">
              {loadingStudent.allPaid ? (
                /* All-paid state */
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
                    <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-semibold text-base">{loadingStudent.name}</p>
                    <p className="text-emerald-400 text-sm mt-1">All fees paid ✓</p>
                  </div>
                </>
              ) : (
                /* Loading-payment state */
                <>
                  <div className="relative w-16 h-16">
                    <div className="w-16 h-16 rounded-full border-4 border-white/20 border-t-emerald-400 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-semibold text-base">{loadingStudent.name}</p>
                    <p className="text-gray-300 text-sm mt-1">Opening fee form…</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Status message bar */}
          {message && !loadingStudent && (
            <div className="absolute bottom-3 inset-x-3 flex justify-center">
              <span className="bg-black/70 text-white text-xs px-4 py-2 rounded-full">{message}</span>
            </div>
          )}
        </div>

        <style>{`@keyframes scanLine { 0%,100% { top:0 } 50% { top:calc(100% - 2px) } }`}</style>
      </div>
    </div>
  )
}

// ─── Payment Modal ────────────────────────────────────────────────────────────

function PaymentModal({ record, onClose, onSave }: {
  record: FeeRecord
  onClose: () => void
  onSave: (id: string, amount: number, note: string) => void
}) {
  const balance = record.effectiveAmount - record.paidAmount
  const [amount, setAmount] = useState(balance.toString())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseFloat(amount)
    if (isNaN(n) || n <= 0) { setError('Enter a valid amount'); return }
    if (n > balance) { setError(`Cannot exceed balance (${fmt(balance)})`); return }
    onSave(record.id, n, note); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Record Payment</h2>
          <p className="text-sm text-gray-500 mt-0.5">{record.studentName} — {record.class}</p>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-gray-400">Net Due</p>
              <p className="font-semibold text-gray-900">{fmt(record.effectiveAmount)}</p>
              {record.discount > 0 && <p className="text-xs text-emerald-600">Discount: {fmt(record.discount)}</p>}
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-gray-400">Balance</p>
              <p className="font-semibold text-red-600">{fmt(balance)}</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
              <input type="number" min="1" max={balance} step="0.01" value={amount}
                onChange={e => { setAmount(e.target.value); setError('') }}
                className="w-full pl-7 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Cash payment"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {record.payments.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Payment History</p>
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {record.payments.map(p => (
                  <div key={p.id} className="flex justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-gray-500">{p.date}</span>
                    <span className="font-semibold text-gray-900">{fmt(p.amount)}</span>
                    {p.note && <span className="text-gray-400 truncate max-w-[80px]">{p.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition">Confirm Payment</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Invoice Modal ────────────────────────────────────────────────────────────

function InvoiceModal({ record, onClose }: { record: FeeRecord; onClose: () => void }) {
  const status = getStatus(record)
  const balance = record.effectiveAmount - record.paidAmount
  const invoiceNo = record.id.slice(-8).toUpperCase()
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  // Load invoice settings
  const [inv, setInv] = useState({
    schoolName: 'Wattaman School',
    schoolAddress: '',
    schoolPhone: '',
    schoolEmail: '',
    invoiceTitle: 'INVOICE',
    invoiceSubtitle: 'Student Fee Receipt',
    invoiceFooter: 'This is a computer-generated invoice. No signature required.',
  })
  useEffect(() => {
    apiFetch('/api/fees/settings').then(r => r.ok ? r.json() : null).then(s => { if (s) setInv(s) }).catch(() => {})
  }, [])

  function handlePrint() {
    const content = document.getElementById('accounter-invoice-content')
    if (!content) return
    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Fee Invoice – ${record.studentName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;background:#fff;padding:48px 56px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}.school-name{font-size:22px;font-weight:700}.invoice-label{font-size:26px;font-weight:800;text-align:right}.invoice-meta{text-align:right;font-size:12px;color:#666;margin-top:2px}
hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.info-box{background:#f9fafb;border-radius:10px;padding:14px 16px}.info-box label{font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px}.info-box span{font-size:14px;font-weight:600}
table{width:100%;border-collapse:collapse;margin-bottom:16px}thead tr{background:#f3f4f6}th{text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase}th.right,td.right{text-align:right}td{padding:10px 12px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6}
.totals{width:280px;margin-left:auto}.totals-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:#374151}.totals-row.bold{font-weight:700;font-size:15px;border-top:2px solid #111;padding-top:10px;margin-top:4px}
.stamp{display:inline-block;border:3px solid;border-radius:8px;padding:6px 18px;font-size:18px;font-weight:800;letter-spacing:2px;text-transform:uppercase;transform:rotate(-5deg)}.stamp.paid{color:#059669;border-color:#059669}.stamp.partial{color:#d97706;border-color:#d97706}
.footer{margin-top:48px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center}
</style></head><body>${content.innerHTML}</body></html>`)
    win.document.close(); win.focus(); setTimeout(() => win.print(), 400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Fee Invoice</h2>
            <p className="text-sm text-gray-400">Preview before printing</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
              Print
            </button>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-6">
          <div id="accounter-invoice-content" className="bg-white rounded-xl border border-gray-200 p-8 text-sm">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-xl font-bold text-gray-900">{inv.schoolName}</p>
                {inv.schoolAddress && <p className="text-[11px] text-gray-400 mt-0.5">{inv.schoolAddress}</p>}
                {(inv.schoolPhone || inv.schoolEmail) && <p className="text-[11px] text-gray-400">{[inv.schoolPhone, inv.schoolEmail].filter(Boolean).join(' · ')}</p>}
                <p className="text-xs text-gray-400 mt-0.5">{inv.invoiceSubtitle}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{inv.invoiceTitle}</p>
                <p className="text-xs text-gray-500 mt-1">No: #{invoiceNo}</p>
                <p className="text-xs text-gray-500">Date: {today}</p>
              </div>
            </div>
            <hr className="border-gray-200 mb-5" />
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-gray-50 rounded-xl p-3.5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill To</p>
                <p className="font-semibold text-gray-900">{record.studentName}</p>
                <p className="text-xs text-gray-500">Class: {record.feeClass || record.class}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3.5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Fee Details</p>
                {record.subject && <p className="text-xs text-gray-600">Subject: <span className="font-medium text-gray-900">{record.subject}</span></p>}
                <p className="text-xs text-gray-600">Term: <span className="font-medium text-gray-900">{record.term || '—'}</span></p>
                <p className="text-xs text-gray-600">Due Date: <span className="font-medium text-gray-900">{record.dueDate}</span></p>
                {record.notes && <p className="text-xs text-gray-600 mt-0.5">Note: {record.notes}</p>}
              </div>
            </div>
            <table className="w-full text-xs mb-4 border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left px-3 py-2 rounded-tl-lg text-gray-500 font-semibold uppercase tracking-wider">Description</th>
                  <th className="text-right px-3 py-2 rounded-tr-lg text-gray-500 font-semibold uppercase tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-2.5 text-gray-700">{record.subject ? record.subject : 'School Fee'}{record.term ? ` – ${record.term}` : ''}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-gray-900">{fmt(record.totalAmount)}</td>
                </tr>
                {record.discount > 0 && (
                  <tr className="border-b border-gray-100">
                    <td className="px-3 py-2.5 text-emerald-600">Discount{record.discountReason ? ` — ${record.discountReason}` : ''}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-emerald-600">−{fmt(record.discount)}</td>
                  </tr>
                )}
                {record.discount > 0 && (
                  <tr>
                    <td className="px-3 py-2 text-gray-500 font-semibold text-[11px] uppercase tracking-wide">Net Amount Due</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900">{fmt(record.effectiveAmount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {record.payments.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment History</p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-3 py-2 text-gray-500 font-semibold">#</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-semibold">Date</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-semibold">Note</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.payments.map((p, i) => (
                      <tr key={p.id} className="border-b border-gray-100">
                        <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-2 text-gray-700">{p.date}</td>
                        <td className="px-3 py-2 text-gray-500">{p.note || '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-600">{fmt(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5">
                <div className="flex justify-between text-xs text-gray-600"><span>Total Amount</span><span className="font-medium text-gray-900">{fmt(record.totalAmount)}</span></div>
                {record.discount > 0 && (
                  <div className="flex justify-between text-xs text-emerald-600">
                    <span>Discount{record.discountReason ? ` (${record.discountReason})` : ''}</span>
                    <span className="font-medium">−{fmt(record.discount)}</span>
                  </div>
                )}
                {record.discount > 0 && (
                  <div className="flex justify-between text-xs text-gray-700 border-t border-gray-100 pt-1.5">
                    <span className="font-semibold">Net Due</span><span className="font-semibold">{fmt(record.effectiveAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-emerald-600"><span>Total Paid</span><span className="font-semibold">{fmt(record.paidAmount)}</span></div>
                <div className={`flex justify-between text-sm font-bold border-t border-gray-200 pt-2 mt-1 ${balance === 0 ? 'text-gray-400' : 'text-red-500'}`}>
                  <span>Balance Due</span><span>{fmt(balance)}</span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              {status === 'paid' && <span className="inline-block border-2 border-emerald-500 text-emerald-500 font-extrabold text-base tracking-widest uppercase px-4 py-1.5 rounded-lg rotate-[-4deg]">PAID</span>}
              {status === 'partial' && <span className="inline-block border-2 border-amber-500 text-amber-500 font-extrabold text-base tracking-widest uppercase px-4 py-1.5 rounded-lg rotate-[-4deg]">PARTIAL</span>}
            </div>
            <hr className="border-gray-100 mt-6 mb-3" />
            <p className="text-center text-[10px] text-gray-400">{inv.invoiceFooter}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Fee Modal ────────────────────────────────────────────────────────────
// Standalone "Add Fee" form — lets the accounter create a fee record without
// needing to go through the QR scan flow.

function AddFeeModal({ students, onClose, onCreated }: {
  students: StudentInfo[]
  onClose: () => void
  onCreated: (record: FeeRecord) => void
}) {
  const today = todayCambodia()
  const [query, setQuery] = useState('')
  const [studentId, setStudentId] = useState('')
  const [showDrop, setShowDrop] = useState(false)
  const [totalAmount, setTotalAmount] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [subject, setSubject] = useState('')
  const [feeClass, setFeeClass] = useState('')
  const [dueDate, setDueDate] = useState(today)
  const [term, setTerm] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Discount presets from settings
  const [presets, setPresets] = useState<{ id: string; name: string; type: 'percent' | 'fixed'; value: number }[]>([])
  useEffect(() => {
    apiFetch('/api/fees/settings').then(r => r.ok ? r.json() : null).then(s => { if (s?.discountPresets?.length) setPresets(s.discountPresets) }).catch(() => {})
  }, [])

  const total = parseFloat(totalAmount) || 0
  const disc = parseFloat(discount) || 0
  const effective = Math.max(0, total - disc)

  const filtered = query.trim()
    ? students.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.class.toLowerCase().includes(query.toLowerCase())
      )
    : students.slice(0, 80)

  function applyPreset(p: { type: 'percent' | 'fixed'; value: number; name: string }) {
    const flat = p.type === 'percent' ? Math.round(total * p.value / 100 * 100) / 100 : p.value
    setDiscount(flat.toString())
    setDiscountReason(p.name)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!studentId) { setError('Select a student first'); return }
    const n = parseFloat(totalAmount)
    if (isNaN(n) || n <= 0) { setError('Enter a valid amount'); return }
    if (disc < 0) { setError('Discount cannot be negative'); return }
    if (disc > n) { setError('Discount cannot exceed total amount'); return }
    setSaving(true); setError('')
    try {
      const res = await apiFetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          totalAmount: n,
          discount: disc || undefined,
          discountReason: discountReason.trim() || undefined,
          subject: subject.trim() || undefined,
          feeClass: feeClass.trim() || undefined,
          dueDate,
          term: term.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        onCreated(created)
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.message ?? 'Failed to create fee record')
      }
    } catch { setError('Network error — please try again') }
    finally { setSaving(false) }
  }

  const selectedStudent = students.find(s => s.id === studentId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Add Fee Record</h2>
          <p className="text-sm text-gray-500 mt-0.5">Create a new student fee record</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Student search */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Student <span className="text-red-500">*</span></label>
            {selectedStudent ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-emerald-900">{selectedStudent.name}</p>
                  <p className="text-xs text-emerald-700">{selectedStudent.class}</p>
                </div>
                <button type="button" onClick={() => { setStudentId(''); setQuery('') }}
                  className="text-emerald-500 hover:text-emerald-700 text-xs underline">Change</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <input type="text" value={query} autoFocus
                    onChange={e => { setQuery(e.target.value); setShowDrop(true); setError('') }}
                    onFocus={() => setShowDrop(true)}
                    onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                    placeholder="Search by name or class…"
                    autoComplete="off"
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                {showDrop && (
                  <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <li className="px-4 py-3 text-sm text-gray-400">No students found</li>
                    ) : filtered.map(s => (
                      <li key={s.id} onMouseDown={() => { setStudentId(s.id); setQuery(''); setShowDrop(false) }}
                        className="flex items-center justify-between px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50 transition">
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{s.class}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Subject + Class row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject / Lesson</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Math, English"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class (optional)</label>
              <input type="text" value={feeClass} onChange={e => setFeeClass(e.target.value)}
                placeholder="e.g. Class A"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
              <input type="number" min="1" step="0.01" value={totalAmount}
                onChange={e => { setTotalAmount(e.target.value); setError('') }}
                placeholder="0.00"
                className="w-full pl-7 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                required />
            </div>
          </div>

          {/* Discount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount ($)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
                <input type="number" min="0" step="0.01" value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)}
                placeholder="e.g. Scholarship"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>

          {/* Preset quick-apply */}
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <button type="button" key={p.id}
                  onClick={() => applyPreset(p)}
                  className="px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition">
                  {p.name} ({p.type === 'percent' ? `${p.value}%` : `$${p.value}`})
                </button>
              ))}
            </div>
          )}

          {/* Effective amount preview */}
          {disc > 0 && total > 0 && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 text-sm">
              <span className="text-emerald-700 font-medium">Net due after discount</span>
              <span className="font-bold text-emerald-800">{fmt(effective)}</span>
            </div>
          )}

          {/* Due date + term */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date <span className="text-red-500">*</span></label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
              <input type="text" value={term} onChange={e => setTerm(e.target.value)} placeholder="e.g. 2025-26"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Tuition fee"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition disabled:opacity-60">
              {saving ? 'Creating…' : 'Create Fee Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Quick Fee Modal ──────────────────────────────────────────────────────────
// Shown when a QR scan finds no existing fee record for the student.
// Creates a new fee record then auto-opens the payment form.

function QuickFeeModal({ student, onClose, onCreated }: {
  student: StudentInfo
  onClose: () => void
  onCreated: (record: FeeRecord) => void
}) {
  const today = todayCambodia()
  const [totalAmount, setTotalAmount] = useState('')
  const [discount, setDiscount] = useState('')
  const [dueDate, setDueDate] = useState(today)
  const [term, setTerm] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const total = parseFloat(totalAmount) || 0
  const disc = Math.min(100, Math.max(0, parseFloat(discount) || 0))
  const effective = total * (1 - disc / 100)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseFloat(totalAmount)
    if (isNaN(n) || n <= 0) { setError('Enter a valid amount'); return }
    setSaving(true); setError('')
    try {
      const res = await apiFetch('/api/fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          totalAmount: n,
          discount: disc > 0 ? Math.round(n * disc / 100 * 100) / 100 : undefined,
          dueDate,
          term: term.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        onCreated(created)
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.message ?? 'Failed to create fee record')
      }
    } catch { setError('Network error — please try again') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Create Fee Record</h2>
          <p className="text-sm text-gray-500 mt-0.5">No existing fee for this student — create one to proceed</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Student info (read-only) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Student</p>
              <p className="text-sm font-semibold text-gray-900 truncate">{student.name}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Class</p>
              <p className="text-sm font-semibold text-gray-900">{student.class || '—'}</p>
            </div>
          </div>

          {/* Fee amount + discount row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Fee Amount <span className="text-red-500">*</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
                <input
                  type="number" min="1" step="0.01" value={totalAmount} autoFocus
                  onChange={e => { setTotalAmount(e.target.value); setError('') }}
                  placeholder="0.00"
                  className="w-full pl-7 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount %</label>
              <div className="relative">
                <input
                  type="number" min="0" max="100" step="0.1" value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  placeholder="0"
                  className="w-full pr-7 pl-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">%</span>
              </div>
            </div>
          </div>
          {/* Effective amount preview */}
          {disc > 0 && total > 0 && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 text-sm">
              <span className="text-emerald-700 font-medium">After {disc}% discount</span>
              <span className="font-bold text-emerald-800">{fmt(effective)}</span>
            </div>
          )}

          {/* Due date + term row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date <span className="text-red-500">*</span></label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
              <input type="text" value={term} onChange={e => setTerm(e.target.value)} placeholder="e.g. 2025-26"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Tuition fee"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition disabled:opacity-60">
              {saving ? 'Creating…' : 'Create & Pay'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accent }: { label: string; value: string; sub: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

function AccounterDashboard() {
  currentCurrency = useInstallationCurrency()
  const [records, setRecords] = useState<FeeRecord[]>([])
  const [students, setStudents] = useState<StudentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<FeeStatus>('all')
  const [paymentTarget, setPaymentTarget] = useState<FeeRecord | null>(null)
  const [printTarget, setPrintTarget] = useState<FeeRecord | null>(null)
  const [showQR, setShowQR] = useState(false)
  const [quickFeeStudent, setQuickFeeStudent] = useState<StudentInfo | null>(null)
  const [showAddFee, setShowAddFee] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [alertExpanded, setAlertExpanded] = useState(true)
  const autoPrintRef = useRef(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setAuthError(false)
    try {
      const [feeRes, studentsRes] = await Promise.all([
        apiFetch('/api/fees'),
        apiFetch('/api/fees/students'),
      ])
      if (feeRes.ok) {
        const data = await feeRes.json()
        setRecords(Array.isArray(data) ? data : data.records ?? [])
      } else if (feeRes.status === 401 || feeRes.status === 403) {
        setAuthError(true)
      }
      if (studentsRes.ok) {
        const data = await studentsRes.json()
        setStudents(Array.isArray(data) ? data : [])
      }
    } catch { /* network error — show empty */ } finally { setLoading(false) }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function handleRecordPayment(recordId: string, amount: number, note: string) {
    apiFetch(`/api/fees/${recordId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, note: note || undefined }),
    }).then(res => {
      if (res.ok) res.json().then(updated => {
        setRecords(prev => prev.map(r => r.id === updated.id ? updated : r))
        if (autoPrintRef.current) { autoPrintRef.current = false; setPrintTarget(updated) }
      })
      else {
        setRecords(prev => prev.map(r => {
          if (r.id !== recordId) return r
          const p: FeePayment = { id: Date.now().toString(), amount, date: todayCambodia(), note: note || undefined, createdBy: 'Accounter' }
          return { ...r, paidAmount: r.paidAmount + amount, payments: [...r.payments, p] }
        }))
      }
    }).catch(() => {
      setRecords(prev => prev.map(r => {
        if (r.id !== recordId) return r
        const p: FeePayment = { id: Date.now().toString(), amount, date: todayCambodia(), note: note || undefined, createdBy: 'Accounter' }
        return { ...r, paidAmount: r.paidAmount + amount, payments: [...r.payments, p] }
      }))
    })
    showToast('Payment recorded successfully')
  }

  const filtered = useMemo(() => records.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (!r.studentName.toLowerCase().includes(q) && !r.class.toLowerCase().includes(q)) return false
    }
    if (statusFilter !== 'all' && getStatus(r) !== statusFilter) return false
    return true
  }), [records, search, statusFilter])

  function handleExport() {
    const escape = (v: string | number) => { const s = String(v); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s }
    const rows = [
      ['Student Name', 'Class', 'Subject', 'Amount', 'Discount', 'Discount Reason', 'Net Due', 'Paid', 'Balance', 'Due Date', 'Status', 'Term'],
      ...filtered.map(r => {
        const st = getStatus(r); const bal = r.effectiveAmount - r.paidAmount
        return [r.studentName, r.feeClass || r.class, r.subject, r.totalAmount, r.discount, r.discountReason, r.effectiveAmount, r.paidAmount, bal, r.dueDate, STATUS_LABEL[st], r.term]
      }),
    ]
    const csv = '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `fee-report-${todayCambodia()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // Stats
  const totalRevenue   = records.reduce((s, r) => s + r.paidAmount, 0)
  const pendingAmount  = records.reduce((s, r) => s + Math.max(0, r.effectiveAmount - r.paidAmount), 0)
  const paidCount      = records.filter(r => getStatus(r) === 'paid').length
  const collectionRate = records.length > 0 ? Math.round((paidCount / records.length) * 100) : 0
  const overdueRecords = records.filter(r => getStatus(r) === 'overdue').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  const partialRecords = records.filter(r => getStatus(r) === 'partial')
  const pendingRecords = records.filter(r => getStatus(r) === 'pending')
  const unpaidCount    = overdueRecords.length + partialRecords.length + pendingRecords.length

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Auth error — session expired or no permission */}
        {authError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Session Expired</h2>
            <p className="text-sm text-gray-500 mb-6 max-w-sm">
              Your login session has expired or you do not have permission to access fee data.<br />Please log in again.
            </p>
            <a href="/login" className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition">
              Go to Login
            </a>
          </div>
        )}

        {!authError && (<>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Fee Dashboard</h1>
              <p className="text-sm text-gray-500 mt-0.5">Record payments and print invoices</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowQR(true)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm9-9h.01M12 12h3m0 0v3m0-3h3M15 15h3m0 0v3m-3 0h3" /></svg>
                {loading ? 'Loading…' : 'Scan QR'}
              </button>
              <button
                onClick={() => setShowAddFee(true)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 shadow-sm transition disabled:opacity-50">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Add Fee
              </button>
              <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 shadow-sm transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                Export CSV
              </button>
            </div>
          </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Total Collected" value={fmt(totalRevenue)} sub="Payments received" accent="bg-emerald-50"
            icon={<svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>} />
          <StatCard label="Pending Amount" value={fmt(pendingAmount)} sub="Yet to collect" accent="bg-amber-50"
            icon={<svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
          <StatCard label="Fully Paid" value={`${paidCount}`} sub={`of ${records.length} students`} accent="bg-blue-50"
            icon={<svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>} />
          <StatCard label="Collection Rate" value={`${collectionRate}%`} sub="Payment completion" accent="bg-purple-50"
            icon={<svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>} />
        </div>

        {/* Unpaid Alert */}
        {!loading && unpaidCount > 0 && (
          <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden border-l-4 ${
            overdueRecords.length > 0 ? 'border-l-red-500 border-red-100' : 'border-l-amber-400 border-amber-100'
          }`}>
            {/* Header row */}
            <button
              onClick={() => setAlertExpanded(x => !x)}
              className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-50/60 transition text-left">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                overdueRecords.length > 0 ? 'bg-red-100' : 'bg-amber-100'
              }`}>
                <svg className={`w-4 h-4 ${overdueRecords.length > 0 ? 'text-red-500' : 'text-amber-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </span>
              <div className="flex items-center gap-3 flex-1 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">
                  {unpaidCount} student{unpaidCount !== 1 ? 's' : ''} with unpaid fees
                </span>
                <span className="flex gap-2 text-xs">
                  {overdueRecords.length > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-semibold">{overdueRecords.length} Overdue</span>}
                  {partialRecords.length > 0 && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold">{partialRecords.length} Partial</span>}
                  {pendingRecords.length > 0 && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-semibold">{pendingRecords.length} Pending</span>}
                </span>
                <span className="ml-auto text-xs text-gray-400 hidden sm:block">{fmt(pendingAmount)} outstanding</span>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${alertExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded list — overdue students */}
            {alertExpanded && (
              <div className="border-t border-gray-100">
                {overdueRecords.length > 0 && (
                  <div>
                    <div className="px-6 py-2 bg-red-50 flex items-center justify-between">
                      <span className="text-xs font-bold text-red-600 uppercase tracking-wider">Overdue</span>
                      <button onClick={() => setStatusFilter('overdue')} className="text-xs text-red-500 hover:underline">Filter table →</button>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {overdueRecords.map(r => {
                        const daysLate = Math.floor((Date.now() - new Date(r.dueDate).getTime()) / 86400000)
                        const balance  = r.effectiveAmount - r.paidAmount
                        return (
                          <div key={r.id} className="px-6 py-3 flex items-center gap-3 hover:bg-red-50/40 transition">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{r.studentName}</p>
                              <p className="text-xs text-gray-400">{r.class} · {daysLate}d overdue</p>
                            </div>
                            <span className="text-sm font-bold text-red-600 shrink-0">{fmt(balance)}</span>
                            <button onClick={() => setPaymentTarget(r)}
                              className="px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition shrink-0">
                              Pay
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {(partialRecords.length > 0 || pendingRecords.length > 0) && (
                  <div className="px-6 py-3 bg-gray-50 flex items-center gap-4 border-t border-gray-100">
                    {partialRecords.length > 0 && (
                      <button onClick={() => setStatusFilter('partial')} className="text-xs text-amber-700 font-medium hover:underline">
                        View {partialRecords.length} partial →
                      </button>
                    )}
                    {pendingRecords.length > 0 && (
                      <button onClick={() => setStatusFilter('pending')} className="text-xs text-gray-600 font-medium hover:underline">
                        View {pendingRecords.length} pending →
                      </button>
                    )}
                    <button onClick={() => setStatusFilter('all')} className="text-xs text-gray-400 hover:underline ml-auto">
                      Show all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Fee Records Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Fee Records</h2>
              <p className="text-sm text-gray-400">Click "Pay" to record a payment • "Invoice" to print</p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…"
                  className="pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 w-48" />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FeeStatus)}
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
                <option value="all">All Status</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="pending">Pending</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">No records found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Class</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Term</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Net Due</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(r => {
                    const status = getStatus(r)
                    const balance = r.effectiveAmount - r.paidAmount
                    return (
                      <tr key={r.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900">{r.studentName}</td>
                        <td className="px-4 py-4 text-gray-600">{r.feeClass || r.class || '—'}</td>
                        <td className="px-4 py-4 text-gray-600">{r.subject || '—'}</td>
                        <td className="px-4 py-4 text-gray-500">{r.term || '—'}</td>
                        <td className="px-4 py-4 text-right">
                          <span className="text-gray-700">{fmt(r.effectiveAmount)}</span>
                          {r.discount > 0 && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700" title={r.discountReason || 'Discount'}>
                              -{fmt(r.discount)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right text-emerald-600 font-medium">{fmt(r.paidAmount)}</td>
                        <td className={`px-4 py-4 text-right font-medium ${balance === 0 ? 'text-gray-400' : 'text-red-500'}`}>{fmt(balance)}</td>
                        <td className={`px-4 py-4 ${status === 'overdue' ? 'text-red-500 font-medium' : 'text-gray-600'}`}>{r.dueDate}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[status]}`}>
                            {STATUS_LABEL[status]}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            {balance > 0 && (
                              <button onClick={() => setPaymentTarget(r)}
                                className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition">
                                Pay
                              </button>
                            )}
                            {r.paidAmount > 0 && (
                              <button onClick={() => setPrintTarget(r)}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Print Invoice">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between text-xs text-gray-500">
              <span>Showing {filtered.length} of {records.length} records</span>
              <div className="flex gap-4">
                <span>Net billed: <span className="font-semibold text-gray-700">{fmt(filtered.reduce((s, r) => s + r.effectiveAmount, 0))}</span></span>
                <span>Collected: <span className="font-semibold text-emerald-600">{fmt(filtered.reduce((s, r) => s + r.paidAmount, 0))}</span></span>
                <span>Outstanding: <span className="font-semibold text-red-500">{fmt(filtered.reduce((s, r) => s + Math.max(0, r.effectiveAmount - r.paidAmount), 0))}</span></span>
              </div>
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* Modals */}
      {showAddFee && (
        <AddFeeModal
          students={students}
          onClose={() => setShowAddFee(false)}
          onCreated={record => {
            setRecords(prev => [record, ...prev])
            setShowAddFee(false)
            setPaymentTarget(record)
          }}
        />
      )}
      {showQR && (
        <QRScannerModal
          records={records}
          students={students}
          onClose={() => setShowQR(false)}
          onPayRecord={r => setPaymentTarget(r)}
          onStudentNotFound={student => { setQuickFeeStudent(student); setShowQR(false) }}
        />
      )}
      {quickFeeStudent && (
        <QuickFeeModal
          student={quickFeeStudent}
          onClose={() => setQuickFeeStudent(null)}
          onCreated={record => {
            setRecords(prev => [record, ...prev])
            setQuickFeeStudent(null)
            autoPrintRef.current = true
            setPaymentTarget(record)
          }}
        />
      )}
      {paymentTarget && <PaymentModal record={paymentTarget} onClose={() => setPaymentTarget(null)} onSave={handleRecordPayment} />}
      {printTarget && <InvoiceModal record={printTarget} onClose={() => setPrintTarget(null)} />}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AccounterPage() {
  return (
    <AuthGuard allowedRoles={['ACCOUNTER', 'ADMIN']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Accounter" navItems={accounterNav} accentColor="emerald" />
        <AccounterDashboard />
      </div>
    </AuthGuard>
  )
}
