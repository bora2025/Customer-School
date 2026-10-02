"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { BrowserMultiFormatReader } from '@zxing/library'
import Link from 'next/link'
import { apiFetch, getCurrentUser } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import { useLanguage } from '../../../lib/i18n'
import { todayCambodia } from '../../../lib/dateUtils'

interface Student {
  id: string
  userId: string
  name: string
  email: string
  qrCode: string | null
  photo: string | null
  sex: string | null
  className: string | null
}

interface AttendanceRecord {
  studentId: string
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'PERMISSION'
  checkInTime?: string // ISO string of actual scan time
  permissionType?: string
}

interface StaffMember {
  id: string
  name: string
  email: string
  role: string
  photo: string | null
}


const ATTENDANCE_PRESETS = [
  {
    id: 'full-day', name: 'Full Day', icon: '☀️', description: '7:00 AM – 5:00 PM (Morning + Afternoon)',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:15' },
      { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:15' },
    ],
  },
  {
    id: 'morning-only', name: 'Morning Only', icon: '🌅', description: '7:00 AM – 12:00 PM',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '11:45', endTime: '12:00' },
      { session: 3, type: 'CHECK_IN', startTime: '12:00', endTime: '12:00' },
      { session: 4, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:00' },
    ],
  },
  {
    id: 'afternoon-only', name: 'Afternoon Only', icon: '🌤️', description: '1:00 PM – 5:30 PM',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '13:00', endTime: '13:00' },
      { session: 2, type: 'CHECK_OUT', startTime: '13:00', endTime: '13:00' },
      { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:15', endTime: '17:30' },
    ],
  },
  {
    id: 'evening', name: 'Evening', icon: '🌆', description: '6:00 PM – 9:00 PM',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '18:00', endTime: '18:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '20:45', endTime: '21:00' },
      { session: 3, type: 'CHECK_IN', startTime: '21:00', endTime: '21:00' },
      { session: 4, type: 'CHECK_OUT', startTime: '21:00', endTime: '21:00' },
    ],
  },
  {
    id: 'night-shift', name: 'Night Shift', icon: '🌙', description: '6:00 PM – 6:00 AM (overnight)',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '18:00', endTime: '18:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '23:45', endTime: '23:59' },
      { session: 3, type: 'CHECK_IN', startTime: '00:00', endTime: '00:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '05:45', endTime: '06:00' },
    ],
  },
]

function detectAttendanceFormat(configs: Array<{session: number; type: string; startTime: string; endTime: string}>) {
  for (const preset of ATTENDANCE_PRESETS) {
    const match = preset.configs.every(pc => {
      const c = configs.find(x => x.session === pc.session)
      return c && c.type === pc.type && c.startTime === pc.startTime && c.endTime === pc.endTime
    })
    if (match) return preset
  }
  // Custom format — derive description from active sessions
  const active = configs.filter(c => c.startTime !== c.endTime)
  const firstStart = active.length > 0 ? active.sort((a, b) => a.startTime.localeCompare(b.startTime))[0].startTime : ''
  const lastEnd = active.length > 0 ? active.sort((a, b) => b.endTime.localeCompare(a.endTime))[0].endTime : ''
  return { id: 'custom', name: 'Custom', icon: '⚙️', description: active.length > 0 ? `${firstStart} – ${lastEnd}` : 'No active sessions' }
}

export default function TakeAttendancePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading...</p></div>}>
      <TakeAttendance />
    </Suspense>
  )
}

interface ClassItem {
  id: string
  name: string
  subject: string | null
  schedule?: string | null
}

