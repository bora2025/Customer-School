'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'
import { useLanguage } from '../../../../lib/i18n'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubjectInfo {
  id: string
  name: string
  maxScore: number
  color: string
}

interface ClassInfo {
  id: string
  name: string
}

interface StudentRow {
  id: string
  studentNumber: string
  name: string
  sex: string | null
  classId: string | null
  className: string | null
}

interface ScoreEntryData {
  studentId: string
  subjectId: string
  score: number | null
}

interface FormulaColumnInfo {
  id: string
  name: string
  formula: string
}

type ScoreMode = 'numeric' | 'citation'

// ─── Grade scale ──────────────────────────────────────────────────────────────

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
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-red-100 text-red-700',
  F: 'bg-red-200 text-red-900',
}

type SubjectGradeScale = { A: number; B: number; C: number; D: number; E: number }

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
  if (score === null) return { min: 0, letter: '—', point: 0 }
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0
  return scale.find(g => pct >= g.min) ?? scale[scale.length - 1]
}

function gpaToLetter(gpa: number) {
  if (gpa >= 3.5) return 'A'
  if (gpa >= 2.5) return 'B'
  if (gpa >= 1.5) return 'C'
  if (gpa >= 0.5) return 'D'
  return 'F'
}

// ─── Formula evaluator ────────────────────────────────────────────────────────

