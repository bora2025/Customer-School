'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { pluginTimetableFetch } from '../../../lib/timetable-plugin-api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Timetable {
  id: string; name: string; short: string | null; academicYear: string
  periodsPerDay: number; numberOfDays: number; weekend: string[]
  timeOffRules?: string | null; distribution?: string | null
  homeworkPrep?: string | null; maxOnDay?: number | null
  docNotes?: string | null; periodTimes?: string | null; status: string
  subjects: TSubject[]; classes: TClass[]; classrooms: TClassroom[]
  teachers: TTeacher[]; lessons: TLesson[]; entries: TEntry[]
}
interface TSubject {
  id: string; name: string; short: string; color: string | null
  classroomCount: number; customFields: any
}
interface TClass {
  id: string; name: string; short: string; color: string | null
  printSubjectPicture: boolean; customFields: any; classTeachers?: TTeacher[]
}
interface TClassroom {
  id: string; name: string; short: string; color: string | null; customFields: any
}
interface TTeacher {
  id: string; lastName: string; firstName: string; khmerName?: string | null; short: string
  sex: string | null; email: string | null; phone: string | null
  color: string | null; classTeacherId: string | null; classTeacher?: TClass | null
}
interface TLesson {
  id: string; teacherId: string; subjectId: string; classId: string
  perWeek: number; lessonType: string
  teacher: TTeacher; subject: TSubject; class: TClass
}
interface TEntry {
  id: string; classId: string; teacherId: string; subjectId: string
  lessonId: string | null; classroomId: string | null; day: number; period: number
  class: TClass; teacher: TTeacher; subject: TSubject; classroom: TClassroom | null
}
interface TimetableListItem {
  id: string; name: string; short: string | null; academicYear: string; status: string; createdAt: string
}

const WEEKENDS = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']
const COLOR_PALETTE = [
  '#ef4444','#f97316','#f59e0b','#84cc16','#22c55e',
  '#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6',
  '#a855f7','#ec4899','#64748b','#374151','#0f172a',
]
const WIZARD_STEPS = ['School Info', 'Subjects', 'Classes', 'Classrooms', 'Teachers & Contracts']

// ─── Toast ──────────────────────────────────────────────────────────────────

type Toast = { id: number; msg: string; ok: boolean }
let _toastId = 0

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultPeriodTimes(n: number): string[] {
  const morning = ['07:00', '08:00', '09:00', '10:00', '11:00']
  const afternoon = ['13:00', '14:00', '15:00', '16:00', '17:00']
  const m = Math.min(n, 5)
  const a = Math.max(0, n - m)
  return [...morning.slice(0, m), ...afternoon.slice(0, a)]
}

function getPeriodTimes(tt: { periodsPerDay: number; periodTimes?: string | null }): string[] {
  const defaults = defaultPeriodTimes(tt.periodsPerDay)
  if (tt.periodTimes) {
    try {
      const saved: string[] = JSON.parse(tt.periodTimes)
      // Always return exactly periodsPerDay entries, extending with defaults if saved has fewer
      const result = [...saved]
      while (result.length < tt.periodsPerDay) result.push(defaults[result.length] ?? '00:00')
      return result.slice(0, tt.periodsPerDay).map(to24h)
    } catch {}
  }
  return defaults
}

/** Normalise any time string to HH:MM 24-hour format. */
function to24h(raw: string): string {
  if (!raw) return '00:00'
  // Already HH:MM or H:MM — return as-is (24h values never contain letters)
  const match24 = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    const h = parseInt(match24[1], 10)
    const m = parseInt(match24[2], 10)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59)
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  // Handle 12h strings like "1:00 PM", "07:00 AM"
  const match12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let h = parseInt(match12[1], 10)
    const m = parseInt(match12[2], 10)
    const ampm = match12[3].toUpperCase()
    if (ampm === 'AM' && h === 12) h = 0
    if (ampm === 'PM' && h !== 12) h += 12
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return '00:00'
}

function colorBadge(color: string | null, text: string) {
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
      style={{ backgroundColor: color ?? '#6366f1' }}>{text}</span>
  )
}

// ─── Time Off Rules ─────────────────────────────────────────────────────────

type TimeOffRule = { from: string; to: string }

function parseTimeOffRules(raw: string | null | undefined): TimeOffRule[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((r: any) => r.from && r.to)
    return []
  } catch { return [] }
}

function serializeTimeOffRules(rules: TimeOffRule[]): string | null {
  return rules.length > 0 ? JSON.stringify(rules) : null
}