function TakeAttendance() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const classIdFromUrl = searchParams.get('classId')
  const [selectedClassId, setSelectedClassId] = useState<string>(classIdFromUrl || '')
  const classId = selectedClassId || null
  const [teacherClasses, setTeacherClasses] = useState<ClassItem[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')
  const [showStudentInfo, setShowStudentInfo] = useState(false)
  const [currentStudent, setCurrentStudent] = useState<Student | null>(null)
  const [countdown, setCountdown] = useState(10)
  const [scanHistory, setScanHistory] = useState<string[]>([])
  const [teacherId, setTeacherId] = useState<string>('')
  const [session, setSession] = useState<number>(1)
  const [scanMode, setScanMode] = useState<'check-in' | 'check-out'>('check-in')
  const [sessionConfigs, setSessionConfigs] = useState<Array<{session: number; type: string; startTime: string; endTime: string}>>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [showStaffInfo, setShowStaffInfo] = useState(false)
  const [currentStaffScanned, setCurrentStaffScanned] = useState<StaffMember | null>(null)
  const [staffScanResult, setStaffScanResult] = useState<{ action: string; sessionName: string; status: string; date: string; checkInTime: string | null; checkOutTime: string | null; userDepartment: { id: string; name: string; nameKh?: string } | null } | null>(null)
  const [todayHoliday, setTodayHoliday] = useState<string | null>(null)
  const [scheduledDayOff, setScheduledDayOff] = useState(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'pending' | 'granted' | 'denied' | 'unavailable'>('pending')

  // Request and continuously update GPS location
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unavailable')
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        locationRef.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
        setLocationStatus('granted')
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
        locationRef.current = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
        setLocationStatus('granted')
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

  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)
  const scanningRef = useRef(false)
  const showStudentInfoRef = useRef(false)
  const staffScanLockRef = useRef(false)
  const studentsRef = useRef<Student[]>([])
  const attendanceRef = useRef<AttendanceRecord[]>([])
  const sessionConfigsRef = useRef<Array<{session: number; type: string; startTime: string; endTime: string}>>([])
  const sessionRef = useRef<number>(1)
  const scanModeRef = useRef<'check-in' | 'check-out'>('check-in')
  const [allCameras, setAllCameras] = useState<MediaDeviceInfo[]>([])
  const allCamerasRef = useRef<MediaDeviceInfo[]>([])
  const [currentCamIdx, setCurrentCamIdx] = useState(0)
  const currentCamIdxRef = useRef(0)
  const [cameraLabel, setCameraLabel] = useState('')

  useEffect(() => { showStudentInfoRef.current = showStudentInfo }, [showStudentInfo])
  useEffect(() => { scanningRef.current = scanning }, [scanning])
  useEffect(() => { studentsRef.current = students }, [students])
  useEffect(() => { attendanceRef.current = attendance }, [attendance])
  useEffect(() => { sessionConfigsRef.current = sessionConfigs }, [sessionConfigs])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { scanModeRef.current = scanMode }, [scanMode])

  /** Detect the correct session & mode based on current Cambodia time */
  const detectCurrentSession = useCallback(() => {
    const cfgs = sessionConfigsRef.current
    if (cfgs.length === 0) return null
    const active = cfgs.filter(c => c.startTime !== c.endTime)
    if (active.length === 0) return null
    const cambodiaNow = new Date(Date.now() + 7 * 60 * 60 * 1000)
    const nowMin = cambodiaNow.getUTCHours() * 60 + cambodiaNow.getUTCMinutes()
    const withMinutes = active.map(c => {
      const [sh, sm] = c.startTime.split(':').map(Number)
      const [eh, em] = c.endTime.split(':').map(Number)
      return { ...c, startMin: sh * 60 + sm, endMin: eh * 60 + em }
    }).sort((a, b) => a.startMin - b.startMin)

    // Pick the session with the latest startMin that still contains the current time.
    // Using the last match (highest startMin) prevents a wide-window session (e.g. 00:45–13:15)
    // from overshadowing a narrower, more recently started session (e.g. 08:45–09:15).
    const matching = withMinutes.filter(s => nowMin >= s.startMin && nowMin <= s.endMin)
    let best = matching.length > 0 ? matching[matching.length - 1] : undefined
    if (!best) {
      best = withMinutes.find(s => nowMin >= s.startMin - 30 && nowMin < s.startMin)
    }
    if (!best) {
      const past = withMinutes.filter(s => nowMin >= s.startMin)
      best = past.length > 0 ? past[past.length - 1] : withMinutes[0]
    }
    const mode: 'check-in' | 'check-out' = best.type === 'CHECK_IN' ? 'check-in' : 'check-out'
    return { session: best.session, mode }
  }, [])

  // Auto-detect session on load and every 30 seconds
  useEffect(() => {
    const update = () => {
      const detected = detectCurrentSession()
      if (detected) {
        setSession(detected.session)
        setScanMode(detected.mode)
      }
    }
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [sessionConfigs, detectCurrentSession])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (user) setTeacherId(user.userId)
    })
  }, [])

  // Fetch teacher's classes for the selector
  useEffect(() => {
    const fetchTeacherClasses = async () => {
      try {
        const user = await getCurrentUser()
        if (!user) return
        const res = await apiFetch(`/api/classes?teacherId=${user.userId}`)
        if (res.ok) {
          const data = await res.json()
          setTeacherClasses(data)
          // Auto-select first class if none from URL
          if (!classIdFromUrl && data.length > 0) {
            setSelectedClassId(data[0].id)
          }
        }
      } catch (e) { console.error('Error fetching teacher classes:', e) }
    }
    fetchTeacherClasses()
  }, [classIdFromUrl])

  useEffect(() => {
    if (classId) fetchStudents()
    fetchSessionConfigs()
    fetchStaff()
    checkScheduledDayOff()
    // Check if today is a holiday
    const now = new Date()
    const utc = now.getTime() + now.getTimezoneOffset() * 60000
    const cambodia = new Date(utc + 7 * 3600000)
    const todayISO = cambodia.toISOString().split('T')[0]
    apiFetch(`/api/holidays/check?date=${todayISO}`).then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.isHoliday) {
          apiFetch(`/api/holidays?year=${cambodia.getFullYear()}&month=${cambodia.getMonth() + 1}`).then(r => r.ok ? r.json() : [])
            .then(holidays => {
              const match = holidays.find((h: any) => h.date.split('T')[0] === todayISO)
              setTodayHoliday(match ? match.name : 'Holiday')
            })
        }
      }).catch(() => {})
    return () => { stopScanning() }
  }, [classId])

  const fetchSessionConfigs = async () => {
    try {
      const url = classId ? `/api/session-config?classId=${classId}` : '/api/session-config'
      const res = await apiFetch(url)
      if (res.ok) setSessionConfigs(await res.json())
    } catch (e) { console.error('Error fetching session configs:', e) }
  }

  const fetchStaff = async () => {
    try {
      const res = await apiFetch('/api/auth/users?roles=TEACHER,ADMIN')
      if (res.ok) setStaffList(await res.json())
    } catch (e) { console.error('Error fetching staff:', e) }
  }

  const fetchStudents = async () => {
    try {
      const res = await apiFetch(`/api/classes/${classId}/students`)
      if (res.ok) {
        const data = await res.json()
        setStudents(data)
        // If scheduled day-off, auto-set all students to PERMISSION
        const cls = teacherClasses.find(c => c.id === classId)
        const isDayOff = checkClassDayOff(cls?.schedule)
        setAttendance(data.map((s: Student) => ({ studentId: s.id, status: isDayOff ? 'PERMISSION' as const : 'ABSENT' as const })))
      }
    } catch (error) { console.error('Error fetching students:', error) }
  }

  const checkClassDayOff = (schedule?: string | null): boolean => {
    if (!schedule) return false
    try {
      const parsed = JSON.parse(schedule)
      const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
      const now = new Date()
      const utc = now.getTime() + now.getTimezoneOffset() * 60000
      const cambodia = new Date(utc + 7 * 3600000)
      const dayName = DAY_NAMES[cambodia.getUTCDay()]
      return parsed[dayName] === 'day-off'
    } catch { return false }
  }

  const checkScheduledDayOff = () => {
    const cls = teacherClasses.find(c => c.id === classId)
    setScheduledDayOff(checkClassDayOff(cls?.schedule))
  }

  // Mirrors backend/src/attendance/attendance.service.ts's own late-detection
  // (cfg.endTime, not startTime+20) — this used to use a different, looser
  // threshold than the backend's authoritative check, so a student scanned
  // between endTime and startTime+20 showed as "✓ Present" here but was
  // silently flipped to LATE the moment the record actually got saved.
  const isLateByConfig = () => {
    const cfg = sessionConfigsRef.current.find(c => c.session === sessionRef.current)
    if (!cfg) return false
    const [h, m] = cfg.endTime.split(':').map(Number)
    const lateAfterMinutes = h * 60 + m
    const cambodiaNow = new Date(Date.now() + 7 * 60 * 60 * 1000)
    const nowMinutes = cambodiaNow.getUTCHours() * 60 + cambodiaNow.getUTCMinutes()
    return nowMinutes > lateAfterMinutes
  }

  const updateAttendance = useCallback((studentId: string, status: 'PRESENT' | 'ABSENT' | 'LATE' | 'PERMISSION') => {
    const isAttending = status === 'PRESENT' || status === 'LATE'
    setAttendance(prev => prev.map(a => {
      if (a.studentId !== studentId) return a
      const wasAttending = a.status === 'PRESENT' || a.status === 'LATE'
      return {
        ...a,
        status,
        // Preserve first check-in time — only assign a new time if the student wasn't already marked
        checkInTime: isAttending ? (wasAttending && a.checkInTime ? a.checkInTime : new Date().toISOString()) : undefined,
        permissionType: status === 'PERMISSION' ? (a.permissionType || 'FULL_DAY') : a.permissionType,
      }
    }))
  }, [])

  const updatePermissionType = useCallback((studentId: string, permType: string) => {
    setAttendance(prev => prev.map(a => a.studentId === studentId ? { ...a, permissionType: permType } : a))
  }, [])

  const handleQrScanned = useCallback((qrData: string) => {
    if (showStudentInfoRef.current) return

    // Auto-detect the correct session & mode at scan time
    const detected = detectCurrentSession()
    if (detected) {
      sessionRef.current = detected.session
      scanModeRef.current = detected.mode
      setSession(detected.session)
      setScanMode(detected.mode)
    }

    let studentId = qrData
    let qrWasJson = false
    try {
      const parsedData = JSON.parse(qrData)
      qrWasJson = parsedData !== null && typeof parsedData === 'object'
      if (parsedData.studentId) studentId = parsedData.studentId
      if (parsedData.staffId) {
        // Handle staff QR code via auto-scan API
        if (staffScanLockRef.current) return
        staffScanLockRef.current = true
        const loc = locationRef.current
        apiFetch('/api/attendance/staff/auto-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: parsedData.staffId, ...(loc ? { latitude: loc.latitude, longitude: loc.longitude } : {}) }),
        })
          .then(async res => {
            if (res.ok) {
              playSound('success')
              const result = await res.json()
              setCurrentStaffScanned({
                id: parsedData.staffId,
                name: result.userName || 'Unknown',
                email: '',
                role: result.userRole || '',
                photo: result.userPhoto || null,
              })
              setStaffScanResult(result)
              setShowStaffInfo(true)
              const action = result.action === 'CHECK_OUT' ? 'Check-out' : 'Check-in'
              setMessage(`Staff ${action} marked ✓`)
              if ('vibrate' in navigator) navigator.vibrate(200)
              setTimeout(() => {
                setShowStaffInfo(false)
                setCurrentStaffScanned(null)
                setStaffScanResult(null)
                setMessage('')
                staffScanLockRef.current = false
              }, 3000)
            } else {
              playSound('error')
              const err = await res.json().catch(() => ({}))
              setMessage(err.message || 'Staff attendance failed')
              setTimeout(() => { setMessage(''); staffScanLockRef.current = false }, 3000)
            }
          })
          .catch(() => {
            setMessage('Staff attendance error')
            setTimeout(() => { setMessage(''); staffScanLockRef.current = false }, 3000)
          })
        return
      }
    } catch { /* Not JSON */ }

    // Detect Officer Attendance QR (URL-based) → self-scan
    if (qrData.includes('/employee/scan')) {
      if (staffScanLockRef.current) return
      staffScanLockRef.current = true
      const loc = locationRef.current
      apiFetch('/api/attendance/employee/self-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrData,
          ...(loc ? { latitude: loc.latitude, longitude: loc.longitude, location: `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` } : {}),
        }),
      })
        .then(async res => {
          if (res.ok) {
            playSound('success')
            const result = await res.json()
            setCurrentStaffScanned({
              id: 'self',
              name: result.userName || 'You',
              email: '',
              role: result.userRole || '',
              photo: result.userPhoto || null,
            })
            setStaffScanResult(result)
            setShowStaffInfo(true)
            const action = result.action === 'CHECK_OUT' ? 'Check-out' : 'Check-in'
            setMessage(`${action} marked ✓`)
            if ('vibrate' in navigator) navigator.vibrate(200)
            setTimeout(() => {
              setShowStaffInfo(false)
              setCurrentStaffScanned(null)
              setStaffScanResult(null)
              setMessage('')
              staffScanLockRef.current = false
            }, 3000)
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

    const currentStudents = studentsRef.current
    const currentAttendance = attendanceRef.current
    // Priority-ordered matching: primary IDs first, then legacy qrCode field as fallback.
    // This way an exact Student.id / User.id match always wins over a stale qrCode collision
    // (which previously could cause Student A's scan to surface Student B), while still
    // allowing legacy printed cards whose QR encodes the qrCode field to scan.
    const student =
      currentStudents.find(s => s.id === studentId) ||
      currentStudents.find(s => s.userId === studentId) ||
      (qrWasJson
        ? currentStudents.find(s => !!s.qrCode && s.qrCode === studentId)
        : currentStudents.find(s => !!s.qrCode && (s.qrCode === studentId || s.qrCode === qrData)))

    if (!student) {
      playSound('error')
      setMessage(`Student not found for QR: "${qrData}"`)
      if ('vibrate' in navigator) navigator.vibrate([100, 100, 100])
      setTimeout(() => setMessage(''), 3000)
      return
    }

    const existing = currentAttendance.find(a => a.studentId === student.id)
    if (scanModeRef.current === 'check-in' && (existing?.status === 'PRESENT' || existing?.status === 'LATE')) {
      playSound('error')
      setMessage(`${student.name} is already marked ${existing?.status === 'LATE' ? 'late' : 'present'}`)
      setTimeout(() => setMessage(''), 3000)
      return
    }

    if (scanModeRef.current === 'check-out') {
      apiFetch('/api/attendance/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: student.id, classId, session: sessionRef.current }),
      })
        .then(res => {
          if (res.ok) {
            playSound('success')
            setMessage(`${student.name} checked out ✓`)
            if ('vibrate' in navigator) navigator.vibrate(200)
          } else {
            playSound('error')
            setMessage(`Check-out failed for ${student.name}`)
          }
        })
        .catch(() => {
          setMessage(`Check-out error for ${student.name}`)
        })
        .finally(() => {
          setTimeout(() => setMessage(''), 3000)
        })
      return
    }

    // If today is a scheduled day-off, auto-mark as PERMISSION instead of scanning
    if (scheduledDayOff) {
      playSound('error')
      setMessage(`Today is a scheduled day-off for this class — ${student.name} marked as PERMISSION`)
      updateAttendance(student.id, 'PERMISSION')
      setTimeout(() => setMessage(''), 3000)
      return
    }

    // Determine if this student is late (>20 min after session config start time)
    const autoStatus: 'PRESENT' | 'LATE' = isLateByConfig() ? 'LATE' : 'PRESENT'

    playSound('success')
    // Synchronously block re-entry BEFORE awaiting any state update (setState/useEffect is async).
    // Without this, two QR detections in the same tick could both pass the guard above and
    // overwrite the displayed student (e.g. Student A scanned but Student B shown).
    showStudentInfoRef.current = true
    // Clear any previously running countdown to avoid leaked intervals from a stale scan.
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    setCurrentStudent(student)
    setShowStudentInfo(true)
    setCountdown(10)
    setScanHistory(prev => [student.id, ...prev])
    if ('vibrate' in navigator) navigator.vibrate(200)

    let remaining = 10
    const statusToApply = autoStatus
    countdownRef.current = setInterval(() => {
      remaining--
      setCountdown(remaining)
      if (remaining <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current)
        countdownRef.current = null
        setShowStudentInfo(false)
        setCurrentStudent(null)
        setCountdown(10)
        updateAttendance(student.id, statusToApply)
        setMessage(`${student.name} marked ${statusToApply === 'LATE' ? 'late ⚠️' : 'present'}`)
        setTimeout(() => setMessage(''), 3000)
      }
    }, 1000)
  }, [updateAttendance, staffList, playSound, detectCurrentSession, scheduledDayOff])

  useEffect(() => {
    if (!scanning || !videoRef.current) return
    let cancelled = false
    const videoEl = videoRef.current
    const initCamera = async () => {
      try {
        // Stop any existing reader first
        if (codeReaderRef.current) {
          codeReaderRef.current.reset()
          codeReaderRef.current = null
        }
        videoEl.pause()
        if (videoEl.srcObject) {
          (videoEl.srcObject as MediaStream).getTracks().forEach(t => t.stop())
          videoEl.srcObject = null
        }
        await new Promise(r => setTimeout(r, 400))
        if (cancelled) return

        const reader = new BrowserMultiFormatReader()
        codeReaderRef.current = reader

        // Step 1: Enumerate cameras (needs one-time permission)
        let cameras = allCamerasRef.current
        if (cameras.length === 0) {
          cameras = await reader.listVideoInputDevices()
          // Sort: back/environment cameras first, then others
          cameras.sort((a, b) => {
            const aBack = /back|rear|environment|後/i.test(a.label) ? 0 : 1
            const bBack = /back|rear|environment|後/i.test(b.label) ? 0 : 1
            return aBack - bBack
          })
          allCamerasRef.current = cameras
          if (!cancelled) setAllCameras([...cameras])
        }
        if (cancelled) return

        // Step 2: Pick camera by current index
        const camIdx = currentCamIdxRef.current
        const deviceId = cameras.length > 0 && camIdx < cameras.length
          ? cameras[camIdx].deviceId
          : undefined
        const label = cameras.length > 0 && camIdx < cameras.length
          ? cameras[camIdx].label || `Camera ${camIdx + 1}`
          : 'Default'
        if (!cancelled) setCameraLabel(label)

        // Step 3: Use the library's native method — it manages its own stream
        reader.timeBetweenDecodingAttempts = 150
        await reader.decodeFromVideoDevice(deviceId || null, videoEl, (result) => {
          if (cancelled) return
          if (result) handleQrScanned(result.getText())
        })

        // Step 4: After video starts, apply autofocus to the stream the library created
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

        if (!cancelled) setMessage('Camera ready — scan QR code')
      } catch (error: any) {
        if (cancelled) return
        console.error('Camera init error:', error)
        if (error.name === 'NotAllowedError') setMessage('Camera access denied. Please allow camera permissions.')
        else if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
          setMessage('Camera not available. Try switching camera.')
        } else setMessage('Failed to start camera. Please try again.')
        setScanning(false)
      }
    }
    initCamera()
    return () => {
      cancelled = true
      if (codeReaderRef.current) {
        codeReaderRef.current.reset()
        codeReaderRef.current = null
      }
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

  const stopScanning = () => {
    if (codeReaderRef.current) { codeReaderRef.current.reset(); codeReaderRef.current = null }
    setScanning(false)
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
    }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    setShowStudentInfo(false)
    setCurrentStudent(null)
    setCountdown(10)
    setMessage('')
  }

  const dismissStudentInfo = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    if (currentStudent) {
      const status = isLateByConfig() ? 'LATE' : 'PRESENT'
      updateAttendance(currentStudent.id, status)
      setMessage(`${currentStudent.name} marked ${status === 'LATE' ? 'late ⚠️' : 'present'}`)
      setTimeout(() => setMessage(''), 3000)
    }
    setShowStudentInfo(false)
    setCurrentStudent(null)
    setCountdown(10)
  }

  const submitAttendance = async () => {
    const date = todayCambodia()
    if (!classId) { setMessage('No class selected.'); return }
    setMessage(`Submitting attendance for ${attendance.length} students...`)
    try {
      const res = await apiFetch('/api/attendance/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          date,
          session,
          records: attendance.map(record => ({
            studentId: record.studentId,
            status: record.status,
            checkInTime: record.checkInTime,
            ...(record.status === 'PERMISSION' ? {
              permissionType: record.permissionType || 'FULL_DAY',
              permissionStartDate: date,
              permissionEndDate: date,
            } : {}),
          })),
          ...(locationRef.current ? { latitude: locationRef.current.latitude, longitude: locationRef.current.longitude } : {}),
        }),
      })
      if (res.ok) {
        const result = await res.json()
        if (result.failed === 0) {
          setMessage(`Attendance submitted successfully! (${result.success} records)`)
        } else {
          setMessage(`${result.success} saved, ${result.failed} failed.`)
        }
      } else if (res.status === 401) {
        setMessage('Session expired. Please log in again.')
        setTimeout(() => { window.location.href = '/login' }, 2000)
        return
      } else {
        const errText = await res.text()
        console.error('Bulk attendance failed:', res.status, errText)
        // Fallback to individual submission
        await submitAttendanceIndividually(date)
      }
      setTimeout(() => setMessage(''), 8000)
    } catch (error: any) {
      setMessage(`Error submitting attendance: ${error?.message || 'Unknown error'}`)
      setTimeout(() => setMessage(''), 8000)
    }
  }

  const submitAttendanceIndividually = async (date: string) => {
    let successCount = 0
    let failCount = 0
    let lastError = ''
    for (const record of attendance) {
      try {
        const res = await apiFetch('/api/attendance/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: record.studentId, classId, date, status: record.status, session, checkInTime: record.checkInTime, ...(locationRef.current ? { latitude: locationRef.current.latitude, longitude: locationRef.current.longitude } : {}) }),
        })
        if (res.ok) {
          successCount++
        } else {
          failCount++
          const errText = await res.text()
          lastError = `${res.status}: ${errText}`
          console.error(`Failed to record attendance for ${record.studentId}: ${res.status}`, errText)
        }
      } catch (fetchErr: any) {
        failCount++
        lastError = fetchErr?.message || 'Network error'
        console.error(`Network error for ${record.studentId}:`, fetchErr)
      }
    }
    if (failCount === 0) {
      setMessage(`Attendance submitted successfully! (${successCount} records)`)
    } else {
      setMessage(`${successCount} saved, ${failCount} failed. Last error: ${lastError}`)
    }
  }

  const presentCount = attendance.filter(a => a.status === 'PRESENT').length
  const lateCount = attendance.filter(a => a.status === 'LATE').length
  const dayOffCount = attendance.filter(a => a.status === 'PERMISSION').length
  const totalStudents = students.length
  const progressPct = totalStudents > 0 ? ((presentCount + lateCount) / totalStudents) * 100 : 0

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-14 lg:hidden" />

      {/* ===== FULLSCREEN CAMERA MODE ===== */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay playsInline muted
          />
          {/* Scanning overlay with crosshair */}
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
          {/* Top bar overlay */}
          <div className="relative z-10 flex items-center justify-between px-4 pt-4 pb-2 bg-gradient-to-b from-black/70 to-transparent">
            <div className="flex items-center gap-3">
              <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                scanMode === 'check-in' ? 'bg-teal-500 text-white' : 'bg-sky-500 text-white'
              }`}>
                {scanMode === 'check-in' ? '📥 Check-In' : '📤 Check-Out'}
              </div>
              <span className="text-white/80 text-xs font-medium">Session {session}</span>
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
              <button
                onClick={stopScanning}
                className="w-10 h-10 rounded-full bg-red-500/90 backdrop-blur-sm flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform"
              >
                ✕
              </button>
            </div>
          </div>
          {/* Bottom info bar */}
          <div className="relative z-10 mt-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-6 pt-8">
            {message && (
              <div className={`mb-3 px-4 py-2.5 rounded-xl text-sm font-medium text-center ${
                message.includes('marked present') || message.includes('checked out') || message.includes('Camera ready') || message.includes('Staff')
                  ? 'bg-emerald-500/90 text-white'
                  : message.includes('already')
                    ? 'bg-amber-500/90 text-white'
                    : 'bg-white/20 text-white backdrop-blur-sm'
              }`}>
                {message}
              </div>
            )}
            <div className="flex items-center justify-between text-white/90">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                <span className="text-xs font-medium">Scanning for student & staff QR codes...</span>
              </div>
              <div className="flex items-center gap-3 text-xs font-medium">
                <span className="px-2 py-1 rounded-full bg-emerald-500/30">{presentCount} ✓</span>
                <span className="px-2 py-1 rounded-full bg-amber-500/30">{lateCount} ⚠</span>
                <span className="px-2 py-1 rounded-full bg-white/20">{totalStudents} total</span>
              </div>
            </div>
            <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
              <div className="h-1 bg-teal-400 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Hidden video element for ref when not scanning */}
      {!scanning && <video ref={videoRef} className="hidden" autoPlay playsInline muted />}

      {/* ===== STUDENT INFO OVERLAY (Eye-catching) ===== */}
      {showStudentInfo && currentStudent && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center z-[60] animate-[fadeIn_0.2s_ease-out]"
          onClick={dismissStudentInfo}
        >
          <div
            className="w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl overflow-hidden animate-[slideUp_0.35s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gradient header */}
            <div className={`relative px-4 sm:px-6 py-4 sm:py-6 text-white text-center overflow-hidden ${
              isLateByConfig()
                ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-red-500'
                : 'bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500'
            }`}>
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
              <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-white/10" />
              {/* Countdown ring */}
              <div className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <svg className="absolute w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="white" strokeWidth="3" opacity="0.3" />
                  <circle
                    cx="24" cy="24" r="20" fill="none" stroke="white" strokeWidth="3"
                    strokeDasharray={`${2 * Math.PI * 20}`}
                    strokeDashoffset={`${2 * Math.PI * 20 * (1 - countdown / 10)}`}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>
                <span className="text-lg font-bold relative z-10">{countdown}</span>
              </div>
              <p className="text-sm font-medium text-white/80 mb-1">
                {isLateByConfig() ? '⚠️ Late Arrival' : '✓ Student Scanned'}
              </p>
              <h2 className="text-2xl font-extrabold tracking-tight">{currentStudent.name}</h2>
            </div>
            {/* Student photo + details */}
            <div className="px-4 sm:px-6 py-3 sm:py-5 flex flex-col items-center">
              <div className="relative -mt-12 mb-4">
                <div className={`w-24 h-24 rounded-full border-4 shadow-xl flex items-center justify-center overflow-hidden text-3xl font-bold ${
                  isLateByConfig()
                    ? 'border-amber-200 bg-amber-50 text-amber-600'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-600'
                }`}>
                  {currentStudent.photo ? (
                    <img src={currentStudent.photo} alt={currentStudent.name} className="w-full h-full object-cover" />
                  ) : (
                    currentStudent.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className={`absolute -bottom-1 right-0 w-7 h-7 rounded-full border-3 border-white flex items-center justify-center text-xs ${
                  isLateByConfig() ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                }`}>
                  {isLateByConfig() ? '⚠' : '✓'}
                </div>
              </div>
              <div className="w-full space-y-2">
                <div className="flex items-center gap-3 py-3 px-4 bg-slate-50 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 text-sm">🏫</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Class</p>
                    <p className="font-bold text-slate-800 truncate">{currentStudent.className || 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 py-3 px-4 bg-slate-50 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 text-sm">
                    {currentStudent.sex === 'MALE' ? '♂' : currentStudent.sex === 'FEMALE' ? '♀' : '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Sex</p>
                    <p className="font-bold text-slate-800">{currentStudent.sex === 'MALE' ? 'Male' : currentStudent.sex === 'FEMALE' ? 'Female' : 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 py-3 px-4 bg-slate-50 rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-sky-100 flex items-center justify-center text-sky-600 text-sm">✉</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Email</p>
                    <p className="font-semibold text-slate-800 text-sm truncate">{currentStudent.email}</p>
                  </div>
                </div>
              </div>
              {/* Status banner */}
              <div className="mt-4 w-full">
                {(() => {
                  const isLate = isLateByConfig()
                  return (
                    <div className={`rounded-xl px-4 py-3 text-center ${
                      isLate
                        ? 'bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200'
                        : 'bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200'
                    }`}>
                      <p className={`${isLate ? 'text-amber-700' : 'text-emerald-700'} font-bold text-base`}>
                        {isLate ? `⚠️ ${t('attendance.markingLate')}` : `✅ ${t('attendance.markingPresent')}`}
                      </p>
                      <p className={`${isLate ? 'text-amber-600' : 'text-emerald-600'} text-sm mt-0.5`}>
                        Auto-confirming in {countdown}s
                      </p>
                    </div>
                  )
                })()}
                <div className="mt-3 bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-1000 ease-linear ${
                      isLateByConfig() ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-emerald-400 to-teal-500'
                    }`}
                    style={{ width: `${(countdown / 10) * 100}%` }}
                  />
                </div>
              </div>
              <button
                onClick={dismissStudentInfo}
                className={`w-full mt-4 py-3.5 rounded-xl font-bold text-white text-base shadow-lg active:scale-[0.98] transition-transform ${
                  isLateByConfig()
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500'
                }`}
              >
                ✓ Confirm Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== STAFF INFO OVERLAY ===== */}
      {showStaffInfo && currentStaffScanned && staffScanResult && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="w-full sm:max-w-sm bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl overflow-hidden sm:mx-4 animate-[slideUp_0.35s_ease-out]">
            <div className={`relative px-6 py-6 text-center overflow-hidden ${
              staffScanResult.action === 'CHECK_OUT'
                ? 'bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-500'
                : 'bg-gradient-to-br from-teal-500 via-emerald-500 to-cyan-500'
            }`}>
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10" />
              <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-white/10" />
              <p className="text-sm font-medium text-white/80 mb-1">
                {staffScanResult.action === 'CHECK_OUT' ? '📤 Check-Out' : '📥 Check-In'} · {staffScanResult.sessionName}
              </p>
              <h2 className="text-2xl font-extrabold text-white tracking-tight">{currentStaffScanned.name}</h2>
            </div>
            <div className="px-6 py-5 flex flex-col items-center">
              <div className="relative -mt-12 mb-3">
                <div className="w-20 h-20 rounded-full border-4 border-white shadow-xl bg-teal-50 text-teal-600 flex items-center justify-center text-3xl font-bold overflow-hidden">
                  {currentStaffScanned.photo ? (
                    <img src={currentStaffScanned.photo} alt={currentStaffScanned.name} className="w-full h-full object-cover" />
                  ) : (
                    currentStaffScanned.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className={`absolute -bottom-1 right-0 w-7 h-7 rounded-full border-2 border-white text-white flex items-center justify-center text-xs ${
                  staffScanResult.action === 'CHECK_OUT' ? 'bg-sky-500' : 'bg-emerald-500'
                }`}>{staffScanResult.action === 'CHECK_OUT' ? '↑' : '✓'}</div>
              </div>
              <p className="text-sm font-medium text-slate-700">💼 {t('role.' + (currentStaffScanned.role || '').toLowerCase()) || currentStaffScanned.role}</p>
              {staffScanResult.userDepartment && (
                <p className="text-xs text-slate-500 mt-0.5">🏢 {staffScanResult.userDepartment.name}</p>
              )}
              <div className="mt-3 w-full space-y-2">
                <div className="flex items-center gap-3 py-2.5 px-4 bg-slate-50 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center text-teal-600 text-sm">📅</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Date</p>
                    <p className="font-bold text-slate-800 text-sm">{new Date(staffScanResult.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 py-2.5 px-4 bg-slate-50 rounded-xl">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                    staffScanResult.action === 'CHECK_OUT' ? 'bg-sky-100 text-sky-600' : 'bg-emerald-100 text-emerald-600'
                  }`}>{staffScanResult.action === 'CHECK_OUT' ? '📤' : '📥'}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Time</p>
                    <p className="font-bold text-slate-800 text-sm">
                      {staffScanResult.action === 'CHECK_OUT' && staffScanResult.checkOutTime
                        ? formatCambodiaTime(staffScanResult.checkOutTime)
                        : staffScanResult.checkInTime
                          ? formatCambodiaTime(staffScanResult.checkInTime)
                          : 'Just now'}
                    </p>
                  </div>
                  {staffScanResult.status && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      staffScanResult.status === 'LATE' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>{staffScanResult.status}</span>
                  )}
                </div>
              </div>
              <div className={`mt-4 w-full px-4 py-3 rounded-xl text-sm font-bold text-center border ${
                staffScanResult.action === 'CHECK_OUT'
                  ? 'bg-sky-50 text-sky-700 border-sky-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                ✅ Staff Attendance Marked
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOP BAR ===== */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-slate-800">{t('attendance.title')}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">{presentCount} {t('common.present').toLowerCase()}</span>
              <span className="text-slate-300 text-xs">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">{lateCount} {t('common.late').toLowerCase()}</span>
              <span className="text-slate-300 text-xs">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">{totalStudents} total</span>
              <span className="text-slate-300 text-xs hidden sm:inline">·</span>
              <span className="text-xs text-slate-400 hidden sm:inline">Session {session} · {scanMode === 'check-in' ? '📥 Check-In' : '📤 Check-Out'}</span>
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
        {/* Class selector */}
        {teacherClasses.length > 0 && (
          <div className="card p-3 sm:p-4">
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Class</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full sm:w-auto rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
            >
              <option value="">— Select a class —</option>
              {teacherClasses.map(cls => (
                <option key={cls.id} value={cls.id}>{cls.name} — {cls.subject || 'N/A'}</option>
              ))}
            </select>
          </div>
        )}

        {/* Holiday warning banner */}
        {todayHoliday && (
          <div className="px-4 py-3 rounded-xl text-sm font-medium shadow-sm bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-2">
            <span className="text-lg">📅</span>
            <span>Today is <strong>{todayHoliday}</strong> — attendance taken today will be recorded on a holiday.</span>
          </div>
        )}

        {/* Scheduled day-off warning banner */}
        {scheduledDayOff && (
          <div className="px-4 py-3 rounded-xl text-sm font-medium shadow-sm bg-red-50 text-red-800 border border-red-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg shrink-0">🚫</span>
              <span>Today is a <strong>scheduled day-off</strong> for this class. All students are auto-marked as PERMISSION. Contact admin to update the class schedule if this is incorrect.</span>
            </div>
          </div>
        )}

        {/* Message banner */}
        {message && !scanning && (
          <div className={`px-4 py-3 rounded-xl text-sm font-medium shadow-sm ${
            message.includes('marked present') || message.includes('submitted') || message.includes('checked out')
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}>
            {message}
          </div>
        )}

        {/* ===== SESSION / SCAN MODE (AUTO-DETECTED) ===== */}
        <div className="card p-3 sm:p-4">
          {/* Attendance Format badge */}
          {sessionConfigs.length > 0 && (() => {
            const fmt = detectAttendanceFormat(sessionConfigs)
            return (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-lg">{fmt.icon}</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-700">Attendance Format: <span className="text-indigo-600">{fmt.name}</span></div>
                  <div className="text-[11px] text-slate-500">{fmt.description}</div>
                </div>
              </div>
            )
          })()}

          {/* Auto-detected current session */}
          {sessionConfigs.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-slate-400 bg-slate-50 rounded-xl border border-slate-200">Loading sessions…</div>
          ) : (() => {
            const cfg = sessionConfigs.find(c => c.session === session && c.startTime !== c.endTime)
            if (!cfg) return <div className="px-3 py-2.5 text-sm text-slate-400">No active session</div>
            const h = parseInt(cfg.startTime.split(':')[0])
            const period = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'
            return (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 ${
                cfg.type === 'CHECK_IN'
                  ? 'bg-emerald-50 border-emerald-300'
                  : 'bg-blue-50 border-blue-300'
              }`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                  cfg.type === 'CHECK_IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {cfg.type === 'CHECK_IN' ? '📥' : '📤'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold ${cfg.type === 'CHECK_IN' ? 'text-emerald-800' : 'text-blue-800'}`}>
                    {period} {cfg.type === 'CHECK_IN' ? 'Check-In' : 'Check-Out'}
                  </div>
                  <div className={`text-xs ${cfg.type === 'CHECK_IN' ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {cfg.startTime} – {cfg.endTime}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${cfg.type === 'CHECK_IN' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                  <span className={`text-[11px] font-semibold ${cfg.type === 'CHECK_IN' ? 'text-emerald-600' : 'text-blue-600'}`}>Auto</span>
                </div>
              </div>
            )
          })()}

          {/* All sessions overview */}
          {sessionConfigs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {sessionConfigs.filter(c => c.startTime !== c.endTime).map(cfg => {
                const h = parseInt(cfg.startTime.split(':')[0])
                const period = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'
                const isCurrent = session === cfg.session
                return (
                  <div
                    key={cfg.session}
                    className={`text-xs p-2.5 rounded-xl text-left ${
                      isCurrent
                        ? cfg.type === 'CHECK_IN'
                          ? 'bg-emerald-50 border-2 border-emerald-300'
                          : 'bg-blue-50 border-2 border-blue-300'
                        : 'bg-slate-50 border border-slate-200 opacity-60'
                    }`}
                  >
                    <div className={`font-semibold ${isCurrent ? (cfg.type === 'CHECK_IN' ? 'text-emerald-700' : 'text-blue-700') : 'text-slate-500'}`}>
                      {period} {cfg.type === 'CHECK_IN' ? 'Check-In' : 'Check-Out'}
                    </div>
                    <div className={isCurrent ? (cfg.type === 'CHECK_IN' ? 'text-emerald-500' : 'text-blue-500') : 'text-slate-400'}>
                      {cfg.startTime} – {cfg.endTime} {isCurrent && '← now'}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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

        {/* ===== ACTION BUTTONS ===== */}
        <div className="flex gap-3">
          <button
            onClick={startScanning}
            className="flex-1 sm:flex-none bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-3.5 sm:py-3 px-6 rounded-xl shadow-lg shadow-emerald-200 active:scale-[0.98] transition-all text-sm sm:text-base"
          >
            📷 Open Camera
          </button>
          <button
            onClick={submitAttendance}
            className="flex-1 sm:flex-none bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white font-bold py-3.5 sm:py-3 px-6 rounded-xl shadow-lg shadow-sky-200 active:scale-[0.98] transition-all text-sm sm:text-base"
          >
            💾 Submit
          </button>
        </div>

        {/* ===== STUDENT ROSTER ===== */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-700">{t('attendance.studentRoster')}</h2>
            <span className="text-xs text-slate-400">{presentCount + lateCount}/{totalStudents} scanned</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {students.map(student => {
              const record = attendance.find(a => a.studentId === student.id)
              const status = record?.status || 'ABSENT'
              const justScanned = scanHistory[0] === student.id

              return (
                <div
                  key={student.id}
                  className={`card p-3 sm:p-4 transition-all duration-300 ${
                    status === 'PRESENT' ? 'border-emerald-300 bg-emerald-50/50' :
                    status === 'LATE' ? 'border-amber-300 bg-amber-50/50' : ''
                  } ${justScanned ? 'ring-2 ring-emerald-400 animate-pulse' : ''}`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center overflow-hidden text-sm font-bold shrink-0 ${
                      status === 'PRESENT' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300' :
                      status === 'LATE' ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {student.photo ? (
                        <img src={student.photo} alt={student.name} className="w-full h-full object-cover" />
                      ) : (
                        student.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-slate-800 truncate text-sm">{student.name}</h3>
                      <p className="text-xs text-slate-400 truncate">
                        {student.sex === 'MALE' ? '♂' : student.sex === 'FEMALE' ? '♀' : ''} {student.email}
                      </p>
                    </div>
                    {status === 'PRESENT' && <span className="badge-green text-[10px] sm:text-xs">{t('common.present')}</span>}
                    {status === 'LATE' && <span className="badge-yellow text-[10px] sm:text-xs">{t('common.late')}</span>}
                    {status === 'ABSENT' && <span className="badge-red text-[10px] sm:text-xs">{t('common.absent')}</span>}
                    {status === 'PERMISSION' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-100 text-blue-800">{t('common.permission')}</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={status === 'PRESENT' || status === 'LATE'}
                        onChange={(e) => updateAttendance(student.id, e.target.checked ? 'PRESENT' : 'ABSENT')}
                        className="w-5 h-5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-slate-600">{t('common.present')}</span>
                    </label>
                    <select
                      value={status}
                      onChange={(e) => updateAttendance(student.id, e.target.value as 'PRESENT' | 'ABSENT' | 'LATE' | 'PERMISSION')}
                      className="text-xs px-2 py-1.5 rounded-lg border border-slate-200"
                    >
                      <option value="PRESENT">{t('common.present')}</option>
                      <option value="ABSENT">{t('common.absent')}</option>
                      <option value="LATE">{t('common.late')}</option>
                      <option value="PERMISSION">📋 {t('common.permission')}</option>
                    </select>
                  </div>
                  {status === 'PERMISSION' && (
                    <select
                      value={record?.permissionType || 'FULL_DAY'}
                      onChange={(e) => updatePermissionType(student.id, e.target.value)}
                      className="mt-2 w-full text-xs px-2 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 font-medium"
                    >
                      <option value="HALF_DAY_MORNING">🌅 Half Day (Morning)</option>
                      <option value="HALF_DAY_AFTERNOON">🌤️ Half Day (Afternoon)</option>
                      <option value="FULL_DAY">☀️ Full Day</option>
                      <option value="MULTI_DAY">📅 Many Days</option>
                    </select>
                  )}
                </div>
              )
            })}
          </div>
          {students.length === 0 && (
            <div className="card p-12">
              <div className="empty-state">
                <p className="text-5xl mb-3">📋</p>
                <p className="font-semibold text-slate-600">No students found</p>
                <p className="text-sm text-slate-400 mt-1">Make sure a class is selected with students enrolled.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* CSS Animations */}
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