function evalFormulaExpr(formula: string, ctx: Record<string, number | string>): string {
  try {
    let expr = formula.replace(/^=\s*/, '')
    expr = expr.replace(/\bIF\s*\(/gi, '$IF(')
    expr = expr.replace(/\bAVERAGE\s*\(/gi, '$AVG(')
    expr = expr.replace(/\bSUM\s*\(/gi, '$SUM(')
    const keys = Object.keys(ctx).sort((a, b) => b.length - a.length)
    for (const k of keys) {
      const v = ctx[k]
      const rep = typeof v === 'string' ? JSON.stringify(v) : String(v)
      expr = expr.replace(new RegExp(`\\b${k}\\b`, 'g'), rep)
    }
    const check = expr.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\$[A-Za-z_]\w*/g, '0')
    if (/[a-zA-Z_]/.test(check)) return '#ERR'
    const $IF = (cond: unknown, then: unknown, els: unknown) => (cond ? then : els)
    const $AVG = (...a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
    const $SUM = (...a: number[]) => a.reduce((s, x) => s + x, 0)
    const fn = new Function('$IF', '$AVG', '$SUM', `"use strict"; return (${expr});`)
    const result = fn($IF, $AVG, $SUM)
    if (typeof result === 'number') return isFinite(result) ? result.toFixed(2) : '#ERR'
    return String(result ?? '')
  } catch { return '#ERR' }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRawTotal(subjects: SubjectInfo[], scores: Record<string, Record<string, number | null>>, studentId: string) {
  return subjects.reduce((sum, sub) => sum + (scores[studentId]?.[sub.id] ?? 0), 0)
}

function getCitationTotal(
  subjects: SubjectInfo[],
  scores: Record<string, Record<string, number | null>>,
  studentId: string,
  subjectGradeScales: Record<string, SubjectGradeScale> = {},
) {
  return subjects.reduce((sum, sub) => {
    const s = scores[studentId]?.[sub.id] ?? null
    return sum + scoreToGradeEntry(s, sub.maxScore, buildSubjectGradeScale(sub.id, subjectGradeScales, sub.maxScore)).point
  }, 0)
}

function getTotal(
  subjects: SubjectInfo[],
  scores: Record<string, Record<string, number | null>>,
  studentId: string,
  mode: ScoreMode,
  subjectGradeScales: Record<string, SubjectGradeScale> = {},
) {
  return mode === 'citation' ? getCitationTotal(subjects, scores, studentId, subjectGradeScales) : getRawTotal(subjects, scores, studentId)
}

function getAverage(
  subjects: SubjectInfo[],
  scores: Record<string, Record<string, number | null>>,
  studentId: string,
  mode: ScoreMode,
  subjectGradeScales: Record<string, SubjectGradeScale> = {},
) {
  const n = subjects.length
  return n ? getTotal(subjects, scores, studentId, mode, subjectGradeScales) / n : 0
}

function buildRankings(
  students: StudentRow[],
  subjects: SubjectInfo[],
  scores: Record<string, Record<string, number | null>>,
  mode: ScoreMode,
  subjectGradeScales: Record<string, SubjectGradeScale> = {},
) {
  const groups: Record<string, StudentRow[]> = {}
  students.forEach(s => {
    const key = s.classId ?? '__none__'
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  })
  const map: Record<string, number> = {}
  Object.values(groups).forEach(group => {
    const sorted = [...group].sort((a, b) => getTotal(subjects, scores, b.id, mode, subjectGradeScales) - getTotal(subjects, scores, a.id, mode, subjectGradeScales))
    sorted.forEach((s, i) => { map[s.id] = i + 1 })
  })
  return map
}

// ─── Page wrapper (Suspense required for useSearchParams) ─────────────────────

export default function ScoringPrintPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ScoringPrintContent />
    </Suspense>
  )
}

function ScoringPrintContent() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()

  const tabId = searchParams.get('tabId') || ''
  const classId = searchParams.get('classId') || 'ALL'
  const sheetName = searchParams.get('sheetName') || ''
  const tabLabel = searchParams.get('tabLabel') || ''
  const logoUrl = searchParams.get('logoUrl') || ''
  const orgName = searchParams.get('orgName') || ''
  const logoGap = parseInt(searchParams.get('logoGap') || '4')
  const logoTextGap = parseInt(searchParams.get('logoTextGap') || '4')
  const headerGap = parseInt(searchParams.get('headerGap') || '6')

  const subjects: SubjectInfo[] = (() => {
    try { return JSON.parse(searchParams.get('subjects') || '[]') } catch { return [] }
  })()

  const sheetClasses: ClassInfo[] = (() => {
    try { return JSON.parse(searchParams.get('sheetClasses') || '[]') } catch { return [] }
  })()

  const logoTextLines: string[] = (() => {
    try { return JSON.parse(searchParams.get('logoTextLines') || '[]') } catch { return [] }
  })()

  const headerLines: string[] = (() => {
    try { return JSON.parse(searchParams.get('headerLines') || '[]') } catch { return [] }
  })()

  const signers: string[] = (() => {
    try { return JSON.parse(searchParams.get('signers') || '["Teacher","Admin"]') } catch { return ['Teacher', 'Admin'] }
  })()

  const scoreMode: ScoreMode = (searchParams.get('scoreMode') || 'numeric') as ScoreMode

  const formulaColumns: FormulaColumnInfo[] = (() => {
    try { return JSON.parse(searchParams.get('formulaColumns') || '[]') } catch { return [] }
  })()

  const printColsArr: string[] = (() => {
    try { return JSON.parse(searchParams.get('printCols') || '[]') } catch { return [] }
  })()
  const printCols = new Set(printColsArr.length ? printColsArr : ['no', 'name', 'subjects', 'total', 'average', 'rank'])

  const subjectGradeScales: Record<string, SubjectGradeScale> = (() => {
    try { return JSON.parse(searchParams.get('subjectGradeScales') || '{}') } catch { return {} }
  })()

  const dualColumn = searchParams.get('dualColumn') === '1'

  // ─── Data ─────────────────────────────────────────────────────────────────

  const [students, setStudents] = useState<StudentRow[]>([])
  const [scores, setScores] = useState<Record<string, Record<string, number | null>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tabId) { setError('Missing tab ID'); setLoading(false); return }
    const classIds = classId === 'ALL'
      ? sheetClasses.map(c => c.id)
      : [classId]
    const q = classIds.length ? `?classIds=${classIds.join(',')}` : ''
    apiFetch(`/api/scoring/exam-tabs/${tabId}/scores${q}`).then(async res => {
      if (!res.ok) { setError('Failed to load scores'); setLoading(false); return }
      const data: {
        entries: ScoreEntryData[]
        students: Array<{ id: string; studentNumber: string; user: { name: string }; sex: string | null; class: { id: string; name: string } | null }>
      } = await res.json()
      setStudents(data.students.map(s => ({
        id: s.id,
        studentNumber: s.studentNumber || '',
        name: s.user?.name || '',
        sex: s.sex,
        classId: s.class?.id ?? null,
        className: s.class?.name ?? null,
      })))
      const scoreMap: Record<string, Record<string, number | null>> = {}
      for (const e of data.entries) {
        if (!scoreMap[e.studentId]) scoreMap[e.studentId] = {}
        scoreMap[e.studentId][e.subjectId] = e.score
      }
      setScores(scoreMap)
      setLoading(false)
    }).catch(() => { setError('Failed to connect'); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, classId])

  // ─── Derived ──────────────────────────────────────────────────────────────

  const rankings = buildRankings(students, subjects, scores, scoreMode, subjectGradeScales)

  // When printing all classes with multiple classes, group them
  const isMultiClass = sheetClasses.length > 1 && classId === 'ALL'

  // Selected class name (for single-class print)
  const selectedClassName = classId === 'ALL'
    ? sheetClasses.map(c => c.name).join(', ')
    : sheetClasses.find(c => c.id === classId)?.name ?? classId

  // ─── Formula context per student ──────────────────────────────────────────

  const getFormulaContext = (studentId: string): Record<string, number | string> => {
    const rawTotal = getRawTotal(subjects, scores, studentId)
    const rawAvg = subjects.length ? rawTotal / subjects.length : 0
    const citTotal = getCitationTotal(subjects, scores, studentId, subjectGradeScales)
    const citAvg = subjects.length ? citTotal / subjects.length : 0
    const total = scoreMode === 'citation' ? citTotal : rawTotal
    const avg = scoreMode === 'citation' ? citAvg : rawAvg
    const ctx: Record<string, number | string> = {
      total, avg, average: avg, gpa: citAvg,
      numavg: rawAvg, numtotal: rawTotal,
      rank: rankings[studentId] ?? 0,
    }
    subjects.forEach((sub, i) => {
      const score = scores[studentId]?.[sub.id] ?? null
      const grade = scoreToGradeEntry(score, sub.maxScore, buildSubjectGradeScale(sub.id, subjectGradeScales, sub.maxScore))
      ctx[`s${i + 1}`] = score ?? 0
      ctx[`g${i + 1}`] = grade.letter
      ctx[`gp${i + 1}`] = grade.point
    })
    return ctx
  }

  // ─── UI states ────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p className="text-red-600 font-medium">{error}</p>
        <button onClick={() => window.close()} className="mt-4 px-4 py-2 bg-slate-200 rounded-lg text-sm">
          {t('common.close')}
        </button>
      </div>
    </div>
  )

  // ─── Render table for a list of students ──────────────────────────────────

  function ScoreTable({ rows, showClass, startIdx = 0 }: { rows: StudentRow[]; showClass: boolean; startIdx?: number }) {
    let classRowIdx = 0
    let lastClassName: string | null = null

    // Which formula columns are selected for print
    const activeFcols = formulaColumns.filter(fc => printCols.has(`fcol_${fc.id}`))

    // Compute dynamic colspan for class-group header rows
    const activeColCount =
      (printCols.has('no') ? 1 : 0) +
      (printCols.has('name') ? 1 : 0) +
      (printCols.has('gender') ? 1 : 0) +
      ((showClass && printCols.has('class')) ? 1 : 0) +
      (printCols.has('subjects') ? subjects.length : 0) +
      (printCols.has('subj_grades') ? subjects.length : 0) +
      (printCols.has('total') ? 1 : 0) +
      (printCols.has('average') ? 1 : 0) +
      (printCols.has('rank') ? 1 : 0) +
      activeFcols.length

    return (
      <table className="w-full border-collapse text-xs table-fixed">
        <colgroup>
          {printCols.has('no') && <col style={{ width: '28px' }} />}
          {printCols.has('name') && <col />}
          {printCols.has('gender') && <col style={{ width: '36px' }} />}
          {showClass && printCols.has('class') && <col style={{ width: '80px' }} />}
          {printCols.has('subjects') && subjects.map(sub => <col key={sub.id} style={{ width: '58px' }} />)}
          {printCols.has('subj_grades') && subjects.map(sub => <col key={`gr-${sub.id}`} style={{ width: '38px' }} />)}
          {printCols.has('total') && <col style={{ width: '52px' }} />}
          {printCols.has('average') && <col style={{ width: '52px' }} />}
          {printCols.has('rank') && <col style={{ width: '36px' }} />}
          {activeFcols.map(fc => <col key={fc.id} style={{ width: '60px' }} />)}
        </colgroup>
        <thead>
          <tr className="bg-slate-800 text-white">
            {printCols.has('no') && (
              <th className="border border-slate-600 px-1 py-2 text-center font-semibold">{t('scoring.no')}</th>
            )}
            {printCols.has('name') && (
              <th className="border border-slate-600 px-2 py-2 text-left font-semibold">{t('scoring.studentName')}</th>
            )}
            {printCols.has('gender') && (
              <th className="border border-slate-600 px-1 py-2 text-center font-semibold">{t('scoring.gender')}</th>
            )}
            {showClass && printCols.has('class') && (
              <th className="border border-slate-600 px-1 py-2 text-center font-semibold">{t('scoring.classGroup')}</th>
            )}
            {printCols.has('subjects') && subjects.map(sub => (
              <th key={sub.id} className="border border-slate-600 px-1 py-1 text-center font-semibold">
                <div className="flex flex-col items-center leading-tight">
                  <span className="truncate w-full text-center" style={{ color: sub.color === '#000000' ? 'white' : sub.color }}>{sub.name}</span>
                  <span className="text-slate-400 font-normal text-[9px]">/{sub.maxScore}</span>
                </div>
              </th>
            ))}
            {printCols.has('subj_grades') && subjects.map(sub => (
              <th key={`gh-${sub.id}`} className="border border-slate-600 px-1 py-1 text-center font-semibold text-[10px] bg-slate-700">
                <div className="leading-tight">
                  <div style={{ color: sub.color === '#000000' ? 'white' : sub.color }} className="truncate">{sub.name}</div>
                  <div className="text-slate-300 font-normal">{t('scoring.grade')}</div>
                </div>
              </th>
            ))}
            {printCols.has('total') && (
              <th className="border border-slate-600 px-1 py-2 text-center font-semibold bg-slate-900">
                {scoreMode === 'citation' ? <span className="leading-tight"><div>{t('scoring.total')}</div><div className="text-[9px] font-normal text-slate-400">Citation pts</div></span> : t('scoring.total')}
              </th>
            )}
            {printCols.has('average') && (
              <th className="border border-slate-600 px-1 py-2 text-center font-semibold bg-slate-900">
                {scoreMode === 'citation' ? <span className="leading-tight"><div>{t('scoring.average')}</div><div className="text-[9px] font-normal text-slate-400">{t('scoring.gpaGrade')}</div></span> : t('scoring.average')}
              </th>
            )}
            {printCols.has('rank') && (
              <th className="border border-slate-600 px-1 py-2 text-center font-semibold bg-slate-900">{t('scoring.ranking')}</th>
            )}
            {activeFcols.map(fc => (
              <th key={fc.id} className="border border-slate-600 px-1 py-2 text-center font-semibold bg-purple-900 text-purple-100">{fc.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((student, idx) => {
            const showClassHeader = isMultiClass && student.className !== lastClassName
            if (showClassHeader) {
              lastClassName = student.className
              classRowIdx = 0
            }
            classRowIdx++
            const rowNum = isMultiClass ? classRowIdx : startIdx + idx + 1
            const total = getTotal(subjects, scores, student.id, scoreMode, subjectGradeScales)
            const avg = getAverage(subjects, scores, student.id, scoreMode, subjectGradeScales)
            const rank = rankings[student.id] ?? '-'
            const fCtx = activeFcols.length ? getFormulaContext(student.id) : {}

            return (
              <>
                {showClassHeader && (
                  <tr key={`cls-${student.classId}`}>
                    <td colSpan={activeColCount}
                      className="bg-slate-100 border border-slate-300 px-3 py-1 font-semibold text-slate-700 text-xs">
                      {t('scoring.classGroup')}: {student.className}
                    </td>
                  </tr>
                )}
                <tr key={student.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  {printCols.has('no') && (
                    <td className="border border-slate-300 px-1 py-1.5 text-center text-slate-500 whitespace-nowrap">{rowNum}</td>
                  )}
                  {printCols.has('name') && (
                    <td className="border border-slate-300 px-2 py-1.5 text-slate-800 truncate">{student.name}</td>
                  )}
                  {printCols.has('gender') && (
                    <td className="border border-slate-300 px-1 py-1.5 text-center text-slate-500 whitespace-nowrap">
                      {student.sex === 'FEMALE' ? '♀' : student.sex === 'MALE' ? '♂' : '—'}
                    </td>
                  )}
                  {showClass && printCols.has('class') && (
                    <td className="border border-slate-300 px-1 py-1.5 text-center text-slate-500 text-[10px] truncate">{student.className}</td>
                  )}
                  {printCols.has('subjects') && subjects.map(sub => {
                    const val = scores[student.id]?.[sub.id]
                    return (
                      <td key={sub.id} className="border border-slate-300 px-1 py-1.5 text-center text-slate-700 whitespace-nowrap">
                        {val != null ? val.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  {printCols.has('subj_grades') && subjects.map(sub => {
                    const val = scores[student.id]?.[sub.id] ?? null
                    const grade = scoreToGradeEntry(val, sub.maxScore, buildSubjectGradeScale(sub.id, subjectGradeScales, sub.maxScore))
                    return (
                      <td key={`gc-${sub.id}`} className="border border-slate-300 px-1 py-1 text-center whitespace-nowrap">
                        <span className={`inline-block px-1 py-0.5 rounded text-[10px] font-bold ${GRADE_COLORS[grade.letter] ?? ''}`}>
                          {grade.letter}
                        </span>
                      </td>
                    )
                  })}
                  {printCols.has('total') && (
                    <td className="border border-slate-300 px-1 py-1.5 text-center font-semibold text-indigo-700 bg-indigo-50 whitespace-nowrap">
                      {total.toFixed(scoreMode === 'citation' ? 1 : 1)}
                      {scoreMode === 'citation' && <span className="text-[9px] text-slate-400 ml-0.5">pts</span>}
                    </td>
                  )}
                  {printCols.has('average') && (
                    <td className="border border-slate-300 px-1 py-1.5 text-center text-slate-700 bg-indigo-50 whitespace-nowrap">
                      {scoreMode === 'citation' ? (
                        <>
                          {avg.toFixed(2)}
                          <span className={`ml-1 text-[9px] font-bold px-0.5 rounded ${GRADE_COLORS[gpaToLetter(avg)] ?? ''}`}>
                            {gpaToLetter(avg)}
                          </span>
                        </>
                      ) : avg.toFixed(1)}
                    </td>
                  )}
                  {printCols.has('rank') && (
                    <td className="border border-slate-300 px-1 py-1.5 text-center font-bold text-indigo-800 bg-indigo-50 whitespace-nowrap">{rank}</td>
                  )}
                  {activeFcols.map(fc => {
                    const result = evalFormulaExpr(fc.formula, fCtx)
                    return (
                      <td key={fc.id} className="border border-slate-300 px-1 py-1.5 text-center bg-purple-50 text-purple-800 font-medium whitespace-nowrap text-[10px]">
                        {result === '#ERR' ? <span className="text-red-400">#ERR</span> : result}
                      </td>
                    )
                  })}
                </tr>
              </>
            )
          })}
        </tbody>
      </table>
    )
  }

  // Sort helper — rank ascending (1st = best)
  const sortByRank = (rows: StudentRow[]) =>
    [...rows].sort((a, b) => (rankings[a.id] ?? 9999) - (rankings[b.id] ?? 9999))

  // Group students by class for per-class-page printing (all classes mode)
  const classGroups: { classId: string; className: string; rows: StudentRow[] }[] = isMultiClass
    ? sheetClasses.map(cls => ({
        classId: cls.id,
        className: cls.name,
        rows: sortByRank(students.filter(s => s.classId === cls.id)),
      })).filter(g => g.rows.length > 0)
    : [{ classId: classId, className: selectedClassName, rows: sortByRank(students) }]

  const printDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm 12mm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }
          .print-page { page-break-after: always; }
          .print-page:last-child { page-break-after: avoid; }
        }
        @media screen {
          body { background: #f1f5f9; }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="no-print fixed top-0 left-0 right-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-50 shadow-sm gap-2">
        <button onClick={() => window.close()}
          className="flex-shrink-0 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">
          ← {t('common.close')}
        </button>
        <div className="text-sm text-slate-500 truncate min-w-0 mx-2">
          {sheetName} — {tabLabel} — {selectedClassName}
        </div>
        <button onClick={() => window.print()}
          className="flex-shrink-0 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm">
          🖨️ {t('scoring.print')}
        </button>
      </div>

      {/* Print pages */}
      <div style={{ marginTop: '60px' }}>
        {classGroups.map((group, gIdx) => (
          <div key={group.classId} className={`print-page bg-white mx-auto p-8 mb-6 ${gIdx < classGroups.length - 1 ? 'print:mb-0' : ''}`}
            style={{ maxWidth: '297mm', minHeight: '210mm' }}>

            {/* Header */}
            <div className="mb-5 border-b-2 border-slate-800 pb-4">
              <div className="flex items-start gap-4">
                {logoUrl && (
                  <div className="flex-shrink-0 pt-1 text-center">
                    <img src={logoUrl} alt="logo" className="h-20 w-20 object-contain" style={{ marginBottom: `${logoGap}px` }} />
                    {logoTextLines.length > 0 && (
                      <div style={{ marginBottom: `${logoTextGap}px` }}>
                        {logoTextLines.map((line, idx) => (
                          <p key={idx} className="text-[9px] text-slate-600 leading-tight whitespace-nowrap">{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex-1 text-center" style={{ marginBottom: `${headerGap}px` }}>
                  {headerLines.map((line, i) => (
                    <p key={i} className={i === 0 ? 'text-base font-bold text-slate-900' : 'text-sm font-semibold text-slate-700'}>{line}</p>
                  ))}
                  {orgName && (
                    <p className="text-lg font-bold text-slate-900 uppercase tracking-wide mt-1">{orgName}</p>
                  )}
                </div>
                {logoUrl && <div className="w-20 flex-shrink-0" />}
              </div>
              <div className="text-center mt-3">
                <h2 className="text-lg font-semibold text-slate-700">{sheetName}</h2>
                <div className="mt-2 flex flex-wrap justify-center gap-x-8 gap-y-1 text-sm text-slate-600">
                  <span><strong>{t('scoring.month')}:</strong> {tabLabel}</span>
                  <span><strong>{t('common.class')}:</strong> {group.className}</span>
                </div>
              </div>
            </div>

            {/* Table */}
            {dualColumn ? (() => {
              const half = Math.ceil(group.rows.length / 2)
              const leftRows = group.rows.slice(0, half)
              const rightRows = group.rows.slice(half)
              return (
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0 overflow-x-auto">
                    {ScoreTable({ rows: leftRows, showClass: isMultiClass, startIdx: 0 })}
                  </div>
                  <div className="w-px bg-slate-300 self-stretch flex-shrink-0" />
                  <div className="flex-1 min-w-0 overflow-x-auto">
                    {ScoreTable({ rows: rightRows, showClass: isMultiClass, startIdx: half })}
                  </div>
                </div>
              )
            })() : (
              <div className="overflow-x-auto">
                {ScoreTable({ rows: group.rows, showClass: isMultiClass, startIdx: 0 })}
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 flex justify-between items-end text-xs text-slate-400">
              <span>{t('reports.printDate')}: {printDate}</span>
              <span>{sheetName} — {tabLabel}</span>
            </div>

            {/* Signatures */}
            {signers.length > 0 && (
              <div className={`mt-10 flex ${signers.length <= 3 ? 'justify-between' : 'justify-around flex-wrap gap-y-8'} px-4`}>
                {signers.map((signer, i) => (
                  <div key={i} className="text-center">
                    <div className="border-b border-slate-400 w-32 mb-1" />
                    <p className="text-xs text-slate-500">{signer}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
