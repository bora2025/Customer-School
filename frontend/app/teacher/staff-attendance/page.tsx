"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import { todayCambodia } from '../../../lib/dateUtils'

interface StaffMember {
  id: string
  name: string
  email: string
  role: string
  photo: string | null
  department?: { id: string; name: string; nameKh?: string } | null
}


interface StaffAttendanceRecord {
  id: string
  userId: string
  status: string
  checkInTime: string | null
  checkOutTime: string | null
  session: number
}

interface ScanResultInfo {
  action: string
  sessionName: string
  status: string
  date: string
  checkInTime: string | null
  checkOutTime: string | null
  userName: string
  userPhoto: string | null
  userRole: string
  userDepartment: { id: string; name: string; nameKh?: string } | null
}

interface SessionConfigItem {
  session: number
  type: string
  startTime: string
  endTime: string
}

const SESSION_NAMES: Record<number, string> = {
  1: 'Morning 1',
  2: 'Morning 2',
  3: 'Afternoon 1',
  4: 'Afternoon 2',
}

export default function TeacherStaffAttendancePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading...</p></div>}>
      <TeacherStaffAttendance />
    </Suspense>
  )
}

function TeacherStaffAttendance() {
  const { t } = useLanguage()
  const router = useRouter()

  const sessionName = (n: number) => {
    switch (n) {
      case 1: return t('attendance.morning1')
      case 2: return t('attendance.morning2')
      case 3: return t('attendance.afternoon1')
      case 4: return t('attendance.afternoon2')
      default: return `Session ${n}`
    }
  }
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [todayRecords, setTodayRecords] = useState<StaffAttendanceRecord[]>([])
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [session, setSession] = useState<number>(1)
  const [scanMode, setScanMode] = useState<'check-in' | 'check-out'>('check-in')
  const [showStaffInfo, setShowStaffInfo] = useState(false)
  const [currentStaff, setCurrentStaff] = useState<StaffMember | null>(null)
  const [scanResult, setScanResult] = useState<ScanResultInfo | null>(null)
  const [staffSessionConfigs, setStaffSessionConfigs] = useState<SessionConfigItem[]>([])
  const [dataReady, setDataReady] = useState(false)
  const autoStartedRef = useRef(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const sessionRef = useRef<number>(1)
  const scanModeRef = useRef<'check-in' | 'check-out'>('check-in')
  const staffScanLockRef = useRef(false)
  const locationRef = useRef<{ latitude: number; longitude: number; locationName?: string } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'pending' | 'granted' | 'denied' | 'unavailable'>('pending')
  const [allCameras, setAllCameras] = useState<MediaDeviceInfo[]>([])
  const allCamerasRef = useRef<MediaDeviceInfo[]>([])
  const [currentCamIdx, setCurrentCamIdx] = useState(0)
  const currentCamIdxRef = useRef(0)
  const [cameraLabel, setCameraLabel] = useState('')

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { scanModeRef.current = scanMode }, [scanMode])

  // Request and continuously update GPS location
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unavailable')
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        locationRef.current = { latitude: lat, longitude: lng, locationName: locationRef.current?.locationName }
        setLocationStatus('granted')
        // Reverse geocode to get place name (fire-and-forget)
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=0`)
          .then(r => r.json())
          .then(data => {
            if (data?.display_name && locationRef.current) {
              const short = data.display_name.split(',').slice(0, 2).map((s: string) => s.trim()).join(', ')
              locationRef.current = { ...locationRef.current, locationName: short }
            }
          })
          .catch(() => { /* ignore geocode errors */ })
      },
      (err) => {
        console.warn('Geolocation error:', err.code, err.message)
        locationRef.current = null
        setLocationStatus(err.code === 1 ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return
    setLocationStatus('pending')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        locationRef.current = { latitude: lat, longitude: lng }
        setLocationStatus('granted')
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=0`)
          .then(r => r.json())
          .then(data => {
            if (data?.display_name && locationRef.current) {
              const short = data.display_name.split(',').slice(0, 2).map((s: string) => s.trim()).join(', ')
              locationRef.current = { ...locationRef.current, locationName: short }
            }
          })
          .catch(() => {})
      },
      (err) => {
        locationRef.current = null
        setLocationStatus(err.code === 1 ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }, [])

  const playSound = useCallback((type: 'success' | 'error') => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
      const ctx = audioCtxRef.current
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      if (type === 'success') {
        oscillator.frequency.setValueAtTime(880, ctx.currentTime)
        oscillator.frequency.setValueAtTime(1108, ctx.currentTime + 0.1)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.3)
      } else {
        oscillator.frequency.setValueAtTime(330, ctx.currentTime)
        oscillator.frequency.setValueAtTime(220, ctx.currentTime + 0.15)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.4)
      }
    } catch { /* Audio not supported */ }
  }, [])

  const fetchStaffSessionConfigs = async () => {
    try {
      const res = await apiFetch('/api/session-config/staff')
      if (res.ok) {
        const data = await res.json()
        setStaffSessionConfigs(data.map((d: any) => ({
          session: d.session, type: d.type, startTime: d.startTime, endTime: d.endTime,
        })))
        autoDetectSession(data)
        setDataReady(true)
      }
    } catch (e) {
      console.error('Error fetching staff session configs:', e)
      setDataReady(true)
    }
  }

  const autoDetectSession = (configs: SessionConfigItem[]) => {
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    let matched: SessionConfigItem | null = null
    for (const cfg of configs) {
      if (hhmm >= cfg.startTime && hhmm <= cfg.endTime) {
        matched = cfg
        break
      }
    }
    if (!matched) {
      // Pick the most recently ended session (not next upcoming)
      const past = configs.filter(c => c.endTime < hhmm).sort((a, b) => b.endTime.localeCompare(a.endTime))
      if (past.length > 0) {
        matched = past[0]
      } else {
        // Before any session today → pick first upcoming
        const upcoming = configs.filter(c => c.startTime > hhmm).sort((a, b) => a.startTime.localeCompare(b.startTime))
        matched = upcoming[0] || configs[configs.length - 1] || null
      }
    }
    if (matched) {
      setSession(matched.session)
      setScanMode(matched.type === 'CHECK_OUT' ? 'check-out' : 'check-in')
    }
  }

  useEffect(() => {
    fetchStaff()
    fetchTodayRecords()
    fetchStaffSessionConfigs()
    return () => { stopScanning() }
  }, [])

  // Auto-start camera when data is ready
  useEffect(() => {
    if (dataReady && !autoStartedRef.current) {
      autoStartedRef.current = true
      if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
        setScanning(true)
        setMessage('Initializing camera...')
      }
    }
  }, [dataReady])

  useEffect(() => {
    fetchTodayRecords()
  }, [session])


  const fetchStaff = async () => {
    try {
      const res = await apiFetch('/api/auth/users?roles=TEACHER,ADMIN')
      if (res.ok) {
        const data = await res.json()
        setStaffList(data)
      }
    } catch (e) { console.error('Error fetching staff:', e) }
  }

  const fetchTodayRecords = async () => {
    try {
      const today = todayCambodia()
      const res = await apiFetch(`/api/reports/staff-attendance-grid?date=${today}`)
      if (res.ok) setTodayRecords(await res.json())
    } catch (e) { console.error('Error fetching today records:', e) }
  }

  const stopScanning = useCallback(() => {
    if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
    setScanning(false)
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    setMessage('')
  }, [])

  const handleQrScanned = useCallback((qrData: string) => {
    let staffId: string | null = null
    try {
      const parsed = JSON.parse(qrData)
      if (parsed.staffId) staffId = parsed.staffId
    } catch { /* Not JSON */ }

    // Detect Officer Attendance QR (URL-based) → self-scan
    if (!staffId && qrData.includes('/employee/scan')) {
      if (staffScanLockRef.current) return
      staffScanLockRef.current = true
      const loc = locationRef.current
      apiFetch('/api/attendance/employee/self-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrData,
          ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: loc.locationName || undefined } : {}),
        }),
      })
        .then(async res => {
          if (res.ok) {
            playSound('success')
            const result = await res.json()
            setCurrentStaff({
              id: 'self',
              name: result.userName || 'You',
              email: '',
              role: result.userRole || '',
              photo: result.userPhoto || null,
              department: result.userDepartment || null,
            })
            setScanResult(result)
            setShowStaffInfo(true)
            const action = result.action === 'CHECK_OUT' ? 'Check-out' : 'Check-in'
            setMessage(`${action} marked ✓`)
            if ('vibrate' in navigator) navigator.vibrate(200)
            setTimeout(() => {
              setShowStaffInfo(false)
              setCurrentStaff(null)
              setScanResult(null)
              stopScanning()
              router.push('/teacher')
            }, 2000)
          } else {
            playSound('error')
            const err = await res.json().catch(() => ({}))
            setMessage(err.message || 'Self-scan failed')
            setTimeout(() => { setMessage(''); staffScanLockRef.current = false }, 3000)
          }
        })
        .catch(() => {
          setMessage('Self-scan error')
          setTimeout(() => { setMessage(''); staffScanLockRef.current = false }, 3000)
        })
      return
    }

    if (!staffId) {
      playSound('error')
      setMessage('Not a staff QR code')
      setTimeout(() => setMessage(''), 3000)
      return
    }

    if (staffScanLockRef.current) return
    staffScanLockRef.current = true

    const loc = locationRef.current
    apiFetch('/api/attendance/staff/auto-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: staffId, ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: loc.locationName || undefined } : {}) }),
    })
      .then(async res => {
        if (res.ok) {
          playSound('success')
          const result = await res.json()
          setCurrentStaff({
            id: staffId!,
            name: result.userName || 'Unknown',
            email: '',
            role: result.userRole || '',
            photo: result.userPhoto || null,
            department: result.userDepartment || null,
          })
          setScanResult(result)
          setShowStaffInfo(true)
          const action = result.action === 'CHECK_OUT' ? 'Check-out' : 'Check-in'
          setMessage(`${action} marked ✓`)
          if ('vibrate' in navigator) navigator.vibrate(200)
          // Auto-close camera and redirect to dashboard after 2 seconds
          setTimeout(() => {
            setShowStaffInfo(false)
            setCurrentStaff(null)
            setScanResult(null)
            stopScanning()
            router.push('/teacher')
          }, 2000)
        } else {
          playSound('error')
          const err = await res.json().catch(() => ({}))
          setMessage(err.message || 'Attendance failed')
          setTimeout(() => { setMessage(''); staffScanLockRef.current = false }, 3000)
        }
      })
      .catch(() => {
        setMessage('Staff attendance error')
        setTimeout(() => { setMessage(''); staffScanLockRef.current = false }, 3000)
      })
  }, [staffList, playSound, stopScanning, router])

  useEffect(() => {
    if (!scanning || !videoRef.current) return
    let cancelled = false
    const videoEl = videoRef.current
    const initCamera = async () => {
      try {
        if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
        videoEl.pause()
        if (videoEl.srcObject) {
          (videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop())
          videoEl.srcObject = null
        }
        await new Promise(r => setTimeout(r, 400))
        if (cancelled) return

        const reader = new BrowserMultiFormatReader()
        codeReaderRef.current = reader

        let cameras = allCamerasRef.current
        if (cameras.length === 0) {
          cameras = await reader.listVideoInputDevices()
          cameras.sort((a, b) => {
            const aBack = /back|rear|environment|後/i.test(a.label) ? 0 : 1
            const bBack = /back|rear|environment|後/i.test(b.label) ? 0 : 1
            return aBack - bBack
          })
          allCamerasRef.current = cameras
          if (!cancelled) setAllCameras([...cameras])
        }
        if (cancelled) return

        const camIdx = currentCamIdxRef.current
        const deviceId = cameras.length > 0 && camIdx < cameras.length
          ? cameras[camIdx].deviceId
          : undefined
        const label = cameras.length > 0 && camIdx < cameras.length
          ? cameras[camIdx].label || `Camera ${camIdx + 1}`
          : 'Default'
        if (!cancelled) setCameraLabel(label)

        reader.timeBetweenDecodingAttempts = 150
        await reader.decodeFromVideoDevice(deviceId || null, videoEl, (result) => {
          if (cancelled) return
          if (result) handleQrScanned(result.getText())
        })

        const applyFocus = () => {
          try {
            const stream = videoEl.srcObject as MediaStream | null
            const track = stream?.getVideoTracks()[0]
            if (track) {
              const caps = track.getCapabilities?.() as any
              if (caps?.focusMode?.includes('continuous')) {
                track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] })
              }
            }
          } catch { /* focus not supported */ }
        }
        if (videoEl.readyState >= 2) applyFocus()
        else videoEl.addEventListener('playing', applyFocus, { once: true })

        if (!cancelled) setMessage('Camera ready — point at staff QR code')
      } catch (error: any) {
        if (cancelled) return
        if (error.name === 'NotAllowedError') setMessage('Camera access denied.')
        else if (error.name === 'NotFoundError') setMessage('No camera found.')
        else setMessage('Failed to start camera.')
        setScanning(false)
      }
    }
    initCamera()
    return () => {
      cancelled = true
      if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
      if (videoEl.srcObject) {
        (videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop())
        videoEl.srcObject = null
      }
    }
  }, [scanning, handleQrScanned, currentCamIdx])

  const switchCamera = useCallback(() => {
    const cameras = allCamerasRef.current
    if (cameras.length <= 1) return
    const nextIdx = (currentCamIdx + 1) % cameras.length
    currentCamIdxRef.current = nextIdx
    setCurrentCamIdx(nextIdx)
  }, [currentCamIdx])

  const startScanning = () => {
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') { setMessage('Camera not supported'); return }
    setScanning(true)
    setMessage('Initializing camera...')
  }

  const checkedInCount = todayRecords.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length
  const totalStaff = staffList.length
  const progressPct = totalStaff > 0 ? (checkedInCount / totalStaff) * 100 : 0

  const getStaffRecord = (userId: string) => todayRecords.find(r => r.userId === userId && r.session === session)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-14 lg:hidden" />

      {/* ===== FULLSCREEN CAMERA MODE ===== */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />

          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-64 h-64 sm:w-72 sm:h-72 relative">
                <div className="absolute inset-0 bg-black/0 rounded-2xl" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }} />
                <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-teal-400 rounded-tl-2xl drop-shadow-[0_0_8px_rgba(0,201,167,0.5)]" />
                <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-teal-400 rounded-tr-2xl drop-shadow-[0_0_8px_rgba(0,201,167,0.5)]" />
                <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-teal-400 rounded-bl-2xl drop-shadow-[0_0_8px_rgba(0,201,167,0.5)]" />
                <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-teal-400 rounded-br-2xl drop-shadow-[0_0_8px_rgba(0,201,167,0.5)]" />
                <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-teal-400 to-transparent drop-shadow-[0_0_8px_rgba(0,201,167,0.6)]" style={{ animation: 'scanLine 2.5s ease-in-out infinite' }} />
              </div>
            </div>
          </div>

          <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 bg-gradient-to-b from-black/70 to-transparent">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                scanMode === 'check-in' ? 'bg-teal-500 text-white' : 'bg-sky-500 text-white'
              }`}>
                {scanMode === 'check-in' ? '📥 Check-In' : '📤 Check-Out'}
              </div>
              <div className="flex flex-col">
                <span className="text-white/90 text-xs font-medium">{sessionName(session)} · Session {session}</span>
                {(() => { const cfg = staffSessionConfigs.find(c => c.session === session); return cfg ? <span className="text-white/60 text-[11px]">⏰ {cfg.startTime} – {cfg.endTime}</span> : null })()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {allCameras.length > 1 && (
                <button
                  onClick={switchCamera}
                  className="h-10 px-3 rounded-full bg-white/20 backdrop-blur-sm flex items-center gap-1.5 text-white shadow-lg active:scale-95 transition-transform"
                  title={`Switch camera (${currentCamIdx + 1}/${allCameras.length})`}
                >
                  🔄 <span className="text-xs max-w-[80px] truncate">{cameraLabel}</span>
                </button>
              )}
              <button onClick={() => { stopScanning(); router.push('/teacher') }} className="w-10 h-10 rounded-full bg-red-500/90 backdrop-blur-sm flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform">
              ✕
            </button>
            </div>
          </div>

          {/* Session schedule cards (info-only) */}
          {staffSessionConfigs.length > 0 && (
            <div className="relative z-10 px-4 mt-2">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {staffSessionConfigs.map(cfg => {
                  const isActive = cfg.session === session
                  const now = new Date()
                  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
                  const isCurrent = hhmm >= cfg.startTime && hhmm <= cfg.endTime
                  return (
                    <div
                      key={cfg.session}
                      className={`relative flex-shrink-0 px-3 py-2 rounded-xl text-left border backdrop-blur-md ${
                        isActive
                          ? 'border-teal-400 bg-teal-500/30 ring-1 ring-teal-400'
                          : 'border-white/20 bg-white/10'
                      }`}
                    >
                      {isCurrent && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                      <div className="text-[10px] text-white/70">{sessionName(cfg.session)}</div>
                      <div className={`text-[11px] font-bold ${cfg.type === 'CHECK_IN' ? 'text-emerald-300' : 'text-blue-300'}`}>
                        {cfg.type === 'CHECK_IN' ? '📥 In' : '📤 Out'}
                      </div>
                      <div className="text-[10px] text-white/50">{cfg.startTime}–{cfg.endTime}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="relative z-10 mt-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-6 pt-8">
            {message && (
              <div className={`mb-3 px-4 py-2.5 rounded-xl text-sm font-medium text-center ${
                message.includes('checked') || message.includes('Camera ready')
                  ? 'bg-emerald-500/90 text-white'
                  : message.includes('Not a staff')
                    ? 'bg-amber-500/90 text-white'
                    : 'bg-white/20 text-white backdrop-blur-sm'
              }`}>
                {message}
              </div>
            )}
            <div className="flex items-center justify-between text-white/90">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                <span className="text-xs font-medium">Scanning for staff QR codes...</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-medium">
                <span className="px-2 py-1 rounded-full bg-emerald-500/30">{checkedInCount} ✓</span>
                <span className="px-2 py-1 rounded-full bg-white/20">{totalStaff} total</span>
              </div>
            </div>
            <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
              <div className="h-1 bg-teal-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {showStaffInfo && currentStaff && scanResult && (
            <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
              <div className="w-full sm:max-w-sm bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl overflow-hidden sm:mx-4 animate-[slideUp_0.35s_ease-out]">
                <div className={`relative px-6 py-6 text-center overflow-hidden ${
                  scanResult.action === 'CHECK_OUT'
                    ? 'bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-500'
                    : 'bg-gradient-to-br from-teal-500 via-emerald-500 to-cyan-500'
                }`}>
                  <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
                  <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-white/10" />
                  <p className="text-sm font-medium text-white/80 mb-1">
                    {scanResult.action === 'CHECK_OUT' ? '📤 Check-Out' : '📥 Check-In'} · {scanResult.sessionName}
                  </p>
                  <h2 className="text-2xl font-extrabold text-white tracking-tight">{currentStaff.name}</h2>
                </div>
                <div className="px-6 py-5 flex flex-col items-center">
                  <div className="relative -mt-12 mb-3">
                    <div className="w-20 h-20 rounded-full border-4 border-white shadow-xl bg-teal-50 text-teal-600 flex items-center justify-center text-3xl font-bold overflow-hidden">
                      {currentStaff.photo ? (
                        <img src={currentStaff.photo} alt={currentStaff.name} className="w-full h-full object-cover" />
                      ) : (
                        currentStaff.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className={`absolute -bottom-1 right-0 w-7 h-7 rounded-full border-2 border-white text-white flex items-center justify-center text-xs ${
                      scanResult.action === 'CHECK_OUT' ? 'bg-sky-500' : 'bg-emerald-500'
                    }`}>{scanResult.action === 'CHECK_OUT' ? '↑' : '✓'}</div>
                  </div>
                  {/* Position & Department */}
                  <p className="text-sm font-medium text-slate-700">💼 {t('role.' + (currentStaff.role || '').toLowerCase()) || currentStaff.role}</p>
                  {scanResult.userDepartment && (
                    <p className="text-xs text-slate-500 mt-0.5">🏢 {scanResult.userDepartment.name}</p>
                  )}
                  {/* Date & Time details */}
                  <div className="mt-3 w-full space-y-2">
                    <div className="flex items-center gap-3 py-2.5 px-4 bg-slate-50 rounded-xl">
                      <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center text-teal-600 text-sm">📅</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Date</p>
                        <p className="font-bold text-slate-800 text-sm">{new Date(scanResult.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 py-2.5 px-4 bg-slate-50 rounded-xl">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                        scanResult.action === 'CHECK_OUT' ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'
                      }`}>{scanResult.action === 'CHECK_OUT' ? '📤' : '📥'}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Time</p>
                        <p className="font-bold text-slate-800 text-sm">
                          {scanResult.action === 'CHECK_OUT' && scanResult.checkOutTime
                            ? formatCambodiaTime(scanResult.checkOutTime)
                            : scanResult.checkInTime
                              ? formatCambodiaTime(scanResult.checkInTime)
                              : 'Just now'}
                        </p>
                      </div>
                      {scanResult.status && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          scanResult.status === 'LATE' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>{scanResult.status}</span>
                      )}
                    </div>
                  </div>
                  <div className={`mt-4 w-full px-4 py-3 rounded-xl text-sm font-bold text-center border ${
                    scanResult.action === 'CHECK_OUT'
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    ✅ Attendance Marked
                  </div>
                  <p className="text-xs text-slate-400 mt-3 pb-2">Redirecting to dashboard...</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!scanning && <video ref={videoRef} className="hidden" autoPlay playsInline muted />}

      {/* ===== TOP BAR ===== */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-800">{t('attendance.title')}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">{checkedInCount} {t('attendance.checkedIn')}</span>
              <span className="text-slate-300 text-xs">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">{totalStaff} {t('attendance.totalStaff')}</span>
              <span className="text-slate-300 text-xs hidden sm:inline">·</span>
              <span className="text-xs text-slate-400 hidden sm:inline">Session {session} · {scanMode === 'check-in' ? '📥 Check-In' : '📤 Check-Out'}{(() => { const cfg = staffSessionConfigs.find(c => c.session === session); return cfg ? ` · ${cfg.startTime}–${cfg.endTime}` : '' })()}</span>
            </div>
          </div>
          <Link href="/teacher" className="shrink-0 text-sm text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors">
            ← Back
          </Link>
        </div>
        <div className="h-1 bg-slate-100">
          <div className="h-1 bg-emerald-500 transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {message && !scanning && (
          <div className={`px-4 py-3 rounded-xl text-sm font-medium shadow-sm ${
            message.includes('checked') ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}>
            {message}
          </div>
        )}

        {/* ===== STAFF SESSION TIME WINDOWS ===== */}
        {staffSessionConfigs.length > 0 && (
          <div className="card p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-slate-700">⏰ Staff Session Schedule</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {staffSessionConfigs.map(cfg => {
                const isActive = cfg.session === session
                const now = new Date()
                const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
                const isCurrent = hhmm >= cfg.startTime && hhmm <= cfg.endTime
                return (
                  <div
                    key={cfg.session}
                    className={`relative p-2.5 rounded-xl text-left border ${
                      isActive
                        ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    )}
                    <div className="text-[11px] font-medium text-slate-500">{sessionName(cfg.session)}</div>
                    <div className={`text-xs font-bold mt-0.5 ${
                      cfg.type === 'CHECK_IN' ? 'text-emerald-600' : 'text-blue-600'
                    }`}>
                      {cfg.type === 'CHECK_IN' ? '📥 Check-In' : '📤 Check-Out'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{cfg.startTime} – {cfg.endTime}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ===== SESSION STATUS ===== */}
        <div className="card p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                scanMode === 'check-in' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {scanMode === 'check-in' ? '📥 Check-In' : '📤 Check-Out'} · Session {session}
              </div>
              {(() => {
                const cfg = staffSessionConfigs.find(c => c.session === session)
                return cfg ? <span className="text-xs text-slate-400">{cfg.startTime} – {cfg.endTime}</span> : null
              })()}
            </div>
            <div className="text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              {checkedInCount}/{totalStaff} {t('attendance.checkedIn')}
            </div>
          </div>
        </div>

        {/* ===== LOCATION STATUS ===== */}
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
          locationStatus === 'granted'
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : locationStatus === 'denied'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : locationStatus === 'unavailable'
                ? 'bg-slate-50 text-slate-500 border border-slate-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          <span>{locationStatus === 'granted' ? '📍' : locationStatus === 'denied' ? '🚫' : locationStatus === 'unavailable' ? '📍' : '⏳'}</span>
          <span className="flex-1">
            {locationStatus === 'granted'
              ? `Location active (${locationRef.current?.latitude.toFixed(4)}, ${locationRef.current?.longitude.toFixed(4)})`
              : locationStatus === 'denied'
                ? 'Location blocked — enable in browser settings'
                : locationStatus === 'unavailable'
                  ? 'Location unavailable on this device'
                  : 'Requesting location...'}
          </span>
          {(locationStatus === 'denied' || locationStatus === 'unavailable') && (
            <button onClick={requestLocation} className="px-2.5 py-1 bg-white rounded-lg border border-current/20 text-xs font-bold hover:bg-slate-50 transition-colors">
              Retry
            </button>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={startScanning}
            className="flex-1 sm:flex-none bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-3.5 sm:py-3 px-6 rounded-xl shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all text-sm sm:text-base"
          >
            📷 Scan Staff QR
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-700">{t('attendance.staffRoster')}</h2>
            <span className="text-xs text-slate-400">{checkedInCount}/{totalStaff} {t('attendance.checkedIn')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {staffList.map(staff => {
              const record = getStaffRecord(staff.id)
              const status = record?.status || 'NOT_RECORDED'

              return (
                <div
                  key={staff.id}
                  className={`card p-3 sm:p-4 transition-all duration-300 ${
                    status === 'PRESENT' ? 'border-emerald-300 bg-emerald-50/50' :
                    status === 'LATE' ? 'border-amber-300 bg-amber-50/50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center overflow-hidden text-sm font-bold shrink-0 ${
                      status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300' :
                      status === 'LATE' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {staff.photo ? (
                        <img src={staff.photo} alt={staff.name} className="w-full h-full object-cover" />
                      ) : (
                        staff.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-slate-800 truncate text-sm">{staff.name}</h3>
                      <p className="text-xs text-slate-400 truncate">
                        {staff.role === 'ADMIN' ? '🛡️' : '👨‍🏫'} {staff.role} · {staff.email}
                      </p>
                    </div>
                    {status === 'PRESENT' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-emerald-100 text-emerald-800">{t('common.present')}</span>}
                    {status === 'LATE' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-amber-100 text-amber-800">{t('common.late')}</span>}
                    {status === 'NOT_RECORDED' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-slate-100 text-slate-600">—</span>}
                  </div>
                  {record && (
                    <div className="mt-2 flex gap-2 text-[11px] text-slate-500">
                      {record.checkInTime && <span>📥 {formatCambodiaTime(record.checkInTime)}</span>}
                      {record.checkOutTime && <span>📤 {formatCambodiaTime(record.checkOutTime)}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {staffList.length === 0 && (
            <div className="card p-12">
              <div className="text-center text-slate-400">
                <p className="text-5xl mb-3">👔</p>
                <p className="font-semibold text-slate-600">No staff found</p>
                <p className="text-sm text-slate-400 mt-1">Teachers and admins will appear here.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes scanLine {
          0%, 100% { top: 0%; }
          50% { top: 100%; }
        }
      `}</style>
    </div>
  )
}
