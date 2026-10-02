'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BrowserQRCodeReader } from '@zxing/library'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { wattamanNav } from '../../../lib/wattaman-nav'
import { apiFetch } from '../../../lib/api'
import { pluginTimetableFetch } from '../../../lib/timetable-plugin-api'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import Link from 'next/link'

interface TeacherScanResult {
  action: string
  teacherId: string
  teacherName: string
  period: number
  status: string
  checkIn: string | null
  subjectName: string
  className: string
  timetableName: string
  scheduledPeriods: number[]
  message?: string
}

const statusMeta = (action: string, status: string) => {
  if (action === 'ALREADY_RECORDED')
    return { label: '↩ Already Recorded', bg: 'bg-indigo-500', cardBg: 'bg-indigo-50', ring: 'ring-indigo-300', text: 'text-indigo-600', flash: 'rgba(99,102,241,0.4)', bgLight: 'rgba(99,102,241,0.1)', textHex: '#4338ca' }
  if (status === 'LATE')
    return { label: '⚠️ Late', bg: 'bg-amber-500', cardBg: 'bg-amber-50', ring: 'ring-amber-300', text: 'text-amber-600', flash: 'rgba(251,191,36,0.35)', bgLight: 'rgba(245,158,11,0.12)', textHex: '#b45309' }
  return { label: '✓ Present', bg: 'bg-emerald-500', cardBg: 'bg-emerald-50', ring: 'ring-emerald-300', text: 'text-emerald-600', flash: 'rgba(52,211,153,0.4)', bgLight: 'rgba(16,185,129,0.12)', textHex: '#047857' }
}

// Defined at module level so React never treats these as new types on re-render
function TeacherProfileCard({ result }: { result: TeacherScanResult }) {
  const meta = statusMeta(result.action, result.status)
  const isAlready = result.action === 'ALREADY_RECORDED'
  const timeDisplay = result.checkIn
    ? formatCambodiaTime(result.checkIn, true)
    : null
  return (
    <div className={`rounded-2xl overflow-hidden shadow-2xl ${meta.cardBg} ring-2 ${meta.ring}`}>
      {/* Status header */}
      <div className={`${meta.bg} px-4 py-2.5 flex items-center justify-between`}>
        <span className="text-white text-sm font-bold tracking-wide">{meta.label}</span>
        {result.period > 0 && (
          <span className="text-white/80 text-xs font-medium">Period {result.period}</span>
        )}
      </div>

      {/* Teacher info row */}
      <div className="flex items-center gap-4 px-4 pt-4 pb-3">
        <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white flex items-center justify-center text-5xl flex-shrink-0 ring-2 ${meta.ring} shadow-md`}>
          👨‍🏫
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-slate-800 text-lg sm:text-xl leading-tight truncate">{result.teacherName}</p>
          {result.subjectName && (
            <p className="text-sm text-slate-600 truncate mt-0.5">{result.subjectName}{result.className ? ` · ${result.className}` : ''}</p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">{result.timetableName}</p>
          {isAlready && <p className="text-xs text-indigo-500 font-medium mt-1">Already recorded — no duplicate</p>}
          {result.scheduledPeriods?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {result.scheduledPeriods.map(p => (
                <span key={p}
                  className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${p === result.period ? `${meta.bg} text-white` : 'bg-slate-100 text-slate-400'}`}>
                  P{p}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Prominent time badge */}
      {timeDisplay && (
        <div className="mx-4 mb-4 rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ background: meta.bgLight }}>
          <div className="flex items-center gap-2">
            <span className="text-base">🕐</span>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {isAlready ? 'First check-in' : 'Check-in time'}
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

function TeacherSkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden shadow-xl bg-white ring-2 ring-slate-200">
      <div className="bg-slate-200 px-4 py-2.5 h-10 animate-pulse" />
      <div className="flex items-center gap-4 p-4">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-slate-200 animate-pulse flex-shrink-0" />
        <div className="flex-1 space-y-2.5">
          <div className="h-5 bg-slate-200 rounded-lg animate-pulse w-3/4" />
          <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-1/2" />
          <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-2/5" />
        </div>
      </div>
    </div>
  )
}

