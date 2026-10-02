"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BrowserQRCodeReader } from '@zxing/library'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { wattamanNav } from '../../../lib/wattaman-nav'
import { apiFetch } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import { todayCambodia } from '../../../lib/dateUtils'
import { flushAttendanceQueue, getAttendanceNetworkMode, getQueuedAttendanceCount, queueAttendanceScan } from '../../../lib/offline-attendance'
import NetworkQualityBadge from '../../../components/NetworkQualityBadge'

interface ScanResult {
  action: string
  sessionType?: string
  studentId: string
  studentName: string
  studentPhoto: string | null
  className: string
  status: string
  session: number
  checkInTime: string | null
  message?: string
}

/* ─── helpers ─────────────────────────────────────────────── */
const statusMeta = (action: string, status: string) => {
  if (action === 'QUEUED')
    return { label: '📥 Saved Offline', bg: 'bg-cyan-600', cardBg: 'bg-cyan-50', ring: 'ring-cyan-300', text: 'text-cyan-700', flash: 'rgba(6,182,212,0.35)', bgLight: 'rgba(6,182,212,0.1)', textHex: '#0e7490' }
  if (action === 'ALREADY_RECORDED')
    return { label: '↩ Already Recorded', bg: 'bg-indigo-500', cardBg: 'bg-indigo-50', ring: 'ring-indigo-300', text: 'text-indigo-600', flash: 'rgba(99,102,241,0.4)', bgLight: 'rgba(99,102,241,0.1)', textHex: '#4338ca' }
  if (action === 'CHECK_OUT')
    return { label: '↑ Checked Out', bg: 'bg-blue-500', cardBg: 'bg-blue-50', ring: 'ring-blue-300', text: 'text-blue-600', flash: 'rgba(59,130,246,0.4)', bgLight: 'rgba(59,130,246,0.1)', textHex: '#1d4ed8' }
  if (status === 'LATE')
    return { label: '⚠️ Late', bg: 'bg-amber-500', cardBg: 'bg-amber-50', ring: 'ring-amber-300', text: 'text-amber-600', flash: 'rgba(251,191,36,0.35)', bgLight: 'rgba(245,158,11,0.12)', textHex: '#b45309' }
  if (status === 'DAY_OFF')
    return { label: '🌙 Day Off', bg: 'bg-slate-400', cardBg: 'bg-slate-100', ring: 'ring-slate-300', text: 'text-slate-500', flash: 'rgba(148,163,184,0.35)', bgLight: 'rgba(148,163,184,0.12)', textHex: '#64748b' }
  return { label: '✓ Checked In', bg: 'bg-emerald-500', cardBg: 'bg-emerald-50', ring: 'ring-emerald-300', text: 'text-emerald-600', flash: 'rgba(52,211,153,0.4)', bgLight: 'rgba(16,185,129,0.12)', textHex: '#047857' }
}

