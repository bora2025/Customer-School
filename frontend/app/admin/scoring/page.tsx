'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav, classAdminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreSubject {
  id: string; name: string; maxScore: number; color: string; order: number; timetableSubjectId?: string | null
}
interface ScoreExamTab {
  id: string; label: string; type: string; order: number
}
interface ScoreSheetClass {
  id: string; classId: string
}
interface ScoreSheet {
  id: string; name: string; degree: string | null; logoUrl: string | null; studyYearId: string | null
  classes: ScoreSheetClass[]; subjects: ScoreSubject[]; examTabs: ScoreExamTab[]
}
interface StudentRow {
  id: string; studentNumber: string; name: string; sex: string | null; classId: string | null; className: string | null
}
interface ClassOption {
  id: string; name: string; studyYearId: string | null
}
interface StudyYearOption {
  id: string; year: number; label: string | null; isCurrent: boolean
}
interface TimetableSubject {
  id: string; name: string; short: string; color: string | null
  timetable: { name: string; academicYear: string }
}
interface ScoreEntryData {
  studentId: string; subjectId: string; score: number | null
}

type ScoreMode = 'numeric' | 'citation'

interface FormulaColumn {
  id: string; name: string; formula: string
}

// ─── Grade computation helpers ────────────────────────────────────────────────

type GradeEntry = { min: number; letter: string; point: number }

const GRADE_MAP: GradeEntry[] = [
  { min: 90, letter: 'A', point: 4 },
  { min: 75, letter: 'B', point: 3 },
  { min: 60, letter: 'C', point: 2 },
  { min: 50, letter: 'D', point: 1 },
  { min: 40, letter: 'E', point: 0.5 },
  { min: 0,  letter: 'F', point: 0 },
]

const GRADE_COLORS: Record<string, string> = {
  A: 'text-green-700 bg-green-50',
  B: 'text-blue-700 bg-blue-50',
  C: 'text-yellow-700 bg-yellow-50',
  D: 'text-orange-700 bg-orange-50',
  E: 'text-red-600 bg-red-50',
  F: 'text-red-900 bg-red-100',
}

// Per-subject editable grade thresholds (min ABSOLUTE score for each letter; F is always 0)
type SubjectGradeScale = { A: number; B: number; C: number; D: number; E: number }
function defaultSubjectScale(maxScore: number): SubjectGradeScale {
  return {
    A: Math.round(maxScore * 0.9),
    B: Math.round(maxScore * 0.75),
    C: Math.round(maxScore * 0.6),
    D: Math.round(maxScore * 0.5),
    E: Math.round(maxScore * 0.4),
  }
}
function buildSubjectGradeScale(subjectId: string, scales: Record<string, SubjectGradeScale>, maxScore: number): GradeEntry[] {
  const s = scales[subjectId]
  if (!s) return GRADE_MAP  // no custom scale — use global percentage defaults
  const toP = (v: number) => maxScore > 0 ? (v / maxScore) * 100 : 0
  return [
    { min: toP(s.A), letter: 'A', point: 4 },
    { min: toP(s.B), letter: 'B', point: 3 },
    { min: toP(s.C), letter: 'C', point: 2 },
    { min: toP(s.D), letter: 'D', point: 1 },
    { min: toP(s.E), letter: 'E', point: 0.5 },
    { min: 0,        letter: 'F', point: 0 },
  ]
}

function scoreToGradeEntry(score: number | null, maxScore: number, gradeScale?: GradeEntry[]): GradeEntry {
  const scale = gradeScale ?? GRADE_MAP
  if (score === null || score === undefined || maxScore <= 0) return scale[scale.length - 1]
  const pct = (score / maxScore) * 100
  return scale.find(g => pct >= g.min) ?? scale[scale.length - 1]
}

function gpaToLetter(gpa: number): string {
  if (gpa >= 3.5) return 'A'
  if (gpa >= 2.5) return 'B'
  if (gpa >= 1.5) return 'C'
  if (gpa >= 0.5) return 'D'
  if (gpa > 0)    return 'E'
  return 'F'
}