function TeacherScanZone({ isLandscape }: { isLandscape: boolean }) {
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

function TeacherScanContent() {
  const router = useRouter()
  const pluginMode = useSearchParams().get('source') === 'plugin'
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [lastResult, setLastResult] = useState<TeacherScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [allCameras, setAllCameras] = useState<MediaDeviceInfo[]>([])
  const [currentCamIdx, setCurrentCamIdx] = useState(0)
  const [cameraLabel, setCameraLabel] = useState('')
  const [flashColor, setFlashColor] = useState<string | null>(null)
  const [hasTorch, setHasTorch] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [scanHistory, setScanHistory] = useState<TeacherScanResult[]>([])
  const [scanCount, setScanCount] = useState(0)
  const [isLandscape, setIsLandscape] = useState(false)
  const [profileVisible, setProfileVisible] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null)
  const allCamerasRef = useRef<MediaDeviceInfo[]>([])
  const currentCamIdxRef = useRef(0)
  const lockRef = useRef(false)
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const torchTrackRef = useRef<MediaStreamTrack | null>(null)
  const autoResetRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* ── orientation ── */
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

  useEffect(() => {
    setScanning(true)
    setMessage('Initializing camera…')
  }, [])

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

  const handleQrScanned = useCallback(async (qrData: string) => {
    if (lockRef.current) return
    lockRef.current = true
    setIsLoading(true)
    setProfileVisible(false)

    let resolvedQr = qrData
    try {
      const parsed = JSON.parse(qrData)
      if (parsed.studentId || parsed.userId || parsed.staffId) {
        setIsLoading(false)
        playSound('error')
        setMessage('⚠️ Not a teacher card — please scan a teacher ID QR code')
        if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
        setTimeout(() => { setMessage(''); lockRef.current = false }, 2500)
        return
      }
    } catch { /* raw string = teacher QR */ }

    const loc = locationRef.current
    try {
      const res = await timetableFetch('/api/timetable/teacher-attendance/wattaman-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrCode: resolvedQr,
          ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` } : {}),
        }),
      })
      setIsLoading(false)
      if (res.ok) {
        const result: TeacherScanResult = await res.json()
        const isAlready = result.action === 'ALREADY_RECORDED'
        if (isAlready) playSound('already'); else playSound('success')
        const meta = statusMeta(result.action, result.status)
        setFlashColor(meta.flash); setTimeout(() => setFlashColor(null), 500)
        if (!isAlready) setScanCount(c => c + 1)
        setLastResult(result)
        setProfileVisible(true)
        setScanHistory(prev => [result, ...prev].slice(0, 30))
        if ('vibrate' in navigator) navigator.vibrate(isAlready ? [80] : 200)
        const displayTime = isAlready ? 2200 : 2800
        setTimeout(() => {
          setProfileVisible(false)
          setTimeout(() => { setLastResult(null); setMessage(''); lockRef.current = false }, 300)
        }, displayTime)
      } else {
        playSound('error')
        const err = await res.json().catch(() => ({}))
        setMessage(err.message || 'Teacher QR code not found in timetable')
        if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
        setTimeout(() => { setMessage(''); lockRef.current = false }, 2500)
      }
    } catch {
      setIsLoading(false)
      playSound('error')
      setMessage('Network error — check connection')
      setTimeout(() => { setMessage(''); lockRef.current = false }, 2200)
    }
  }, [playSound])

  /* ── camera init ── */
  useEffect(() => {
    if (!scanning || !videoRef.current) return
    let cancelled = false
    const videoEl = videoRef.current
    const init = async () => {
      try {
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

        const idx = currentCamIdxRef.current
        const deviceId = cameras[idx]?.deviceId || null
        if (!cancelled) setCameraLabel(cameras[idx]?.label || `Camera ${idx + 1}`)
        const vidConstraints: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } }
        if (deviceId) vidConstraints.deviceId = deviceId
        else vidConstraints.facingMode = 'environment'

        const onQr = (result: any) => { if (cancelled || !result) return; handleQrScanned(result.getText()) }
        const reader = new BrowserQRCodeReader()
        reader.timeBetweenDecodingAttempts = 200
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
        // Every 90 s, pre-fetch a new camera stream while the current feed runs, then
        // swap atomically — no visible black-screen gap during decoder recycling.
        autoResetRef.current = setInterval(async () => {
          if (cancelled || !videoEl.srcObject) return
          let newStream: MediaStream
          try { newStream = await navigator.mediaDevices.getUserMedia({ video: vidConstraints }) }
          catch { return }
          if (cancelled || !videoEl.srcObject) { newStream.getTracks().forEach(t => t.stop()); return }
          const oldStream = videoEl.srcObject as MediaStream
          if (codeReaderRef.current) {
            ;(codeReaderRef.current as any).stream = undefined
            codeReaderRef.current.reset()
            codeReaderRef.current = null
          }
          oldStream.getTracks().forEach(t => t.stop())
          const fresh = new BrowserQRCodeReader()
          fresh.timeBetweenDecodingAttempts = 200
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
    setScanning(false); setLastResult(null); setMessage('')
    lockRef.current = false; setHasTorch(false); setTorchOn(false)
    torchTrackRef.current = null; setProfileVisible(false)
  }

  const handleLogout = useCallback(async () => {
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

      <Sidebar title="Wattaman" subtitle="Teacher Scan" navItems={wattamanNav} accentColor="emerald"
        bottomTabs={['/wattaman', '/wattaman/scan', '/wattaman/usb-scan', '/wattaman/teacher-scan', '/wattaman/teacher-reports']} />

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

              {/* Flash */}
              {flashColor && (
                <div className="absolute inset-0 z-20 pointer-events-none"
                  style={{ background: flashColor, animation: 'flashOverlay 0.5s ease-out forwards' }} />
              )}

              {/* Scan zone */}
              <TeacherScanZone isLandscape={isLandscape} />

              {/* Processing spinner */}
              {isLoading && (
                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
                </div>
              )}

              {/* ── Top bar ── */}
              <div className="relative z-20 flex items-center justify-between px-4 pt-4 pb-2 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  <span className="text-white text-sm font-semibold">Teacher Scan</span>
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
                  <button onClick={handleLogout} title="Sign out"
                    className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center text-white active:scale-90 transition-all text-lg">
                    ⏻
                  </button>
                  <button onClick={stopScanning}
                    className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center text-white font-bold text-lg active:scale-90 transition-all shadow-lg">
                    ✕
                  </button>
                </div>
              </div>

              {/* ── Bottom hint / error ── */}
              <div className="absolute bottom-24 left-0 right-0 z-20 flex justify-center pointer-events-none px-4">
                {!lastResult && !isLoading && !message && (
                  <div className="bg-black/50 backdrop-blur-sm rounded-full px-4 py-2 text-white/80 text-xs">
                    {isLandscape ? 'Point at teacher timetable QR card' : 'Aim camera at teacher ID card QR code'}
                  </div>
                )}
                {message && !lastResult && (
                  <div className={`w-full max-w-sm px-4 py-3 rounded-2xl text-sm font-medium text-center backdrop-blur-sm ${
                    message.startsWith('⚠️') || message.includes('not found') || message.includes('error') || message.includes('denied') || message.includes('fail')
                      ? 'bg-red-500/90 text-white'
                      : 'bg-black/60 text-white'
                  }`}>{message}</div>
                )}
              </div>

              {/* ── Recent chips ── */}
              {scanHistory.length > 0 && !lastResult && !isLoading && !isLandscape && (
                <div className="absolute bottom-14 left-0 right-0 z-20 px-3">
                  <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {scanHistory.slice(0, 6).map((r, i) => {
                      const m = statusMeta(r.action, r.status)
                      return (
                        <div key={i}
                          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-white ${m.bg} shadow`}>
                          {r.teacherName.split(' ')[0]} · P{r.period}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Phone: skeleton (bottom) ── */}
              {!isLandscape && isLoading && (
                <div className="absolute bottom-0 left-0 right-0 z-40 px-3 pb-4 profile-enter">
                  <TeacherSkeletonCard />
                </div>
              )}

              {/* ── Phone: result bottom sheet ── */}
              {!isLandscape && lastResult && !isLoading && (
                <div className={`absolute bottom-0 left-0 right-0 z-40 px-3 pb-4 ${profileVisible ? 'profile-enter' : 'profile-exit'}`}>
                  <TeacherProfileCard result={lastResult} />
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════
                TABLET LANDSCAPE: right panel
            ═══════════════════════════════════════════════ */}
            {isLandscape && (
              <div className="w-72 md:w-80 xl:w-96 bg-black/85 backdrop-blur-sm flex flex-col p-4 gap-3 overflow-y-auto">
                <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <p className="text-white/80 text-sm font-semibold">Teacher Log</p>
                  {scanCount > 0 && (
                    <span className="ml-auto text-emerald-400 text-xs font-bold">{scanCount} today</span>
                  )}
                </div>

                {isLoading && (
                  <div className="result-enter flex-shrink-0">
                    <div className="rounded-2xl overflow-hidden bg-slate-800 ring-1 ring-white/10">
                      <div className="h-9 bg-slate-700 animate-pulse" />
                      <div className="flex gap-3 p-3">
                        <div className="w-16 h-16 rounded-xl bg-slate-700 animate-pulse flex-shrink-0" />
                        <div className="flex-1 space-y-2 pt-1">
                          <div className="h-4 bg-slate-700 rounded animate-pulse w-3/4" />
                          <div className="h-3 bg-slate-600 rounded animate-pulse w-1/2" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {lastResult && !isLoading && (
                  <div className={`flex-shrink-0 result-enter transition-opacity duration-300 ${profileVisible ? 'opacity-100' : 'opacity-0'}`}>
                    <TeacherProfileCard result={lastResult} />
                  </div>
                )}

                <div className="space-y-2 overflow-y-auto flex-1">
                  {scanHistory.length === 0 && !isLoading && (
                    <p className="text-white/30 text-xs text-center py-8">No scans yet</p>
                  )}
                  {scanHistory.map((r, i) => {
                    const m = statusMeta(r.action, r.status)
                    return (
                      <div key={i} className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${m.bg}`}>
                          {r.action === 'ALREADY_RECORDED' ? '↩' : r.status === 'LATE' ? 'L' : '✓'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{r.teacherName}</p>
                          <p className="text-xs text-white/40 truncate">P{r.period}{r.subjectName ? ` · ${r.subjectName}` : ''}</p>
                        </div>
                        {r.checkIn && (
                          <span className="text-xs text-white/30 flex-shrink-0">
                            {formatCambodiaTime(r.checkIn)}
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
        {!scanning && (
          <div className="page-body space-y-5">
            {/* Header with back link */}
            <div className="page-header pb-0">
              <div className="flex items-center gap-3">
                <Link href="/wattaman/scheduled-teacher"
                  className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors flex-shrink-0">
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </Link>
                <div>
                  <h1 className="text-xl font-bold text-slate-800">Scan Teacher QR</h1>
                  <p className="text-xs text-slate-500 mt-0.5">Record teacher attendance from timetable</p>
                </div>
                <button onClick={handleLogout} title="Sign out"
                  className="ml-auto flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-500 transition-colors py-2 px-3 rounded-xl hover:bg-red-50 flex-shrink-0">
                  <span className="text-base">⏻</span>
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>
            </div>

            {/* Big scan CTA */}
            <button onClick={() => setScanning(true)} className="block w-full active:scale-[0.98] transition-transform">
              <div className="relative overflow-hidden rounded-2xl shadow-lg p-6 text-white"
                style={{ background: 'linear-gradient(135deg,#00C9A7 0%,#00a88a 50%,#008f75 100%)' }}>
                <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-white/10" />
                <div className="absolute -right-2 top-10 w-24 h-24 rounded-full bg-white/10" />
                <div className="relative z-10 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-white/80 text-sm font-medium">Ready to scan</p>
                    <h2 className="text-2xl font-bold mt-0.5">Open Teacher Scanner</h2>
                    <p className="text-white/70 text-xs mt-1">Scan teacher timetable QR cards</p>
                    <div className="mt-4 inline-flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1.5 text-sm font-semibold">
                      <span>Start Scanning</span><span>→</span>
                    </div>
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-4xl flex-shrink-0">👨‍🏫</div>
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
                    <p className="text-xs text-slate-400 mt-0.5">On Time</p>
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

            {/* Scan history */}
            {scanHistory.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recent Scans</p>
                  <button
                    onClick={() => { setScanHistory([]); setScanCount(0) }}
                    className="text-xs text-slate-400 hover:text-red-400 transition-colors">
                    Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {scanHistory.slice(0, 10).map((r, i) => {
                    const m = statusMeta(r.action, r.status)
                    return (
                      <div key={i} className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${m.bg}`}>
                          {r.action === 'ALREADY_RECORDED' ? '↩' : r.status === 'LATE' ? 'L' : '✓'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{r.teacherName}</p>
                          <p className="text-xs text-slate-400 truncate">Period {r.period}{r.subjectName ? ` · ${r.subjectName}` : ''}{r.className ? ` · ${r.className}` : ''}</p>
                        </div>
                        {r.checkIn && (
                          <span className="text-xs text-slate-400 flex-shrink-0">
                            {formatCambodiaTime(r.checkIn)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* How it works */}
            {scanHistory.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <h3 className="font-semibold text-slate-700 text-sm mb-3">How it works</h3>
                <div className="space-y-3">
                  {[
                    { icon: '📷', title: 'Open Scanner', desc: 'Tap the button above' },
                    { icon: '🪪', title: 'Point at Teacher Card', desc: 'Aim at the QR code on the teacher timetable ID card' },
                    { icon: '✅', title: 'Instant Record', desc: 'Attendance recorded for the current period automatically' },
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
        )}
      </div>
    </div>
  )
}

export default function TeacherScanPage() {
  return (
    <AuthGuard allowedRoles={['WATTAMAN', 'ADMIN']}>
      <TeacherScanContent />
    </AuthGuard>
  )
}