// Defined at module level so React never treats these as new types on re-render
function StudentProfileCard({ result }: { result: ScanResult }) {
  const meta = statusMeta(result.action, result.status)
  const isAlready = result.action === 'ALREADY_RECORDED'
  const timeDisplay = result.checkInTime
    ? formatCambodiaTime(result.checkInTime, true)
    : null
  return (
    <div className={`rounded-2xl overflow-hidden shadow-2xl ${meta.cardBg} ring-2 ${meta.ring}`}>
      {/* Status header */}
      <div className={`${meta.bg} px-4 py-2.5 flex items-center justify-between`}>
        <span className="text-white text-sm font-bold tracking-wide">{meta.label}</span>
        {result.session > 0 && (
          <span className="text-white/80 text-xs font-medium">Session {result.session}</span>
        )}
      </div>

      {/* Student info row */}
      <div className="flex items-center gap-4 px-4 pt-4 pb-3">
        <div className={`flex-shrink-0 ring-2 ${meta.ring} rounded-2xl shadow-md overflow-hidden`}>
          {result.studentPhoto ? (
            <img src={result.studentPhoto} alt={result.studentName}
              className="w-20 h-20 sm:w-24 sm:h-24 object-cover" />
          ) : (
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white flex items-center justify-center text-5xl">👤</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-slate-800 text-lg sm:text-xl leading-tight truncate">{result.studentName}</p>
          <p className="text-sm text-slate-500 truncate mt-0.5">{result.className}</p>
          {isAlready && <p className="text-xs text-indigo-500 font-medium mt-1">Already recorded — no duplicate</p>}
        </div>
      </div>

      {/* Prominent time badge */}
      {timeDisplay && (
        <div className="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ background: meta.bgLight }}>
          <div className="flex items-center gap-2">
            <span className="text-base">🕐</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {isAlready ? 'First scan time' : result.action === 'CHECK_OUT' ? 'Check-out time' : 'Check-in time'}
            </span>
          </div>
          <span className="text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight"
            style={{ color: meta.textHex }}>
            {timeDisplay}
          </span>
        </div>
      )}
    </div>
  )
}

function ScanSkeletonCard({ photo }: { photo?: string | null }) {
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl bg-white ring-2 ring-slate-200">
      <div className="bg-slate-300 px-4 py-2.5 h-10 animate-pulse" />
      <div className="flex items-center gap-4 p-4">
        <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex-shrink-0 overflow-hidden bg-slate-200 ${!photo ? 'animate-pulse' : ''}`}>
          {photo && <img src={photo} alt="" className="w-full h-full object-cover" />}
        </div>
        <div className="flex-1 space-y-2.5">
          <div className="h-5 bg-slate-300 rounded-lg animate-pulse w-3/4" />
          <div className="h-3 bg-slate-200 rounded-lg animate-pulse w-1/2" />
          <div className="h-3 bg-slate-200 rounded-lg animate-pulse w-2/5" />
        </div>
      </div>
    </div>
  )
}

function StudentScanZone({ isLandscape }: { isLandscape: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
      <div className={`relative ${
        isLandscape
          ? 'w-52 h-52 md:w-64 md:h-64'
          : 'w-[62vw] h-[62vw] max-w-xs max-h-[300px] sm:max-w-sm sm:max-h-[340px] md:max-w-md md:max-h-[380px]'
      }`}>
        <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
        <div className="absolute top-0 left-0 w-10 h-10 sm:w-12 sm:h-12 border-t-4 border-l-4 border-teal-400 rounded-tl-2xl" />
        <div className="absolute top-0 right-0 w-10 h-10 sm:w-12 sm:h-12 border-t-4 border-r-4 border-teal-400 rounded-tr-2xl" />
        <div className="absolute bottom-0 left-0 w-10 h-10 sm:w-12 sm:h-12 border-b-4 border-l-4 border-teal-400 rounded-bl-2xl" />
        <div className="absolute bottom-0 right-0 w-10 h-10 sm:w-12 sm:h-12 border-b-4 border-r-4 border-teal-400 rounded-br-2xl" />
        <div
          className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-teal-400 to-transparent drop-shadow-[0_0_6px_rgba(0,201,167,0.9)]"
          style={{ animation: 'scanLine 2s linear infinite' }}
        />
      </div>
    </div>
  )
}

function WattamanScanContent() {
  const router = useRouter()
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [lastResult, setLastResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [allCameras, setAllCameras] = useState<MediaDeviceInfo[]>([])
  const [currentCamIdx, setCurrentCamIdx] = useState(0)
  const [cameraLabel, setCameraLabel] = useState('')
  const [flashColor, setFlashColor] = useState<string | null>(null)
  const [hasTorch, setHasTorch] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([])
  const [scanCount, setScanCount] = useState(0)
  const [isLandscape, setIsLandscape] = useState(false)
  const [profileVisible, setProfileVisible] = useState(false)
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null)
  const [clockStr, setClockStr] = useState('')
  const [activeSession, setActiveSession] = useState<{ session: number; type: string; startTime: string; endTime: string; isActive: boolean; badge: 'Active' | 'Near' | 'Upcoming' } | null>(null)
  const [editSessionOpen, setEditSessionOpen] = useState(false)
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [configRefreshTick, setConfigRefreshTick] = useState(0)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  /* ── Unknown-card linking modal (lets admin link a printed card to a current student) ── */
  const [linkCardQr, setLinkCardQr] = useState<string | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<Array<{ id: string; studentNumber: string | null; photo: string | null; user: { name: string; photo: string | null }; class: { name: string } | null }>>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null)
  const allCamerasRef = useRef<MediaDeviceInfo[]>([])
  const currentCamIdxRef = useRef(0)
  const lockRef = useRef(false)
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const torchTrackRef = useRef<MediaStreamTrack | null>(null)
  const photoCacheRef = useRef<Map<string, string>>(new Map())
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recentCodesRef = useRef<Map<string, number>>(new Map())
  const autoResetRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionConfigsRef = useRef<Array<{ session: number; type: string; startTime: string; endTime: string }>>([])

  /* ── orientation detection ── */
  useEffect(() => {
    const check = () =>
      setIsLandscape(window.matchMedia('(orientation: landscape) and (min-width: 600px)').matches)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  /* ── GPS ── */
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const watchId = navigator.geolocation.watchPosition(
      pos => { locationRef.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude } },
      () => { locationRef.current = null },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  /* ── durable offline queue ── */
  useEffect(() => {
    let mounted = true
    const sync = async () => {
      try {
        const result = await flushAttendanceQueue()
        if (mounted) setPendingSyncCount(result.pending)
      } catch { /* IndexedDB unavailable — normal online scanning still works */ }
    }
    getQueuedAttendanceCount().then(count => { if (mounted) setPendingSyncCount(count) }).catch(() => {})
    sync()
    window.addEventListener('online', sync)
    const interval = setInterval(sync, 30_000)
    return () => { mounted = false; window.removeEventListener('online', sync); clearInterval(interval) }
  }, [])

  /* ── session config + live Cambodia clock ── */
  useEffect(() => {
    const fetchConfigs = () =>
      apiFetch('/api/session-config/global')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (Array.isArray(data)) sessionConfigsRef.current = data.filter((c: any) => c.startTime !== c.endTime) })
        .catch(() => {})
    fetchConfigs()
    // Re-fetch every 60 s so the indicator stays current if admin changes session settings
    const configInterval = setInterval(fetchConfigs, 60_000)
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const tick = () => {
      const cam = new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
      const hh = String(cam.getUTCHours()).padStart(2, '0')
      const mm = String(cam.getUTCMinutes()).padStart(2, '0')
      const ss = String(cam.getUTCSeconds()).padStart(2, '0')
      setClockStr(`${hh}:${mm}:${ss}`)
      const configs = sessionConfigsRef.current
      if (configs.length === 0) return
      const nowMin = parseInt(hh) * 60 + parseInt(mm)
      const sorted = [...configs].sort((a, b) => a.session - b.session)
      let matched: typeof sorted[0] | undefined = sorted.find(c => nowMin >= toMin(c.startTime) && nowMin <= toMin(c.endTime))
      const isActive = !!matched
      let badge: 'Active' | 'Near' | 'Upcoming' = 'Upcoming'
      if (isActive) {
        badge = 'Active'
      } else {
        matched = sorted.find(c => { const s = toMin(c.startTime); return nowMin >= s - 30 && nowMin < s })
        if (matched) {
          badge = 'Near'
        } else {
          // Prefer nearest upcoming; fall back to most-recently-started
          const upcoming = sorted.filter(c => toMin(c.startTime) > nowMin)
          if (upcoming.length > 0) {
            matched = upcoming[0]
          } else {
            const past = sorted.filter(c => toMin(c.startTime) <= nowMin)
            matched = past.length > 0 ? past[past.length - 1] : sorted[0]
          }
          badge = 'Upcoming'
        }
      }
      setActiveSession(matched ? { ...matched, isActive, badge } : null)
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => { clearInterval(iv); clearInterval(configInterval) }
  }, [configRefreshTick])

  /* ── Edit session times (inline from scan UI) ── */
  const openEditSession = useCallback(() => {
    if (!activeSession) return
    setEditStart(activeSession.startTime)
    setEditEnd(activeSession.endTime)
    setEditError('')
    setEditSessionOpen(true)
  }, [activeSession])

  const saveEditSession = useCallback(async () => {
    if (!activeSession) return
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    if (!/^\d{2}:\d{2}$/.test(editStart) || !/^\d{2}:\d{2}$/.test(editEnd)) {
      setEditError('Time must be in HH:MM format'); return
    }
    if (toMin(editEnd) <= toMin(editStart)) {
      setEditError('End time must be after start time'); return
    }
    setEditSaving(true)
    setEditError('')
    try {
      // Build full 4-session payload from current cache, replacing the target session.
      const current = sessionConfigsRef.current.length > 0
        ? sessionConfigsRef.current
        : await apiFetch('/api/session-config/global').then(r => r.ok ? r.json() : [])
      const merged = [1, 2, 3, 4].map(s => {
        if (s === activeSession.session) {
          return { session: s, type: activeSession.type, startTime: editStart, endTime: editEnd }
        }
        const existing = current.find((c: any) => c.session === s)
        return existing
          ? { session: existing.session, type: existing.type, startTime: existing.startTime, endTime: existing.endTime }
          : { session: s, type: s % 2 === 1 ? 'CHECK_IN' : 'CHECK_OUT', startTime: '00:00', endTime: '00:00' }
      })
      const res = await apiFetch('/api/session-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: null, scope: 'CLASS', configs: merged }),
      })
      if (!res.ok) { setEditError('Save failed. You may not have permission.'); return }
      setEditSessionOpen(false)
      setConfigRefreshTick(t => t + 1)
    } catch (e: any) {
      setEditError(e?.message || 'Save failed')
    } finally {
      setEditSaving(false)
    }
  }, [activeSession, editStart, editEnd])

  /* ── auto-start ── */
  useEffect(() => {
    setScanning(true)
    setMessage('Initializing camera…')
  }, [])

  /* ── sounds ── */
  const playSound = useCallback((type: 'success' | 'error' | 'already') => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const tone = (freq: number, start: number, dur: number, vol = 0.25) => {
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.connect(g); g.connect(ctx.destination)
        o.frequency.setValueAtTime(freq, ctx.currentTime + start)
        g.gain.setValueAtTime(vol, ctx.currentTime + start)
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
        o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur)
      }
      if (type === 'success') { tone(880, 0, 0.12, 0.3); tone(1108, 0.1, 0.2, 0.3) }
      else if (type === 'already') { tone(660, 0, 0.1, 0.15); tone(660, 0.15, 0.1, 0.15) }
      else { tone(330, 0, 0.15); tone(220, 0.15, 0.25) }
    } catch { /* audio not supported */ }
  }, [])

  const dismissLock = useCallback(() => {
    if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null }
    lockRef.current = false
    setMessage('')
    setPendingPhoto(null)
    setIsLoading(false)
  }, [])

  /* ── Link unknown card handlers ── */
  const closeLinkModal = useCallback(() => {
    setLinkCardQr(null)
    setLinkSearch('')
    setLinkResults([])
    setLinkError('')
    setLinkSaving(false)
    dismissLock()
  }, [dismissLock])

  // Debounced student search while modal is open
  useEffect(() => {
    if (!linkCardQr) return
    setLinkLoading(true)
    const handle = setTimeout(() => {
      apiFetch(`/api/card-aliases/students?q=${encodeURIComponent(linkSearch.trim())}`)
        .then(r => r.ok ? r.json() : [])
        .then((data: any[]) => { if (Array.isArray(data)) setLinkResults(data) })
        .catch(() => setLinkResults([]))
        .finally(() => setLinkLoading(false))
    }, 250)
    return () => clearTimeout(handle)
  }, [linkCardQr, linkSearch])

  const linkCardToStudent = useCallback(async (studentId: string) => {
    if (!linkCardQr || linkSaving) return
    setLinkSaving(true)
    setLinkError('')
    try {
      const res = await apiFetch('/api/card-aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrValue: linkCardQr, studentId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setLinkError(body?.message || 'Failed to link card')
        setLinkSaving(false)
        return
      }
      playSound('success')
      const linkedQr = linkCardQr
      closeLinkModal()
      // Immediately re-scan so this card now records attendance
      setTimeout(() => { handleQrScanned(linkedQr) }, 150)
    } catch {
      setLinkError('Network error — try again')
      setLinkSaving(false)
    }
    // handleQrScanned added later in closure; safe because the call happens in setTimeout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCardQr, linkSaving, playSound, closeLinkModal])

  const handleLogout = useCallback(async () => {
    // Stop camera before logging out
    if (autoResetRef.current) { clearInterval(autoResetRef.current); autoResetRef.current = null }
    if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch { /* ignore */ }
    localStorage.removeItem('role')
    router.push('/login')
  }, [router])

  /* ── QR handler ── */
  const handleQrScanned = useCallback(async (qrData: string) => {
    if (lockRef.current) return

    // A camera sees the same card across many frames. Suppress it locally so the
    // next student can be scanned quickly without generating duplicate requests.
    const normalizedCode = qrData.trim()
    const scannedAt = Date.now()
    const previousScan = recentCodesRef.current.get(normalizedCode)
    if (previousScan && scannedAt - previousScan < 5000) return

    // Ignore scanner firmware / config strings
    const upperQ = qrData.toUpperCase()
    const isScannerConfig = upperQ.startsWith('FIRMWARE:') || upperQ.startsWith('CONFIG:') ||
      upperQ.startsWith('VERSION:') || upperQ.startsWith('SCANCODE') ||
      upperQ.startsWith('VM.') || /^[A-Z]+\.[0-9]{8}$/.test(qrData.trim())
    if (isScannerConfig) return

    lockRef.current = true
    recentCodesRef.current.set(normalizedCode, scannedAt)
    if (recentCodesRef.current.size > 100) {
      for (const [code, time] of recentCodesRef.current) {
        if (scannedAt - time > 10000) recentCodesRef.current.delete(code)
      }
    }
    setIsLoading(true)
    setProfileVisible(false)

    let resolvedQr = qrData
    try {
      const parsed = JSON.parse(qrData)
      const keys: Record<string, string> = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => [k.toLowerCase(), String(v).trim()])
      )
      if (keys['staffid']) {
        setIsLoading(false)
        playSound('error')
        setPendingPhoto(null)
        setMessage('⚠️ Staff card — please scan a student ID card')
        if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
        lockTimerRef.current = setTimeout(() => { setMessage(''); lockRef.current = false }, 3000)
        return
      }
      const sid = keys['studentid'] || keys['userid'] || keys['id'] ||
        keys['student_number'] || keys['studentnumber'] || keys['no'] ||
        keys['number'] || keys['sn'] || keys['code']
      if (sid) resolvedQr = sid.trim()
      // Pre-fill skeleton with cached photo if we've seen this student before
      if (sid) setPendingPhoto(photoCacheRef.current.get(sid.trim()) ?? null)
    } catch { /* Raw student identifiers are resolved by the attendance API. */ }

    const loc = locationRef.current
    try {
      const networkMode = getAttendanceNetworkMode()
      if (networkMode !== 'ONLINE') throw new DOMException(networkMode, 'TimeoutError')
      const res = await apiFetch('/api/attendance/wattaman/scan', {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrData: resolvedQr,
          ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` } : {}),
        }),
      })
      if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
        throw new TypeError(`Temporary attendance API failure: ${res.status}`)
      }
      setIsLoading(false)
      if (res.ok) {
        const result: ScanResult = await res.json()
        // Unknown card → open link-card modal so admin can attach it to a student
        if ((result as any).action === 'UNMATCHED' || (result as any).unmatched) {
          playSound('error')
          setPendingPhoto(null)
          setLinkCardQr(((result as any).qrValue as string) || resolvedQr)
          setLinkSearch('')
          setLinkResults([])
          setLinkError('')
          if ('vibrate' in navigator) navigator.vibrate([60, 40, 60])
          // Don't auto-release lock — the modal's close handler does it
          return
        }
        const isAlready = result.action === 'ALREADY_RECORDED'
        const isDayOff = result.action === 'DAY_OFF'
        const isLate = result.status === 'LATE'
        if (isDayOff) playSound('error')
        else if (isAlready) playSound('already')
        else playSound('success')
        const meta = statusMeta(result.action, result.status)
        if (!isDayOff) {
          setFlashColor(meta.flash); setTimeout(() => setFlashColor(null), 500)
          if (!isAlready) setScanCount(c => c + 1)
        }
        try {
          const key = `wattaman_scans_${todayCambodia()}`
          const saved = JSON.parse(localStorage.getItem(key) || '[]')
          saved.unshift({ action: result.action, status: result.status, studentName: result.studentName, className: result.className, time: new Date().toISOString() })
          localStorage.setItem(key, JSON.stringify(saved.slice(0, 200)))
          window.dispatchEvent(new StorageEvent('storage', { key }))
        } catch { /* storage unavailable */ }
        setLastResult(result)
        setProfileVisible(true)
        setScanHistory(prev => [result, ...prev].slice(0, 30))
        if (result.studentId && result.studentPhoto) {
          if (photoCacheRef.current.size >= 100) photoCacheRef.current.delete(photoCacheRef.current.keys().next().value as string)
          photoCacheRef.current.set(result.studentId, result.studentPhoto)
        }
        if ('vibrate' in navigator) navigator.vibrate(isAlready ? [80] : 200)
        // Release the decoder quickly for the next card. The result remains visible,
        // while the per-code cooldown above prevents the same card from firing again.
        lockTimerRef.current = setTimeout(() => { lockRef.current = false }, 650)
        if (profileTimerRef.current) clearTimeout(profileTimerRef.current)
        profileTimerRef.current = setTimeout(() => {
          setProfileVisible(false)
          setTimeout(() => { setLastResult(null); setMessage(''); setPendingPhoto(null) }, 300)
        }, isAlready ? 1800 : 2400)
      } else {
        playSound('error')
        const errBody = await res.json().catch(() => ({}))
        const serverMsg = errBody.message || ''
        const msg = res.status === 404
          ? serverMsg
            ? `❌ ${serverMsg}`
            : '❌ Student not recognised — check ID card'
          : res.status >= 500
            ? '⚠️ Server error — try again'
            : serverMsg || '❌ Scan failed — try again'
        setPendingPhoto(null)
        setMessage(msg)
        if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
        lockTimerRef.current = setTimeout(() => { setMessage(''); lockRef.current = false }, res.status === 404 ? 5000 : 3000)
      }
    } catch (err) {
      setIsLoading(false)
      setPendingPhoto(null)
      const errorName = err instanceof DOMException ? err.name : ''
      const currentNetworkMode = getAttendanceNetworkMode()
      const isOffline = currentNetworkMode !== 'ONLINE' || err instanceof TypeError || errorName === 'AbortError' || errorName === 'TimeoutError'
      if (isOffline) {
        try {
          const queuedAt = new Date(scannedAt).toISOString()
          await queueAttendanceScan({
            qrData: resolvedQr,
            scannedAt: queuedAt,
            ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` } : {}),
          })
          const pending = await getQueuedAttendanceCount()
          setPendingSyncCount(pending)
          const queued: ScanResult = { action: 'QUEUED', studentId: resolvedQr, studentName: 'Offline scan saved', studentPhoto: null, className: `${pending} waiting to sync`, status: 'QUEUED', session: 0, checkInTime: queuedAt }
          setLastResult(queued); setProfileVisible(true); setScanHistory(prev => [queued, ...prev].slice(0, 30))
          setMessage(currentNetworkMode === 'OFFLINE'
            ? `📥 Saved offline — ${pending} waiting to sync`
            : `📥 Slow network — saved locally, ${pending} waiting to sync`)
          setScanCount(c => c + 1); playSound('success')
          lockTimerRef.current = setTimeout(() => { lockRef.current = false }, 650)
          if (profileTimerRef.current) clearTimeout(profileTimerRef.current)
          profileTimerRef.current = setTimeout(() => setProfileVisible(false), 2400)
          return
        } catch { /* fall through to the storage error below */ }
      }
      playSound('error')
      setMessage(isOffline ? '⚠️ Offline storage unavailable — scan not saved' : '⚠️ Network error — try again')
      lockTimerRef.current = setTimeout(() => { setMessage(''); lockRef.current = false }, 3000)
    }
  }, [playSound])

  /* ── camera init ── */
  useEffect(() => {
    if (!scanning || !videoRef.current) return
    let cancelled = false
    const videoEl = videoRef.current
    const init = async () => {
      try {
        // Reset per-camera state before switching so stale torch/refs don't linger
        setHasTorch(false); setTorchOn(false); torchTrackRef.current = null

        if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
        videoEl.pause()
        if (videoEl.srcObject) {
          (videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop())
          videoEl.srcObject = null
        }
        videoEl.load() // Reset video element state — Edge needs this so onloadedmetadata fires for the next stream
        await new Promise(r => setTimeout(r, 300))
        if (cancelled) return

        // Always re-enumerate so camera switching gets valid deviceIds after permission
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const cameras = allDevices.filter(d => d.kind === 'videoinput')
        allCamerasRef.current = cameras
        if (!cancelled) setAllCameras([...cameras])
        if (cancelled) return

        // Guard against index going out-of-range if enumeration result changed
        let idx = currentCamIdxRef.current
        if (idx >= cameras.length) { idx = 0; currentCamIdxRef.current = 0; setCurrentCamIdx(0) }
        const deviceId = cameras[idx]?.deviceId || null   // "" → null (use default)
        if (!cancelled) setCameraLabel(cameras[idx]?.label || `Camera ${idx + 1}`)
        // 1280x720 decodes ~4x faster than 1920x1080 and is still plenty for QR.
        // 30fps + continuous focus give the decoder sharp frames as fast as possible.
        const vidConstraints: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          // focusMode is non-standard but widely supported on mobile browsers
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        }
        if (deviceId) vidConstraints.deviceId = deviceId
        else vidConstraints.facingMode = 'environment'

        const onQr = (result: any) => { if (cancelled || !result) return; handleQrScanned(result.getText()) }
        const reader = new BrowserQRCodeReader()
        // Decode every animation frame instead of waiting 200ms between attempts.
        reader.timeBetweenDecodingAttempts = 0
        codeReaderRef.current = reader
        await reader.decodeFromConstraints({ video: vidConstraints }, videoEl, onQr)
        if (!cancelled && videoEl.srcObject) {
          const track = (videoEl.srcObject as MediaStream).getVideoTracks()[0]
          if (track) {
            const cap = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean }
            if (cap.torch) { setHasTorch(true); torchTrackRef.current = track }
          }
        }
        if (!cancelled) setMessage('')
        // Every 90 s, silently recycle the ZXing decoder to prevent internal buffer
        // accumulation that causes slowdown.  We pre-fetch a new camera stream BEFORE
        // stopping the old one so there is no visible black-screen gap:
        //   1. getUserMedia acquires a new stream while the current feed keeps running.
        //   2. We null-out the old reader's .stream ref so its reset() does NOT stop the tracks.
        //   3. We stop old tracks manually — camera is dark for < 1 video frame.
        //   4. decodeFromStream attaches the new stream and starts decoding immediately.
        autoResetRef.current = setInterval(async () => {
          if (cancelled || !videoEl.srcObject) return
          let newStream: MediaStream
          try { newStream = await navigator.mediaDevices.getUserMedia({ video: vidConstraints }) }
          catch { return }
          if (cancelled || !videoEl.srcObject) { newStream.getTracks().forEach(t => t.stop()); return }
          const oldStream = videoEl.srcObject as MediaStream
          if (codeReaderRef.current) {
            ;(codeReaderRef.current as any).stream = undefined // prevent reset() killing camera tracks
            codeReaderRef.current.reset()
            codeReaderRef.current = null
          }
          oldStream.getTracks().forEach(t => t.stop()) // < 1 frame gap before new stream renders
          const fresh = new BrowserQRCodeReader()
          fresh.timeBetweenDecodingAttempts = 0
          codeReaderRef.current = fresh
          fresh.decodeFromStream(newStream, videoEl, onQr).catch(() => {})
        }, 90_000)
      } catch (err: unknown) {
        if (cancelled) return
        const e = err as { name?: string }
        if (e?.name === 'NotAllowedError') setMessage('Camera access denied. Please allow camera permissions.')
        else if (e?.name === 'NotFoundError') setMessage('No camera found on this device.')
        else setMessage('Failed to start camera. Try again.')
      }
    }
    init()
    return () => {
      cancelled = true
      if (autoResetRef.current) { clearInterval(autoResetRef.current); autoResetRef.current = null }
      if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
      if (videoEl.srcObject) {
        (videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop())
        videoEl.srcObject = null
      }
    }
  }, [scanning, handleQrScanned, currentCamIdx])

  const stopScanning = () => {
    if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    if (lockTimerRef.current) { clearTimeout(lockTimerRef.current); lockTimerRef.current = null }
    if (profileTimerRef.current) { clearTimeout(profileTimerRef.current); profileTimerRef.current = null }
    setScanning(false); setLastResult(null); setMessage('')
    lockRef.current = false; setHasTorch(false); setTorchOn(false)
    torchTrackRef.current = null; setProfileVisible(false)
  }

  const switchCamera = useCallback(() => {
    const cameras = allCamerasRef.current
    if (cameras.length <= 1) return
    const next = (currentCamIdx + 1) % cameras.length
    currentCamIdxRef.current = next; setCurrentCamIdx(next)
  }, [currentCamIdx])

  const toggleTorch = useCallback(async () => {
    if (!torchTrackRef.current) return
    try {
      await torchTrackRef.current.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
      setTorchOn(v => !v)
    } catch { /* torch not available */ }
  }, [torchOn])

  return (
    <div className="page-shell">
      <style>{`
        @keyframes scanLine { 0%, 100% { top: 6%; } 50% { top: 90%; } }
        @keyframes flashOverlay { 0% { opacity: 0.6; } 100% { opacity: 0; } }
        @keyframes slideUp { from { transform: translateY(110%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slideUpFade { from { transform: translateY(20px) scale(0.97); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(16px); } }
        .profile-enter { animation: slideUp 0.32s cubic-bezier(0.34,1.46,0.64,1) forwards; }
        .profile-exit  { animation: fadeOut 0.22s ease-in forwards; }
        .result-enter  { animation: slideUpFade 0.25s ease-out forwards; }
      `}</style>

      <Sidebar title="Wattaman" subtitle="QR Attendance" navItems={wattamanNav} accentColor="emerald"
        bottomTabs={['/wattaman', '/wattaman/scan', '/wattaman/usb-scan', '/wattaman/teacher-scan', '/wattaman/teacher-reports']} />

      {!scanning && (
        <div className="fixed top-16 right-3 z-40 flex flex-col items-end gap-2">
          <NetworkQualityBadge />
          {pendingSyncCount > 0 && (
            <div className="rounded-full bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg">📥 {pendingSyncCount} pending sync</div>
          )}
        </div>
      )}

      <div className="page-content">
        <div className="h-14 lg:hidden" />

        {/* ═══════════════════════════════════════════════
            FULLSCREEN CAMERA OVERLAY
        ═══════════════════════════════════════════════ */}
        {scanning && (
          <div className={`fixed inset-0 z-50 bg-black ${isLandscape ? 'flex flex-row' : 'flex flex-col'}`}>

            {/* ── Video pane ── */}
            <div className="relative flex-1 overflow-hidden">
              <video ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay playsInline muted />

              {/* Color flash */}
              {flashColor && (
                <div className="absolute inset-0 z-20 pointer-events-none"
                  style={{ background: flashColor, animation: 'flashOverlay 0.5s ease-out forwards' }} />
              )}

              {/* Scan zone brackets + sweep line */}
              <StudentScanZone isLandscape={isLandscape} />

              {/* Keep connection feedback above the fullscreen camera layer. */}
              <div className="absolute top-[4.5rem] right-3 z-30 flex flex-col items-end gap-2">
                <NetworkQualityBadge />
                {pendingSyncCount > 0 && (
                  <div className="rounded-full bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg">📥 {pendingSyncCount} pending sync</div>
                )}
              </div>

              {/* ── Session + clock overlay (portrait only) ── */}
              {!isLandscape && clockStr && (
                <div className="absolute top-28 left-0 right-0 z-20 flex items-center justify-between gap-2 px-3 pointer-events-none">
                  {activeSession && (
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 pointer-events-auto">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${activeSession.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                      <span className="text-white text-xs font-semibold">
                        S{activeSession.session} · {activeSession.type === 'CHECK_IN' ? 'Check-In' : 'Check-Out'}
                      </span>
                      <button
                        type="button"
                        onClick={openEditSession}
                        title="Edit session times"
                        className="text-white/70 hover:text-white text-xs underline decoration-dotted underline-offset-2 transition-colors"
                      >
                        {activeSession.startTime}–{activeSession.endTime} ✏️
                      </button>
                    </div>
                  )}
                  <div className="ml-auto bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
                    <span className="text-white/90 text-xs font-mono font-bold tabular-nums">{clockStr}</span>
                  </div>
                </div>
              )}

              {/* Processing spinner (inside zone area) */}
              {isLoading && (
                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
                </div>
              )}

              {/* ── Top bar ── */}
              <div className="relative z-20 flex items-center justify-between px-4 pt-4 pb-2 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  <span className="text-white text-sm font-semibold">Wattaman Scan</span>
                  {scanCount > 0 && (
                    <div className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-xs font-bold">{scanCount} scanned</div>
                  )}
                  {cameraLabel && (
                    <span className="text-white/40 text-xs hidden sm:inline truncate max-w-[130px]">{cameraLabel}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {hasTorch && (
                    <button onClick={toggleTorch}
                      className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-all active:scale-90 ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}>
                      🔦
                    </button>
                  )}
                  {allCameras.length > 1 && (
                    <button onClick={switchCamera}
                      className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center text-xl text-white active:scale-90 transition-all">
                      🔄
                    </button>
                  )}
                  <button onClick={stopScanning}
                    className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center text-white font-bold text-lg active:scale-90 transition-all shadow-lg">
                    ✕
                  </button>
                </div>
              </div>

              {/* ── Bottom hint / error message ── */}
              <div className="absolute bottom-24 left-0 right-0 z-20 flex justify-center pointer-events-none px-4">
                {!lastResult && !isLoading && !message && (
                  <div className="bg-black/50 backdrop-blur-sm rounded-full px-4 py-2 text-white/80 text-xs">
                    {isLandscape ? 'Point at student or teacher QR card' : 'Aim camera at QR code on ID card'}
                  </div>
                )}
                {message && !lastResult && (
                  message.startsWith('❌') || message.startsWith('⚠️') || message.startsWith('📡') ? (
                    <button
                      className="w-full max-w-sm px-4 py-3 rounded-2xl text-sm font-medium text-center backdrop-blur-sm bg-red-500/90 text-white pointer-events-auto active:scale-95 transition-transform"
                      onClick={dismissLock}
                    >
                      <div>{message}</div>
                      <div className="text-xs mt-1 opacity-75">Tap to scan again</div>
                    </button>
                  ) : (
                    <div className="w-full max-w-sm px-4 py-3 rounded-2xl text-sm font-medium text-center backdrop-blur-sm bg-black/60 text-white">
                      {message}
                    </div>
                  )
                )}
              </div>

              {/* ── Scan history chips ── */}
              {scanHistory.length > 0 && !lastResult && !isLoading && !isLandscape && (
                <div className="absolute bottom-14 left-0 right-0 z-20 px-3">
                  <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {scanHistory.slice(0, 6).map((r, i) => {
                      const m = statusMeta(r.action, r.status)
                      const t = r.checkInTime
                        ? formatCambodiaTime(r.checkInTime)
                        : null
                      return (
                        <div key={i}
                          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white ${m.bg} shadow`}>
                          <span>{r.studentName.split(' ').slice(0, 2).join(' ')}</span>
                          {t && <span className="text-white/70 font-normal">{t}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Phone: loading skeleton (bottom of video pane) ── */}
              {!isLandscape && isLoading && (
                <div className="absolute bottom-0 left-0 right-0 z-40 px-3 pb-4 profile-enter">
                  <ScanSkeletonCard photo={pendingPhoto} />
                </div>
              )}

              {/* ── Phone: result profile card (bottom sheet) ── */}
              {!isLandscape && lastResult && !isLoading && (
                <div className={`absolute bottom-0 left-0 right-0 z-40 px-3 pb-4 ${profileVisible ? 'profile-enter' : 'profile-exit'}`}>
                  <StudentProfileCard result={lastResult} />
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════
                TABLET LANDSCAPE: right info panel
            ═══════════════════════════════════════════════ */}
            {isLandscape && (
              <div className="w-72 md:w-80 xl:w-96 bg-black/85 backdrop-blur-sm flex flex-col p-4 gap-3 overflow-y-auto">
                {/* Session + clock card */}
                {clockStr && (
                  <div className="flex-shrink-0 rounded-xl p-3 mb-0" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-xs uppercase tracking-wide font-semibold">Cambodia Time</span>
                      <span className="text-white font-mono text-sm font-bold tabular-nums">{clockStr}</span>
                    </div>
                    {activeSession ? (
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            activeSession.badge === 'Active' ? 'bg-emerald-400 animate-pulse'
                            : activeSession.badge === 'Near' ? 'bg-amber-400'
                            : 'bg-slate-500'
                          }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-bold leading-tight">
                            Session {activeSession.session} · {activeSession.type === 'CHECK_IN' ? '↓ Check-In' : '↑ Check-Out'}
                          </p>
                          <button
                            type="button"
                            onClick={openEditSession}
                            title="Edit session times"
                            className="text-white/60 hover:text-white text-xs mt-0.5 underline decoration-dotted underline-offset-2 transition-colors"
                          >
                            {activeSession.startTime} – {activeSession.endTime} ✏️
                          </button>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{
                            background: activeSession.badge === 'Active' ? 'rgba(52,211,153,0.2)' : activeSession.badge === 'Near' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.07)',
                            color: activeSession.badge === 'Active' ? '#6ee7b7' : activeSession.badge === 'Near' ? '#fbbf24' : 'rgba(255,255,255,0.35)'
                          }}>
                          {activeSession.badge}
                        </span>
                      </div>
                    ) : (
                      <p className="text-white/30 text-xs">Loading session…</p>
                    )}
                  </div>
                )}

              {/* Panel header */}
                <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-white/80 text-sm font-semibold">Attendance Log</p>
                  {scanCount > 0 && (
                    <span className="ml-auto text-emerald-400 text-xs font-bold">{scanCount} scanned today</span>
                  )}
                </div>

                {/* Loading skeleton */}
                {isLoading && (
                  <div className="result-enter flex-shrink-0">
                    <div className="rounded-2xl overflow-hidden bg-slate-800 ring-1 ring-white/10">
                      <div className="h-9 bg-slate-700 animate-pulse" />
                      <div className="flex gap-3 p-3">
                        <div className={`w-16 h-16 rounded-xl flex-shrink-0 overflow-hidden bg-slate-700 ${!pendingPhoto ? 'animate-pulse' : ''}`}>
                          {pendingPhoto && <img src={pendingPhoto} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <div className="flex-1 space-y-2 pt-1">
                          <div className="h-4 bg-slate-700 rounded animate-pulse w-3/4" />
                          <div className="h-3 bg-slate-600 rounded animate-pulse w-1/2" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Result card on panel */}
                {lastResult && !isLoading && (
                  <div className={`flex-shrink-0 result-enter transition-opacity duration-300 ${profileVisible ? 'opacity-100' : 'opacity-0'}`}>
                    <StudentProfileCard result={lastResult} />
                  </div>
                )}

                {/* History list */}
                <div className="space-y-2 overflow-y-auto flex-1">
                  {scanHistory.length === 0 && !isLoading && (
                    <p className="text-white/30 text-xs text-center py-8">No scans yet this session</p>
                  )}
                  {scanHistory.map((r, i) => {
                    const m = statusMeta(r.action, r.status)
                    return (
                      <div key={i} className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${m.bg}`}>
                          {r.action === 'ALREADY_RECORDED' ? '↩' : r.status === 'LATE' ? 'L' : '✓'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{r.studentName}</p>
                          <p className="text-xs text-white/40 truncate">{r.className}</p>
                        </div>
                        {r.checkInTime && (
                          <span className="text-xs text-white/30 flex-shrink-0">
                            {formatCambodiaTime(r.checkInTime)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            NON-SCANNING PAGE
        ═══════════════════════════════════════════════ */}
        <div className="page-header flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Scan Student Attendance</h1>
            <p className="text-sm text-slate-500 mt-1">Scan student or teacher QR codes — recorded instantly</p>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-500 transition-colors py-2 px-3 rounded-xl hover:bg-red-50 flex-shrink-0">
            <span className="text-base">⏻</span>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>

        <div className="page-body space-y-4">
          {/* Big CTA */}
          <button
            onClick={() => { setScanning(true); setMessage('Initializing camera…') }}
            className="w-full text-left active:scale-[0.98] transition-transform"
          >
            <div className="relative overflow-hidden rounded-2xl shadow-lg p-6 text-white"
              style={{ background: 'linear-gradient(135deg,#00C9A7 0%,#00a88a 50%,#008f75 100%)' }}>
              <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-white/10" />
              <div className="absolute -right-2 top-10 w-24 h-24 rounded-full bg-white/10" />
              <div className="relative z-10 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white/80 text-sm font-medium">{scanning ? 'Scanner is active' : 'Ready to scan'}</p>
                  <h2 className="text-2xl font-bold mt-0.5">{scanning ? 'Scanner Running…' : 'Open QR Scanner'}</h2>
                  <p className="text-white/70 text-xs mt-1">Student &amp; teacher QR cards supported</p>
                  <div className="mt-4 inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1.5 text-sm font-semibold">
                    <span>{scanning ? 'Scanner active' : 'Tap to start'}</span>
                    {!scanning && <span>→</span>}
                  </div>
                </div>
                <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-4xl flex-shrink-0">📷</div>
              </div>
            </div>
          </button>

          {/* Session stats */}
          {scanCount > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">This session</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-3 bg-slate-50 rounded-xl">
                  <p className="text-2xl font-bold text-slate-800">{scanCount}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Scanned</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-xl">
                  <p className="text-2xl font-bold text-emerald-600">
                    {scanHistory.filter(r => r.status === 'PRESENT' && r.action !== 'ALREADY_RECORDED').length}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Present</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-xl">
                  <p className="text-2xl font-bold text-amber-500">
                    {scanHistory.filter(r => r.status === 'LATE').length}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Late</p>
                </div>
              </div>
            </div>
          )}

          {/* Scan history list */}
          {scanHistory.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-700 text-sm">Recent Scans ({scanHistory.length})</h3>
                <button
                  onClick={() => { setScanHistory([]); setScanCount(0) }}
                  className="text-xs text-slate-400 hover:text-red-400 transition-colors py-1 px-2 rounded-lg">
                  Clear
                </button>
              </div>
              <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                {scanHistory.map((r, i) => {
                  const meta = statusMeta(r.action, r.status)
                  const timeStr = r.checkInTime
                    ? formatCambodiaTime(r.checkInTime)
                    : ''
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      {r.studentPhoto ? (
                        <img src={r.studentPhoto} alt={r.studentName}
                          className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">👤</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{r.studentName}</p>
                        <p className="text-xs text-slate-400 truncate">{r.className}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold text-white ${meta.bg}`}>
                          {r.action === 'ALREADY_RECORDED' ? '↩' : r.status === 'LATE' ? '⚠️ Late' : '✓'}
                        </span>
                        {timeStr && <span className="text-xs text-slate-300">{timeStr}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* How it works guide */}
          {scanHistory.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
              <h3 className="font-semibold text-slate-700 text-sm mb-3">How it works</h3>
              <div className="space-y-3">
                {[
                  { icon: '📷', title: 'Open Scanner', desc: 'Tap the card above — camera starts automatically' },
                  { icon: '🪪', title: 'Point at QR Card', desc: 'Aim at student or teacher ID card QR code' },
                  { icon: '✅', title: 'Instant Record', desc: 'Profile displays and attendance is saved immediately' },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-xl flex-shrink-0">{step.icon}</div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{step.title}</p>
                      <p className="text-xs text-slate-400">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════
          EDIT SESSION TIMES MODAL (admin / wattaman)
      ═══════════════════════════════════════════════ */}
      {editSessionOpen && activeSession && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-800">Edit Session {activeSession.session} Time</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activeSession.type === 'CHECK_IN' ? '↓ Check-In' : '↑ Check-Out'} window. Saves globally for all classes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditSessionOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2"
                aria-label="Close"
              >×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Start Time (on time from)</label>
                <input
                  type="time"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">End Time (late after)</label>
                <input
                  type="time"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-1.5">Scans after this time are recorded as <strong>Late</strong>.</p>
              </div>
              {editError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">{editError}</div>
              )}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditSessionOpen(false)}
                disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
              >Cancel</button>
              <button
                type="button"
                onClick={saveEditSession}
                disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >{editSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Link unknown card to student modal ── */}
      {linkCardQr && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
          onClick={closeLinkModal}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 text-xl">
                  ⚠️
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Unknown card
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-all">
                    QR: <span className="font-mono">{linkCardQr.slice(0, 32)}{linkCardQr.length > 32 ? '…' : ''}</span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Pick a student to link this card to. Future scans will work automatically.
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700">
              <input
                autoFocus
                type="text"
                placeholder="Search by name or student number…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={linkSaving}
              />
              {linkError && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-400">{linkError}</div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {linkLoading && linkResults.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-slate-500">Loading…</div>
              )}
              {!linkLoading && linkResults.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-slate-500">No students found</div>
              )}
              {linkResults.map((s) => {
                const photo = s.photo || s.user?.photo
                return (
                  <button
                    key={s.id}
                    onClick={() => linkCardToStudent(s.id)}
                    disabled={linkSaving}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.98] transition-all text-left disabled:opacity-50"
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" className="w-10 h-10 rounded-full object-cover bg-slate-200" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 font-semibold">
                        {s.user?.name?.[0] ?? '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{s.user?.name ?? '—'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {s.studentNumber ? `#${s.studentNumber}` : 'no number'}
                        {s.class?.name ? ` · ${s.class.name}` : ''}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                onClick={closeLinkModal}
                disabled={linkSaving}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WattamanScanPage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN', 'ADMIN']}>
      <WattamanScanContent />
    </AuthGuard>
  )
}