function TimeOffEditor({ rules, onChange }: { rules: TimeOffRule[]; onChange: (r: TimeOffRule[]) => void }) {
  return (
    <div className="space-y-1.5">
      {rules.map((rule, i) => (
        <div key={i} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1.5">
          <span className="text-xs text-gray-500 shrink-0">No lesson</span>
          <input type="time" value={rule.from}
            onChange={e => { const n = [...rules]; n[i] = { ...rule, from: e.target.value }; onChange(n) }}
            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 w-24" />
          <span className="text-xs text-gray-400">–</span>
          <input type="time" value={rule.to}
            onChange={e => { const n = [...rules]; n[i] = { ...rule, to: e.target.value }; onChange(n) }}
            className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 w-24" />
          <button type="button" onClick={() => onChange(rules.filter((_, j) => j !== i))}
            className="ml-auto text-red-400 hover:text-red-600 font-bold text-sm leading-none">×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rules, { from: '12:00', to: '13:00' }])}
        className="w-full text-xs text-indigo-600 border border-dashed border-indigo-300 rounded-lg py-1.5 hover:bg-indigo-50 transition-colors">
        + Add Time Off Slot
      </button>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

function TimetableWorkspace({ pluginMode = false }: { pluginMode?: boolean }) {
  const { t } = useLanguage()
  const DAY_LABELS = [t('timetable.mon'), t('timetable.tue'), t('timetable.wed'), t('timetable.thu'), t('timetable.fri'), t('timetable.sat'), t('timetable.sun')]
  const WIZARD_STEPS = [t('timetable.schoolInfo'), t('timetable.subjects'), t('timetable.classes'), t('timetable.classrooms'), t('timetable.teachersContracts')]
  const router = useRouter()
  const pathname = usePathname()
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const timetablePath = (child = '') => pluginMode
    ? `/plugins/wattanam.timetable/${child || 'timetables'}`
    : `/admin/timetable${child ? `/${child}` : ''}`

  const [timetableList, setTimetableList] = useState<TimetableListItem[]>([])
  const [current, setCurrent] = useState<Timetable | null>(null)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  function showToast(msg: string, ok = true) {
    const id = ++_toastId
    setToasts(prev => [...prev, { id, msg, ok }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }

  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardTimetableId, setWizardTimetableId] = useState<string | null>(null)
  const [wizardSaving, setWizardSaving] = useState(false)
  const [wizardError, setWizardError] = useState('')

  // Step 1 fields
  const [wSchoolName, setWSchoolName] = useState('')
  const [wAcademicYear, setWAcademicYear] = useState('2025-2026')
  const [wPeriods, setWPeriods] = useState(8)
  const [wDays, setWDays] = useState(5)
  const [wWeekend, setWWeekend] = useState<string[]>(['SATURDAY', 'SUNDAY'])
  const [wTimeOffRules, setWTimeOffRules] = useState<TimeOffRule[]>([])
  const [wDistrib, setWDistrib] = useState('')
  const [wHomework, setWHomework] = useState('')
  const [wMaxOn, setWMaxOn] = useState<number | ''>('')
  const [wDoc, setWDoc] = useState('')

  // Modal visibility
  const [showSubjectModal, setShowSubjectModal] = useState(false)
  const [showClassModal, setShowClassModal] = useState(false)
  const [showClassroomModal, setShowClassroomModal] = useState(false)

  // System classes for class picker (wizard + toolbar modal)
  const [wizardSystemClasses, setWizardSystemClasses] = useState<{id: string; name: string; studyYear?: {label?: string | null; year: number} | null}[]>([])
  const [wizardSystemClassesLoading, setWizardSystemClassesLoading] = useState(false)

  // System teachers for teacher picker (from app database)
  const [systemTeachers, setSystemTeachers] = useState<{id: string; name: string; email: string | null; phone: string | null}[]>([])
  const [systemTeachersLoading, setSystemTeachersLoading] = useState(false)
  const [showTeacherModal, setShowTeacherModal] = useState(false)
  const [showLessonModal, setShowLessonModal] = useState(false)
  const [showContractPanel, setShowContractPanel] = useState(false)
  const [contractTeacher, setContractTeacher] = useState<TTeacher | null>(null)
  const [editingItem, setEditingItem] = useState<any>(null)

  // Period time config
  const [showPeriodModal, setShowPeriodModal] = useState(false)
  const [periodInputs, setPeriodInputs] = useState<string[]>([])
  const [savingPeriods, setSavingPeriods] = useState(false)

  // Timetable settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  // Print modal
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printMode, setPrintMode] = useState<'all' | 'class'>('all')
  const [printClassId, setPrintClassId] = useState<string>('')
  const [printOrgName, setPrintOrgName] = useState('Wattaman School')
  const [printHeaderLines, setPrintHeaderLines] = useState<string[]>([])
  const [printNewHeaderLine, setPrintNewHeaderLine] = useState('')
  const [printSigners, setPrintSigners] = useState<string[]>(['Teacher', 'Admin'])
  const [printNewSigner, setPrintNewSigner] = useState('')
  const [printLeftFooter, setPrintLeftFooter] = useState('')
  const [printRightFooter, setPrintRightFooter] = useState('')

  // Workload modal
  const [showWorkloadModal, setShowWorkloadModal] = useState(false)
  const [weeksPerMonth, setWeeksPerMonth] = useState(4)
  const [workloadSort, setWorkloadSort] = useState<'name' | 'week' | 'month'>('week')
  const [sPeriods, setSPeriods] = useState(8)
  const [sDays, setSDays] = useState(5)
  const [sWeekend, setSWeekend] = useState<string[]>(['SATURDAY','SUNDAY'])
  const [sTimeOffRules, setSTimeOffRules] = useState<TimeOffRule[]>([])
  const [savingSettings, setSavingSettings] = useState(false)

  // Subject form
  const [fSubName, setFSubName] = useState('')
  const [fSubShort, setFSubShort] = useState('')
  const [fSubColor, setFSubColor] = useState('#6366f1')
  const [fSubRooms, setFSubRooms] = useState(1)
  const [fSubCustom, setFSubCustom] = useState('')

  // Class form
  const [fClsName, setFClsName] = useState('')
  const [fClsShort, setFClsShort] = useState('')
  const [fClsColor, setFClsColor] = useState('#3b82f6')
  const [fClsPrint, setFClsPrint] = useState(false)
  const [fClsCustom, setFClsCustom] = useState('')

  // Classroom form
  const [fRmName, setFRmName] = useState('')
  const [fRmShort, setFRmShort] = useState('')
  const [fRmColor, setFRmColor] = useState('#14b8a6')
  const [fRmCustom, setFRmCustom] = useState('')

  // Teacher form
  const [fTLast, setFTLast] = useState('')
  const [fTFirst, setFTFirst] = useState('')
  const [fTKhmer, setFTKhmer] = useState('')
  const [fTShort, setFTShort] = useState('')
  const [fTSex, setFTSex] = useState('')
  const [fTEmail, setFTEmail] = useState('')
  const [fTPhone, setFTPhone] = useState('')
  const [fTColor, setFTColor] = useState('#22c55e')
  const [fTClassTeacher, setFTClassTeacher] = useState('')

  // Lesson form
  const [fLTeacher, setFLTeacher] = useState('')
  const [fLSubject, setFLSubject] = useState('')
  const [fLClass, setFLClass] = useState('')
  const [fLPerWeek, setFLPerWeek] = useState(2)
  const [fLType, setFLType] = useState('SINGLE')

  // Color picker
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [colorPickerValue, setColorPickerValue] = useState('#6366f1')
  const colorPickerResolve = useRef<((c: string) => void) | null>(null)

  function openColorPicker(current: string): Promise<string> {
    setColorPickerValue(current)
    setShowColorPicker(true)
    return new Promise(resolve => { colorPickerResolve.current = resolve })
  }
  function resolveColorPicker(color: string) {
    colorPickerResolve.current?.(color)
    colorPickerResolve.current = null
    setShowColorPicker(false)
  }

  const fetchList = useCallback(async () => {
    const res = await timetableFetch('/api/timetable')
    if (res.ok) {
      const list: TimetableListItem[] = await res.json()
      setTimetableList(list)
      return list
    }
    return [] as TimetableListItem[]
  }, [])

  const loadTimetable = useCallback(async (id: string) => {
    setLoading(true)
    const res = await timetableFetch(`/api/timetable/${id}`)
    if (res.ok) setCurrent(await res.json())
    setLoading(false)
  }, [])

  // Auto-load the timetable whose academicYear matches the current year on first mount
  // Prevent browser from navigating when a lesson card is accidentally dropped
  // on a sidebar link or any non-grid element
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault() }
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [])

  useEffect(() => {
    const currentYear = new Date().getFullYear()
    fetchList().then(list => {
      if (!list || list.length === 0) return
      // Prefer a timetable whose academicYear contains the current calendar year
      const match =
        list.find(tt => tt.academicYear?.includes(String(currentYear))) ??
        list.find(tt => tt.status === 'PUBLISHED') ??
        list[0]
      if (match) loadTimetable(match.id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload current timetable when the user returns from a sub-page (e.g. lessons, teachers)
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        const needsRefresh = sessionStorage.getItem('timetable_needs_refresh')
        if (needsRefresh && current?.id) {
          sessionStorage.removeItem('timetable_needs_refresh')
          loadTimetable(current.id)
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    // Also check immediately on same-tab navigation back to this page
    if (sessionStorage.getItem('timetable_needs_refresh') && current?.id) {
      sessionStorage.removeItem('timetable_needs_refresh')
      loadTimetable(current.id)
    }
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [pathname, current?.id, loadTimetable])

  const ttId = () => wizardTimetableId ?? current?.id ?? ''

  function openWizard() {
    setWizardStep(0); setWizardTimetableId(null); setWizardError('')
    setWSchoolName(''); setWAcademicYear('2025-2026')
    setWPeriods(8); setWDays(5); setWWeekend(['SATURDAY','SUNDAY'])
    setWTimeOffRules([]); setWDistrib(''); setWHomework(''); setWMaxOn(''); setWDoc('')
    setShowWizard(true)
  }

  async function wizardNext() {
    setWizardError('')
    if (wizardStep === 0) {
      // Step 1 → create timetable, only advance on success
      setWizardSaving(true)
      const res = await timetableFetch('/api/timetable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: wSchoolName || 'New Timetable', academicYear: wAcademicYear,
          periodsPerDay: wPeriods, numberOfDays: wDays, weekend: wWeekend,
          timeOffRules: serializeTimeOffRules(wTimeOffRules), distribution: wDistrib || null,
          homeworkPrep: wHomework || null, maxOnDay: wMaxOn || null, docNotes: wDoc || null,
        }),
      })
      if (res.ok) {
        const tt = await res.json()
        setWizardTimetableId(tt.id)
        await loadTimetable(tt.id)
        await fetchList()
        setWizardSaving(false)
        showToast(`Timetable "${tt.name}" created successfully.`)
        setWizardStep(1)  // only advance when create succeeded
      } else {
        const body = await res.json().catch(() => ({}))
        const msg = body?.message ?? `Error ${res.status} — could not create timetable.`
        setWizardError(msg)
        showToast(msg, false)
        setWizardSaving(false)
      }
      return
    }
    // Steps 1-4: just advance
    if (wizardStep < WIZARD_STEPS.length - 1) setWizardStep(s => s + 1)
  }

  function wizardPrev() { if (wizardStep > 0) setWizardStep(s => s - 1) }

  async function wizardOk() {
    setShowWizard(false)
    if (wizardTimetableId) loadTimetable(wizardTimetableId)
  }

  // CRUD
  async function saveSubject() {
    const id = ttId(); if (!id) return
    const isEdit = !!editingItem
    const url = isEdit ? `/api/timetable/subjects/${editingItem.id}` : `/api/timetable/${id}/subjects`
    const res = await timetableFetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fSubName, short: fSubShort, color: fSubColor, classroomCount: fSubRooms,
        customFields: fSubCustom ? { note: fSubCustom } : undefined }) })
    if (res.ok) {
      showToast(isEdit ? `Subject "${fSubName}" updated.` : `Subject "${fSubName}" added.`)
      await loadTimetable(id); setShowSubjectModal(false)
    } else { showToast(`Failed to ${isEdit ? 'update' : 'add'} subject.`, false) }
  }
  async function removeSubject(subId: string, name: string) {
    const id = ttId(); if (!id) return
    const res = await timetableFetch(`/api/timetable/subjects/${subId}`, { method: 'DELETE' })
    if (res.ok) { showToast(`Subject "${name}" removed.`); await loadTimetable(id) }
    else showToast('Failed to remove subject.', false)
  }
  async function saveClass() {
    const id = ttId(); if (!id) return
    const isEdit = !!editingItem
    const url = isEdit ? `/api/timetable/classes/${editingItem.id}` : `/api/timetable/${id}/classes`
    const res = await timetableFetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fClsName, short: fClsShort, color: fClsColor,
        printSubjectPicture: fClsPrint, customFields: fClsCustom ? { note: fClsCustom } : undefined }) })
    if (res.ok) {
      showToast(isEdit ? `Class "${fClsName}" updated.` : `Class "${fClsName}" added.`)
      await loadTimetable(id); setShowClassModal(false)
    } else { showToast(`Failed to ${isEdit ? 'update' : 'add'} class.`, false) }
  }
  async function removeClass(clsId: string, name: string) {
    const id = ttId(); if (!id) return
    const res = await timetableFetch(`/api/timetable/classes/${clsId}`, { method: 'DELETE' })
    if (res.ok) { showToast(`Class "${name}" removed.`); await loadTimetable(id) }
    else showToast('Failed to remove class.', false)
  }
  async function saveClassroom() {
    const id = ttId(); if (!id) return
    const isEdit = !!editingItem
    const url = isEdit ? `/api/timetable/classrooms/${editingItem.id}` : `/api/timetable/${id}/classrooms`
    const res = await timetableFetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fRmName, short: fRmShort, color: fRmColor,
        customFields: fRmCustom ? { note: fRmCustom } : undefined }) })
    if (res.ok) {
      showToast(isEdit ? `Classroom "${fRmName}" updated.` : `Classroom "${fRmName}" added.`)
      await loadTimetable(id); setShowClassroomModal(false)
    } else { showToast(`Failed to ${isEdit ? 'update' : 'add'} classroom.`, false) }
  }
  async function removeClassroom(rmId: string, name: string) {
    const id = ttId(); if (!id) return
    const res = await timetableFetch(`/api/timetable/classrooms/${rmId}`, { method: 'DELETE' })
    if (res.ok) { showToast(`Classroom "${name}" removed.`); await loadTimetable(id) }
    else showToast('Failed to remove classroom.', false)
  }
  async function saveTeacher() {
    const id = ttId(); if (!id) return
    const isEdit = !!editingItem
    const url = isEdit ? `/api/timetable/teachers/${editingItem.id}` : `/api/timetable/${id}/teachers`
    const res = await timetableFetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastName: fTLast, firstName: fTFirst, khmerName: fTKhmer || null, short: fTShort,
        sex: fTSex || null, email: fTEmail || null, phone: fTPhone || null,
        color: fTColor, classTeacherId: fTClassTeacher || null }) })
    const fullName = `${fTFirst} ${fTLast}`.trim()
    if (res.ok) {
      showToast(isEdit ? `Teacher "${fullName}" updated.` : `Teacher "${fullName}" added.`)
      await loadTimetable(id); setShowTeacherModal(false)
    } else {
      const err = await res.json().catch(() => ({}))
      const reason = Array.isArray(err?.message) ? err.message[0] : (err?.message ?? `HTTP ${res.status}`)
      showToast(`Failed to ${isEdit ? 'update' : 'add'} teacher: ${reason}`, false)
    }
  }
  async function removeTeacher(tchId: string, name: string) {
    const id = ttId(); if (!id) return
    const res = await timetableFetch(`/api/timetable/teachers/${tchId}`, { method: 'DELETE' })
    if (res.ok) { showToast(`Teacher "${name}" removed.`); await loadTimetable(id) }
    else showToast('Failed to remove teacher.', false)
  }
  async function saveLesson() {
    const id = ttId(); if (!id) return
    const isEdit = !!editingItem
    const url = isEdit ? `/api/timetable/lessons/${editingItem.id}` : `/api/timetable/${id}/lessons`
    const res = await timetableFetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId: fLTeacher, subjectId: fLSubject, classId: fLClass,
        perWeek: fLPerWeek, lessonType: fLType }) })
    if (res.ok) {
      showToast(isEdit ? 'Lesson contract updated.' : 'Lesson contract added.')
      await loadTimetable(id); setShowLessonModal(false)
    } else { showToast(`Failed to ${isEdit ? 'update' : 'add'} lesson.`, false) }
  }
  async function removeLesson(lsnId: string) {
    const id = ttId(); if (!id) return
    const res = await timetableFetch(`/api/timetable/lessons/${lsnId}`, { method: 'DELETE' })
    if (res.ok) { showToast('Lesson contract removed.'); await loadTimetable(id) }
    else showToast('Failed to remove lesson.', false)
  }
  async function handleGenerate() {
    const id = current?.id; if (!id) return
    setGenerating(true)
    const res = await timetableFetch(`/api/timetable/${id}/generate`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      showToast(`Timetable generated — ${data.generated} entries created.`)
      await loadTimetable(id)
    } else { showToast(t('timetable.generateFailed'), false) }
    setGenerating(false)
  }
  async function handleSave() {
    if (!current) return
    const res = await timetableFetch(`/api/timetable/${current.id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: current.status }) })
    if (res.ok) showToast(t('timetable.saved'))
    else showToast(t('timetable.saveFailed'), false)
  }

  async function saveSettings() {
    if (!current) return
    setSavingSettings(true)
    const res = await timetableFetch(`/api/timetable/${current.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodsPerDay: sPeriods, numberOfDays: sDays, weekend: sWeekend, timeOffRules: serializeTimeOffRules(sTimeOffRules) }),
    })
    if (res.ok) {
      const updated = await res.json()
      setCurrent(prev => prev ? {
        ...prev,
        periodsPerDay: updated.periodsPerDay ?? sPeriods,
        numberOfDays: updated.numberOfDays ?? sDays,
        weekend: updated.weekend ?? sWeekend,
        timeOffRules: updated.timeOffRules ?? null,
      } : null)
      showToast(t('timetable.settingsSaved'))
      setShowSettingsModal(false)
    } else {
      showToast('Failed to save settings.', false)
    }
    setSavingSettings(false)
  }

  async function handleDeleteTimetable(id: string, name: string, status?: string) {
    if (status === 'PUBLISHED') {
      showToast('Cannot delete a published timetable. Unpublish it first.', false)
      return
    }
    if (!window.confirm(`Delete "${name}"?\n\nThis will permanently remove the timetable and all its subjects, classes, classrooms, teachers, lessons and entries.`)) return
    const res = await timetableFetch(`/api/timetable/${id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast(`Timetable "${name}" deleted.`)
      if (current?.id === id) setCurrent(null)
      await fetchList()
    } else {
      const body = await res.json().catch(() => ({}))
      const reason = body?.message ?? `HTTP ${res.status}`
      showToast(typeof reason === 'string' ? reason : reason[0] ?? `Failed to delete "${name}".`, false)
    }
  }

  // Drag-and-drop state
  const [dragLesson, setDragLesson] = useState<TLesson | null>(null)
  const [dragEntry, setDragEntry] = useState<TEntry | null>(null)
  const [dropTarget, setDropTarget] = useState<{ classId: string; day: number; period: number } | null>(null)
  const [showLessonPanel, setShowLessonPanel] = useState(true)
  const [lessonFilterClass, setLessonFilterClass] = useState<string>('ALL')

  async function placeEntry(classId: string, day: number, period: number, lesson: TLesson, sourceEntryId?: string): Promise<boolean> {
    if (!current) return false
    // Enforce perWeek limit — when moving an existing entry, exclude it from the count
    if (lesson.id) {
      const placed = current.entries.filter(e => e.lessonId === lesson.id && e.id !== sourceEntryId).length
      if (placed >= lesson.perWeek) {
        showToast(`Fully scheduled: ${lesson.subject.short} for ${lesson.class.short} already placed ${placed}/${lesson.perWeek}×/week`, false)
        return false
      }
    }
    // Detect teacher conflict at same day+period in a different class
    const conflict = current.entries.find(
      e => e.teacherId === lesson.teacherId && e.day === day && e.period === period
        && e.classId !== classId && e.id !== sourceEntryId
    )
    if (conflict) {
      showToast(`Conflict: ${lesson.teacher.short} already has ${conflict.subject.short} (${conflict.class.short}) at this slot`, false)
      return false
    }
    const res = await timetableFetch(`/api/timetable/${current.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId, day, period,
        teacherId: lesson.teacherId,
        subjectId: lesson.subjectId,
        ...(lesson.id ? { lessonId: lesson.id } : {}),
      }),
    })
    if (res.ok) {
      const entry = await res.json()
      setCurrent(prev => {
        if (!prev) return prev
        const filtered = prev.entries.filter(e => !(e.classId === classId && e.day === day && e.period === period))
        return { ...prev, entries: [...filtered, entry] }
      })
      return true
    } else {
      showToast('Failed to place entry.', false)
      return false
    }
  }

  async function removeEntry(entry: TEntry) {
    const res = await timetableFetch(`/api/timetable/entries/${entry.id}`, { method: 'DELETE' })
    if (res.ok) {
      setCurrent(prev => prev ? { ...prev, entries: prev.entries.filter(e => e.id !== entry.id) } : prev)
    } else {
      showToast('Failed to remove entry.', false)
    }
  }

  // Auto-generate a short name from a full class name
  function autoShort(name: string) {
    const words = name.trim().split(/\s+/)
    if (words.length === 1) return name.slice(0, 5).toUpperCase()
    return words.map(w => w[0]).join('').slice(0, 6).toUpperCase()
  }

  // Open modals
  function openSubjectModal(item?: TSubject) {
    setEditingItem(item ?? null); setFSubName(item?.name ?? ''); setFSubShort(item?.short ?? '')
    setFSubColor(item?.color ?? '#6366f1'); setFSubRooms(item?.classroomCount ?? 1); setFSubCustom(item?.customFields?.note ?? '')
    setShowSubjectModal(true)
  }
  function openClassModal(item?: TClass) {
    setEditingItem(item ?? null); setFClsName(item?.name ?? ''); setFClsShort(item?.short ?? '')
    setFClsColor(item?.color ?? '#3b82f6'); setFClsPrint(item?.printSubjectPicture ?? false); setFClsCustom(item?.customFields?.note ?? '')
    if (!item) {
      setWizardSystemClasses([])
      setWizardSystemClassesLoading(true)
      apiFetch('/api/classes').then(async res => {
        if (res.ok) setWizardSystemClasses(await res.json())
        setWizardSystemClassesLoading(false)
      })
    }
    setShowClassModal(true)
  }
  function openClassroomModal(item?: TClassroom) {
    setEditingItem(item ?? null); setFRmName(item?.name ?? ''); setFRmShort(item?.short ?? '')
    setFRmColor(item?.color ?? '#14b8a6'); setFRmCustom(item?.customFields?.note ?? '')
    setShowClassroomModal(true)
  }
  function openTeacherModal(item?: TTeacher) {
    setEditingItem(item ?? null); setFTLast(item?.lastName ?? ''); setFTFirst(item?.firstName ?? '')
    setFTKhmer(item?.khmerName ?? '')
    setFTShort(item?.short ?? ''); setFTSex(item?.sex ?? ''); setFTEmail(item?.email ?? '')
    setFTPhone(item?.phone ?? ''); setFTColor(item?.color ?? '#22c55e'); setFTClassTeacher(item?.classTeacherId ?? '')
    if (!item) {
      setSystemTeachers([])
      setSystemTeachersLoading(true)
      apiFetch('/api/auth/users?roles=TEACHER').then(async res => {
        if (res.ok) setSystemTeachers(await res.json())
        setSystemTeachersLoading(false)
      })
    }
    setShowTeacherModal(true)
  }
  function openLessonModal(item?: TLesson, teacherDefault?: TTeacher) {
    setEditingItem(item ?? null); setFLTeacher(item?.teacherId ?? teacherDefault?.id ?? '')
    setFLSubject(item?.subjectId ?? ''); setFLClass(item?.classId ?? '')
    setFLPerWeek(item?.perWeek ?? 2); setFLType(item?.lessonType ?? 'SINGLE'); setShowLessonModal(true)
  }
  function openContractPanel(teacher: TTeacher) { setContractTeacher(teacher); setShowContractPanel(true) }

  async function savePeriodTimes() {
    if (!current) return
    setSavingPeriods(true)
    const normalised = periodInputs.map(to24h)
    const res = await timetableFetch(`/api/timetable/${current.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodTimes: JSON.stringify(normalised) }),
    })
    if (res.ok) {
      const updated = await res.json()
      setCurrent(prev => prev ? { ...prev, periodTimes: updated.periodTimes } : null)
      showToast(t('timetable.periodTimesSaved'))
      setShowPeriodModal(false)
    } else {
      showToast(t('timetable.saveFailed'), false)
    }
    setSavingPeriods(false)
  }

  // Grid
  function buildGrid() {
    if (!current) return null
    const { entries, numberOfDays } = current

    // ── Time-off rules: which period times are blocked ─────────────────
    const offRules = parseTimeOffRules(current.timeOffRules)
    const isBlocked = (time: string) =>
      offRules.length > 0 && offRules.some(r => r.from && r.to && time >= r.from && time < r.to)

    const khmerToArabic = (s: string) => s.replace(/[០-៩]/g, d => String(d.charCodeAt(0) - 0x17E0))
    const gradeNum = (s: string) => { const d = khmerToArabic(s).match(/\d+/); return d ? parseInt(d[0], 10) : 9999 }
    const classes = [...current.classes].sort((a, b) => {
      const gA = gradeNum(a.short), gB = gradeNum(b.short)
      if (gA !== gB) return gA - gB
      return khmerToArabic(a.name).localeCompare(khmerToArabic(b.name), undefined, { numeric: true, sensitivity: 'base' })
    })
    const days = Array.from({ length: numberOfDays }, (_, i) => i + 1)
    const times = getPeriodTimes(current)
    const morningTimes = times.filter(t => t < '12:00')
    const afternoonTimes = times.filter(t => t >= '12:00')
    const morningCount = morningTimes.length
    const hasBrk = morningCount > 0 && afternoonTimes.length > 0
    const dayColSpan = morningCount + (hasBrk ? 1 : 0) + afternoonTimes.length

    function renderCell(cls: TClass, day: number, period: number, cellKey: string, blocked = false) {
      const entry = entries.find(e => e.classId === cls.id && e.day === day && e.period === period)

      // ── Blocked (time-off) cell ──────────────────────────────────────
      if (blocked) {
        return (
          <td key={cellKey} className="border border-gray-200 p-0 text-center align-middle"
            style={{ minWidth: 56, height: 46, background: 'repeating-linear-gradient(135deg,#f3f4f6 0px,#f3f4f6 5px,#e5e7eb 5px,#e5e7eb 10px)' }}>
            {entry ? (
              // Entry exists in a blocked period – show it with warning outline so user can move it
              <div
                className="relative group rounded mx-0.5 my-0.5 px-1 py-0.5 text-white text-[10px] leading-tight cursor-grab active:cursor-grabbing ring-2 ring-orange-400"
                style={{ backgroundColor: entry.subject.color ?? '#6366f1', opacity: 0.75 }}
                draggable
                onDragStart={e => {
                  setDragEntry(entry)
                  const synth: TLesson = {
                    id: entry.lessonId ?? '', teacherId: entry.teacherId, subjectId: entry.subjectId,
                    classId: entry.classId, perWeek: 999, lessonType: 'SINGLE',
                    teacher: entry.teacher, subject: entry.subject, class: entry.class,
                  }
                  e.dataTransfer.setData('lesson', JSON.stringify(synth))
                  e.dataTransfer.setData('sourceEntryId', entry.id)
                }}
                onDragEnd={() => setDragEntry(null)}
                title="This period is in a time-off window — move or remove it"
              >
                <div className="font-semibold">{entry.subject.short}</div>
                <div className="opacity-90 text-[9px] rounded px-0.5 mt-0.5 inline-block"
                  style={{ backgroundColor: entry.teacher.color ?? '#374151' }}>{entry.teacher.short}</div>
                <button
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] items-center justify-center hidden group-hover:flex leading-none"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); removeEntry(entry) }}
                  title="Remove">×</button>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300 text-[13px]">⊘</div>
            )}
          </td>
        )
      }

      // ── Normal cell ──────────────────────────────────────────────────
      const isTarget = dropTarget?.classId === cls.id && dropTarget?.day === day && dropTarget?.period === period
      return (
        <td key={cellKey}
          className={`border p-0 text-center align-middle transition-colors ${isTarget ? 'bg-indigo-100 border-indigo-400' : 'border-gray-200'}`}
          style={{ minWidth: 56, height: 46 }}
          onDragOver={e => {
            e.preventDefault()
            setDropTarget(prev =>
              prev?.classId === cls.id && prev?.day === day && prev?.period === period
                ? prev
                : { classId: cls.id, day, period }
            )
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={async e => {
            e.preventDefault()
            setDropTarget(null)
            const raw = e.dataTransfer.getData('lesson')
            if (!raw) return
            const lesson: TLesson = JSON.parse(raw)
            const srcId = e.dataTransfer.getData('sourceEntryId') || undefined
            if (srcId) {
              const src = current?.entries.find(en => en.id === srcId)
              if (src && src.classId === cls.id && src.day === day && src.period === period) return
            }
            const ok = await placeEntry(cls.id, day, period, lesson, srcId)
            if (ok && srcId) {
              const delRes = await timetableFetch(`/api/timetable/entries/${srcId}`, { method: 'DELETE' })
              if (delRes.ok) setCurrent(prev => prev ? { ...prev, entries: prev.entries.filter(e => e.id !== srcId) } : prev)
            }
          }}
        >
          {entry ? (
            <div
              className="relative group rounded mx-0.5 my-0.5 px-1 py-0.5 text-white text-[10px] leading-tight cursor-grab active:cursor-grabbing"
              style={{ backgroundColor: entry.subject.color ?? '#6366f1' }}
              draggable
              onDragStart={e => {
                setDragEntry(entry)
                const synth: TLesson = {
                  id: entry.lessonId ?? '', teacherId: entry.teacherId, subjectId: entry.subjectId,
                  classId: entry.classId, perWeek: 999, lessonType: 'SINGLE',
                  teacher: entry.teacher, subject: entry.subject, class: entry.class,
                }
                e.dataTransfer.setData('lesson', JSON.stringify(synth))
                e.dataTransfer.setData('sourceEntryId', entry.id)
              }}
              onDragEnd={() => setDragEntry(null)}
            >
              <div className="font-semibold" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>{entry.subject.short}</div>
              <div className="opacity-90 text-[9px] rounded px-0.5 mt-0.5 inline-block"
                style={{ backgroundColor: entry.teacher.color ?? '#374151', fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>
                {entry.teacher.short}
              </div>
              <button
                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[8px] items-center justify-center hidden group-hover:flex leading-none"
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeEntry(entry) }}
                title="Remove"
              >×</button>
            </div>
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-gray-200 text-[9px] ${isTarget ? 'text-indigo-400' : ''}`}>
              {isTarget ? '↓' : ''}
            </div>
          )}
        </td>
      )
    }

    return (
      <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', transition: 'transform 0.2s' }}>
        <table className="border-collapse text-xs select-none" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr className="bg-indigo-700 text-white">
              <th rowSpan={2} className="border border-indigo-800 px-2 py-1 min-w-[90px] text-left align-middle">{t('timetable.class')}</th>
              {days.map(d => (
                <th key={d} colSpan={dayColSpan} className="border border-indigo-800 px-2 py-1 text-center">
                  {DAY_LABELS[d - 1] ?? `Day ${d}`}
                </th>
              ))}
            </tr>
            <tr className="bg-indigo-600 text-white text-[10px]">
              {days.map(d => (
                <Fragment key={d}>
                  {morningTimes.map((time, idx) => (
                    isBlocked(time)
                      ? <th key={`${d}-m${idx}`} className="border border-orange-700 bg-orange-800/70 text-orange-200 px-0.5 py-1 text-[9px] font-normal text-center" title={`Time-off: ${time}`}>⊘<br/>{time}</th>
                      : <th key={`${d}-m${idx}`} className="border border-indigo-700 px-1 py-1 min-w-[56px] text-center font-normal">{time}</th>
                  ))}
                  {hasBrk && <th className="border border-indigo-900 bg-indigo-900/60 text-indigo-400 px-1 py-1 text-[9px] font-normal">☕<br/>{t('timetable.break')}</th>}
                  {afternoonTimes.map((time, idx) => (
                    isBlocked(time)
                      ? <th key={`${d}-a${idx}`} className="border border-orange-700 bg-orange-800/70 text-orange-200 px-0.5 py-1 text-[9px] font-normal text-center" title={`Time-off: ${time}`}>⊘<br/>{time}</th>
                      : <th key={`${d}-a${idx}`} className="border border-indigo-700 px-1 py-1 min-w-[56px] text-center font-normal">{time}</th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map(cls => (
              <tr key={cls.id} className="even:bg-gray-50">
                <td className="border border-gray-300 px-2 py-1 align-middle whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-[10px]"
                      style={{ backgroundColor: cls.color ?? '#6366f1' }}>{cls.short.slice(0, 2)}</span>
                    <div>
                      <div className="font-semibold text-xs text-gray-800">{cls.short}</div>
                      <div className="text-gray-400 text-[10px] leading-tight">{cls.name}</div>
                    </div>
                  </div>
                </td>
                {days.map(day => (
                  <Fragment key={day}>
                    {morningTimes.map((time, idx) => renderCell(cls, day, idx + 1, `${day}-m${idx}`, isBlocked(time)))}
                    {hasBrk && <td className="border border-gray-200 bg-gray-100" style={{ width: 28 }} />}
                    {afternoonTimes.map((time, idx) => renderCell(cls, day, morningCount + idx + 1, `${day}-a${idx}`, isBlocked(time)))}
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <AuthGuard allowedRoles={['ADMIN']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-100 print:bg-white print:h-auto print:block pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
        <div className="flex-1 flex flex-col overflow-hidden print:hidden">
          {/* Ribbon Toolbar */}
          <div className="bg-white border-b-2 border-indigo-100 select-none">
            {/* Timetable name bar */}
            {current && (
              <div className="bg-indigo-700 text-white text-xs px-4 py-0.5 flex items-center gap-2">
                <span className="font-semibold truncate">{current.name}</span>
                <span className="opacity-60">·</span>
                <span className="opacity-70">{current.academicYear}</span>
                <span className={`ml-2 px-1.5 py-0 rounded text-[10px] font-medium ${current.status === 'PUBLISHED' ? 'bg-green-400/30' : 'bg-yellow-400/30'}`}>{current.status}</span>
              </div>
            )}
            {/* Ribbon row */}
            <div className="flex items-stretch gap-0 overflow-x-auto">

              {/* ── Group: File ── */}
              <div className="flex flex-col items-center border-r border-gray-200 px-1">
                <div className="flex items-end gap-1 py-1.5 flex-1">
                  {/* New — big primary button */}
                  <button onClick={openWizard}
                    className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white transition-colors min-w-[48px]">
                    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="text-[10px] font-semibold leading-none">{t('timetable.new')}</span>
                  </button>
                  {/* Open */}
                  <button onClick={() => setShowOpenModal(true)}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.75h16.5m-16.5 0A2.25 2.25 0 016 7.5h2.25L9.75 6h4.5l1.5 1.5H18a2.25 2.25 0 012.25 2.25v8.25A2.25 2.25 0 0118 20.25H6a2.25 2.25 0 01-2.25-2.25V9.75z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.open')}</span>
                  </button>
                  {/* Save */}
                  <button onClick={handleSave} disabled={!current}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors disabled:opacity-35 min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25h12A2.25 2.25 0 0020.25 18V7.5L16.5 3.75z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 20.25v-6.75h7.5v6.75M15.75 3.75V8.25H9" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.save')}</span>
                  </button>
                  {/* Print */}
                  <button onClick={() => { if (!current) return; setPrintClassId(''); setShowPrintModal(true) }} disabled={!current}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors disabled:opacity-35 min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75H5.25a2.25 2.25 0 01-2.25-2.25v-4.5A2.25 2.25 0 015.25 6.75h13.5A2.25 2.25 0 0121 9v4.5a2.25 2.25 0 01-2.25 2.25h-1.5" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75V3.75h10.5v3M6.75 15.75v4.5h10.5v-4.5" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.print')}</span>
                  </button>
                </div>
                <span className="text-[9px] text-gray-400 pb-0.5 font-medium tracking-wide uppercase">{t('timetable.file')}</span>
              </div>

              {/* ── Group: Data ── */}
              <div className="flex flex-col items-center border-r border-gray-200 px-1">
                <div className="flex items-end gap-1 py-1.5 flex-1">
                  {/* Subjects */}
                  <button onClick={() => router.push(timetablePath('subjects'))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-blue-50 text-blue-700 transition-colors min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.subjects')}</span>
                  </button>
                  {/* Classes */}
                  <button onClick={() => router.push(timetablePath('classes'))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-blue-50 text-blue-700 transition-colors min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.classes')}</span>
                  </button>
                  {/* Classrooms */}
                  <button onClick={() => router.push(timetablePath('classrooms'))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-blue-50 text-blue-700 transition-colors min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.rooms')}</span>
                  </button>
                  {/* Teachers */}
                  <button onClick={() => router.push(timetablePath('teachers'))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-blue-50 text-blue-700 transition-colors min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.teachers')}</span>
                  </button>
                  {/* Lessons */}
                  <button onClick={() => router.push(timetablePath('lessons'))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-blue-50 text-blue-700 transition-colors min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.lessons')}</span>
                  </button>
                </div>
                <span className="text-[9px] text-gray-400 pb-0.5 font-medium tracking-wide uppercase">{t('timetable.data')}</span>
              </div>

              {/* ── Group: Configure ── */}
              <div className="flex flex-col items-center border-r border-gray-200 px-1">
                <div className="flex items-end gap-1 py-1.5 flex-1">
                  {/* Settings */}
                  <button onClick={() => {
                    if (!current) return
                    setSPeriods(current.periodsPerDay)
                    setSDays(current.numberOfDays)
                    setSWeekend(current.weekend ?? ['SATURDAY','SUNDAY'])
                    setSTimeOffRules(parseTimeOffRules(current.timeOffRules))
                    setShowSettingsModal(true)
                  }} disabled={!current}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors disabled:opacity-35 min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.settings')}</span>
                  </button>
                  {/* Period Times */}
                  <button onClick={() => {
                    if (!current) return
                    setPeriodInputs(getPeriodTimes(current))
                    setShowPeriodModal(true)
                  }} disabled={!current}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-purple-50 text-purple-700 transition-colors disabled:opacity-35 min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.periods')}</span>
                  </button>
                </div>
                <span className="text-[9px] text-gray-400 pb-0.5 font-medium tracking-wide uppercase">{t('timetable.configure')}</span>
              </div>

              {/* ── Group: View ── */}
              <div className="flex flex-col items-center border-r border-gray-200 px-1">
                <div className="flex items-end gap-1 py-1.5 flex-1">
                  {/* Zoom out */}
                  <button onClick={() => setZoom(z => Math.max(0.5, parseFloat((z - 0.1).toFixed(1))))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors min-w-[40px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
                    </svg>
                    <span className="text-[10px] leading-none">−</span>
                  </button>
                  {/* Zoom reset */}
                  <button onClick={() => setZoom(1)}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-600 transition-colors min-w-[40px]">
                    <span className="text-sm font-bold leading-none mt-1">{Math.round(zoom * 100)}%</span>
                    <span className="text-[10px] leading-none mt-1">{t('timetable.zoom')}</span>
                  </button>
                  {/* Zoom in */}
                  <button onClick={() => setZoom(z => Math.min(2, parseFloat((z + 0.1).toFixed(1))))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors min-w-[40px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                    </svg>
                    <span className="text-[10px] leading-none">+</span>
                  </button>
                </div>
                <span className="text-[9px] text-gray-400 pb-0.5 font-medium tracking-wide uppercase">{t('timetable.view')}</span>
              </div>

              {/* ── Group: Tools ── */}
              <div className="flex flex-col items-center border-r border-gray-200 px-1">
                <div className="flex items-end gap-1 py-1.5 flex-1">
                  {/* Schedule */}
                  <button onClick={() => router.push(timetablePath('schedule'))}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white transition-colors min-w-[52px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                    </svg>
                    <span className="text-[10px] font-semibold leading-none">{t('timetable.schedule')}</span>
                  </button>
                  {/* Auto-generate */}
                  <button onClick={handleGenerate} disabled={!current || generating}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-emerald-50 text-emerald-700 transition-colors disabled:opacity-35 min-w-[48px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                    <span className="text-[10px] leading-none">{generating ? t('timetable.running') : t('timetable.autoFill')}</span>
                  </button>
                  {/* Workload */}
                  <button onClick={() => setShowWorkloadModal(true)} disabled={!current}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-emerald-50 text-emerald-700 transition-colors disabled:opacity-35 min-w-[52px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.workload')}</span>
                  </button>
                </div>
                <span className="text-[9px] text-gray-400 pb-0.5 font-medium tracking-wide uppercase">{t('timetable.tools')}</span>
              </div>

              {/* ── Group: Danger ── */}
              <div className="flex flex-col items-center px-1">
                <div className="flex items-end gap-1 py-1.5 flex-1">
                  <button
                    onClick={() => current && handleDeleteTimetable(current.id, current.name, current.status)}
                    disabled={!current || current.status === 'PUBLISHED'}
                    title={current?.status === 'PUBLISHED' ? 'Unpublish before deleting' : 'Delete timetable'}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md hover:bg-red-50 text-red-500 transition-colors disabled:opacity-35 disabled:cursor-not-allowed min-w-[44px]">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    <span className="text-[10px] leading-none">{t('timetable.delete')}</span>
                  </button>
                </div>
                <span className="text-[9px] text-gray-400 pb-0.5 font-medium tracking-wide uppercase">{t('timetable.danger')}</span>
              </div>

            </div>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Lesson Panel */}
            {current && (
              <div className={`flex-shrink-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200 print:hidden ${showLessonPanel ? 'w-48' : 'w-8'}`}>
                <div className="flex items-center justify-between px-2 py-2 border-b border-gray-200">
                  {showLessonPanel && <span className="text-xs font-semibold text-gray-600 truncate">{t('timetable.lessons')}</span>}
                  <button onClick={() => setShowLessonPanel(p => !p)}
                    className="ml-auto text-gray-400 hover:text-gray-600 text-xs w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100">
                    {showLessonPanel ? '◀' : '▶'}
                  </button>
                </div>
                {showLessonPanel && (
                  <>
                    {/* Class filter */}
                    <div className="px-2 py-1.5 border-b border-gray-100">
                      <select
                        value={lessonFilterClass}
                        onChange={e => setLessonFilterClass(e.target.value)}
                        className="w-full text-[10px] rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        <option value="ALL">{t('timetable.allClasses')}</option>
                        {[...current.classes]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(cls => (
                            <option key={cls.id} value={cls.id}>{cls.short || cls.name}</option>
                          ))}
                      </select>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      {(() => {
                        const filtered = current.lessons.filter(
                          l => lessonFilterClass === 'ALL' || l.classId === lessonFilterClass
                        )
                        return filtered.length === 0
                          ? <p className="text-[10px] text-gray-400 text-center pt-4">
                              {current.lessons.length === 0 ? <>{t('timetable.noLessonsYet')}</> : t('timetable.noLessonsForClass')}
                            </p>
                          : filtered.map(lesson => {
                              const placed = current.entries.filter(e => e.lessonId === lesson.id).length
                              const full = placed >= lesson.perWeek
                              return (
                              <div
                                key={lesson.id}
                                draggable
                                onDragStart={e => {
                                  setDragLesson(lesson)
                                  e.dataTransfer.setData('lesson', JSON.stringify(lesson))
                                }}
                                onDragEnd={() => setDragLesson(null)}
                                className={`rounded-lg px-2 py-1.5 text-white text-[10px] cursor-grab active:cursor-grabbing select-none shadow-sm transition-opacity ${full ? 'opacity-40 hover:opacity-60' : 'hover:opacity-90'}`}
                                style={{ backgroundColor: lesson.subject.color ?? '#6366f1' }}
                                title={`${lesson.subject.name} · ${lesson.teacher.lastName} ${lesson.teacher.firstName} · ${lesson.class.name}\n${placed}/${lesson.perWeek} periods scheduled`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="font-bold truncate">{lesson.subject.short}</div>
                                  <span className={`text-[9px] font-bold px-1 rounded ml-1 flex-shrink-0 ${full ? 'bg-green-400/80' : placed > 0 ? 'bg-yellow-400/80 text-yellow-900' : 'bg-black/25'}`}>
                                    {placed}/{lesson.perWeek}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="rounded px-1 py-0 text-[9px] font-medium"
                                    style={{ backgroundColor: lesson.teacher.color ?? '#374151' }}>
                                    {lesson.teacher.short}
                                  </span>
                                  {lessonFilterClass === 'ALL' && (
                                    <span className="rounded px-1 py-0 text-[9px] font-medium bg-black/20">
                                      {lesson.class.short}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[9px] opacity-70 mt-0.5">{lesson.lessonType.toLowerCase()}{full ? ' ✓' : ''}</div>
                              </div>
                              )
                            })
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Grid area */}
            <div className="flex-1 overflow-auto p-4">
              {loading && <div className="flex items-center justify-center h-40 text-gray-400">{t('timetable.loading')}</div>}
              {!loading && !current && (
                <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-400">
                  <svg className="w-16 h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg">{t('timetable.noOpen')}</p>
                  <p className="text-sm">{t('timetable.noOpenHint')}</p>
                </div>
              )}
              {!loading && current && (
                <div>
                  <p className="text-[10px] text-gray-400 mb-2 print:hidden">
                    ← Drag a lesson card onto a cell to place it · Hover an entry and click <strong>×</strong> to remove it · Drag an entry to move it
                  </p>
                  {buildGrid()}
                </div>
              )}
            </div>
          </div>
          {/* Footer zoom */}
          <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-3 print:hidden">
            <span className="text-xs text-gray-500">{t('timetable.zoom')}</span>
            <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(1)))}
              className="w-7 h-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold">−</button>
            <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))}
              className="w-7 h-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold">+</button>
            <button onClick={() => setZoom(1)} className="text-xs text-indigo-600 hover:underline ml-1">{t('timetable.zoomReset')}</button>
            {current && (
              <span className="ml-auto text-xs text-gray-400">
                {current.classes.length} classes · {current.entries.length} entries · {current.periodsPerDay} periods/day
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Timetable Settings Modal */}
      {showSettingsModal && current && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-800">{t('timetable.timetableSettings')}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{current.name} · {current.academicYear}</p>
              </div>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('timetable.periodsPerDay')}</label>
                <input type="number" min={1} max={20}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={sPeriods} onChange={e => setSPeriods(+e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('timetable.numberOfDays')}</label>
                <input type="number" min={1} max={7}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={sDays} onChange={e => setSDays(+e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('timetable.weekendDays')}</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {WEEKENDS.map(d => (
                    <button key={d} type="button"
                      onClick={() => setSWeekend(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                        ${sWeekend.includes(d) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:border-indigo-300'}`}>
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t('timetable.timeOffRules')}</label>
                <TimeOffEditor rules={sTimeOffRules} onChange={setSTimeOffRules} />
              </div>
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                {t('timetable.settingsWarning')}
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowSettingsModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">{t('common.cancel')}</button>
              <button onClick={saveSettings} disabled={savingSettings || sPeriods < 1 || sDays < 1}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
                {savingSettings ? t('timetable.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Period Times Config Modal */}
      {showPeriodModal && current && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-800">{t('timetable.periodTimes')}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{t('timetable.setStartTime')}</p>
              </div>
              <button onClick={() => setShowPeriodModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-2 max-h-80 overflow-y-auto">
              {periodInputs.map((time, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-indigo-600 w-16 flex-shrink-0">{t('timetable.period')} {idx + 1}</span>
                  <input
                    type="text"
                    placeholder="HH:MM"
                    pattern="[0-2][0-9]:[0-5][0-9]"
                    maxLength={5}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    value={time}
                    onChange={e => {
                      const next = [...periodInputs]
                      next[idx] = e.target.value
                      setPeriodInputs(next)
                    }}
                    onBlur={e => {
                      const next = [...periodInputs]
                      next[idx] = to24h(e.target.value)
                      setPeriodInputs(next)
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <p className="text-xs text-gray-400 mb-3">
                {t('timetable.periodTimesHint')}
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowPeriodModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">{t('common.cancel')}</button>
                <button onClick={savePeriodTimes} disabled={savingPeriods}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-40">
                  {savingPeriods ? t('timetable.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Open Modal */}
      {showOpenModal && (
        <ModalShell title="Open Timetable" onClose={() => setShowOpenModal(false)} width="max-w-lg">
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {timetableList.length === 0 && <p className="text-gray-400 text-sm text-center py-8">{t('timetable.noTimetables')}</p>}
            {timetableList.map(tt => (
              <div key={tt.id} className="flex items-center gap-2 rounded border border-transparent hover:border-indigo-200 hover:bg-indigo-50 px-3 py-2 transition-colors">
                <button className="flex-1 text-left"
                  onClick={async () => { await loadTimetable(tt.id); setShowOpenModal(false) }}>
                  <div className="font-medium text-gray-800">{tt.name}</div>
                  <div className="text-xs text-gray-500">{tt.academicYear} · {tt.status}</div>
                </button>
                {tt.status !== 'PUBLISHED' && (
                  <button
                    onClick={async () => { await handleDeleteTimetable(tt.id, tt.name, tt.status); }}
                    className="shrink-0 px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded border border-transparent hover:border-red-200">
                    {t('common.delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </ModalShell>
      )}

      {/* 5-Step Wizard */}
      {showWizard && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-indigo-50 rounded-t-xl flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-indigo-800">{t('timetable.newTimetable')}</h2>
                <p className="text-sm text-indigo-600 mt-0.5">{t('timetable.step')} {wizardStep + 1} {t('timetable.of')} {WIZARD_STEPS.length} — {WIZARD_STEPS[wizardStep]}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {WIZARD_STEPS.map((label, i) => (
                  <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${i === wizardStep ? 'bg-indigo-600 text-white' : i < wizardStep ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-200 text-gray-400'}`}>
                    {i < wizardStep ? '✓' : i + 1}
                  </div>
                ))}
              </div>
            </div>

            {/* Column labels for step 1 */}
            {wizardStep === 0 && (
              <div className="px-6 pt-3 pb-1">
                <div className="grid grid-cols-8 gap-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 pb-1">
                  <div className="col-span-2">Name</div>
                  <div>Short</div>
                  <div>Time Off</div>
                  <div>Distribut.</div>
                  <div>Hmwk Prep</div>
                  <div>Max. On</div>
                  <div>Doc.</div>
                </div>
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">

              {/* STEP 1 */}
              {wizardStep === 0 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="label-sm">Name of School / Timetable</label>
                      <input className="input-field" value={wSchoolName} onChange={e => setWSchoolName(e.target.value)} placeholder="e.g. Wattaman School 2025" />
                    </div>
                    <div>
                      <label className="label-sm">Academic Year</label>
                      <input className="input-field" value={wAcademicYear} onChange={e => setWAcademicYear(e.target.value)} placeholder="2025-2026" />
                    </div>
                    <div>
                      <label className="label-sm">Periods per Day</label>
                      <input type="number" className="input-field" value={wPeriods} onChange={e => setWPeriods(+e.target.value)} min={1} max={20} />
                    </div>
                    <div>
                      <label className="label-sm">Number of Days</label>
                      <input type="number" className="input-field" value={wDays} onChange={e => setWDays(+e.target.value)} min={1} max={7} />
                    </div>
                    <div>
                      <label className="label-sm">Max. Lessons on One Day</label>
                      <input type="number" className="input-field" value={wMaxOn} onChange={e => setWMaxOn(e.target.value ? +e.target.value : '')} min={1} placeholder="Optional" />
                    </div>
                  </div>
                  <div>
                    <label className="label-sm">Weekend (non-teaching days)</label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {WEEKENDS.map(d => (
                        <button key={d} type="button"
                          onClick={() => setWWeekend(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                            ${wWeekend.includes(d) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:border-indigo-300'}`}>
                          {d.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t pt-3 grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="label-sm">Time Off Rules</label>
                      <TimeOffEditor rules={wTimeOffRules} onChange={setWTimeOffRules} />
                    </div>
                    <div>
                      <label className="label-sm">Distribution</label>
                      <input className="input-field" value={wDistrib} onChange={e => setWDistrib(e.target.value)} placeholder="e.g. max 2 same subject/day" />
                    </div>
                    <div>
                      <label className="label-sm">Homework Preparation</label>
                      <input className="input-field" value={wHomework} onChange={e => setWHomework(e.target.value)} placeholder="Notes..." />
                    </div>
                    <div>
                      <label className="label-sm">Doc Notes</label>
                      <input className="input-field" value={wDoc} onChange={e => setWDoc(e.target.value)} placeholder="Additional notes..." />
                    </div>
                  </div>
                </div>
              )}

              {/* Loading state for steps 2-5 while timetable is being fetched */}
              {wizardStep >= 1 && !current && (
                <div className="flex flex-col items-center justify-center py-14 gap-3 text-gray-400">
                  <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  <span className="text-sm">{t('timetable.loadingData')}</span>
                </div>
              )}

              {/* STEP 2: Subjects */}
              {wizardStep === 1 && current && (
                <WizardListStep
                  title="Subjects" addLabel="Enter Subject" items={current.subjects} onNew={() => openSubjectModal()}
                  columns={['Name', 'Short', 'Rooms', 'Color']}
                  renderRow={(s: TSubject) => [s.name, s.short, String(s.classroomCount), colorBadge(s.color, '  ')]}
                  onEdit={(s: TSubject) => openSubjectModal(s)} onRemove={(s: TSubject) => removeSubject(s.id, s.name)}
                />
              )}

              {/* STEP 3: Classes */}
              {wizardStep === 2 && current && (
                <WizardListStep
                  title="Classes" addLabel="Enter Class" items={current.classes} onNew={() => openClassModal()}
                  columns={['Name', 'Short', 'Color', 'Print Pic']}
                  renderRow={(c: TClass) => [c.name, c.short, colorBadge(c.color, '  '), c.printSubjectPicture ? '✓' : '—']}
                  onEdit={(c: TClass) => openClassModal(c)} onRemove={(c: TClass) => removeClass(c.id, c.name)}
                />
              )}

              {/* STEP 4: Classrooms */}
              {wizardStep === 3 && current && (
                <WizardListStep
                  title="Classrooms" addLabel="Enter Classroom" items={current.classrooms} onNew={() => openClassroomModal()}
                  columns={['Name', 'Short', 'Color']}
                  renderRow={(r: TClassroom) => [r.name, r.short, colorBadge(r.color, '  ')]}
                  onEdit={(r: TClassroom) => openClassroomModal(r)} onRemove={(r: TClassroom) => removeClassroom(r.id, r.name)}
                />
              )}

              {/* STEP 5: Teachers + Contracts */}
              {wizardStep === 4 && current && (
                <WizardListStep
                  title="Teachers" addLabel="Enter Teacher" items={current.teachers} onNew={() => openTeacherModal()}
                  columns={['Last Name', 'First Name', 'Short', 'Color', 'Class Teacher']}
                  renderRow={(t: TTeacher) => [t.lastName, t.firstName, t.short, colorBadge(t.color, '  '), t.classTeacher?.short ?? '—']}
                  onEdit={(t: TTeacher) => openTeacherModal(t)}
                  onRemove={(t: TTeacher) => removeTeacher(t.id, `${t.firstName} ${t.lastName}`.trim())}
                  extraAction={(t: TTeacher) => (
                    <button onClick={() => openContractPanel(t)} className="text-emerald-600 hover:underline mr-2 text-xs font-medium">Contract</button>
                  )}
                />
              )}
            </div>

            {/* Error message */}
            {wizardError && (
              <div className="mx-6 mb-1 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {wizardError}
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowWizard(false)} className="tt-btn bg-white border border-gray-300 text-gray-700">{t('common.cancel')}</button>
              <div className="flex gap-2">
                {wizardStep > 0 && (
                  <button onClick={wizardPrev} className="tt-btn bg-gray-100 text-gray-700">← Previous</button>
                )}
                {wizardStep < WIZARD_STEPS.length - 1 ? (
                  <button onClick={wizardNext} disabled={wizardSaving} className="tt-btn bg-indigo-600 text-white disabled:opacity-50">
                    {wizardSaving ? 'Saving…' : 'Next →'}
                  </button>
                ) : (
                  <button onClick={wizardOk} className="tt-btn bg-emerald-600 text-white">OK ✓</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contract Panel */}
      {showContractPanel && contractTeacher && current && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50 rounded-t-xl">
              <div>
                <h2 className="font-bold text-gray-800">{t('timetable.lessonContracts')}</h2>
                <p className="text-sm text-gray-500">{contractTeacher.lastName} {contractTeacher.firstName}</p>
              </div>
              <button onClick={() => openLessonModal(undefined, contractTeacher)} className="tt-btn bg-emerald-600 text-white text-xs">{t('timetable.newLessonBtn')}</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {current.lessons.filter(l => l.teacherId === contractTeacher.id).length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-10">{t('timetable.noContractsYet')}</p>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      {['Subject','Class','Lessons/Week','Type',''].map(h => (
                        <th key={h} className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.lessons.filter(l => l.teacherId === contractTeacher.id).map(l => (
                      <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2">{colorBadge(l.subject.color, l.subject.short)} {l.subject.name}</td>
                        <td className="px-3 py-2">{colorBadge(l.class.color, l.class.short)} {l.class.name}</td>
                        <td className="px-3 py-2 text-center font-medium">{l.perWeek}x/week</td>
                        <td className="px-3 py-2">{l.lessonType}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => openLessonModal(l)} className="text-blue-600 hover:underline mr-3">{t('timetable.editLesson')}</button>
                          <button onClick={() => removeLesson(l.id)} className="text-red-500 hover:underline">{t('timetable.removeLesson')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end bg-gray-50 rounded-b-xl">
              <button onClick={() => setShowContractPanel(false)} className="tt-btn bg-gray-100 text-gray-700">{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Subject Modal */}
      {showSubjectModal && (
        <ItemModal title={editingItem ? 'Edit Subject' : 'New Subject'} onOk={saveSubject} onCancel={() => setShowSubjectModal(false)}>
          <Field label="Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fSubName} onChange={e => setFSubName(e.target.value)} placeholder="e.g. Mathematics" /></Field>
          <Field label="Short Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fSubShort} onChange={e => setFSubShort(e.target.value)} maxLength={8} placeholder="e.g. Math" /></Field>
          <Field label="Custom Fields"><input className="input-field" value={fSubCustom} onChange={e => setFSubCustom(e.target.value)} placeholder="Optional notes" /></Field>
          <Field label="Classroom Count">
            <div className="flex items-center gap-2">
              <input type="number" className="input-field" style={{width:80}} value={fSubRooms} onChange={e => setFSubRooms(+e.target.value)} min={1} />
              <span className="text-xs text-gray-400">rooms needed</span>
            </div>
          </Field>
          <Field label="Color / Picture">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded border border-gray-300" style={{ backgroundColor: fSubColor }} />
              <button type="button" onClick={async () => { const c = await openColorPicker(fSubColor); setFSubColor(c) }}
                className="tt-btn bg-gray-100 text-gray-700 text-xs">Change</button>
              <span className="text-xs text-gray-500">{fSubColor}</span>
            </div>
          </Field>
          <Field label="Set for lessons of this subject">
            <p className="text-xs text-gray-400">Classroom count sets how many rooms this subject requires.</p>
          </Field>
        </ItemModal>
      )}

      {/* Class Modal */}
      {showClassModal && (
        <ItemModal title={editingItem ? 'Edit Class' : 'New Class'} onOk={saveClass} onCancel={() => setShowClassModal(false)}>
          {!editingItem && (
            <Field label="From existing classes">
              {wizardSystemClassesLoading ? (
                <p className="text-xs text-gray-400">Loading…</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {wizardSystemClasses
                    .filter(sc => !(current?.classes ?? []).some(tc => tc.name.toLowerCase() === sc.name.toLowerCase()))
                    .map(sc => (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => { setFClsName(sc.name); setFClsShort(autoShort(sc.name)) }}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          fClsName === sc.name
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-indigo-400 hover:text-indigo-700'
                        }`}
                      >
                        {sc.name}{sc.studyYear ? ` · ${sc.studyYear.label ?? sc.studyYear.year}` : ''}
                      </button>
                    ))
                  }
                  {!wizardSystemClassesLoading && wizardSystemClasses.filter(sc => !(current?.classes ?? []).some(tc => tc.name.toLowerCase() === sc.name.toLowerCase())).length === 0 && (
                    <p className="text-xs text-gray-400">All existing classes are already added.</p>
                  )}
                </div>
              )}
            </Field>
          )}
          <Field label="Class Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fClsName} onChange={e => setFClsName(e.target.value)} placeholder="e.g. Grade 10A" /></Field>
          <Field label="Short Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fClsShort} onChange={e => setFClsShort(e.target.value)} maxLength={8} placeholder="e.g. G10A" /></Field>
          <Field label="Custom Fields"><input className="input-field" value={fClsCustom} onChange={e => setFClsCustom(e.target.value)} placeholder="Optional notes" /></Field>
          <Field label="Color / Picture">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded border border-gray-300" style={{ backgroundColor: fClsColor }} />
              <button type="button" onClick={async () => { const c = await openColorPicker(fClsColor); setFClsColor(c) }}
                className="tt-btn bg-gray-100 text-gray-700 text-xs">Change</button>
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-1">
            <input type="checkbox" checked={fClsPrint} onChange={e => setFClsPrint(e.target.checked)} className="rounded" />
            Print subject picture on timetable
          </label>
        </ItemModal>
      )}

      {/* Classroom Modal */}
      {showClassroomModal && (
        <ItemModal title={editingItem ? 'Edit Classroom' : 'New Classroom'} onOk={saveClassroom} onCancel={() => setShowClassroomModal(false)}>
          <Field label="Classroom Name"><input className="input-field" value={fRmName} onChange={e => setFRmName(e.target.value)} placeholder="e.g. Room 101" /></Field>
          <Field label="Short Name"><input className="input-field" value={fRmShort} onChange={e => setFRmShort(e.target.value)} maxLength={8} placeholder="e.g. R101" /></Field>
          <Field label="Custom Fields"><input className="input-field" value={fRmCustom} onChange={e => setFRmCustom(e.target.value)} placeholder="Optional notes" /></Field>
          <Field label="Color / Picture">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded border border-gray-300" style={{ backgroundColor: fRmColor }} />
              <button type="button" onClick={async () => { const c = await openColorPicker(fRmColor); setFRmColor(c) }}
                className="tt-btn bg-gray-100 text-gray-700 text-xs">Change</button>
            </div>
          </Field>
        </ItemModal>
      )}

      {/* Teacher Modal */}
      {showTeacherModal && (
        <ItemModal title={editingItem ? 'Edit Teacher' : 'New Teacher'} onOk={saveTeacher} onCancel={() => setShowTeacherModal(false)} width="max-w-lg">
          {!editingItem && (
            <Field label="From existing teachers">
              {systemTeachersLoading ? (
                <p className="text-xs text-gray-400">Loading…</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {systemTeachers
                    .filter(st => !(current?.teachers ?? []).some(tt => tt.email && tt.email === st.email))
                    .map(st => {
                      const nameParts = st.name.trim().split(/\s+/)
                      const first = nameParts[0] ?? ''
                      const last = nameParts.slice(1).join(' ')
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            setFTFirst(first)
                            setFTLast(last)
                            setFTShort(autoShort(st.name))
                            setFTEmail(st.email ?? '')
                            setFTPhone(st.phone ?? '')
                          }}
                          className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                            fTEmail === st.email && st.email
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-emerald-400 hover:text-emerald-700'
                          }`}
                        >
                          {st.name}
                        </button>
                      )
                    })
                  }
                  {!systemTeachersLoading && systemTeachers.filter(st => !(current?.teachers ?? []).some(tt => tt.email && tt.email === st.email)).length === 0 && (
                    <p className="text-xs text-gray-400">All existing teachers are already added, or no teachers found in the system.</p>
                  )}
                </div>
              )}
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Last Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fTLast} onChange={e => setFTLast(e.target.value)} /></Field>
            <Field label="First Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fTFirst} onChange={e => setFTFirst(e.target.value)} /></Field>
          </div>
          <Field label="Short Name"><input className="input-field" style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }} value={fTShort} onChange={e => setFTShort(e.target.value)} maxLength={8} /></Field>
          <Field label="Sex">
            <div className="flex gap-6 mt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={fTSex === 'MALE'} onChange={() => setFTSex(fTSex === 'MALE' ? '' : 'MALE')} />
                Male
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={fTSex === 'FEMALE'} onChange={() => setFTSex(fTSex === 'FEMALE' ? '' : 'FEMALE')} />
                Female
              </label>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="E-mail"><input type="email" className="input-field" value={fTEmail} onChange={e => setFTEmail(e.target.value)} /></Field>
            <Field label="Phone"><input className="input-field" value={fTPhone} onChange={e => setFTPhone(e.target.value)} /></Field>
          </div>
          <Field label="Khmer Name · ឈ្មោះខ្មែរ">
            <input
              className="input-field"
              value={fTKhmer}
              onChange={e => setFTKhmer(e.target.value)}
              placeholder="ឧ. សុខ ដារ៉ា"
              style={{ fontFamily: '"Khmer", var(--font-khmer), sans-serif' }}
            />
          </Field>
          <Field label="Class Teacher for (Class)">
            <div className="flex items-center gap-2">
              <select className="input-field" value={fTClassTeacher} onChange={e => setFTClassTeacher(e.target.value)}>
                <option value="">— None —</option>
                {current?.classes.map((c: TClass) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => setFTClassTeacher('')} className="tt-btn bg-gray-100 text-gray-700 text-xs whitespace-nowrap">Clear</button>
            </div>
          </Field>
          <Field label="Color">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded border border-gray-300" style={{ backgroundColor: fTColor }} />
              <button type="button" onClick={async () => { const c = await openColorPicker(fTColor); setFTColor(c) }}
                className="tt-btn bg-gray-100 text-gray-700 text-xs">Change</button>
            </div>
          </Field>
        </ItemModal>
      )}

      {/* Lesson Modal */}
      {showLessonModal && (
        <ItemModal title={editingItem ? 'Edit Lesson' : 'New Lesson'} onOk={saveLesson} onCancel={() => setShowLessonModal(false)}>
          <Field label="Teacher">
            <select className="input-field" value={fLTeacher} onChange={e => setFLTeacher(e.target.value)}>
              <option value="">Select teacher</option>
              {current?.teachers.map((t: TTeacher) => <option key={t.id} value={t.id}>{t.lastName} {t.firstName}</option>)}
            </select>
          </Field>
          <Field label="Subject">
            <select className="input-field" value={fLSubject} onChange={e => setFLSubject(e.target.value)}>
              <option value="">Select subject</option>
              {current?.subjects.map((s: TSubject) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Class">
            <select className="input-field" value={fLClass} onChange={e => setFLClass(e.target.value)}>
              <option value="">Select class</option>
              {current?.classes.map((c: TClass) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Lessons / Week">
            <select className="input-field" value={fLPerWeek} onChange={e => setFLPerWeek(+e.target.value)}>
              {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} {n === 1 ? 'time' : 'times'} per week</option>)}
            </select>
          </Field>
          <Field label="Lesson Type">
            <select className="input-field" value={fLType} onChange={e => setFLType(e.target.value)}>
              <option value="SINGLE">Single (1 period)</option>
              <option value="DOUBLE">Double (2 periods)</option>
              <option value="TRIPLE">Triple (3 periods)</option>
            </select>
          </Field>
        </ItemModal>
      )}

      {/* ── Workload Modal ── */}
      {showWorkloadModal && current && (() => {
        // Compute per-teacher stats from timetable entries
        const rows = current.teachers.map(teacher => {
          const teacherEntries = current.entries.filter(e => e.teacherId === teacher.id)
          const periodsPerWeek = teacherEntries.length
          const periodsPerMonth = periodsPerWeek * weeksPerMonth
          // Lessons contracted (sum of perWeek)
          const contractedPerWeek = current.lessons
            .filter(l => l.teacherId === teacher.id)
            .reduce((sum, l) => sum + l.perWeek, 0)
          // Subject breakdown: subject name → count of placed entries
          const subjectMap: Record<string, { name: string; color: string | null; count: number }> = {}
          for (const e of teacherEntries) {
            const key = e.subjectId
            if (!subjectMap[key]) subjectMap[key] = { name: e.subject.short, color: e.subject.color, count: 0 }
            subjectMap[key].count++
          }
          const subjects = Object.values(subjectMap).sort((a, b) => b.count - a.count)
          return { teacher, periodsPerWeek, periodsPerMonth, contractedPerWeek, subjects }
        })

        const sorted = [...rows].sort((a, b) => {
          if (workloadSort === 'name') return a.teacher.lastName.localeCompare(b.teacher.lastName)
          if (workloadSort === 'week') return b.periodsPerWeek - a.periodsPerWeek
          return b.periodsPerMonth - a.periodsPerMonth
        })

        const totalWeek = rows.reduce((s, r) => s + r.periodsPerWeek, 0)
        const totalMonth = totalWeek * weeksPerMonth
        const maxWeek = Math.max(...rows.map(r => r.periodsPerWeek), 1)

        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50 rounded-t-xl">
                <div>
                  <h2 className="font-bold text-gray-800 text-base">{t('timetable.teacherWorkload')}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{current.name} · {current.academicYear} · {current.teachers.length} teachers</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 font-medium">{t('timetable.weeksPerMonth')}</label>
                    <select value={weeksPerMonth} onChange={e => setWeeksPerMonth(+e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500">
                      {[3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <button onClick={() => setShowWorkloadModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>
              </div>

              {/* Summary cards */}
              <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-gray-100">
                <div className="bg-emerald-50 rounded-lg px-3 py-2 text-center">
                  <div className="text-xl font-bold text-emerald-700">{totalWeek}</div>
                  <div className="text-xs text-gray-500">{t('timetable.totalPeriodsWeek')}</div>
                </div>
                <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
                  <div className="text-xl font-bold text-blue-700">{totalMonth}</div>
                  <div className="text-xs text-gray-500">{t('timetable.totalPeriodsMonth')} ({weeksPerMonth}w)</div>
                </div>
                <div className="bg-indigo-50 rounded-lg px-3 py-2 text-center">
                  <div className="text-xl font-bold text-indigo-700">{current.teachers.length > 0 ? (totalWeek / current.teachers.length).toFixed(1) : 0}</div>
                  <div className="text-xs text-gray-500">{t('timetable.avgPeriodsTeacher')}</div>
                </div>
              </div>

              {/* Sort controls */}
              <div className="px-5 py-2 flex items-center gap-2 border-b border-gray-100">
                <span className="text-xs text-gray-500">{t('timetable.sortBy')}</span>
                {(['name', 'week', 'month'] as const).map(s => (
                  <button key={s} onClick={() => setWorkloadSort(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                      workloadSort === s ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-600 hover:border-emerald-300'
                    }`}>
                    {s === 'name' ? t('timetable.sortName') : s === 'week' ? t('timetable.sortWeek') : t('timetable.sortMonth')}
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto">
                {sorted.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-10">{t('timetable.noTeachers')}</p>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className="border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">{t('timetable.teacher')}</th>
                        <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">{t('timetable.contractedPerWeek')}</th>
                        <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">{t('timetable.scheduledPerWeek')}</th>
                        <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">{t('timetable.periodsPerMonth')}</th>
                        <th className="border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">{t('timetable.subjectsPlaced')}</th>
                        <th className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600 w-32">{t('timetable.loadBar')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((row, idx) => {
                        const diff = row.periodsPerWeek - row.contractedPerWeek
                        const barPct = Math.round((row.periodsPerWeek / maxWeek) * 100)
                        const overload = diff > 0
                        const underload = diff < 0
                        return (
                          <tr key={row.teacher.id} className={`border-b border-gray-100 ${idx % 2 === 0 ? '' : 'bg-gray-50'}`}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.teacher.color ?? '#6366f1' }} />
                                <div>
                                  <div className="font-semibold text-gray-800">{row.teacher.lastName} {row.teacher.firstName}</div>
                                  <div className="text-[10px] text-gray-400">{row.teacher.short}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="font-medium text-gray-700">{row.contractedPerWeek}</span>
                              <span className="text-gray-400"> /w</span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`font-bold ${
                                overload ? 'text-orange-600' : underload ? 'text-red-500' : 'text-emerald-600'
                              }`}>{row.periodsPerWeek}</span>
                              {diff !== 0 && (
                                <span className={`ml-1 text-[10px] font-medium ${overload ? 'text-orange-500' : 'text-red-400'}`}>
                                  ({overload ? '+' : ''}{diff})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="font-bold text-blue-700">{row.periodsPerMonth}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {row.subjects.length === 0 ? (
                                  <span className="text-gray-300">{t('timetable.noEntries')}</span>
                                ) : row.subjects.map(s => (
                                  <span key={s.name} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-white text-[10px] font-medium"
                                    style={{ backgroundColor: s.color ?? '#6366f1' }}>
                                    {s.name} ×{s.count}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div className="h-2 rounded-full transition-all" style={{
                                  width: `${barPct}%`,
                                  backgroundColor: overload ? '#f97316' : underload ? '#ef4444' : '#10b981'
                                }} />
                              </div>
                              <div className="text-[9px] text-gray-400 mt-0.5 text-right">{barPct}%</div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer legend */}
              <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-emerald-500 inline-block" /> {t('timetable.matchedContracted')}</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-orange-500 inline-block" /> {t('timetable.overContracted')}</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-500 inline-block" /> {t('timetable.underScheduled')}</span>
                </div>
                <button onClick={() => setShowWorkloadModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">{t('common.close')}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Print Modal ── */}
      {showPrintModal && current && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="font-bold text-gray-800">{t('timetable.printTitle')}</h2>
              <button onClick={() => setShowPrintModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-5 space-y-5 overflow-y-auto">
              {/* What to print */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">{t('timetable.whatToPrint')}</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors"
                    style={{ borderColor: printMode === 'all' ? '#6366f1' : '#e5e7eb', backgroundColor: printMode === 'all' ? '#eef2ff' : '' }}>
                    <input type="radio" name="printMode" value="all" checked={printMode === 'all'}
                      onChange={() => setPrintMode('all')} className="accent-indigo-600" />
                    <div>
                      <div className="font-medium text-sm text-gray-800">{t('timetable.wholeTimetable')}</div>
                      <div className="text-xs text-gray-500">{t('timetable.onePagePerClass')} — all {current.classes.length} classes</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors"
                    style={{ borderColor: printMode === 'class' ? '#6366f1' : '#e5e7eb', backgroundColor: printMode === 'class' ? '#eef2ff' : '' }}>
                    <input type="radio" name="printMode" value="class" checked={printMode === 'class'}
                      onChange={() => { setPrintMode('class'); if (!printClassId && current.classes.length > 0) setPrintClassId(current.classes[0].id) }}
                      className="accent-indigo-600" />
                    <div className="flex-1">
                      <div className="font-medium text-sm text-gray-800">{t('timetable.singleClass')}</div>
                      <div className="text-xs text-gray-500">{t('timetable.oneClassOnly')}</div>
                    </div>
                  </label>
                </div>
              </div>
              {printMode === 'class' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t('timetable.selectClassLabel')}</label>
                  <select className="input-field" value={printClassId}
                    onChange={e => setPrintClassId(e.target.value)}>
                    {[...current.classes].sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Org Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Organization Name</label>
                <input
                  className="input-field"
                  value={printOrgName}
                  onChange={e => setPrintOrgName(e.target.value)}
                  placeholder="e.g. Wattaman School"
                />
              </div>

              {/* Header Lines */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Header Lines <span className="text-gray-400 font-normal">(appear above org name)</span></label>
                <div className="space-y-1 mb-2">
                  {printHeaderLines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        className="input-field flex-1"
                        value={line}
                        onChange={e => setPrintHeaderLines(prev => prev.map((l, i) => i === idx ? e.target.value : l))}
                      />
                      <button
                        onClick={() => setPrintHeaderLines(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-600 px-2 text-lg font-bold flex-shrink-0"
                      >×</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    value={printNewHeaderLine}
                    onChange={e => setPrintNewHeaderLine(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && printNewHeaderLine.trim()) { setPrintHeaderLines(prev => [...prev, printNewHeaderLine.trim()]); setPrintNewHeaderLine('') } }}
                    placeholder="Add header line..."
                  />
                  <button
                    onClick={() => { if (printNewHeaderLine.trim()) { setPrintHeaderLines(prev => [...prev, printNewHeaderLine.trim()]); setPrintNewHeaderLine('') } }}
                    className="tt-btn bg-indigo-600 text-white text-xs flex-shrink-0"
                  >+ Add</button>
                </div>
              </div>

              {/* Signers */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Signers <span className="text-gray-400 font-normal">(signature blocks at bottom)</span></label>
                <div className="space-y-1 mb-2">
                  {printSigners.map((signer, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        className="input-field flex-1"
                        value={signer}
                        onChange={e => setPrintSigners(prev => prev.map((s, i) => i === idx ? e.target.value : s))}
                      />
                      <button
                        onClick={() => setPrintSigners(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-600 px-2 text-lg font-bold flex-shrink-0"
                      >×</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    value={printNewSigner}
                    onChange={e => setPrintNewSigner(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && printNewSigner.trim()) { setPrintSigners(prev => [...prev, printNewSigner.trim()]); setPrintNewSigner('') } }}
                    placeholder="Add signer name..."
                  />
                  <button
                    onClick={() => { if (printNewSigner.trim()) { setPrintSigners(prev => [...prev, printNewSigner.trim()]); setPrintNewSigner('') } }}
                    className="tt-btn bg-indigo-600 text-white text-xs flex-shrink-0"
                  >+ Add</button>
                </div>
              </div>

              {/* Footer Texts */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Footer <span className="text-gray-400 font-normal">(left and right info above signature lines)</span></label>
                <div className="flex gap-2">
                  <input
                    className="input-field flex-1"
                    value={printLeftFooter}
                    onChange={e => setPrintLeftFooter(e.target.value)}
                    placeholder={`Printed: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
                  />
                  <input
                    className="input-field flex-1"
                    value={printRightFooter}
                    onChange={e => setPrintRightFooter(e.target.value)}
                    placeholder="School — Class (auto)"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">{t('common.cancel')}</button>
              <button
                onClick={() => {
                  setShowPrintModal(false)
                  setTimeout(() => window.print(), 150)
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75H5.25a2.25 2.25 0 01-2.25-2.25v-4.5A2.25 2.25 0 015.25 6.75h13.5A2.25 2.25 0 0121 9v4.5a2.25 2.25 0 01-2.25 2.25h-1.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75V3.75h10.5v3M6.75 15.75v4.5h10.5v-4.5" />
                </svg>
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Print Layout (hidden on screen, visible on print) ── */}
      {current && (
        <div className="hidden print:block">
          <PrintLayout
            timetable={current}
            mode={printMode}
            classId={printClassId}
            orgName={printOrgName}
            headerLines={printHeaderLines}
            signers={printSigners}
            leftFooter={printLeftFooter}
            rightFooter={printRightFooter}
          />
        </div>
      )}

      {/* Color Picker */}
      {showColorPicker && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-72 p-5">
            <h3 className="font-bold text-gray-800 mb-3">Choose Color</h3>
            <div className="grid grid-cols-5 gap-2 mb-4">
              {COLOR_PALETTE.map(c => (
                <button key={c} type="button" onClick={() => resolveColorPicker(c)}
                  className="w-10 h-10 rounded-lg border-2 transition-transform hover:scale-110 border-transparent hover:border-gray-400"
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex items-center gap-2 mb-4">
              <label className="text-sm text-gray-600">Custom:</label>
              <input type="color" value={colorPickerValue} onChange={e => setColorPickerValue(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-gray-300" />
              <span className="text-sm text-gray-500">{colorPickerValue}</span>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowColorPicker(false)} className="tt-btn bg-gray-100 text-gray-700">Cancel</button>
              <button onClick={() => resolveColorPicker(colorPickerValue)} className="tt-btn bg-indigo-600 text-white">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium
              animate-[slideUp_.25s_ease-out]
              ${t.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
            <span>{t.ok ? '✓' : '✗'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Battambang:wght@400;700&display=swap');
        .tt-btn { padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: opacity .15s; }
        .tt-btn:hover { opacity: .85; }
        .label-sm { display: block; font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 3px; }
        .input-field { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 6px 10px; font-size: 13px; outline: none; background: #fff; }
        .input-field:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @page { size: A4 portrait; margin: 15mm; }
        @media print {
          body {
            margin: 0;
            font-family: 'Battambang', sans-serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background: white !important; }
          .print-page { page-break-after: always; }
          .print-page:last-child { page-break-after: avoid; }
          .print-page, .print-page * { font-family: 'Battambang', sans-serif !important; }
        }
      `}</style>
    </AuthGuard>
  )
}

// ═══ Print Layout ═══════════════════════════════════════════════════════════

function PrintLayout({ timetable, mode, classId, orgName, headerLines, signers, leftFooter, rightFooter }: {
  timetable: Timetable
  mode: 'all' | 'class'
  classId: string
  orgName: string
  headerLines: string[]
  signers: string[]
  leftFooter?: string
  rightFooter?: string
}) {
  const { t } = useLanguage()
  const DAY_LABELS = [t('timetable.mon'), t('timetable.tue'), t('timetable.wed'), t('timetable.thu'), t('timetable.fri'), t('timetable.sat'), t('timetable.sun')]
  const times = getPeriodTimes(timetable)
  const days = Array.from({ length: timetable.numberOfDays }, (_, i) => i + 1)

  const khmerToArabic = (s: string) => s.replace(/[០-៩]/g, d => String(d.charCodeAt(0) - 0x17E0))
  const gradeNum = (s: string) => { const d = khmerToArabic(s).match(/\d+/); return d ? parseInt(d[0], 10) : 9999 }
  const allClasses = [...timetable.classes].sort((a, b) => {
    const gA = gradeNum(a.short), gB = gradeNum(b.short)
    if (gA !== gB) return gA - gB
    return khmerToArabic(a.name).localeCompare(khmerToArabic(b.name), undefined, { numeric: true, sensitivity: 'base' })
  })

  const classesToPrint = mode === 'class'
    ? allClasses.filter(c => c.id === classId)
    : allClasses

  const morningPeriods = times.map((t, i) => ({ time: t, period: i + 1 })).filter(p => p.time < '12:00')
  const afternoonPeriods = times.map((t, i) => ({ time: t, period: i + 1 })).filter(p => p.time >= '12:00')

  function getEntry(classId: string, day: number, period: number) {
    return timetable.entries.find(e => e.classId === classId && e.day === day && e.period === period) ?? null
  }

  function nextTime(periodIdx: number): string {
    const next = times[periodIdx + 1]
    if (next) return next
    // estimate +1h
    const [h, m] = times[periodIdx].split(':').map(Number)
    return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const cellStyle: React.CSSProperties = {
    border: '1px solid #d1d5db',
    padding: '4px 6px',
    fontSize: 11,
    verticalAlign: 'top',
    minWidth: 90,
  }
  const headerStyle: React.CSSProperties = {
    border: '1px solid #6366f1',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 700,
    backgroundColor: '#4f46e5',
    color: '#fff',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  }
  const sectionRowStyle: React.CSSProperties = {
    backgroundColor: '#e0e7ff',
    fontWeight: 700,
    fontSize: 11,
    color: '#3730a3',
    border: '1px solid #c7d2fe',
  }

  return (
    <>
      {classesToPrint.map((cls, clsIdx) => (
        <div key={cls.id} className="print-page" style={{ padding: '20px 24px', fontFamily: "'Battambang', sans-serif" }}>
          {/* Header — letter-head style matching print report */}
          <div style={{ marginBottom: 24, borderBottom: '2px solid #1e293b', paddingBottom: 16 }}>
            <div style={{ textAlign: 'center' }}>
              {headerLines.map((line, idx) => (
                <div key={idx} style={{ fontSize: idx === 0 ? 14 : 13, fontWeight: idx === 0 ? 700 : 600, color: idx === 0 ? '#0f172a' : '#374151' }}>{line}</div>
              ))}
              {orgName && (
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1e1b4b', textTransform: 'uppercase' as const, letterSpacing: 1, marginTop: headerLines.length > 0 ? 4 : 0 }}>{orgName}</div>
              )}
            </div>
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{t('timetable.printTitle') || 'Class Timetable'}</div>
              <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' as const, fontSize: 13, color: '#4b5563' }}>
                <span><strong>{t('timetable.academicYearLabel')}:</strong> {timetable.academicYear}</span>
                <span><strong>{t('timetable.classLabel')}:</strong> {cls.name}</span>
              </div>
            </div>
          </div>

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...headerStyle, minWidth: 110, textAlign: 'left' }}>Time</th>
                {days.map(d => (
                  <th key={d} style={headerStyle}>{DAY_LABELS[d - 1] ?? `Day ${d}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Morning */}
              {morningPeriods.length > 0 && (
                <>
                  <tr>
                    <td colSpan={days.length + 1} style={sectionRowStyle}>
                      <div style={{ padding: '3px 8px' }}>☀ {t('timetable.morning')}</div>
                    </td>
                  </tr>
                  {morningPeriods.map(({ time, period }, idx) => {
                    const endTime = nextTime(period - 1)
                    return (
                      <tr key={period} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ ...cellStyle, fontWeight: 600, whiteSpace: 'nowrap', color: '#374151', backgroundColor: '#f3f4f6' }}>
                          {time} – {endTime}
                        </td>
                        {days.map(day => {
                          const entry = getEntry(cls.id, day, period)
                          return (
                            <td key={day} style={cellStyle}>
                              {entry ? (
                                <div>
                                  <div style={{ fontWeight: 700, color: entry.subject.color ?? '#6366f1', fontSize: 11 }}>{entry.subject.name}</div>
                                  <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>{entry.teacher.lastName} {entry.teacher.firstName}</div>
                                </div>
                              ) : (
                                <span style={{ color: '#d1d5db', fontSize: 10 }}>—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </>
              )}

              {/* Afternoon */}
              {afternoonPeriods.length > 0 && (
                <>
                  <tr>
                    <td colSpan={days.length + 1} style={sectionRowStyle}>
                      <div style={{ padding: '3px 8px' }}>🌙 {t('timetable.afternoon')}</div>
                    </td>
                  </tr>
                  {afternoonPeriods.map(({ time, period }, idx) => {
                    const endTime = nextTime(period - 1)
                    return (
                      <tr key={period} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                        <td style={{ ...cellStyle, fontWeight: 600, whiteSpace: 'nowrap', color: '#374151', backgroundColor: '#f3f4f6' }}>
                          {time} – {endTime}
                        </td>
                        {days.map(day => {
                          const entry = getEntry(cls.id, day, period)
                          return (
                            <td key={day} style={cellStyle}>
                              {entry ? (
                                <div>
                                  <div style={{ fontWeight: 700, color: entry.subject.color ?? '#6366f1', fontSize: 11 }}>{entry.subject.name}</div>
                                  <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>{entry.teacher.lastName} {entry.teacher.firstName}</div>
                                </div>
                              ) : (
                                <span style={{ color: '#d1d5db', fontSize: 10 }}>—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </>
              )}
            </tbody>
          </table>

          {/* Footer — matching print report style */}
          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 11, color: '#9ca3af' }}>
            <div>{leftFooter || `Printed: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}</div>
            <div>{rightFooter || `${orgName || timetable.name} — ${cls.name}`}</div>
          </div>

          {/* Signature area */}
          {signers.length > 0 && (
            <div style={{ marginTop: 48, display: 'flex', justifyContent: signers.length <= 3 ? 'space-between' : 'space-around', flexWrap: 'wrap' as const, gap: 32, padding: '0 16px' }}>
              {signers.map((signer, idx) => (
                <div key={idx} style={{ textAlign: 'center' }}>
                  <div style={{ borderBottom: '1px solid #94a3b8', width: 140, marginBottom: 4 }}></div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{signer}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

// ═══ Wizard List Step ════════════════════════════════════════════════════════

function WizardListStep({ title, addLabel, items, onNew, columns, renderRow, onEdit, onRemove, extraAction }: {
  title: string; addLabel: string; items: any[]; onNew: () => void
  columns: string[]; renderRow: (item: any) => any[]
  onEdit: (item: any) => void; onRemove: (item: any) => void
  extraAction?: (item: any) => React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-700">{addLabel} <span className="text-gray-400 font-normal text-xs ml-2">({items.length})</span></h3>
        <button onClick={onNew} className="tt-btn bg-indigo-600 text-white text-xs">+ New</button>
      </div>
      {items.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl py-10 text-center text-gray-400 text-sm">
          No {title.toLowerCase()} added yet.<br/>
          <button onClick={onNew} className="mt-2 text-indigo-600 hover:underline text-sm font-medium">+ Add first</button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {columns.map(c => (
                  <th key={c} className="px-3 py-2 text-left font-semibold text-gray-600">{c}</th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 last:border-0 hover:bg-indigo-50/40">
                  {renderRow(item).map((cell, ci) => (
                    <td key={ci} className="px-3 py-2">{cell}</td>
                  ))}
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {extraAction?.(item)}
                    <button onClick={() => onEdit(item)} className="text-blue-600 hover:underline mr-2">Edit</button>
                    <button onClick={() => onRemove(item)} className="text-red-500 hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══ Item Modal ══════════════════════════════════════════════════════════════

function ItemModal({ title, onOk, onCancel, children, width = 'max-w-md' }: {
  title: string; onOk: () => void; onCancel: () => void
  children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${width} max-h-[85vh] flex flex-col`}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">x</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">{children}</div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50 rounded-b-xl">
          <button onClick={onCancel} className="tt-btn bg-white border border-gray-300 text-gray-700">Cancel</button>
          <button onClick={onOk} className="tt-btn bg-indigo-600 text-white">OK</button>
        </div>
      </div>
    </div>
  )
}

// ═══ Modal Shell ════════════════════════════════════════════════════════════

function ModalShell({ title, onClose, children, width = 'max-w-md' }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${width} max-h-[85vh] flex flex-col`}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">x</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="tt-btn bg-gray-100 text-gray-700">Close</button>
        </div>
      </div>
    </div>
  )
}

// ═══ Field ═══════════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-sm">{label}</label>
      {children}
    </div>
  )
}

export default function TimetablePage() {
  const searchParams = useSearchParams()
  return <TimetableWorkspace pluginMode={searchParams.get('source') === 'plugin'} />
}