function evalFormulaExpr(formula: string, ctx: Record<string, number | string>): string {
  try {
    let expr = formula.replace(/^=\s*/, '')

    // Rename spreadsheet functions to $-prefixed JS helpers BEFORE variable substitution
    // This avoids regex[^()]+ failing on nested parens
    expr = expr.replace(/\bIF\s*\(/gi, '$IF(')
    expr = expr.replace(/\bAVERAGE\s*\(/gi, '$AVG(')
    expr = expr.replace(/\bSUM\s*\(/gi, '$SUM(')

    // Substitute context variables (longest keys first to avoid partial matches)
    const keys = Object.keys(ctx).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      const v = ctx[k]
      const rep = typeof v === 'string' ? JSON.stringify(v) : String(v)
      expr = expr.replace(new RegExp(`\\b${k}\\b`, 'g'), rep)
    }

    // Security: remove string literals and $helper names, then check for bare identifiers
    const check = expr
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/\$[A-Za-z_]\w*/g, '0')
    if (/[a-zA-Z_]/.test(check)) return '#ERR'

    // Helpers injected into sandbox
    const $IF = (cond: unknown, then: unknown, els: unknown) => (cond ? then : els)
    const $AVG = (...a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
    const $SUM = (...a: number[]) => a.reduce((s, x) => s + x, 0)

    // eslint-disable-next-line no-new-func
    const fn = new Function('$IF', '$AVG', '$SUM', `"use strict"; return (${expr});`)
    const result = fn($IF, $AVG, $SUM)
    if (typeof result === 'number') return isFinite(result) ? result.toFixed(2) : '#ERR'
    return String(result ?? '')
  } catch { return '#ERR' }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function ToolBtn({ icon, label, onClick, danger, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40
        ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}>
      <span className="text-base leading-none select-none">{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

function Divider() { return <div className="w-px h-8 bg-gray-200 mx-0.5 self-center" /> }

function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`bg-white rounded-xl shadow-2xl w-full flex flex-col max-h-[90vh] ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-6 h-6 flex items-center justify-center">×</button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type WizardStep = 'year' | 'classes' | 'subject' | 'option' | 'month'
const WIZARD_STEPS: WizardStep[] = ['year', 'classes', 'subject', 'option', 'month']

export default function ScoringPage() {
  const { t } = useLanguage()
  const tableRef = useRef<HTMLDivElement>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Sheet state
  const [sheets, setSheets] = useState<ScoreSheet[]>([])
  const [activeSheet, setActiveSheet] = useState<ScoreSheet | null>(null)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [scores, setScores] = useState<Record<string, Record<string, number | null>>>({})
  const [dirtyScores, setDirtyScores] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [autoSaveLabel, setAutoSaveLabel] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [filterClassId, setFilterClassId] = useState<string>('ALL')
  const [zoom, setZoom] = useState(1)

  // ── Reference data
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [studyYears, setStudyYears] = useState<StudyYearOption[]>([])
  const [timetableSubjects, setTimetableSubjects] = useState<TimetableSubject[]>([])
  const [selectedTimetableSubs, setSelectedTimetableSubs] = useState<Set<string>>(new Set())

  // ── Modals
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [showNewWizard, setShowNewWizard] = useState(false)
  const [showSubjectModal, setShowSubjectModal] = useState(false)
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [showClassModal, setShowClassModal] = useState(false)
  const [showDeleteSheetConfirm, setShowDeleteSheetConfirm] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [showCalcModal, setShowCalcModal] = useState(false)
  const [subjectTab, setSubjectTab] = useState<'manual' | 'import'>('manual')

  // ── Score mode & formula columns
  const [scoreMode, setScoreMode] = useState<ScoreMode>('numeric')
  const [formulaColumns, setFormulaColumns] = useState<FormulaColumn[]>([])
  const [subjectGradeScales, setSubjectGradeScales] = useState<Record<string, SubjectGradeScale>>({})
  const [calcColName, setCalcColName] = useState('')
  const [calcColFormula, setCalcColFormula] = useState('=IF(avg>=3.5,"A",IF(avg>=2.5,"B",IF(avg>=1.5,"C","F")))')
  const [editingFormulaCol, setEditingFormulaCol] = useState<FormulaColumn | null>(null)

  // ── Wizard scoring option
  const [wCalcOption, setWCalcOption] = useState<'citation' | 'formula' | ''>('')

  // ── Persist scoreMode + formulaColumns per sheet in localStorage
  // Use a ref for the key so the save effect does NOT include calcStorageKey in its
  // deps — otherwise both effects fire in the same flush when a sheet activates, and
  // the save effect runs with stale-default values, overwriting what was just loaded.
  const calcStorageKeyRef = useRef<string | null>(null)

  // Load when sheet changes (also updates the ref so saves go to the right key)
  useEffect(() => {
    const key = activeSheet ? `scoring_calc_${activeSheet.id}` : null
    calcStorageKeyRef.current = key
    if (!key) { setScoreMode('numeric'); setFormulaColumns([]); return }
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const saved = JSON.parse(raw) as { scoreMode?: ScoreMode; formulaColumns?: FormulaColumn[]; subjectGradeScales?: Record<string, SubjectGradeScale> }
        setScoreMode(saved.scoreMode ?? 'numeric')
        setFormulaColumns(saved.formulaColumns ?? [])
        setSubjectGradeScales(saved.subjectGradeScales ?? {})
      } else {
        setScoreMode('numeric'); setFormulaColumns([]); setSubjectGradeScales({})
      }
    } catch { setScoreMode('numeric'); setFormulaColumns([]); setSubjectGradeScales({}) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet?.id])

  // Save when scoreMode or formulaColumns change — key via ref avoids firing on sheet load
  useEffect(() => {
    const key = calcStorageKeyRef.current
    if (!key) return
    try { localStorage.setItem(key, JSON.stringify({ scoreMode, formulaColumns, subjectGradeScales })) } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreMode, formulaColumns, subjectGradeScales])

  // ── Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>('year')
  const [wStudyYearId, setWStudyYearId] = useState('')
  const [wNewYearLabel, setWNewYearLabel] = useState('')
  const [wShowNewYear, setWShowNewYear] = useState(false)
  const [wClassIds, setWClassIds] = useState<Set<string>>(new Set())
  const [wDegree, setWDegree] = useState('')
  const [wLogoUrl, setWLogoUrl] = useState('')
  const [creatingSheet, setCreatingSheet] = useState<ScoreSheet | null>(null)

  // ── Subject form
  const [editSubject, setEditSubject] = useState<ScoreSubject | null>(null)
  const [subjectName, setSubjectName] = useState('')
  const [subjectMax, setSubjectMax] = useState(100)
  const [subjectColor, setSubjectColor] = useState('#000000')

  // ── Exam tab form
  const [tabLabel, setTabLabel] = useState('')
  const [tabType, setTabType] = useState('MONTHLY')

  // ── Class modal for active sheet
  const [editClassIds, setEditClassIds] = useState<Set<string>>(new Set())

  // ─── Data fetch ───────────────────────────────────────────────────────────

  const fetchSheets = useCallback(async () => {
    const res = await apiFetch('/api/scoring/sheets')
    if (res.ok) setSheets(await res.json())
  }, [])

  const fetchRefs = useCallback(async () => {
    const [r1, r2, r3] = await Promise.all([
      apiFetch('/api/classes'),
      apiFetch('/api/study-years'),
      apiFetch('/api/scoring/timetable-subjects'),
    ])
    if (r1.ok) setClasses(await r1.json())
    if (r2.ok) setStudyYears(await r2.json())
    if (r3.ok) setTimetableSubjects(await r3.json())
  }, [])

  useEffect(() => { fetchSheets(); fetchRefs() }, [fetchSheets, fetchRefs])

  useEffect(() => {
    if (!activeTabId || !activeSheet) { setStudents([]); setScores({}); return }
    const classIds = activeSheet.classes?.map(c => c.classId) ?? []
    const q = classIds.length ? `?classIds=${classIds.join(',')}` : ''
    apiFetch(`/api/scoring/exam-tabs/${activeTabId}/scores${q}`).then(async res => {
      if (!res.ok) return
      const data: {
        entries: ScoreEntryData[]
        students: Array<{ id: string; studentNumber: string; user: { name: string }; sex: string | null; class: { id: string; name: string } | null }>
      } = await res.json()
      setStudents(data.students.map(s => ({
        id: s.id, studentNumber: s.studentNumber || '', name: s.user?.name || '',
        sex: s.sex, classId: s.class?.id ?? null, className: s.class?.name ?? null,
      })))
      const scoreMap: Record<string, Record<string, number | null>> = {}
      for (const e of data.entries) {
        if (!scoreMap[e.studentId]) scoreMap[e.studentId] = {}
        scoreMap[e.studentId][e.subjectId] = e.score
      }
      setScores(scoreMap); setDirtyScores(new Set())
    })
  }, [activeTabId, activeSheet])

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000)
  }

  const refreshSheet = async (id: string): Promise<ScoreSheet | null> => {
    const res = await apiFetch(`/api/scoring/sheets/${id}`)
    if (!res.ok) return null
    const fresh: ScoreSheet = await res.json()
    setSheets(prev => prev.map(s => s.id === id ? fresh : s))
    return fresh
  }

  const openSheet = (sheet: ScoreSheet) => {
    setActiveSheet(sheet); setActiveTabId(sheet.examTabs[0]?.id ?? null)
    setFilterClassId('ALL'); setShowOpenModal(false)
  }

  const currentSheet = showNewWizard ? creatingSheet : activeSheet

  const yearLabel = (sy: StudyYearOption) => sy.label || `${sy.year}-${sy.year + 1}`

  const handlePrint = useCallback(() => {
    setShowPrintMenu(false)
    setShowPrintModal(true)
  }, [])

  // ─── Save / auto-save ─────────────────────────────────────────────────────

  const performSave = useCallback(async (
    tabId: string, dirty: Set<string>,
    sc: Record<string, Record<string, number | null>>,
  ) => {
    if (!dirty.size) return
    const entries = Array.from(dirty).map((key: string) => {
      const [studentId, subjectId] = key.split(':')
      return { examTabId: tabId, subjectId, studentId, score: sc[studentId]?.[subjectId] ?? null }
    })
    const res = await apiFetch('/api/scoring/entries/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    if (res.ok) { setDirtyScores(new Set()); setAutoSaveLabel(t('scoring.autoSaved')); setTimeout(() => setAutoSaveLabel(null), 2500) }
  }, [t])

  const saveScores = async () => {
    if (!activeTabId || dirtyScores.size === 0) return
    setSaving(true)
    try {
      const entries = Array.from(dirtyScores).map((key: string) => {
        const [studentId, subjectId] = key.split(':')
        return { examTabId: activeTabId, subjectId, studentId, score: scores[studentId]?.[subjectId] ?? null }
      })
      const res = await apiFetch('/api/scoring/entries/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      if (res.ok) { setDirtyScores(new Set()); showToast(t('scoring.saved')) }
      else showToast(t('scoring.saveFailed'), false)
    } catch { showToast(t('scoring.saveFailed'), false) }
    finally { setSaving(false) }
  }

  // ─── Wizard ───────────────────────────────────────────────────────────────

  const startWizard = () => {
    setWizardStep('year'); setWStudyYearId(''); setWNewYearLabel(''); setWShowNewYear(false)
    setWClassIds(new Set()); setWDegree(''); setWLogoUrl(''); setCreatingSheet(null); setShowNewWizard(true)
    setWCalcOption(''); setScoreMode('numeric'); setFormulaColumns([]); setSubjectGradeScales({})
  }

  const wizardIndex = WIZARD_STEPS.indexOf(wizardStep)

  const handleWizardNext = async () => {
    if (wizardStep === 'year') {
      let syId = wStudyYearId
      if (wShowNewYear && wNewYearLabel.trim()) {
        // Create new study year
        const parts = wNewYearLabel.match(/(\d{4})/)
        const year = parts ? parseInt(parts[1]) : new Date().getFullYear()
        const res = await apiFetch('/api/study-years', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, label: wNewYearLabel.trim() }),
        })
        if (res.ok) { const sy: StudyYearOption = await res.json(); syId = sy.id; setStudyYears(prev => [sy, ...prev]); setWStudyYearId(sy.id) }
        else { showToast('Failed to create academic year', false); return }
      }
      if (!syId) return
      const label = studyYears.find(y => y.id === syId) ? yearLabel(studyYears.find(y => y.id === syId)!) : wNewYearLabel
      // Create sheet
      const res = await apiFetch('/api/scoring/sheets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: label, degree: wDegree.trim() || undefined, logoUrl: wLogoUrl || undefined, studyYearId: syId }),
      })
      if (res.ok) {
        const sheet: ScoreSheet = await res.json()
        setCreatingSheet(sheet); setSheets(prev => [sheet, ...prev]); setWizardStep('classes')
      }
    } else if (wizardStep === 'classes') {
      if (creatingSheet && wClassIds.size > 0) {
        const res = await apiFetch(`/api/scoring/sheets/${creatingSheet.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classIds: Array.from(wClassIds) }),
        })
        if (res.ok) { const fresh: ScoreSheet = await res.json(); setCreatingSheet(fresh); setSheets(prev => prev.map(s => s.id === fresh.id ? fresh : s)) }
      }
      setWizardStep('subject')
    } else if (wizardStep === 'subject') {
      setWizardStep('option')
    } else if (wizardStep === 'option') {
      if (wCalcOption === 'citation') {
        setScoreMode('citation')
      } else if (wCalcOption === 'formula') {
        setScoreMode('numeric')
        if (formulaColumns.length === 0) {
          setFormulaColumns([{ id: `fc-${Date.now()}`, name: t('scoring.grade'), formula: '=IF(avg>=3.5,"A",IF(avg>=2.5,"B",IF(avg>=1.5,"C","F")))' }])
        }
      }
      setWizardStep('month')
    } else {
      if (creatingSheet) { const fresh = await refreshSheet(creatingSheet.id); if (fresh) openSheet(fresh) }
      setShowNewWizard(false); setCreatingSheet(null)
    }
  }

  const handleWizardBack = () => {
    if (wizardIndex === 0) { setShowNewWizard(false); return }
    setWizardStep(WIZARD_STEPS[wizardIndex - 1])
  }

  // ─── Subjects ─────────────────────────────────────────────────────────────

  const resetSubjectForm = () => { setEditSubject(null); setSubjectName(''); setSubjectMax(100); setSubjectColor('#000000') }
  const openEditSubject = (s: ScoreSubject) => { setEditSubject(s); setSubjectName(s.name); setSubjectMax(s.maxScore); setSubjectColor(s.color) }

  const saveSubject = async () => {
    const sheetId = currentSheet?.id
    if (!sheetId || !subjectName.trim()) return
    let res: Response
    if (editSubject) {
      res = await apiFetch(`/api/scoring/subjects/${editSubject.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: subjectName, maxScore: subjectMax, color: subjectColor }),
      })
    } else {
      res = await apiFetch(`/api/scoring/sheets/${sheetId}/subjects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: subjectName, maxScore: subjectMax, color: subjectColor }),
      })
    }
    if (res.ok) {
      const fresh = await refreshSheet(sheetId)
      if (fresh) { if (activeSheet?.id === sheetId) setActiveSheet(fresh); if (creatingSheet?.id === sheetId) setCreatingSheet(fresh) }
      resetSubjectForm()
    }
  }

  const importTimetableSubjects = async () => {
    const sheetId = currentSheet?.id
    if (!sheetId || !selectedTimetableSubs.size) return
    const toAdd = timetableSubjects.filter(s => selectedTimetableSubs.has(s.id))
    for (const s of toAdd) {
      await apiFetch(`/api/scoring/sheets/${sheetId}/subjects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: s.name, color: s.color ?? '#000000', timetableSubjectId: s.id }),
      })
    }
    const fresh = await refreshSheet(sheetId)
    if (fresh) { if (activeSheet?.id === sheetId) setActiveSheet(fresh); if (creatingSheet?.id === sheetId) setCreatingSheet(fresh) }
    setSelectedTimetableSubs(new Set())
  }

  const deleteSubject = async (s: ScoreSubject) => {
    if (!confirm(t('scoring.deleteSubjectConfirm'))) return
    const sheetId = currentSheet?.id
    if (!sheetId) return
    const res = await apiFetch(`/api/scoring/subjects/${s.id}`, { method: 'DELETE' })
    if (res.ok) {
      const fresh = await refreshSheet(sheetId)
      if (fresh) { if (activeSheet?.id === sheetId) setActiveSheet(fresh); if (creatingSheet?.id === sheetId) setCreatingSheet(fresh) }
    }
  }

  // ─── Exam Tabs ────────────────────────────────────────────────────────────

  const saveTab = async () => {
    const sheetId = currentSheet?.id
    if (!sheetId || !tabLabel.trim()) return
    const res = await apiFetch(`/api/scoring/sheets/${sheetId}/exam-tabs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: tabLabel, type: tabType }),
    })
    if (res.ok) {
      const fresh = await refreshSheet(sheetId)
      if (fresh) {
        if (activeSheet?.id === sheetId) { setActiveSheet(fresh); if (!activeTabId) setActiveTabId(fresh.examTabs[0]?.id ?? null) }
        if (creatingSheet?.id === sheetId) setCreatingSheet(fresh)
      }
      setTabLabel('')
    }
  }

  const deleteTab = async (tabId: string) => {
    if (!confirm(t('scoring.deleteTabConfirm'))) return
    const sheetId = currentSheet?.id
    if (!sheetId) return
    const res = await apiFetch(`/api/scoring/exam-tabs/${tabId}`, { method: 'DELETE' })
    if (res.ok) {
      const fresh = await refreshSheet(sheetId)
      if (fresh) {
        if (activeSheet?.id === sheetId) { setActiveSheet(fresh); if (activeTabId === tabId) setActiveTabId(fresh.examTabs[0]?.id ?? null) }
        if (creatingSheet?.id === sheetId) setCreatingSheet(fresh)
      }
    }
  }

  // ─── Score entry ──────────────────────────────────────────────────────────

  const handleScoreChange = (sId: string, subId: string, val: string) => {
    const num = val === '' ? null : parseFloat(val)
    setScores(prev => ({ ...prev, [sId]: { ...(prev[sId] ?? {}), [subId]: isNaN(num as number) ? null : num } }))
    setDirtyScores(prev => { const s = new Set(prev); s.add(`${sId}:${subId}`); return s })
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      setDirtyScores(d => { setScores(sc => { if (activeTabId && d.size > 0) performSave(activeTabId, d, sc); return sc }); return d })
    }, 2500)
  }

  // ─── Classes modal for active sheet ──────────────────────────────────────

  const openClassModal = () => {
    if (!activeSheet) return
    setEditClassIds(new Set(activeSheet.classes?.map(c => c.classId) ?? []))
    setShowClassModal(true)
  }

  const saveClasses = async () => {
    if (!activeSheet) return
    const res = await apiFetch(`/api/scoring/sheets/${activeSheet.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classIds: Array.from(editClassIds) }),
    })
    if (res.ok) { const fresh: ScoreSheet = await res.json(); setActiveSheet(fresh); setSheets(prev => prev.map(s => s.id === fresh.id ? fresh : s)) }
    setShowClassModal(false)
    // Reload scores for new class selection
    setActiveTabId(id => id)
  }

  // ─── Delete sheet ─────────────────────────────────────────────────────────

  const deleteSheet = async () => {
    if (!activeSheet) return
    const res = await apiFetch(`/api/scoring/sheets/${activeSheet.id}`, { method: 'DELETE' })
    if (res.ok) { setActiveSheet(null); setActiveTabId(null); setStudents([]); setScores({}); await fetchSheets(); setShowDeleteSheetConfirm(false) }
  }

  // ─── Computed ─────────────────────────────────────────────────────────────

  const visibleStudents = filterClassId === 'ALL' ? students : students.filter(s => s.classId === filterClassId)

  const getTotal = (sId: string) => {
    const subjects = activeSheet?.subjects ?? []
    if (scoreMode === 'citation') {
      return subjects.reduce((sum, sub) => sum + scoreToGradeEntry(scores[sId]?.[sub.id] ?? null, sub.maxScore, buildSubjectGradeScale(sub.id, subjectGradeScales, sub.maxScore)).point, 0)
    }
    return subjects.reduce((sum, sub) => sum + (scores[sId]?.[sub.id] ?? 0), 0)
  }
  const getAverage = (sId: string) => { const n = activeSheet?.subjects.length ?? 0; return n ? getTotal(sId) / n : 0 }

  const rankings = (() => {
    // Group students by classId (null counts as its own group)
    const groups: Record<string, StudentRow[]> = {}
    visibleStudents.forEach(s => {
      const key = s.classId ?? '__none__'
      if (!groups[key]) groups[key] = []
      groups[key].push(s)
    })
    const map: Record<string, number> = {}
    Object.values(groups).forEach(group => {
      const sorted = [...group].sort((a, b) => getTotal(b.id) - getTotal(a.id))
      sorted.forEach((s, i) => { map[s.id] = i + 1 })
    })
    return map
  })()

  const getFormulaContext = (sId: string): Record<string, number | string> => {
    const subjects = activeSheet?.subjects ?? []
    const total = getTotal(sId)
    const avg = getAverage(sId)
    // numavg = raw numeric average (unaffected by citation mode)
    const numTotal = subjects.reduce((sum, sub) => sum + (scores[sId]?.[sub.id] ?? 0), 0)
    const numavg = subjects.length ? numTotal / subjects.length : 0
    const ctx: Record<string, number | string> = {
      total, avg, average: avg, gpa: avg,
      numavg, numtotal: numTotal,
      rank: rankings[sId] ?? 0,
    }
    subjects.forEach((sub, i) => {
      const score = scores[sId]?.[sub.id] ?? null
      const grade = scoreToGradeEntry(score, sub.maxScore, buildSubjectGradeScale(sub.id, subjectGradeScales, sub.maxScore))
      ctx[`s${i + 1}`] = score ?? 0; ctx[`g${i + 1}`] = grade.letter; ctx[`gp${i + 1}`] = grade.point
    })
    return ctx
  }

  const addFormulaColumn = () => {
    if (!calcColName.trim()) return
    if (editingFormulaCol) {
      setFormulaColumns(cols => cols.map(c => c.id === editingFormulaCol.id ? { ...c, name: calcColName, formula: calcColFormula } : c))
      setEditingFormulaCol(null)
    } else {
      setFormulaColumns(cols => [...cols, { id: `fc-${Date.now()}`, name: calcColName, formula: calcColFormula }])
    }
    setCalcColName(''); setCalcColFormula('=IF(avg>=3.5,"A",IF(avg>=2.5,"B",IF(avg>=1.5,"C",IF(avg>=0.5,"D","F"))))')
  }

  // ─── Sub panels ───────────────────────────────────────────────────────────

  function SubjectFormPanel() {
    return (
      <div className="space-y-3">
        {/* Manual add */}
        <div className="flex gap-2">
          <input className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={subjectName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubjectName(e.target.value)}
            placeholder={t('scoring.subjectName')} />
          <input type="number" min={0} className="w-20 border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={subjectMax} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubjectMax(Number(e.target.value))} title={t('scoring.maxScore')} />
          <input type="color" className="w-10 h-[38px] border rounded-lg cursor-pointer"
            value={subjectColor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubjectColor(e.target.value)} />
          <button onClick={saveSubject} disabled={!subjectName.trim()}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50">{editSubject ? '✓' : '+'}</button>
          {editSubject && <button onClick={resetSubjectForm} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">✕</button>}
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {(currentSheet?.subjects ?? []).map(s => (
            <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-sm">{s.name}</span>
                <span className="text-xs text-gray-400">/{s.maxScore}</span>
                {s.timetableSubjectId && <span className="text-[10px] bg-blue-100 text-blue-600 px-1 rounded">TT</span>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEditSubject(s)} className="text-indigo-600 text-xs px-1.5 py-0.5 rounded hover:bg-indigo-50">Edit</button>
                <button onClick={() => deleteSubject(s)} className="text-red-500 text-xs px-1.5 py-0.5 rounded hover:bg-red-50">Del</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function TimetableImportPanel() {
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-500">{t('scoring.importSubjectHint')}</p>
        <div className="max-h-56 overflow-y-auto space-y-1 border rounded-lg p-2">
          {timetableSubjects.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No timetable subjects found.</p>}
          {timetableSubjects.map(s => {
            const checked = selectedTimetableSubs.has(s.id)
            const alreadyAdded = (currentSheet?.subjects ?? []).some(sub => sub.timetableSubjectId === s.id)
            return (
              <label key={s.id} className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer ${alreadyAdded ? 'opacity-40' : 'hover:bg-indigo-50'}`}>
                <input type="checkbox" checked={checked} disabled={alreadyAdded}
                  onChange={e => setSelectedTimetableSubs(prev => { const n = new Set(prev); e.target.checked ? n.add(s.id) : n.delete(s.id); return n })} />
                {s.color && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />}
                <span className="text-sm flex-1">{s.name}</span>
                <span className="text-xs text-gray-400">{s.timetable.academicYear}</span>
                {alreadyAdded && <span className="text-[10px] text-green-600">Added</span>}
              </label>
            )
          })}
        </div>
        <button onClick={importTimetableSubjects} disabled={!selectedTimetableSubs.size}
          className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50">
          {t('scoring.importSelected')} ({selectedTimetableSubs.size})
        </button>
      </div>
    )
  }

  function MonthFormPanel() {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={tabLabel} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTabLabel(e.target.value)}
            placeholder="January / Q1 / Semester 1" />
          <select className="border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={tabType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTabType(e.target.value)}>
            <option value="MONTHLY">{t('scoring.monthly')}</option>
            <option value="QUARTERLY">{t('scoring.quarterly')}</option>
            <option value="SEMESTER">{t('scoring.semester')}</option>
          </select>
          <button onClick={saveTab} disabled={!tabLabel.trim()}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50">+</button>
        </div>
        <div className="space-y-1 max-h-44 overflow-y-auto">
          {(currentSheet?.examTabs ?? []).map(tab => (
            <div key={tab.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5">
              <span className="text-sm">{tab.label} <span className="text-xs text-gray-400">({tab.type})</span></span>
              <button onClick={() => deleteTab(tab.id)} className="text-red-500 text-xs px-1.5 py-0.5 rounded hover:bg-red-50">Del</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const sheetClassIds = activeSheet?.classes?.map(c => c.classId) ?? []
  const sheetClasses = classes.filter(c => sheetClassIds.includes(c.id))
  const yearClasses = classes.filter(c => !wStudyYearId || c.studyYearId === wStudyYearId)

  return (
    <AuthGuard allowedRoles={['ADMIN', 'TEACHER', 'CLASS_ADMIN']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-50 lg:overflow-hidden pt-14 lg:pt-0 pb-[72px] lg:pb-0" onClick={() => { setShowAddMenu(false); setShowPrintMenu(false) }}>
        <Sidebar title="Wattaman" subtitle="Admin" navItems={typeof window !== 'undefined' && localStorage.getItem('role') === 'CLASS_ADMIN' ? classAdminNav : adminNav} accentColor="indigo" />

        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-white text-sm shadow-lg ${toast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
            {toast.msg}
          </div>
        )}

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ── Toolbar */}
          <div className="bg-white border-b shadow-sm print:hidden flex-shrink-0">
            <div className="px-4 pt-2.5 pb-1.5 border-b flex items-center gap-3">
              <div>
                <h1 className="text-sm font-semibold text-gray-800">{t('scoring.title')}</h1>
                {activeSheet && (
                  <p className="text-xs text-gray-400">
                    {activeSheet.name}
                    {sheetClasses.length > 0 && ` · ${sheetClasses.map(c => c.name).join(', ')}`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
              <ToolBtn icon="📄" label={t('scoring.new')} onClick={startWizard} />
              <ToolBtn icon="📂" label={t('scoring.open')} onClick={() => setShowOpenModal(true)} />
              <ToolBtn icon={saving ? '⏳' : '💾'} label={saving ? t('scoring.saving') : t('scoring.save')} onClick={saveScores} disabled={dirtyScores.size === 0 || !activeTabId} />
              <Divider />
              <ToolBtn icon="🖨️" label={t('scoring.print')} onClick={handlePrint} disabled={!activeSheet} />
              <Divider />
              <ToolBtn icon="📚" label={t('scoring.subject')} onClick={() => { resetSubjectForm(); setSubjectTab('manual'); setShowSubjectModal(true) }} disabled={!activeSheet} />
              <ToolBtn icon="🏫" label={t('scoring.class')} onClick={openClassModal} disabled={!activeSheet} />
              <ToolBtn icon="📅" label={t('scoring.month')} onClick={() => setShowMonthModal(true)} disabled={!activeSheet} />
              <Divider />
              <ToolBtn icon="📊" label={t('scoring.scoring')} onClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth' })} disabled={!activeSheet} />
              <ToolBtn icon="🧮" label="Calc Column" onClick={() => { setEditingFormulaCol(null); setCalcColName(''); setCalcColFormula('=IF(avg>=3.5,"A",IF(avg>=2.5,"B",IF(avg>=1.5,"C",IF(avg>=0.5,"D","F"))))'); setShowCalcModal(true) }} disabled={!activeSheet} />
              <Divider />
              <ToolBtn icon="🗑️" label={t('scoring.delete')} onClick={() => activeSheet && setShowDeleteSheetConfirm(true)} disabled={!activeSheet} danger />
            </div>
          </div>

          {/* ── Body */}
          <div className="flex-1 overflow-auto">
            {!activeSheet ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="text-6xl mb-4">📊</div>
                <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('scoring.noSheet')}</h2>
                <p className="text-gray-500 text-sm mb-6">{t('scoring.noSheetHint')}</p>
                <div className="flex gap-3">
                  <button onClick={startWizard} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">{t('scoring.new')}</button>
                  <button onClick={() => setShowOpenModal(true)} className="px-5 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50">{t('scoring.open')}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                {/* Tabs bar */}
                <div className="flex items-center gap-0.5 px-4 pt-2 pb-0 bg-white border-b overflow-x-auto print:hidden flex-shrink-0">
                  {activeSheet.examTabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTabId(tab.id)} title={tab.type}
                      className={`px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors
                        ${activeTabId === tab.id ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}>
                      {tab.label}
                      <span className="ml-1 text-[10px] opacity-50">{tab.type[0]}</span>
                    </button>
                  ))}
                  <button onClick={() => setShowMonthModal(true)} className="px-3 py-2 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-t ml-1">
                    + {t('scoring.month')}
                  </button>
                  {/* Class filter */}
                  {sheetClasses.length > 1 && (
                    <div className="ml-auto flex items-center gap-1 pr-1">
                      <select className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                        value={filterClassId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterClassId(e.target.value)}>
                        <option value="ALL">{t('scoring.allClasses')}</option>
                        {sheetClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* Score table */}
                <div className="flex-1 overflow-auto p-4" ref={tableRef}>
                  {!activeTabId ? (
                    <div className="text-center py-16 text-gray-400 text-sm">{t('scoring.noTabs')}</div>
                  ) : activeSheet.subjects.length === 0 ? (
                    <div className="text-center py-16 text-gray-400 text-sm">
                      <p>{t('scoring.noSubjects')}</p>
                      <button onClick={() => { resetSubjectForm(); setSubjectTab('import'); setShowSubjectModal(true) }}
                        className="mt-3 text-sm text-indigo-600 underline">{t('scoring.importSubject')}</button>
                    </div>
                  ) : (
                    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                      {/* Print header */}
                      <div className="hidden print:flex items-center gap-4 mb-6">
                        {activeSheet.logoUrl && <img src={activeSheet.logoUrl} alt="logo" className="h-14 object-contain" />}
                        <div>
                          <h1 className="text-xl font-bold">{activeSheet.name}</h1>
                          {activeSheet.degree && <p className="text-sm text-violet-700 font-medium">{activeSheet.degree}</p>}
                          <p className="text-sm text-gray-600">{activeSheet.examTabs.find(tab => tab.id === activeTabId)?.label}</p>
                        </div>
                      </div>

                      <table className="border-collapse bg-white shadow-sm text-xs min-w-max print:shadow-none">
                        <thead>
                          <tr className="bg-indigo-700 text-white">
                            <th className="border border-indigo-600 px-3 py-2 text-left font-semibold w-10 sticky left-0 bg-indigo-700">{t('scoring.no')}</th>
                            <th className="border border-indigo-600 px-3 py-2 text-left font-semibold min-w-[160px] sticky left-10 bg-indigo-700">{t('scoring.studentName')}</th>
                            <th className="border border-indigo-600 px-2 py-2 text-center font-semibold w-10">{t('scoring.gender')}</th>
                            {sheetClasses.length > 1 && filterClassId === 'ALL' && (
                              <th className="border border-indigo-600 px-2 py-2 text-center font-semibold">{t('scoring.classGroup')}</th>
                            )}
                            {activeSheet.subjects.map((sub, subIdx) => (
                              <React.Fragment key={sub.id}>
                                <th className="border border-indigo-600 px-2 py-1 text-center font-semibold min-w-[64px]">
                                  <div className="flex flex-col items-center leading-tight">
                                    <span className="text-[10px] text-indigo-300 font-normal">{String.fromCharCode(65 + subIdx)}</span>
                                    <span style={{ color: sub.color === '#000000' ? 'white' : sub.color }}>{sub.name}</span>
                                    <span className="text-indigo-300 font-normal text-[10px]">/{sub.maxScore}</span>
                                  </div>
                                </th>
                                {scoreMode === 'citation' && (
                                  <th className="border border-indigo-600 px-2 py-1 text-center font-semibold w-12 bg-indigo-600">
                                    <div className="flex flex-col items-center leading-tight">
                                      <span className="text-[10px] text-indigo-200 font-normal">Grade</span>
                                      <span className="text-indigo-100 text-[10px]">{sub.name}</span>
                                    </div>
                                  </th>
                                )}
                              </React.Fragment>
                            ))}
                            {scoreMode === 'citation' ? (
                              <th className="border border-indigo-600 px-2 py-1 text-center font-semibold w-20 bg-indigo-800">
                                <div className="flex flex-col items-center leading-tight">
                                  <span className="text-indigo-100 text-[10px] font-semibold">Total</span>
                                  <span className="text-indigo-300 text-[9px] font-normal">Citation Score</span>
                                </div>
                              </th>
                            ) : (
                              <th className="border border-indigo-600 px-2 py-2 text-center font-semibold w-16 bg-indigo-800">{t('scoring.total')}</th>
                            )}
                            {scoreMode === 'citation' ? (
                              <th className="border border-indigo-600 px-2 py-1 text-center font-semibold w-24 bg-indigo-800">
                                <div className="flex flex-col items-center leading-tight">
                                  <span className="text-indigo-100 text-[10px] font-semibold">Avg Citation</span>
                                  <span className="text-indigo-300 text-[9px] font-normal">(≈ Grade)</span>
                                </div>
                              </th>
                            ) : (
                              <th className="border border-indigo-600 px-2 py-2 text-center font-semibold w-16 bg-indigo-800">{t('scoring.average')}</th>
                            )}
                            <th className="border border-indigo-600 px-2 py-2 text-center font-semibold w-12 bg-indigo-800">{t('scoring.ranking')}</th>
                            {formulaColumns.map(col => (
                              <th key={col.id} title={col.formula}
                                className="border border-indigo-600 px-2 py-1 text-center font-semibold w-20 bg-purple-800 cursor-pointer hover:bg-purple-700 transition-colors"
                                onClick={() => { setEditingFormulaCol(col); setCalcColName(col.name); setCalcColFormula(col.formula); setShowCalcModal(true) }}>
                                <div className="flex flex-col items-center leading-tight">
                                  <span className="text-purple-200 text-xs">{col.name}</span>
                                  <span className="text-purple-400 text-[9px]">fx ✎</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleStudents.length === 0 ? (
                            <tr><td colSpan={3 + (sheetClasses.length > 1 && filterClassId === 'ALL' ? 1 : 0) + activeSheet.subjects.length * (scoreMode === 'citation' ? 2 : 1) + 3 + formulaColumns.length} className="text-center py-10 text-gray-400">{t('scoring.noStudents')}</td></tr>
                          ) : (() => {
                            const rows: React.ReactNode[] = []
                            let lastClassName: string | null = null
                            let classRowIdx = 0
                            visibleStudents.forEach((student, idx) => {
                              const showClassHeader = sheetClasses.length > 1 && filterClassId === 'ALL' && student.className !== lastClassName
                              if (showClassHeader) {
                                lastClassName = student.className
                                classRowIdx = 0
                                rows.push(
                                  <tr key={`cls-${student.classId}`} className="print:break-before-page">
                                    <td colSpan={3 + 1 + activeSheet.subjects.length * (scoreMode === 'citation' ? 2 : 1) + 3 + formulaColumns.length}
                                      className="bg-indigo-50 border border-indigo-200 px-4 py-1.5 font-semibold text-indigo-700 text-xs">
                                      {t('scoring.classGroup')}: {student.className}
                                    </td>
                                  </tr>
                                )
                              }
                              classRowIdx++
                              const rowNum = (sheetClasses.length > 1 && filterClassId === 'ALL') ? classRowIdx : idx + 1
                              const total = getTotal(student.id)
                              const avg = getAverage(student.id)
                              const rank = rankings[student.id] ?? '-'
                              const isDirty = activeSheet.subjects.some(sub => dirtyScores.has(`${student.id}:${sub.id}`))
                              rows.push(
                                <tr key={student.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isDirty ? 'ring-1 ring-inset ring-amber-200' : ''}`}>
                                  <td className="border border-gray-200 px-3 py-1 text-center text-gray-500 sticky left-0 bg-inherit">{rowNum}</td>
                                  <td className="border border-gray-200 px-3 py-1 font-medium text-gray-800 sticky left-10 bg-inherit">{student.name}</td>
                                  <td className="border border-gray-200 px-2 py-1 text-center text-gray-500">
                                    {student.sex === 'FEMALE' ? '♀' : student.sex === 'MALE' ? '♂' : '—'}
                                  </td>
                                  {sheetClasses.length > 1 && filterClassId === 'ALL' && (
                                    <td className="border border-gray-200 px-2 py-1 text-center text-gray-500 text-[10px]">{student.className}</td>
                                  )}
                                  {activeSheet.subjects.map(sub => {
                                    const scoreVal = scores[student.id]?.[sub.id]
                                    const gradeEntry = scoreToGradeEntry(scoreVal ?? null, sub.maxScore, buildSubjectGradeScale(sub.id, subjectGradeScales, sub.maxScore))
                                    return (
                                      <React.Fragment key={sub.id}>
                                        <td className="border border-gray-200 p-0">
                                          <input
                                            type="number"
                                            className="w-full px-2 py-1.5 text-center bg-transparent focus:outline-none focus:bg-yellow-50 focus:ring-1 focus:ring-inset focus:ring-indigo-400 text-xs"
                                            value={scoreVal != null ? scoreVal : ''}
                                            min={0}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleScoreChange(student.id, sub.id, e.target.value)}
                                          />
                                        </td>
                                        {scoreMode === 'citation' && (
                                          <td className={`border border-gray-200 px-2 py-1 text-center text-xs font-bold ${GRADE_COLORS[gradeEntry.letter] ?? ''}`}>
                                            {scoreVal !== null && scoreVal !== undefined ? gradeEntry.letter : '—'}
                                          </td>
                                        )}
                                      </React.Fragment>
                                    )
                                  })}
                                  {scoreMode === 'citation' ? (
                                    <td className="border border-gray-200 px-2 py-1 text-center bg-indigo-50">
                                      <span className="font-semibold text-indigo-700">{(total ?? 0).toFixed(1)}</span>
                                      <span className="text-indigo-400 text-[10px] ml-0.5">pts</span>
                                    </td>
                                  ) : (
                                    <td className="border border-gray-200 px-2 py-1 text-center font-semibold text-indigo-700 bg-indigo-50">{(total ?? 0).toFixed(1)}</td>
                                  )}
                                  {scoreMode === 'citation' ? (() => {
                                    const gradeLetter = gpaToLetter(avg)
                                    const gradeColor = GRADE_COLORS[gradeLetter] ?? ''
                                    return (
                                      <td className="border border-gray-200 px-2 py-1 text-center bg-indigo-50">
                                        <span className="text-gray-700 text-xs">{(avg ?? 0).toFixed(2)}</span>
                                        <span className="text-gray-400 text-[10px] mx-0.5">≈</span>
                                        <span className={`font-bold text-sm px-1 rounded ${gradeColor}`}>{gradeLetter}</span>
                                      </td>
                                    )
                                  })() : (
                                    <td className="border border-gray-200 px-2 py-1 text-center text-gray-700 bg-indigo-50">{(avg ?? 0).toFixed(1)}</td>
                                  )}
                                  <td className="border border-gray-200 px-2 py-1 text-center font-bold text-indigo-800 bg-indigo-50">{rank}</td>
                                  {formulaColumns.map(col => (
                                    <td key={col.id} className="border border-gray-200 px-2 py-1 text-center text-xs font-medium text-purple-700 bg-purple-50">
                                      {evalFormulaExpr(col.formula, getFormulaContext(student.id))}
                                    </td>
                                  ))}
                                </tr>
                              )
                            })
                            return rows
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Footer */}
          <div className="bg-white border-t px-4 py-2 flex items-center justify-between text-xs text-gray-500 print:hidden flex-shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setZoom(z => parseFloat(Math.max(0.5, z - 0.1).toFixed(1)))} className="px-2 py-1 rounded hover:bg-gray-100 font-mono">−</button>
              <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => parseFloat(Math.min(2, z + 0.1).toFixed(1)))} className="px-2 py-1 rounded hover:bg-gray-100 font-mono">+</button>
              <button onClick={() => setZoom(1)} className="px-2 py-1 rounded hover:bg-gray-100 text-indigo-500">Reset</button>
            </div>
            {autoSaveLabel && <span className="text-green-600 text-xs">{autoSaveLabel}</span>}
            <div className="flex items-center gap-3">
              <div className="relative">
                <button onClick={e => { e.stopPropagation(); setShowAddMenu(v => !v) }} disabled={!activeSheet}
                  className="flex items-center gap-1 px-3 py-1 rounded border text-xs hover:bg-gray-50 disabled:opacity-40">
                  + Add ▾
                </button>
                {showAddMenu && (
                  <div className="absolute bottom-8 right-0 bg-white border rounded-lg shadow-lg z-20 w-52" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setShowAddMenu(false); resetSubjectForm(); setSubjectTab('manual'); setShowSubjectModal(true) }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-2">
                      <span>📚</span> {t('scoring.addColumn')}
                    </button>
                    <button onClick={() => { setShowAddMenu(false); resetSubjectForm(); setSubjectTab('import'); setShowSubjectModal(true) }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-2">
                      <span>🔗</span> {t('scoring.importSubject')}
                    </button>
                    <div className="border-t mx-2" />
                    <button onClick={() => { setShowAddMenu(false); setShowMonthModal(true) }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-indigo-50 text-gray-700 flex items-center gap-2">
                      <span>📅</span> {t('scoring.addTabBtn')}
                    </button>
                    <div className="border-t mx-2" />
                    <button onClick={() => { setShowAddMenu(false); setEditingFormulaCol(null); setCalcColName(''); setCalcColFormula('=IF(avg>=3.5,"A",IF(avg>=2.5,"B",IF(avg>=1.5,"C",IF(avg>=0.5,"D","F"))))'); setShowCalcModal(true) }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-purple-50 text-purple-700 flex items-center gap-2">
                      <span>🧮</span> Calc Column
                    </button>
                  </div>
                )}
              </div>
              {dirtyScores.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-amber-600">{dirtyScores.size} unsaved</span>
                  <button onClick={saveScores} disabled={saving}
                    className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-50">
                    {saving ? t('scoring.saving') : t('scoring.save')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* ══ Wizard Modal ══ */}
        {showNewWizard && (
          <Modal title={`${t('scoring.wizard')} · ${t('scoring.step')} ${wizardIndex + 1} ${t('scoring.of')} ${WIZARD_STEPS.length}`} onClose={() => setShowNewWizard(false)}>
            <div className="flex gap-1 mb-4">
              {WIZARD_STEPS.map((s, i) => (
                <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= wizardIndex ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mb-5 -mt-3">
              {[t('scoring.academyYear'), t('scoring.multiClass'), t('scoring.addSubject'), t('scoring.scoreOption'), t('scoring.addMonth')].map((lbl, i) => (
                <span key={i} className={i === wizardIndex ? 'text-indigo-600 font-semibold' : ''}>{lbl}</span>
              ))}
            </div>

            {/* Step 1: Academy Year */}
            {wizardStep === 'year' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">{t('scoring.academyYearHint')}</p>
                {!wShowNewYear ? (
                  <>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      value={wStudyYearId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setWStudyYearId(e.target.value)}>
                      <option value="">{t('scoring.selectYear')}</option>
                      {studyYears.map(y => (
                        <option key={y.id} value={y.id}>{yearLabel(y)}{y.isCurrent ? ' ★' : ''}</option>
                      ))}
                    </select>
                    <button onClick={() => setWShowNewYear(true)} className="text-sm text-indigo-600 underline">+ {t('scoring.createNewYear')}</button>
                  </>
                ) : (
                  <>
                    <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      value={wNewYearLabel} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWNewYearLabel(e.target.value)}
                      placeholder="2026-2027" autoFocus />
                    <button onClick={() => { setWShowNewYear(false); setWNewYearLabel('') }} className="text-sm text-gray-400 underline">← Back to list</button>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Degree <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    value={wDegree}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWDegree(e.target.value)}
                    placeholder="e.g. Degree 1: Grade 7–9"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Group this gradebook by education level or degree.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('scoring.schoolLogo')}</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    value={wLogoUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWLogoUrl(e.target.value)} placeholder="https://..." />
                  {wLogoUrl && <img src={wLogoUrl} alt="preview" className="mt-2 h-10 object-contain rounded" onError={e => (e.currentTarget.style.display = 'none')} />}
                </div>
              </div>
            )}

            {/* Step 2: Classes */}
            {wizardStep === 'classes' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">{t('scoring.multiClassHint')}</p>
                <div className="max-h-60 overflow-y-auto border rounded-lg divide-y">
                  {yearClasses.length === 0 && <p className="text-xs text-gray-400 text-center py-4">{t('scoring.noClassInYear')}</p>}
                  {yearClasses.map(c => (
                    <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-indigo-50">
                      <input type="checkbox" checked={wClassIds.has(c.id)}
                        onChange={e => setWClassIds(prev => { const n = new Set(prev); e.target.checked ? n.add(c.id) : n.delete(c.id); return n })} />
                      <span className="text-sm">{c.name}</span>
                    </label>
                  ))}
                </div>
                {wClassIds.size > 0 && <p className="text-xs text-indigo-600">{wClassIds.size} class(es) selected</p>}
              </div>
            )}

            {/* Step 3: Subjects */}
            {wizardStep === 'subject' && (
              <div className="space-y-3">
                <div className="flex gap-2 border-b pb-2">
                  <button onClick={() => setSubjectTab('manual')}
                    className={`text-xs px-3 py-1 rounded-lg font-medium ${subjectTab === 'manual' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {t('scoring.manualAdd')}
                  </button>
                  <button onClick={() => setSubjectTab('import')}
                    className={`text-xs px-3 py-1 rounded-lg font-medium ${subjectTab === 'import' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {t('scoring.importSubject')}
                  </button>
                </div>
                {subjectTab === 'manual' ? SubjectFormPanel() : TimetableImportPanel()}
              </div>
            )}

            {/* Step 4: Score Option */}
            {wizardStep === 'option' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 font-medium">How should student scores be calculated?</p>

                {/* Option 1: Citation */}
                <label className={`block border-2 rounded-xl p-4 cursor-pointer transition-colors ${
                  wCalcOption === 'citation' ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'
                }`}>
                  <input type="radio" className="sr-only" checked={wCalcOption === 'citation'} onChange={() => setWCalcOption('citation')} />
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">📊</span>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{t('scoring.option1WizTitle')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t('scoring.option1WizDesc')}</p>
                      <div className="mt-2 text-[11px] font-mono bg-white rounded border px-2 py-1.5 text-gray-600">
                        {t('scoring.option1WizExample')}
                      </div>
                      <div className="mt-2 flex gap-1 flex-wrap">
                        {([['A','≥90%','4'], ['B','≥75%','3'], ['C','≥60%','2'], ['D','≥50%','1'], ['E','≥40%','0.5'], ['F','<40%','0(Fail)']] as const).map(([l, p, g]) => (
                          <span key={l} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${GRADE_COLORS[l] ?? 'bg-gray-100 text-gray-600'}`}>{l}: {p}={g}pt</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </label>

                {/* Option 2: Formula Column */}
                <label className={`block border-2 rounded-xl p-4 cursor-pointer transition-colors ${
                  wCalcOption === 'formula' ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'
                }`}>
                  <input type="radio" className="sr-only" checked={wCalcOption === 'formula'} onChange={() => setWCalcOption('formula')} />
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">📐</span>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{t('scoring.option2WizTitle')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t('scoring.option2WizDesc')}</p>
                      <div className="mt-2 text-[10px] font-mono bg-white rounded border px-2 py-1.5 text-gray-600 break-all">
                        =IF(avg&gt;=3.5,"A",IF(avg&gt;=2.5,"B",IF(avg&gt;=1.5,"C",IF(avg&gt;=0.5,"D","F"))))
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">Variables: <strong>avg</strong> (average citation pts), <strong>total</strong>, <strong>rank</strong>, s1/s2/… (scores), g1/g2/… (grades)</p>
                    </div>
                  </div>
                </label>

                {/* Default: Numeric */}
                <label className={`flex items-center gap-3 border-2 rounded-xl p-3.5 cursor-pointer transition-colors ${
                  wCalcOption === '' ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'
                }`}>
                  <input type="radio" className="sr-only" checked={wCalcOption === ''} onChange={() => setWCalcOption('')} />
                  <span className="text-xl">🔢</span>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{t('scoring.defaultNumTitle')}</p>
                    <p className="text-xs text-gray-500">{t('scoring.defaultNumDesc')}</p>
                  </div>
                </label>
              </div>
            )}

            {/* Step 5: Months */}
            {wizardStep === 'month' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">{t('scoring.addMonth')}</p>
                {MonthFormPanel()}
              </div>
            )}

            <div className="flex justify-between pt-5">
              <button onClick={handleWizardBack} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">
                {wizardIndex === 0 ? (t('common.cancel') || 'Cancel') : t('scoring.back')}
              </button>
              <button onClick={handleWizardNext}
                disabled={(wizardStep === 'year' && !wStudyYearId && !wNewYearLabel.trim())}
                className="px-5 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {wizardIndex === WIZARD_STEPS.length - 1 ? t('scoring.finish') : t('scoring.next')}
              </button>
            </div>
          </Modal>
        )}

        {/* ══ Open Modal ══ */}
        {showOpenModal && (
          <Modal title={t('scoring.openSheet')} onClose={() => setShowOpenModal(false)}>
            {sheets.length === 0 ? <p className="text-gray-500 text-sm text-center py-6">{t('scoring.noSheets')}</p> : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {sheets.map(sheet => {
                  const sc = classes.filter(c => sheet.classes?.some(x => x.classId === c.id))
                  const sy = studyYears.find(y => y.id === sheet.studyYearId)
                  return (
                    <button key={sheet.id} onClick={() => openSheet(sheet)}
                      className="w-full text-left px-4 py-3 rounded-lg border hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-gray-800 text-sm">{sheet.name}</p>
                        <div className="flex items-center gap-1.5">
                          {sheet.degree && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">{sheet.degree}</span>}
                          {sy && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{yearLabel(sy)}</span>}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{sc.map(c => c.name).join(', ') || t('scoring.noClasses')} · {sheet.subjects?.length ?? 0} {t('scoring.subject')} · {sheet.examTabs?.length ?? 0} tabs</p>
                    </button>
                  )
                })}
              </div>
            )}
          </Modal>
        )}

        {/* ══ Subject Modal ══ */}
        {showSubjectModal && !showNewWizard && (
          <Modal title={t('scoring.manageSubjects')} onClose={() => setShowSubjectModal(false)} wide>
            <div className="flex gap-2 border-b pb-3 mb-4">
              <button onClick={() => setSubjectTab('manual')}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium ${subjectTab === 'manual' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {t('scoring.manualAdd')}
              </button>
              <button onClick={() => setSubjectTab('import')}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium ${subjectTab === 'import' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {t('scoring.importSubject')}
              </button>
            </div>
            {subjectTab === 'manual' ? SubjectFormPanel() : TimetableImportPanel()}
            <div className="flex justify-end pt-4">
              <button onClick={() => setShowSubjectModal(false)} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.close') || 'Close'}</button>
            </div>
          </Modal>
        )}

        {/* ══ Month Modal ══ */}
        {showMonthModal && !showNewWizard && (
          <Modal title={t('scoring.manageMonths')} onClose={() => setShowMonthModal(false)}>
            {MonthFormPanel()}
            <div className="flex justify-end pt-4">
              <button onClick={() => setShowMonthModal(false)} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.close') || 'Close'}</button>
            </div>
          </Modal>
        )}

        {/* ══ Class Modal ══ */}
        {showClassModal && (
          <Modal title={t('scoring.multiClass')} onClose={() => setShowClassModal(false)}>
            <p className="text-sm text-gray-500 mb-3">{t('scoring.multiClassHint')}</p>
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y mb-4">
              {classes.map(c => (
                <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-indigo-50">
                  <input type="checkbox" checked={editClassIds.has(c.id)}
                    onChange={e => setEditClassIds(prev => { const n = new Set(prev); e.target.checked ? n.add(c.id) : n.delete(c.id); return n })} />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowClassModal(false)} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.cancel') || 'Cancel'}</button>
              <button onClick={saveClasses} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">{t('common.save') || 'Save'}</button>
            </div>
          </Modal>
        )}

        {/* ══ Delete Confirm ══ */}
        {showDeleteSheetConfirm && (
          <Modal title={t('scoring.delete')} onClose={() => setShowDeleteSheetConfirm(false)}>
            <p className="text-sm text-gray-600 mb-6">{t('scoring.deleteSheetConfirm')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteSheetConfirm(false)} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.cancel') || 'Cancel'}</button>
              <button onClick={deleteSheet} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">{t('scoring.delete')}</button>
            </div>
          </Modal>
        )}

        {/* ══ Print Modal ══ */}
        {showPrintModal && activeSheet && (
          <ScoringPrintModal
            sheet={activeSheet}
            activeTabId={activeTabId}
            sheetClasses={sheetClasses}
            scoreMode={scoreMode}
            formulaColumns={formulaColumns}
            subjectGradeScales={subjectGradeScales}
            onClose={() => setShowPrintModal(false)}
          />
        )}

        {/* ══ Calc Column Modal ══ */}
        {showCalcModal && activeSheet && (
          <Modal title={editingFormulaCol ? t('scoring.editCalcTitle') : t('scoring.addCalcTitle')} onClose={() => { setShowCalcModal(false); setEditingFormulaCol(null) }} wide>
            <div className="space-y-5">

              {/* ── Option 1: Citation Mode ── */}
              <div className={`rounded-xl border-2 p-4 transition-colors ${scoreMode === 'citation' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">📊</span>
                    <div>
                      <p className="font-semibold text-sm text-gray-800">{t('scoring.option1ModalTitle')}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('scoring.option1ModalDesc')}
                      </p>
                      {scoreMode === 'citation' && (
                        <div className="mt-2 flex gap-1 flex-wrap">
                          {(['A','B','C','D','E','F'] as const).map(l => (
                            <span key={l} className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${GRADE_COLORS[l] ?? ''}`}>{l}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setScoreMode(m => m === 'citation' ? 'numeric' : 'citation')}
                    className={`flex-shrink-0 px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                      scoreMode === 'citation' ? 'bg-indigo-600 text-white shadow-sm' : 'border-2 border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-600'
                    }`}>
                    {scoreMode === 'citation' ? '✓ On' : 'Off'}
                  </button>
                </div>

                {/* ── Per-subject grade threshold editor ── */}
                {scoreMode === 'citation' && (
                  <div className="mt-4 border-t border-indigo-200 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-indigo-700">
                        📐 {t('scoring.gradeThresholds')}
                        <span className="font-normal text-gray-400 ml-1">{t('scoring.gradeThresholdsHint')}</span>
                      </p>
                      <button
                        onClick={() => setSubjectGradeScales({})}
                        className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">
                        {t('scoring.resetAllDefault')}
                      </button>
                    </div>
                    {/* Column headers */}
                    <div className="grid gap-1.5 mb-1.5 px-1" style={{ gridTemplateColumns: '1fr repeat(5, 46px)' }}>
                      <span className="text-[10px] text-gray-400">Subject</span>
                      {(['A','B','C','D','E'] as const).map(l => (
                        <span key={l} className={`text-[10px] font-bold text-center px-1 py-0.5 rounded ${GRADE_COLORS[l] ?? ''}`}>{l}</span>
                      ))}
                    </div>
                    {/* Per-subject rows */}
                    {activeSheet.subjects.map(sub => {
                      const scale = subjectGradeScales[sub.id] ?? defaultSubjectScale(sub.maxScore)
                      return (
                        <div key={sub.id} className="grid gap-1.5 items-center mb-1.5 px-1" style={{ gridTemplateColumns: '1fr repeat(5, 46px)' }}>
                          <span className="text-xs font-medium text-gray-700 truncate" title={`${sub.name} (max ${sub.maxScore})`}>
                            {sub.name}
                            <span className="text-gray-400 text-[9px] ml-1">/{sub.maxScore}</span>
                          </span>
                          {(['A','B','C','D','E'] as const).map(letter => (
                            <input
                              key={letter}
                              type="number" min={0} max={sub.maxScore} step={0.5}
                              value={scale[letter]}
                              onChange={e => {
                                const val = Math.min(sub.maxScore, Math.max(0, Number(e.target.value) || 0))
                                setSubjectGradeScales(prev => ({
                                  ...prev,
                                  [sub.id]: { ...(prev[sub.id] ?? defaultSubjectScale(sub.maxScore)), [letter]: val },
                                }))
                              }}
                              className="w-full text-center text-[11px] border border-gray-300 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                            />
                          ))}
                        </div>
                      )
                    })}
                    <p className="text-[10px] text-gray-400 px-1 mt-0.5">
                      {t('scoring.gradeFAuto')}
                    </p>
                  </div>
                )}
              </div>

              {/* ── Option 2: Formula Column ── */}
              <div className="rounded-xl border-2 border-purple-200 bg-purple-50/40 p-4">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-2xl">📐</span>
                  <div>
                    <p className="font-semibold text-sm text-gray-800">{t('scoring.option2ModalTitle')}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{t('scoring.option2ModalDesc')}</p>
                  </div>
                </div>

                {/* Template quick-picks */}
                <div className="mb-3">
                  <p className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide mb-1.5">{t('scoring.quickTemplates')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Citation Grade (GPA)', icon: '🎓', desc: 'A–F from GPA · avg 0–4', name: t('scoring.grade'), formula: '=IF(avg>=3.5,"A",IF(avg>=2.5,"B",IF(avg>=1.5,"C",IF(avg>=0.5,"D","F"))))' },
                      { label: 'Numeric Grade (%)',    icon: '📈', desc: 'A–F from score · avg 0–100', name: t('scoring.grade'), formula: '=IF(avg>=90,"A",IF(avg>=75,"B",IF(avg>=60,"C",IF(avg>=50,"D","F"))))' },
                      { label: 'Pass / Fail',          icon: '✅', desc: 'Pass if avg ≥ 50', name: 'Result', formula: '=IF(avg>=50,"Pass","Fail")' },
                      { label: 'Points × Weight',      icon: '⚖️', desc: 'e.g. (s1*0.4)+(s2*0.6)', name: 'Weighted', formula: '=(s1*0.4)+(s2*0.6)' },
                    ].map(tpl => (
                      <button key={tpl.label} onClick={() => { setCalcColName(tpl.name); setCalcColFormula(tpl.formula) }}
                        className="flex items-start gap-2 text-left px-3 py-2.5 rounded-lg border border-purple-200 bg-white hover:border-purple-500 hover:bg-purple-50 transition-colors">
                        <span className="text-base mt-0.5 flex-shrink-0">{tpl.icon}</span>
                        <div>
                          <p className="text-xs font-semibold text-gray-800 leading-tight">{tpl.label}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{tpl.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Column name + formula */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('scoring.colName')}</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                      value={calcColName} onChange={e => setCalcColName(e.target.value)}
                      placeholder={t('scoring.colNamePlaceholder')} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">{t('scoring.formula')}</label>
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400 h-16 resize-none"
                      value={calcColFormula} onChange={e => setCalcColFormula(e.target.value)}
                      placeholder='=IF(avg>=90,"A",IF(avg>=75,"B","F"))' />

                    {/* Live preview */}
                    {calcColFormula && students.length > 0 && (() => {
                      const ctx0 = getFormulaContext(students[0].id)
                      const preview = evalFormulaExpr(calcColFormula, ctx0)
                      const isErr = preview === '#ERR'
                      return (
                        <div className={`mt-1.5 flex items-center gap-2 text-[11px] px-2 py-1 rounded ${isErr ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                          <span>{isErr ? '⚠️' : '✓'}</span>
                          <span>Preview (row 1 · avg={Number(ctx0.avg).toFixed(1)}): <strong className="font-mono">{preview}</strong></span>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Variable reference */}
                  <details className="group">
                    <summary className="text-[10px] font-semibold text-purple-700 cursor-pointer list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 transition-transform inline-block">▶</span> Variable reference
                    </summary>
                    <div className="mt-2 bg-white border border-purple-100 rounded-lg px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                      <span><code className="text-purple-700 font-mono">avg</code> — avg (citation GPA or numeric)</span>
                      <span><code className="text-purple-700 font-mono">numavg</code> — raw numeric avg (0–100)</span>
                      <span><code className="text-purple-700 font-mono">total</code> — total (citation pts or numeric)</span>
                      <span><code className="text-purple-700 font-mono">numtotal</code> — raw numeric total</span>
                      <span><code className="text-purple-700 font-mono">rank</code> — student rank</span>
                      <span><code className="text-purple-700 font-mono">s1, s2…</code> — raw subject scores</span>
                      <span><code className="text-purple-700 font-mono">g1, g2…</code> — grade letters (A/B…)</span>
                      <span><code className="text-purple-700 font-mono">gp1, gp2…</code> — grade pts (4/3…)</span>
                      <span className="col-span-2 text-gray-400 mt-1">Functions: <code>IF(cond,then,else)</code> · <code>AVERAGE(a,b,…)</code> · <code>SUM(a,b,…)</code></span>
                    </div>
                  </details>

                  <div className="flex gap-2 pt-1">
                    <button onClick={addFormulaColumn} disabled={!calcColName.trim() || !calcColFormula.trim()}
                      className="px-5 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-40">
                      {editingFormulaCol ? t('scoring.saveChanges') : t('scoring.addColBtn')}
                    </button>
                    {editingFormulaCol && (
                      <button onClick={() => { setFormulaColumns(cols => cols.filter(c => c.id !== editingFormulaCol.id)); setEditingFormulaCol(null); setShowCalcModal(false) }}
                        className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50">
                        {t('scoring.delete')}
                      </button>
                    )}
                    {editingFormulaCol && (
                      <button onClick={() => { setEditingFormulaCol(null); setCalcColName(''); setCalcColFormula('') }}
                        className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                        {t('scoring.cancelEdit')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Active columns list ── */}
              {formulaColumns.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">{t('scoring.activeFormulaCols')}</p>
                  <div className="space-y-1.5">
                    {formulaColumns.map(col => (
                      <div key={col.id} className="flex items-center justify-between bg-purple-50 rounded-lg px-3 py-2.5 border border-purple-100">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-purple-800">{col.name}</p>
                          <p className="text-[10px] font-mono text-purple-400 mt-0.5 truncate max-w-xs">{col.formula}</p>
                        </div>
                        <button
                          onClick={() => { setEditingFormulaCol(col); setCalcColName(col.name); setCalcColFormula(col.formula) }}
                          className="ml-3 flex-shrink-0 text-purple-600 text-xs px-2.5 py-1 rounded border border-purple-200 hover:bg-purple-100">
                          {t('common.edit')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1 border-t">
                <button onClick={() => { setShowCalcModal(false); setEditingFormulaCol(null) }}
                  className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">{t('common.close')}</button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AuthGuard>
  )
}

// ─── Scoring Print Modal ──────────────────────────────────────────────────────

function ScoringPrintModal({
  sheet, activeTabId, sheetClasses, scoreMode, formulaColumns, subjectGradeScales, onClose,
}: {
  sheet: ScoreSheet
  activeTabId: string | null
  sheetClasses: ClassOption[]
  scoreMode: ScoreMode
  formulaColumns: FormulaColumn[]
  subjectGradeScales: Record<string, SubjectGradeScale>
  onClose: () => void
}) {
  const { t } = useLanguage()

  const [printClassId, setPrintClassId] = useState<string>('ALL')
  const [printCols, setPrintCols] = useState<Set<string>>(
    () => new Set(['no', 'name', 'subjects', 'total', 'average', 'rank'])
  )
  const [orgName, setOrgName] = useState('Wattaman School')
  const [logoUrl, setLogoUrl] = useState(sheet.logoUrl ?? '')
  const [logoTextLines, setLogoTextLines] = useState<string[]>([''])
  const [logoGap, setLogoGap] = useState('4')
  const [logoTextGap, setLogoTextGap] = useState('4')
  const [headerLines, setHeaderLines] = useState<string[]>(['ព្រះរាជាណាចក្រកម្ពុជា', 'ជាតិ សាសនា ព្រះមហាក្សត្រ'])
  const [headerGap, setHeaderGap] = useState('6')
  const [signers, setSigners] = useState<string[]>(['Teacher', 'Admin'])
  const [dualColumn, setDualColumn] = useState(false)

  const tab = sheet.examTabs.find(e => e.id === activeTabId)

  // ── Column definitions ──
  const allColDefs = [
    { key: 'no',          label: t('scoring.no') },
    { key: 'name',        label: t('scoring.studentName') },
    { key: 'gender',      label: t('scoring.gender') },
    { key: 'class',       label: t('scoring.colClassGroup') },
    { key: 'subjects',    label: `${t('scoring.subject')} (${sheet.subjects.length})` },
    { key: 'subj_grades', label: t('scoring.colGradeLetters') },
    { key: 'total',       label: t('scoring.total') },
    { key: 'average',     label: t('scoring.average') },
    { key: 'rank',        label: t('scoring.ranking') },
    ...formulaColumns.map(fc => ({ key: `fcol_${fc.id}`, label: `${fc.name} (${t('scoring.formula')})` })),
  ]

  const toggleCol = (key: string) => setPrintCols(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const applyPreset = (keys: string[]) => setPrintCols(new Set(keys))

  const PRESETS = [
    { label: '📋 Summary', keys: ['no', 'name', 'total', 'average', 'rank', ...formulaColumns.map(fc => `fcol_${fc.id}`)] },
    { label: '📊 Full Detail', keys: ['no', 'name', 'gender', 'subjects', 'total', 'average', 'rank', ...formulaColumns.map(fc => `fcol_${fc.id}`)] },
    { label: '🎓 Per Subject', keys: ['no', 'name', 'subjects', 'subj_grades', 'total', 'average', 'rank', ...formulaColumns.map(fc => `fcol_${fc.id}`)] },
  ]

  const handlePrint = () => {
    if (!activeTabId) return
    const params = new URLSearchParams({
      tabId: activeTabId,
      classId: printClassId,
      sheetName: sheet.name,
      tabLabel: tab?.label ?? '',
      logoUrl,
      orgName,
      logoTextLines: JSON.stringify(logoTextLines.filter(l => l.trim())),
      logoGap,
      logoTextGap,
      headerLines: JSON.stringify(headerLines.filter(l => l.trim())),
      headerGap,
      subjects: JSON.stringify(sheet.subjects.map(s => ({ id: s.id, name: s.name, maxScore: s.maxScore, color: s.color }))),
      sheetClasses: JSON.stringify(sheetClasses.map(c => ({ id: c.id, name: c.name }))),
      signers: JSON.stringify(signers.filter(s => s.trim())),
      printCols: JSON.stringify([...printCols]),
      scoreMode,
      formulaColumns: JSON.stringify(formulaColumns),
      subjectGradeScales: JSON.stringify(subjectGradeScales),
      dualColumn: dualColumn ? '1' : '0',
    })
    window.open(`/admin/scoring/print?${params.toString()}`, '_blank')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-slate-800">🖨️ {t('scoring.print')}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{sheet.name} — {tab?.label ?? '—'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 text-sm">✕</button>
        </div>

        <div className="p-6 space-y-5">

          {sheetClasses.length > 1 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">🏫 {t('scoring.filterClass')}</label>
              <select value={printClassId} onChange={e => setPrintClassId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white">
                <option value="ALL">{t('scoring.allClasses')}</option>
                {sheetClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* ── Column Selector ── */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">📋 {t('scoring.columnsToPrint')}</h3>
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => applyPreset(p.keys)}
                  className="px-3 py-1 text-[11px] font-medium rounded-full border border-slate-300 bg-white hover:border-indigo-400 hover:text-indigo-700 transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
            {/* Checkboxes grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {allColDefs.map(col => (
                <label key={col.key} className="flex items-center gap-2 cursor-pointer group">
                  <div
                    onClick={() => toggleCol(col.key)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      printCols.has(col.key)
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'border-slate-300 bg-white group-hover:border-indigo-400'
                    }`}>
                    {printCols.has(col.key) && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                  </div>
                  <span className="text-xs text-slate-700 select-none" onClick={() => toggleCol(col.key)}>{col.label}</span>
                </label>
              ))}
            </div>
            {/* Dual-column toggle */}
            <label className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200 cursor-pointer">
              <div
                onClick={() => setDualColumn(v => !v)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  dualColumn ? 'bg-green-600 border-green-600' : 'border-slate-300 bg-white hover:border-green-400'
                }`}>
                {dualColumn && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
              </div>
              <div onClick={() => setDualColumn(v => !v)} className="select-none">
                <span className="text-xs font-semibold text-slate-700">📰 {t('scoring.dualColumn')}</span>
                <span className="block text-[10px] text-slate-400">{t('scoring.dualColumnHint')}</span>
              </div>
            </label>
          </div>

          <div className="space-y-3 p-4 bg-amber-50/50 rounded-xl border border-amber-200">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">📜 {t('scoring.letterHeader')}</h3>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.logoUrl')}</label>
              <input type="text" value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.spacingBelowLogo')}</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="20" step="1" value={logoGap}
                  onChange={e => setLogoGap(e.target.value)} className="flex-1 accent-indigo-500" />
                <span className="text-xs text-slate-500 w-8 text-center">{logoGap}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.textBelowLogo')}</label>
              <div className="space-y-1.5">
                {logoTextLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input type="text" value={line} placeholder={`Line ${idx + 1}`}
                      onChange={e => { const l = [...logoTextLines]; l[idx] = e.target.value; setLogoTextLines(l) }}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                    {logoTextLines.length > 1 && (
                      <button onClick={() => setLogoTextLines(logoTextLines.filter((_, i) => i !== idx))}
                        className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center text-xs">✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setLogoTextLines([...logoTextLines, ''])}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">{t('scoring.addLine')}</button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.spacingBelowLogoText')}</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="20" step="1" value={logoTextGap}
                  onChange={e => setLogoTextGap(e.target.value)} className="flex-1 accent-indigo-500" />
                <span className="text-xs text-slate-500 w-8 text-center">{logoTextGap}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.headerLines')}</label>
              <div className="space-y-1.5">
                {headerLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input type="text" value={line} placeholder={`Line ${idx + 1}`}
                      onChange={e => { const h = [...headerLines]; h[idx] = e.target.value; setHeaderLines(h) }}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-center" />
                    {headerLines.length > 1 && (
                      <button onClick={() => setHeaderLines(headerLines.filter((_, i) => i !== idx))}
                        className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center text-xs">✕</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setHeaderLines([...headerLines, ''])}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">{t('scoring.addLine')}</button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.spacingBelowHeader')}</label>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="20" step="1" value={headerGap}
                  onChange={e => setHeaderGap(e.target.value)} className="flex-1 accent-indigo-500" />
                <span className="text-xs text-slate-500 w-8 text-center">{headerGap}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('scoring.orgName')}</label>
              <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">✍️ {t('scoring.signers')}</label>
            <div className="space-y-2">
              {signers.map((signer, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input type="text" value={signer} placeholder={`${t('scoring.signers')} ${idx + 1}`}
                    onChange={e => { const s = [...signers]; s[idx] = e.target.value; setSigners(s) }}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                  {signers.length > 1 && (
                    <button onClick={() => setSigners(signers.filter((_, i) => i !== idx))}
                      className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center text-sm">✕</button>
                  )}
                </div>
              ))}
              <button onClick={() => setSigners([...signers, ''])}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
                {t('scoring.addSigner')}
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              {t('common.cancel') || 'Cancel'}
            </button>
            <button onClick={handlePrint} disabled={!activeTabId}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm flex items-center justify-center gap-2">
              🖨️ {t('reports.preview')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
