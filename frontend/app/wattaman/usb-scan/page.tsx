"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AuthGuard from '../../../components/AuthGuard'
import { apiFetch } from '../../../lib/api'
import { formatCambodiaTime, todayCambodia } from '../../../lib/dateUtils'
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

function StudentProfileCard({ result }: { result: ScanResult }) {
  const meta = statusMeta(result.action, result.status)
  const isAlready = result.action === 'ALREADY_RECORDED'
  const timeDisplay = result.checkInTime ? formatCambodiaTime(result.checkInTime, true) : null
  return (
    <div className={`rounded-2xl overflow-hidden shadow-2xl ${meta.cardBg} ring-2 ${meta.ring}`}>
      <div className={`${meta.bg} px-4 py-2.5 flex items-center justify-between`}>
        <span className="text-white text-sm font-bold tracking-wide">{meta.label}</span>
        {result.session > 0 && (
          <span className="text-white/80 text-xs font-medium">Session {result.session}</span>
        )}
      </div>
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

function StudentProfileCardLarge({ result }: { result: ScanResult }) {
  const meta = statusMeta(result.action, result.status)
  const isAlready = result.action === 'ALREADY_RECORDED'
  const timeDisplay = result.checkInTime ? formatCambodiaTime(result.checkInTime, true) : null
  return (
    <div className={`rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl ring-2 ${meta.ring}`}>
      {/* Status header */}
      <div className={`${meta.bg} px-4 sm:px-5 py-2.5 sm:py-3.5 flex items-center justify-between`}>
        <span className="text-white text-sm sm:text-base font-extrabold tracking-wide">{meta.label}</span>
        {result.session > 0 && (
          <span className="text-white/80 text-xs sm:text-sm font-semibold">Session {result.session}</span>
        )}
      </div>

      {/* ── Mobile layout (< sm): horizontal photo + stacked info ── */}
      <div className={`${meta.cardBg} flex sm:hidden items-center gap-3 px-4 py-3`}>
        <div className={`ring-2 ${meta.ring} rounded-2xl overflow-hidden flex-shrink-0 shadow`}>
          {result.studentPhoto ? (
            <img src={result.studentPhoto} alt={result.studentName} className="w-20 h-20 object-cover" />
          ) : (
            <div className="w-20 h-20 bg-white flex items-center justify-center text-4xl">👤</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-slate-800 text-xl leading-tight">{result.studentName}</p>
          <p className="text-slate-500 text-xs mt-0.5 truncate">{result.className}</p>
          {isAlready && <p className="text-indigo-500 text-xs font-medium mt-1">Already recorded</p>}
          {timeDisplay && (
            <div className="flex items-center gap-1.5 mt-2 rounded-xl px-3 py-1.5" style={{ background: meta.bgLight }}>
              <span className="text-sm">🕐</span>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {isAlready ? 'First' : result.action === 'CHECK_OUT' ? 'Out' : 'In'}
              </span>
              <span className="ml-auto text-xl font-extrabold tabular-nums" style={{ color: meta.textHex }}>
                {timeDisplay}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop layout (≥ sm): vertical centered ── */}
      <div className={`${meta.cardBg} hidden sm:flex flex-col items-center gap-4 px-6 py-6`}>
        <div className={`ring-4 ${meta.ring} rounded-3xl overflow-hidden shadow-lg`}>
          {result.studentPhoto ? (
            <img src={result.studentPhoto} alt={result.studentName}
              className="w-36 h-36 sm:w-40 sm:h-40 object-cover" />
          ) : (
            <div className="w-36 h-36 sm:w-40 sm:h-40 bg-white flex items-center justify-center text-7xl">👤</div>
          )}
        </div>
        <div className="text-center space-y-1">
          <p className="font-extrabold text-slate-800 text-2xl sm:text-3xl leading-tight">{result.studentName}</p>
          <p className="text-slate-500 text-sm sm:text-base">{result.className}</p>
          {isAlready && <p className="text-indigo-500 text-sm font-medium mt-1">Already recorded — no duplicate</p>}
        </div>
        {timeDisplay && (
          <div className="w-full rounded-2xl px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between"
            style={{ background: meta.bgLight }}>
            <div className="flex items-center gap-2">
              <span className="text-xl">🕐</span>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {isAlready ? 'First scan' : result.action === 'CHECK_OUT' ? 'Check-out' : 'Check-in'}
              </span>
            </div>
            <span className="text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight"
              style={{ color: meta.textHex }}>
              {timeDisplay}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Maps a KeyboardEvent's physical key (e.code) to its ASCII character,
 * ignoring the OS keyboard layout (Khmer, Thai, Arabic, etc.).
 * This ensures USB scanners always produce the correct ASCII output
 * even when the system keyboard is set to a non-Latin layout.
 */
function physicalKeyToAscii(e: KeyboardEvent): string | null {
  const { code, shiftKey } = e
  // Letters A-Z
  if (code.startsWith('Key')) {
    const letter = code.slice(3) // "KeyA" → "A"
    return shiftKey ? letter : letter.toLowerCase()
  }
  // Digits 0-9
  if (code.startsWith('Digit')) {
    const digit = code.slice(5) // "Digit1" → "1"
    if (!shiftKey) return digit
    const shiftMap: Record<string, string> = {
      '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
      '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
    }
    return shiftMap[digit] ?? digit
  }
  // Numpad digits
  if (code.startsWith('Numpad')) {
    const rest = code.slice(6)
    if (/^\d$/.test(rest)) return rest
  }
  // Common punctuation used in QR payloads (US physical layout)
  const punct: Record<string, [string, string]> = {
    Minus:        ['-', '_'],  Equal:       ['=', '+'],
    BracketLeft:  ['[', '{'],  BracketRight: [']', '}'],
    Backslash:    ['\\', '|'], Semicolon:   [';', ':'],
    Quote:        ["'", '"'],  Backquote:   ['`', '~'],
    Comma:        [',', '<'],  Period:      ['.', '>'],
    Slash:        ['/', '?'],  Space:       [' ', ' '],
  }
  if (punct[code]) return shiftKey ? punct[code][1] : punct[code][0]
  // Fallback: on some Android/tablet browsers e.code may be empty — use e.key directly
  // if it's a single printable ASCII character (covers most scanner output)
  if (e.key && e.key.length === 1 && e.key.charCodeAt(0) >= 32) return e.key
  return null
}

/* ─── Main content ─────────────────────────────────────────── */
function UsbScanContent() {
  const router = useRouter()
  const [lastResult, setLastResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [flashColor, setFlashColor] = useState<string | null>(null)
  const [profileVisible, setProfileVisible] = useState(false)
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([])
  const [scanCount, setScanCount] = useState(0)
  const [clockStr, setClockStr] = useState('')
  const [activeSession, setActiveSession] = useState<{
    session: number; type: string; startTime: string; endTime: string; isActive: boolean; badge: 'Active' | 'Near' | 'Upcoming'
  } | null>(null)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  /* ── Input buffer for USB scanner keyboard emulation ── */
  const [bufferDisplay, setBufferDisplay] = useState('')   // shown in the input box
  const bufferRef = useRef('')                             // accumulates raw keystrokes
  const lastKeyTimeRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  /* ── Device activity detection ── */
  const [deviceActive, setDeviceActive] = useState(false)   // scanner sent keystrokes recently
  const [lastActivityStr, setLastActivityStr] = useState<string | null>(null)
  const lastActivityTimeRef = useRef<number>(0)
  const deviceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── WebHID USB device detection ── */
  const [hidSupported] = useState(() => typeof navigator !== 'undefined' && 'hid' in navigator)
  const [hidDeviceName, setHidDeviceName] = useState<string | null>(null)
  const [hidConnected, setHidConnected] = useState(false)

  useEffect(() => {
    if (!hidSupported) return
    const nav = navigator as any
    // Check already-authorized devices on mount
    nav.hid.getDevices().then((devs: any[]) => {
      if (devs.length > 0) {
        setHidConnected(true)
        setHidDeviceName(devs[0].productName || 'HID Device')
      }
    }).catch(() => {})
    const onConnect = (e: any) => {
      setHidConnected(true)
      setHidDeviceName(e.device?.productName || 'HID Device')
    }
    const onDisconnect = (e: any) => {
      nav.hid.getDevices().then((devs: any[]) => {
        if (devs.length === 0) { setHidConnected(false); setHidDeviceName(null) }
        else setHidDeviceName(devs[0].productName || 'HID Device')
      }).catch(() => { setHidConnected(false); setHidDeviceName(null) })
    }
    nav.hid.addEventListener('connect', onConnect)
    nav.hid.addEventListener('disconnect', onDisconnect)
    return () => {
      nav.hid.removeEventListener('connect', onConnect)
      nav.hid.removeEventListener('disconnect', onDisconnect)
    }
  }, [hidSupported])

  const requestHidDevice = useCallback(async () => {
    if (!hidSupported) return
    try {
      const nav = navigator as any
      const devs = await nav.hid.requestDevice({ filters: [] })
      if (devs.length > 0) {
        setHidConnected(true)
        setHidDeviceName(devs[0].productName || 'HID Device')
      }
    } catch { /* user cancelled dialog */ }
  }, [hidSupported])

  /* ── Test mode (scan without recording) ── */
  const [testMode, setTestMode] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  /* ── Unknown-card linking modal ── */
  const [linkCardQr, setLinkCardQr] = useState<string | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<Array<{
    id: string; studentNumber: string | null; photo: string | null;
    user: { name: string; photo: string | null }; class: { name: string } | null
  }>>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [linkedCount, setLinkedCount] = useState(0)
  const [linkSuccessMsg, setLinkSuccessMsg] = useState<string | null>(null)
  const linkSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lockRef = useRef(false)
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /* scanner buffer used while the link modal is open */
  const linkBufferRef = useRef('')
  const linkLastKeyRef = useRef(0)
  const sessionConfigsRef = useRef<Array<{ session: number; type: string; startTime: string; endTime: string }>>([])

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

  useEffect(() => {
    let mounted = true
    const sync = async () => {
      try {
        const result = await flushAttendanceQueue()
        if (mounted) setPendingSyncCount(result.pending)
      } catch { /* IndexedDB unavailable */ }
    }
    getQueuedAttendanceCount().then(count => { if (mounted) setPendingSyncCount(count) }).catch(() => {})
    sync()
    window.addEventListener('online', sync)
    const interval = setInterval(sync, 30_000)
    return () => { mounted = false; window.removeEventListener('online', sync); clearInterval(interval) }
  }, [])

  /* ── Session config + live clock ── */
  useEffect(() => {
    const fetchConfigs = () =>
      apiFetch('/api/session-config/global')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (Array.isArray(data)) sessionConfigsRef.current = data.filter((c: any) => c.startTime !== c.endTime) })
        .catch(() => {})
    fetchConfigs()
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
  }, [])

  /* ── Sounds ── */
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
    setIsLoading(false)
    bufferRef.current = ''
    setBufferDisplay('')
  }, [])

  /* ── Link-card modal ── */
  const closeLinkModal = useCallback(() => {
    setLinkCardQr(null)
    setLinkSearch('')
    setLinkResults([])
    setLinkError('')
    setLinkSaving(false)
    dismissLock()
  }, [dismissLock])

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

  /* ── Process scanned QR value ── */
  const handleQrScanned = useCallback(async (qrData: string) => {
    if (lockRef.current) return

    // Ignore scanner configuration / firmware strings (not student QR codes)
    const upperQ = qrData.toUpperCase()
    const isScannerConfig = upperQ.startsWith('FIRMWARE:') || upperQ.startsWith('CONFIG:') ||
      upperQ.startsWith('VERSION:') || upperQ.startsWith('SCANCODE') ||
      upperQ.startsWith('VM.') || /^[A-Z]+\.[0-9]{8}$/.test(qrData.trim())
    if (isScannerConfig) return   // silently discard — device just booted or config button pressed

    lockRef.current = true
    const scannedAt = new Date().toISOString()
    setIsLoading(true)
    setProfileVisible(false)
    setBufferDisplay('')
    bufferRef.current = ''

    let resolvedQr = qrData.trim().replace(/\0/g, '')
    try {
      const parsed = JSON.parse(resolvedQr)
      // Convert all values to string so numeric IDs (e.g. {"studentId": 42}) work correctly
      const keys: Record<string, string> = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => [k.toLowerCase(), String(v).trim()])
      )
      if (keys['staffid']) {
        setIsLoading(false)
        playSound('error')
        setMessage('⚠️ Staff card — please scan a student ID card')
        if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
        lockTimerRef.current = setTimeout(dismissLock, 3000)
        return
      }
      // Accept any of the common JSON key names used by card-printing systems
      const sid = keys['studentid'] || keys['userid'] || keys['id'] ||
        keys['student_number'] || keys['studentnumber'] || keys['no'] ||
        keys['number'] || keys['sn'] || keys['code']
      if (sid) resolvedQr = sid.trim()
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
        if ((result as any).action === 'UNMATCHED' || (result as any).unmatched) {
          playSound('error')
          const qv: string = ((result as any).qrValue as string) || resolvedQr
          const display = qv.length > 40 ? qv.slice(0, 40) + '…' : qv
          setMessage(`❌ Not recognised: ${display}`)
          if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
          lockTimerRef.current = setTimeout(dismissLock, 7000)
          return
        }
        const isAlready = result.action === 'ALREADY_RECORDED'
        const isDayOff = result.action === 'DAY_OFF'
        if (isDayOff) playSound('error')
        else if (isAlready) playSound('already')
        else playSound('success')
        const meta = statusMeta(result.action, result.status)
        if (!isDayOff) { setFlashColor(meta.flash); setTimeout(() => setFlashColor(null), 500) }
        if (!isAlready && !isDayOff) setScanCount(c => c + 1)
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
        if ('vibrate' in navigator) navigator.vibrate(isAlready ? [80] : 200)
        lockTimerRef.current = setTimeout(dismissLock, 300)
        if (profileTimerRef.current) clearTimeout(profileTimerRef.current)
        profileTimerRef.current = setTimeout(() => {
          setProfileVisible(false)
        }, isAlready ? 1800 : 2400)
      } else {
        playSound('error')
        const errBody = await res.json().catch(() => ({}))
        const serverMsg = errBody.message || ''
        const msg = res.status === 404
          ? serverMsg ? `❌ ${serverMsg}` : '❌ Student not recognised — check ID card'
          : res.status >= 500 ? '⚠️ Server error — try again' : serverMsg || '❌ Scan failed — try again'
        setMessage(msg)
        if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
        lockTimerRef.current = setTimeout(dismissLock, res.status === 404 ? 5000 : 3000)
      }
    } catch (err) {
      setIsLoading(false)
      const errorName = err instanceof DOMException ? err.name : ''
      const currentNetworkMode = getAttendanceNetworkMode()
      const isOffline = currentNetworkMode !== 'ONLINE' || err instanceof TypeError || errorName === 'AbortError' || errorName === 'TimeoutError'
      if (isOffline) {
        try {
          await queueAttendanceScan({
            qrData: resolvedQr,
            scannedAt,
            ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` } : {}),
          })
          const pending = await getQueuedAttendanceCount()
          setPendingSyncCount(pending)
          const queued: ScanResult = { action: 'QUEUED', studentId: resolvedQr, studentName: 'Offline scan saved', studentPhoto: null, className: `${pending} waiting to sync`, status: 'QUEUED', session: 0, checkInTime: scannedAt }
          setLastResult(queued); setProfileVisible(true); setScanHistory(prev => [queued, ...prev].slice(0, 30))
          setMessage(currentNetworkMode === 'OFFLINE'
            ? `📥 Saved offline — ${pending} waiting to sync`
            : `📥 Slow network — saved locally, ${pending} waiting to sync`)
          setScanCount(c => c + 1); playSound('success')
          lockTimerRef.current = setTimeout(dismissLock, 300)
          if (profileTimerRef.current) clearTimeout(profileTimerRef.current)
          profileTimerRef.current = setTimeout(() => setProfileVisible(false), 2400)
          return
        } catch { /* fall through */ }
      }
      playSound('error')
      setMessage(isOffline ? '⚠️ Offline storage unavailable — scan not saved' : '⚠️ Network error — try again')
      lockTimerRef.current = setTimeout(dismissLock, 3000)
    }
  }, [playSound, dismissLock])

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
      const studentName = linkResults.find(s => s.id === studentId)?.user?.name || 'Student'
      playSound('success')
      setLinkedCount(c => c + 1)
      closeLinkModal()
      if (linkSuccessTimerRef.current) clearTimeout(linkSuccessTimerRef.current)
      setLinkSuccessMsg(`✓ Linked: ${studentName}`)
      linkSuccessTimerRef.current = setTimeout(() => setLinkSuccessMsg(null), 2500)
    } catch {
      setLinkError('Network error — try again')
      setLinkSaving(false)
    }
  }, [linkCardQr, linkSaving, linkResults, playSound, closeLinkModal])

  /**
   * Called when the USB scanner reads a card while the link modal is open.
   * Resolves the card to a student (without recording attendance) and
   * auto-links the unknown card to that student.
   */
  const handleAutoLinkScan = useCallback(async (qrData: string) => {
    let resolvedQr = qrData.trim().replace(/\0/g, '')
    try {
      const parsed = JSON.parse(resolvedQr)
      const keys: Record<string, string> = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => [k.toLowerCase(), String(v).trim()])
      )
      const sid = keys['studentid'] || keys['userid'] || keys['id'] ||
        keys['student_number'] || keys['studentnumber'] || keys['no'] ||
        keys['number'] || keys['sn'] || keys['code']
      if (sid) resolvedQr = sid
    } catch { /* raw QR */ }
    try {
      const res = await apiFetch(`/api/card-aliases/resolve?qr=${encodeURIComponent(resolvedQr)}`)
      if (res.ok) {
        const student = await res.json()
        if (student?.id) {
          linkCardToStudent(student.id)
          return
        }
      }
    } catch { /* ignore — fall through to manual search */ }
    // Card not recognised — pre-fill search so admin can quickly find the student
    setLinkSearch(resolvedQr)
  }, [linkCardToStudent])

  /* ── Capture scanner keyboard input at document level (capture phase) ── */
  // Document-level listener fires regardless of which element has focus,
  // so the scanner works even if the user clicks buttons or opens modals.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // When the link modal is open: track scanner input in a separate buffer.
      // Fast chars + Enter = scanner scan → auto-resolve & link.
      // Slow / normal typing → chars fall through to the search input naturally.
      if (linkCardQr) {
        const ch = physicalKeyToAscii(e)
        const now = Date.now()
        if (ch !== null) {
          if (now - linkLastKeyRef.current > 500) linkBufferRef.current = '' // new scan or human gap
          linkLastKeyRef.current = now
          linkBufferRef.current += ch
          return // don't preventDefault — let chars also reach the search input
        }
        if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          const buf = linkBufferRef.current.trim()
          linkBufferRef.current = ''
          if (buf.length > 2 && now - linkLastKeyRef.current < 300) {
            // Last char arrived < 300 ms ago → scanner input, not manual Enter
            e.preventDefault()
            handleAutoLinkScan(buf)
          }
          // else: human pressed Enter → let search input handle it
        }
        return
      }

      // Skip events that originated from a visible text input/textarea
      // (e.g. admin typing in a search box on another overlay)
      const target = e.target as HTMLElement
      if (
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        !target.classList.contains('sr-only')
      ) return

      const now = Date.now()
      lastActivityTimeRef.current = now
      setDeviceActive(true)
      setLastActivityStr(new Date().toLocaleTimeString())
      if (deviceTimerRef.current) clearTimeout(deviceTimerRef.current)
      deviceTimerRef.current = setTimeout(() => setDeviceActive(false), 3000)

      // Gap > 500ms: scanner paused or new card started — reset the buffer
      if (now - lastKeyTimeRef.current > 500 && bufferRef.current.length > 0) {
        bufferRef.current = ''
        setBufferDisplay('')
      }
      lastKeyTimeRef.current = now

      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault()
        const code = bufferRef.current.trim()
        bufferRef.current = ''
        setBufferDisplay('')
        if (code.length > 2) {
          if (testMode) {
            setTestResult(code)
            lockRef.current = false
          } else {
            handleQrScanned(code)
          }
        }
        return
      }

      // Derive the physical ASCII character from e.code so the buffer is
      // always Latin/ASCII regardless of the OS keyboard layout (Khmer, Thai, etc.)
      const ch = physicalKeyToAscii(e)
      if (ch !== null) {
        e.preventDefault()
        bufferRef.current += ch
        setBufferDisplay(bufferRef.current)
        setTestResult(null)
      }
    }

    // Capture phase: this listener fires before any element's own handler
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [linkCardQr, handleQrScanned, handleAutoLinkScan, testMode])

  // Re-focus the hidden input after any tap/click on the page.
  // readOnly inputs don't trigger soft keyboards, so this is safe on touch devices.
  // Keeps the page capturing scanner keystrokes even after the user taps buttons.
  useEffect(() => {
    const refocus = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      // Don't steal focus from real text inputs (search box in link modal, etc.)
      if (target.tagName === 'INPUT' && !target.classList.contains('sr-only')) return
      if (target.tagName === 'TEXTAREA') return
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    }
    document.addEventListener('click', refocus, true)
    document.addEventListener('touchend', refocus, { capture: true, passive: true })
    return () => {
      document.removeEventListener('click', refocus, true)
      document.removeEventListener('touchend', refocus as EventListener, true)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch { /* ignore */ }
    localStorage.removeItem('role')
    router.push('/login')
  }, [router])

  return (
    <div className="flex h-screen bg-slate-900 overflow-hidden">
      <div className="fixed top-16 right-3 z-40 flex flex-col items-end gap-2">
        <NetworkQualityBadge />
        {pendingSyncCount > 0 && (
          <div className="rounded-full bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg">📥 {pendingSyncCount} pending sync</div>
        )}
      </div>
      {/* ── Flash overlay ── */}
      {flashColor && (
        <div className="fixed inset-0 z-50 pointer-events-none"
          style={{ background: flashColor }} />
      )}

      {/* Hidden scanner input */}
      <input ref={inputRef} type="text" className="sr-only" autoFocus readOnly />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* ─── TABLET / MOBILE top bar (< xl) ─── */}
        <header className="md:hidden flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex-shrink-0">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-slate-300 hover:text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-slate-700 active:scale-95 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex-1 text-center min-w-0">
            <p className="text-white font-extrabold text-sm sm:text-base leading-tight">USB Attendance</p>
            {activeSession ? (
              <p className={`text-xs font-semibold leading-tight ${
                activeSession.badge === 'Active' ? 'text-emerald-400'
                : activeSession.badge === 'Near' ? 'text-amber-400'
                : 'text-slate-500'
              }`}>
                {activeSession.badge === 'Active' ? '● ' : activeSession.badge === 'Near' ? '◎ ' : '○ '}
                S{activeSession.session} · {activeSession.startTime}–{activeSession.endTime}
              </p>
            ) : (
              <p className="text-xs text-slate-500 leading-tight">School Attendance</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-slate-300 font-mono text-xs sm:text-sm font-bold tabular-nums">{clockStr}</span>
            <button
              onClick={() => router.push('/wattaman')}
              title="Wattaman home"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 transition-all text-xl"
            >🏠</button>
          </div>
        </header>

        {/* ─── DESKTOP top bar (xl+) ─── */}
        <header className="hidden md:flex items-center justify-between px-6 py-3 bg-slate-800 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/wattaman')}
              title="Back to dashboard"
              className="flex items-center gap-1.5 text-slate-300 hover:text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-slate-700 active:scale-95 transition-all mr-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <span className="text-2xl">🖲️</span>
            <div>
              <h1 className="font-extrabold text-white text-base leading-tight">USB Scanner — Attendance</h1>
              <p className="text-slate-400 text-xs">School Attendance Management System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {activeSession && (
              <div className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full ring-1 ${
                activeSession.badge === 'Active'
                  ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
                  : activeSession.badge === 'Near'
                    ? 'bg-amber-500/20 text-amber-300 ring-amber-500/40'
                    : 'bg-slate-700 text-slate-400 ring-slate-600'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  activeSession.badge === 'Active' ? 'bg-emerald-400 animate-pulse'
                  : activeSession.badge === 'Near' ? 'bg-amber-400'
                  : 'bg-slate-500'
                }`} />
                S{activeSession.session} · {activeSession.type} · {activeSession.startTime}–{activeSession.endTime}
              </div>
            )}
            <span className="text-slate-100 font-mono text-xl font-bold tabular-nums">{clockStr}</span>
          </div>
        </header>

        {/* ─── MAIN CONTENT ─── */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">

          {/* ══ SCAN ZONE (left on desktop, top on mobile/tablet) ══ */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* Device status bar */}
            <div className={`flex items-center gap-2.5 px-3 sm:px-5 py-2 flex-shrink-0 border-b transition-colors duration-500 ${
              deviceActive
                ? 'bg-emerald-900/50 border-emerald-600/40'
                : hidConnected
                  ? 'bg-blue-900/40 border-blue-600/30'
                  : 'bg-slate-800/80 border-slate-700'
            }`}>
              <div className="relative flex-shrink-0 w-3 h-3">
                <div className={`w-3 h-3 rounded-full ${
                  deviceActive ? 'bg-emerald-400' : hidConnected ? 'bg-blue-400' : 'bg-slate-600'
                }`} />
                {deviceActive && (
                  <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                )}
              </div>
              <p className={`flex-1 text-xs font-semibold truncate ${
                deviceActive ? 'text-emerald-300' : hidConnected ? 'text-blue-300' : 'text-slate-500'
              }`}>
                  {deviceActive
                  ? `Scanner active${hidDeviceName ? ` — ${hidDeviceName}` : ''}${lastActivityStr ? ` · ${lastActivityStr}` : ''}`
                  : hidConnected
                    ? `${hidDeviceName} detected — scan a card to test`
                      : 'Waiting for USB scanner…'}
              </p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {hidSupported && (
                  <button
                    onClick={requestHidDevice}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-all"
                    title="Open browser dialog to select and verify the USB scanner device"
                  >
                    Detect
                  </button>
                )}
                <button
                  onClick={() => { setTestMode(t => !t); setTestResult(null) }}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-all ${
                    testMode ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
                  }`}
                >
                  {testMode ? '🧪 Test ON' : 'Test'}
                </button>
              </div>
            </div>

            {/* Test mode panel */}
            {testMode && (
              <div className="mx-3 mt-2 rounded-xl border border-violet-500/30 bg-violet-950/40 px-4 py-3 flex-shrink-0">
                <p className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2">🧪 Test Mode — attendance NOT recorded</p>
                {testResult ? (
                  <div className="bg-slate-900/80 rounded-lg px-3 py-2 border border-violet-500/20">
                    <p className="text-xs text-slate-500 mb-1">Raw QR value from scanner:</p>
                    <p className="font-mono text-sm text-violet-300 break-all">{testResult}</p>
                    <p className="text-xs text-emerald-400 mt-1.5 font-medium">✓ Scanner is working correctly</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Scan any card — value shown here, no attendance recorded</p>
                )}
              </div>
            )}

            {/* ── Central scan display ── */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
              {profileVisible && lastResult ? (
                <div className="w-full max-w-sm sm:max-w-md" style={{ animation: 'slideUpFade 0.3s ease-out' }}>
                  <StudentProfileCardLarge result={lastResult} />
                </div>
              ) : message ? (
                <div className="flex flex-col items-center gap-4 w-full max-w-xs sm:max-w-sm text-center">
                  <div className={`w-24 h-24 sm:w-32 sm:h-32 rounded-3xl flex items-center justify-center text-5xl sm:text-6xl shadow-lg ${
                    message.startsWith('❌') ? 'bg-red-900/50 ring-2 ring-red-500/50' : 'bg-amber-900/50 ring-2 ring-amber-500/50'
                  }`}>
                    {message.startsWith('❌') ? '❌' : '⚠️'}
                  </div>
                  <p className="font-bold text-base sm:text-xl text-white leading-snug px-2">{message}</p>
                  <button
                    onClick={dismissLock}
                    className="mt-1 text-sm font-semibold px-5 py-2.5 rounded-xl bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-all active:scale-95"
                  >
                    Dismiss
                  </button>
                </div>
              ) : isLoading ? (
                <div className="flex flex-col items-center gap-5">
                  <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-3xl bg-amber-900/40 ring-2 ring-amber-500/40 flex items-center justify-center">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-4 border-amber-500/30 border-t-amber-400 animate-spin" />
                  </div>
                  <p className="text-slate-300 text-lg sm:text-xl font-semibold">Processing scan…</p>
                  <p className="text-slate-500 text-sm">Checking student record</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-5 sm:gap-7">
                  <div className="relative">
                    <div
                      className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-[2.5rem] bg-emerald-900/30 ring-2 ring-emerald-500/40 flex items-center justify-center text-6xl sm:text-7xl lg:text-8xl"
                      style={{ boxShadow: '0 0 80px rgba(52,211,153,0.15)' }}
                    >
                      🖲️
                    </div>
                    <div className="absolute -inset-3 rounded-[3rem] ring-1 ring-emerald-400/20 animate-pulse" />
                    <div className="absolute -inset-7 rounded-[3.5rem] ring-1 ring-emerald-400/10 animate-pulse" style={{ animationDelay: '0.75s' }} />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight">Ready to Scan</p>
                    <p className="text-slate-400 text-sm sm:text-base">Point scanner at a student QR card</p>
                  </div>
                  <div className="w-48 sm:w-64 lg:w-80 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 rounded-full"
                      style={{ animation: 'scanPulse 2s ease-in-out infinite' }} />
                  </div>
                  {(scanCount > 0 || linkedCount > 0 || linkSuccessMsg) && (
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {scanCount > 0 && (
                        <div className="flex items-center gap-1.5 bg-emerald-900/50 text-emerald-400 font-bold px-4 py-2 rounded-full ring-1 ring-emerald-500/40 text-sm">
                          ✓ {scanCount} recorded
                        </div>
                      )}
                      {linkedCount > 0 && (
                        <div className="flex items-center gap-1.5 bg-blue-900/40 text-blue-400 font-bold px-4 py-2 rounded-full ring-1 ring-blue-500/30 text-sm">
                          🔗 {linkedCount} linked
                        </div>
                      )}
                      {linkSuccessMsg && (
                        <div className="text-blue-300 font-semibold px-4 py-2 rounded-full bg-blue-900/40 ring-1 ring-blue-500/30 text-sm">
                          {linkSuccessMsg}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Buffer display */}
              {bufferDisplay && (
                <div className="mt-5 bg-slate-800 border border-slate-600 rounded-2xl px-4 py-3 flex items-center gap-3 w-full max-w-xs sm:max-w-sm">
                  <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider flex-shrink-0">Reading</span>
                  <span className="font-mono text-sm text-emerald-300 truncate flex-1">{bufferDisplay}</span>
                  <span className="w-1.5 h-4 bg-emerald-400 animate-pulse rounded-sm flex-shrink-0" />
                </div>
              )}
              </div>{/* end centering div */}
            </div>{/* end scroll div */}

            {/* Troubleshooting strip */}
            {!lastActivityStr && !isLoading && !deviceActive && !profileVisible && (
              <div className="mx-3 sm:mx-4 mb-3 rounded-xl border border-amber-700/30 bg-amber-950/20 px-4 py-2.5 text-xs flex-shrink-0">
                <p className="font-semibold text-amber-400 mb-1">USB scanner not detected — checklist:</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-amber-400/70">
                  <span>{hidConnected ? '✅' : '□'} Scanner plugged in{hidConnected && hidDeviceName ? ` (${hidDeviceName})` : ''}</span>
                  <span>□ This tab is active &amp; focused</span>
                  <span className="text-amber-400">Tap <strong>Test</strong> &amp; scan a card to verify</span>
                </div>
              </div>
            )}
          </div>

          {/* ══ ATTENDED LIST PANEL ══ */}
          <div className="flex flex-col flex-shrink-0 border-t md:border-t-0 md:border-l border-slate-700 bg-slate-800 md:w-64 lg:w-80 xl:w-96 max-h-[38vh] md:max-h-none min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-slate-200 font-bold text-sm">Attended Today</span>
                {scanHistory.length > 0 && (
                  <span className="bg-emerald-500 text-white text-xs font-extrabold px-2 py-0.5 rounded-full leading-none">
                    {scanHistory.length}
                  </span>
                )}
              </div>
              {scanHistory.length > 0 && (
                <button
                  onClick={() => setScanHistory([])}
                  className="text-xs text-slate-500 hover:text-red-400 px-2 py-1 rounded-lg hover:bg-slate-700 transition-all"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
              {scanHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 gap-2 opacity-50">
                  <span className="text-4xl">📋</span>
                  <p className="text-xs text-slate-500">No scans yet</p>
                </div>
              ) : (
                scanHistory.map((r, i) => {
                  const meta = statusMeta(r.action, r.status)
                  return (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/40 hover:bg-slate-700/60 border border-slate-700/50 transition-colors cursor-default">
                      {r.studentPhoto ? (
                        <img src={r.studentPhoto} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0 ring-1 ring-slate-600" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">👤</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate leading-tight">{r.studentName}</p>
                        <p className="text-xs text-slate-500 truncate leading-tight">{r.className}</p>
                      </div>
                      <span className={`text-white font-bold px-1.5 py-0.5 rounded-md flex-shrink-0 ${meta.bg}`}
                        style={{ fontSize: '10px', lineHeight: '1.5' }}>
                        {r.action === 'ALREADY_RECORDED' ? 'Again' : r.action === 'CHECK_OUT' ? 'Out' : r.status === 'LATE' ? 'Late' : 'In'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── Animations ── */}
      <style jsx global>{`
        @keyframes scanPulse {
          0%, 100% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
        }
        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes usbScanPulse {
          0%, 100% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
        }
      `}</style>

      {/* ── Link unknown card modal ── */}
      {linkCardQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          data-modal>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col gap-0 overflow-hidden"
            data-modal>
            <div className="bg-amber-500 px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-base">Unknown Card</p>
                <p className="text-white/80 text-xs mt-0.5">Link this card to a student</p>
              </div>
              <button onClick={closeLinkModal}
                className="text-white/80 hover:text-white text-2xl leading-none transition-colors">×</button>
            </div>
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs text-slate-500 font-mono mb-3 break-all bg-slate-50 rounded-lg px-3 py-2">{linkCardQr}</p>
              <input
                type="text"
                placeholder="Search student by name or ID…"
                value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                autoFocus
              />
            </div>
            <div className="px-5 pb-5 max-h-64 overflow-y-auto flex flex-col gap-2 mt-2">
              {linkLoading && <p className="text-center text-xs text-slate-400 py-4">Searching…</p>}
              {!linkLoading && linkResults.length === 0 && linkSearch.trim() && (
                <p className="text-center text-xs text-slate-400 py-4">No students found</p>
              )}
              {!linkLoading && linkResults.map(s => (
                <button key={s.id}
                  onClick={() => linkCardToStudent(s.id)}
                  disabled={linkSaving}
                  className="flex items-center gap-3 w-full text-left rounded-xl px-3 py-2.5 hover:bg-amber-50 active:bg-amber-100 border border-transparent hover:border-amber-200 transition-all disabled:opacity-50">
                  {(s.photo || s.user.photo) ? (
                    <img src={(s.photo || s.user.photo)!} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl flex-shrink-0">👤</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{s.user.name}</p>
                    <p className="text-xs text-slate-500">{s.studentNumber} · {s.class?.name ?? '—'}</p>
                  </div>
                  <span className="text-amber-500 text-sm">Link →</span>
                </button>
              ))}
              {linkError && <p className="text-xs text-red-500 text-center">{linkError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function UsbScanPage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN', 'ADMIN']}>
      <UsbScanContent />
    </AuthGuard>
  )
}
