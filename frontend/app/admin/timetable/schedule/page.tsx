'use client'

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'
import { pluginTimetableFetch } from '../../../../lib/timetable-plugin-api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimetableListItem {
  id: string; name: string; academicYear: string
  periodsPerDay: number; numberOfDays: number; weekend: string[]
}
interface TSubject { id: string; name: string; short: string; color: string | null }
interface TClass   { id: string; name: string; short: string; color: string | null }
interface TClassroom { id: string; name: string; short: string; color: string | null }
interface TTeacher { id: string; lastName: string; firstName: string; short: string; color: string | null }
interface TLesson  {
  id: string; teacherId: string; subjectId: string; classId: string
  perWeek: number; lessonType: string
  teacher: TTeacher; subject: TSubject; class: TClass
}
interface TEntry {
  id: string; classId: string; teacherId: string; subjectId: string
  classroomId: string | null; lessonId: string | null; day: number; period: number
  class: TClass; teacher: TTeacher; subject: TSubject; classroom: TClassroom | null
}
interface Timetable {
  id: string; name: string; academicYear: string
  periodsPerDay: number; numberOfDays: number; weekend: string[]
  subjects: TSubject[]; classes: TClass[]; classrooms: TClassroom[]
  teachers: TTeacher[]; lessons: TLesson[]; entries: TEntry[]
}

// ─── Drag payload ────────────────────────────────────────────────────────────
// Two kinds:
//   { source: 'panel', lessonId }         — drag from lesson panel
//   { source: 'cell', entryId, classId, day, period }  — drag from grid cell

type DragPayload =
  | { source: 'panel'; lessonId: string }
  | { source: 'cell'; entryId: string; classId: string; day: number; period: number }

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Toast ────────────────────────────────────────────────────────────────────
type Toast = { id: number; msg: string; ok: boolean }
let _tid = 0

// ─── Helpers ─────────────────────────────────────────────────────────────────
function badge(color: string | null, text: string) {
  return (
    <span className="inline-block rounded px-1 py-0 text-[10px] font-bold text-white"
      style={{ backgroundColor: color ?? '#6366f1' }}>{text}</span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function TimetableScheduleWorkspace({ pluginMode = false }: { pluginMode?: boolean }) {
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const [timetables, setTimetables] = useState<TimetableListItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [tt, setTt] = useState<Timetable | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  // View mode: by-class (rows = classes, cols = days) or by-teacher
  const [viewMode, setViewMode] = useState<'class' | 'teacher'>('class')
  const [zoom, setZoom] = useState(1)

  // drag tracking
  const dragPayload = useRef<DragPayload | null>(null)
  const [overCell, setOverCell] = useState<string | null>(null) // "classId_day_period"

  // Classroom assignment panel
  const [assignEntry, setAssignEntry] = useState<TEntry | null>(null)

  function showToast(msg: string, ok = true) {
    const id = ++_tid
    setToasts(p => [...p, { id, msg, ok }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500)
  }

  // ─── Data loading ──────────────────────────────────────────────────

  const fetchList = useCallback(async () => {
    const res = await timetableFetch('/api/timetable')
    if (res.ok) {
      const list: TimetableListItem[] = await res.json()
      setTimetables(list)
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id)
    }
  }, [selectedId])

  const loadTt = useCallback(async (id: string) => {
    setLoading(true)
    const res = await timetableFetch(`/api/timetable/${id}`)
    if (res.ok) setTt(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchList() }, [fetchList])
  useEffect(() => { if (selectedId) loadTt(selectedId) }, [selectedId, loadTt])

  // ─── Derived: unplaced lessons ─────────────────────────────────────
  // A lesson is "unplaced" if it has fewer entries than perWeek
  function unplacedLessons(): Array<{ lesson: TLesson; remaining: number }> {
    if (!tt) return []
    return tt.lessons
      .map(lesson => {
        const placed = tt.entries.filter(e => e.lessonId === lesson.id).length
        const remaining = lesson.perWeek - placed
        return { lesson, remaining }
      })
      .filter(x => x.remaining > 0)
  }

  // ─── Drag handlers ────────────────────────────────────────────────

  function onDragStartPanel(e: DragEvent, lessonId: string) {
    dragPayload.current = { source: 'panel', lessonId }
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragStartCell(e: DragEvent, entry: TEntry) {
    dragPayload.current = {
      source: 'cell', entryId: entry.id,
      classId: entry.classId, day: entry.day, period: entry.period,
    }
    e.dataTransfer.effectAllowed = 'move'
    e.stopPropagation()
  }

  function onDragOver(e: DragEvent, cellKey: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverCell(cellKey)
  }

  function onDragLeave() { setOverCell(null) }

  async function onDrop(e: DragEvent, classId: string, day: number, period: number) {
    e.preventDefault()
    setOverCell(null)
    const payload = dragPayload.current
    if (!payload || !tt) return
    setSaving(true)

    if (payload.source === 'panel') {
      // Find the lesson
      const lesson = tt.lessons.find(l => l.id === payload.lessonId)
      if (!lesson) { setSaving(false); return }
      // Ensure this class matches lesson.classId
      if (lesson.classId !== classId) {
        showToast(`This lesson belongs to class "${lesson.class.name}", not the dropped cell.`, false)
        setSaving(false); return
      }
      // Check slot not already occupied by same class
      const clash = tt.entries.find(en => en.classId === classId && en.day === day && en.period === period)
      if (clash) {
        showToast('That slot is already occupied. Remove the existing card first.', false)
        setSaving(false); return
      }
      const res = await timetableFetch(`/api/timetable/${tt.id}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: lesson.id, classId: lesson.classId,
          teacherId: lesson.teacherId, subjectId: lesson.subjectId,
          day, period,
        }),
      })
      if (res.ok) {
        showToast(`Placed ${lesson.subject.short} · ${lesson.teacher.short} → ${DAY_LABELS[day-1]} P${period}`)
        await loadTt(tt.id)
      } else { showToast('Failed to place card.', false) }
    } else {
      // Moving from cell → cell
      if (payload.classId !== classId) {
        showToast('Cannot move a card to a different class row.', false)
        setSaving(false); return
      }
      const clash = tt.entries.find(
        en => en.classId === classId && en.day === day && en.period === period && en.id !== payload.entryId
      )
      if (clash) {
        showToast('That slot is already occupied.', false)
        setSaving(false); return
      }
      // Find old entry to get lesson info
      const oldEntry = tt.entries.find(en => en.id === payload.entryId)
      if (!oldEntry) { setSaving(false); return }

      // Delete old, create new
      await timetableFetch(`/api/timetable/entries/${payload.entryId}`, { method: 'DELETE' })
      const res = await timetableFetch(`/api/timetable/${tt.id}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: oldEntry.lessonId, classId: oldEntry.classId,
          teacherId: oldEntry.teacherId, subjectId: oldEntry.subjectId,
          day, period,
        }),
      })
      if (res.ok) {
        showToast(`Moved → ${DAY_LABELS[day-1]} P${period}`)
        await loadTt(tt.id)
      } else { showToast('Failed to move card.', false) }
    }
    setSaving(false)
  }

  async function removeEntry(entryId: string) {
    if (!tt) return
    setSaving(true)
    const res = await timetableFetch(`/api/timetable/entries/${entryId}`, { method: 'DELETE' })
    if (res.ok) { showToast('Card removed from schedule.'); await loadTt(tt.id) }
    else showToast('Failed to remove card.', false)
    setSaving(false)
  }

  async function assignClassroom(entryId: string, classroomId: string | null) {
    if (!tt) return
    setSaving(true)
    const entry = tt.entries.find(e => e.id === entryId)
    if (!entry) { setSaving(false); return }
    const res = await timetableFetch(`/api/timetable/${tt.id}/entries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId: entry.lessonId, classId: entry.classId,
        teacherId: entry.teacherId, subjectId: entry.subjectId,
        classroomId: classroomId ?? undefined,
        day: entry.day, period: entry.period,
      }),
    })
    if (res.ok) {
      showToast('Classroom assigned.')
      await loadTt(tt.id)
      setAssignEntry(null)
    } else showToast('Failed to assign classroom.', false)
    setSaving(false)
  }

  // ─── Grid rendering ───────────────────────────────────────────────

  function buildClassGrid() {
    if (!tt) return null
    const days = Array.from({ length: tt.numberOfDays }, (_, i) => i + 1)
    const periods = Array.from({ length: tt.periodsPerDay }, (_, i) => i + 1)

    return (
      <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', transition: 'transform 0.15s' }}>
        <table className="border-collapse text-xs select-none">
          <thead>
            <tr className="bg-indigo-700 text-white sticky top-0 z-10">
              <th className="border border-indigo-600 px-2 py-1 min-w-[80px] text-left sticky left-0 bg-indigo-700 z-20">
                Class / P
              </th>
              {days.map(d =>
                periods.map(p => (
                  <th key={`${d}_${p}`} className="border border-indigo-600 px-1 py-1 min-w-[96px] text-center font-medium">
                    <div>{DAY_LABELS[d - 1] ?? `D${d}`}</div>
                    <div className="text-indigo-300 text-[10px] font-normal">P{p}</div>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {tt.classes.map(cls => (
              <tr key={cls.id} className="even:bg-gray-50 hover:bg-indigo-50/30 transition-colors">
                <td className="border border-gray-200 px-2 py-1 font-semibold align-middle whitespace-nowrap sticky left-0 bg-white z-[5] shadow-sm">
                  <div className="flex flex-col gap-0.5">
                    {badge(cls.color, cls.short)}
                    <span className="text-gray-400 text-[10px]">{cls.name}</span>
                  </div>
                </td>
                {days.map(day =>
                  periods.map(period => {
                    const cellKey = `${cls.id}_${day}_${period}`
                    const entries = tt.entries.filter(e => e.classId === cls.id && e.day === day && e.period === period)
                    const isOver = overCell === cellKey
                    return (
                      <td
                        key={cellKey}
                        className={`border align-top p-0.5 min-h-[56px] w-24 transition-colors
                          ${isOver ? 'bg-indigo-100 border-indigo-400' : 'border-gray-200'}`}
                        onDragOver={ev => onDragOver(ev, cellKey)}
                        onDragLeave={onDragLeave}
                        onDrop={ev => onDrop(ev, cls.id, day, period)}
                      >
                        {entries.map(entry => (
                          <EntryCard
                            key={entry.id}
                            entry={entry}
                            onDragStart={onDragStartCell}
                            onRemove={removeEntry}
                            onAssign={() => setAssignEntry(entry)}
                          />
                        ))}
                        {entries.length === 0 && (
                          <div className="h-12 flex items-center justify-center text-gray-300 text-[10px] pointer-events-none">
                            drop here
                          </div>
                        )}
                      </td>
                    )
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function buildTeacherGrid() {
    if (!tt) return null
    const days = Array.from({ length: tt.numberOfDays }, (_, i) => i + 1)
    const periods = Array.from({ length: tt.periodsPerDay }, (_, i) => i + 1)

    return (
      <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', transition: 'transform 0.15s' }}>
        <table className="border-collapse text-xs select-none">
          <thead>
            <tr className="bg-emerald-700 text-white sticky top-0 z-10">
              <th className="border border-emerald-600 px-2 py-1 min-w-[80px] text-left sticky left-0 bg-emerald-700 z-20">
                Teacher / P
              </th>
              {days.map(d =>
                periods.map(p => (
                  <th key={`${d}_${p}`} className="border border-emerald-600 px-1 py-1 min-w-[96px] text-center font-medium">
                    <div>{DAY_LABELS[d - 1] ?? `D${d}`}</div>
                    <div className="text-emerald-300 text-[10px] font-normal">P{p}</div>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {tt.teachers.map(tch => (
              <tr key={tch.id} className="even:bg-gray-50">
                <td className="border border-gray-200 px-2 py-1 font-semibold align-middle whitespace-nowrap sticky left-0 bg-white z-[5] shadow-sm">
                  <div className="flex flex-col gap-0.5">
                    {badge(tch.color, tch.short)}
                    <span className="text-gray-400 text-[10px]">{tch.lastName}</span>
                  </div>
                </td>
                {days.map(day =>
                  periods.map(period => {
                    const entries = tt.entries.filter(e => e.teacherId === tch.id && e.day === day && e.period === period)
                    return (
                      <td key={`${tch.id}_${day}_${period}`}
                        className="border border-gray-200 align-top p-0.5 min-h-[56px] w-24">
                        {entries.map(entry => (
                          <div key={entry.id}
                            className="rounded mb-0.5 px-1 py-0.5 text-white text-[10px] leading-tight"
                            style={{ backgroundColor: entry.subject.color ?? '#6366f1' }}>
                            <div className="font-semibold">{entry.subject.short}</div>
                            <div className="opacity-80">{entry.class.short}</div>
                          </div>
                        ))}
                      </td>
                    )
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // ─── Unplaced panel ───────────────────────────────────────────────
  const unplaced = unplacedLessons()

  // ─── Stats ────────────────────────────────────────────────────────
  const totalNeeded = tt ? tt.lessons.reduce((s, l) => s + l.perWeek, 0) : 0
  const totalPlaced = tt?.entries.length ?? 0
  const pct = totalNeeded > 0 ? Math.round((totalPlaced / totalNeeded) * 100) : 0

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <AuthGuard allowedRoles={['ADMIN']}>
      <div className="flex h-screen bg-gray-100">
        <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />

        {/* Left Panel: Lesson Cards */}
        <div className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col">
          <div className="px-3 py-3 border-b border-gray-100 bg-indigo-50">
            <h2 className="font-bold text-indigo-800 text-sm">Lesson Cards</h2>
            <p className="text-xs text-indigo-500 mt-0.5">Drag → grid to schedule</p>
          </div>

          {/* Timetable selector */}
          <div className="px-3 py-2 border-b border-gray-100">
            <select
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              <option value="">— Select timetable —</option>
              {timetables.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.academicYear})</option>
              ))}
            </select>
          </div>

          {/* Progress bar */}
          {tt && (
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>Placed: {totalPlaced} / {totalNeeded}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {unplaced.length === 0 && totalNeeded > 0 && (
                <div className="mt-1.5 text-[10px] text-emerald-600 font-semibold text-center">✓ All lessons placed!</div>
              )}
            </div>
          )}

          {/* Unplaced lessons */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {loading && <p className="text-xs text-gray-400 text-center py-6">Loading…</p>}
            {!loading && unplaced.length === 0 && tt && (
              <p className="text-xs text-gray-400 text-center py-6">No unplaced lessons.</p>
            )}
            {!loading && !tt && (
              <p className="text-xs text-gray-400 text-center py-6">Select a timetable above.</p>
            )}
            {unplaced.map(({ lesson, remaining }) => (
              <div key={lesson.id}>
                {Array.from({ length: remaining }).map((_, i) => (
                  <div
                    key={`${lesson.id}_${i}`}
                    draggable
                    onDragStart={e => onDragStartPanel(e, lesson.id)}
                    className="rounded-lg px-2 py-1.5 mb-1 cursor-grab active:cursor-grabbing shadow-sm border border-white/20 select-none
                      hover:brightness-110 transition-all hover:shadow-md"
                    style={{ backgroundColor: lesson.subject.color ?? '#6366f1' }}
                    title={`${lesson.subject.name} · ${lesson.class.name} · ${lesson.teacher.lastName}`}
                  >
                    <div className="font-bold text-white text-[11px] leading-tight">{lesson.subject.short}</div>
                    <div className="text-white/80 text-[10px]">{lesson.class.short} · {lesson.teacher.short}</div>
                    <div className="text-white/60 text-[9px] mt-0.5">{lesson.lessonType.toLowerCase()}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* By-class / by-teacher grouped legend */}
          {tt && (
            <div className="px-2 py-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 font-semibold mb-1">TEACHERS</p>
              <div className="flex flex-wrap gap-1">
                {tt.teachers.map(t => (
                  <span key={t.id}
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white"
                    style={{ backgroundColor: t.color ?? '#6366f1' }}>
                    {t.short}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-700">
              {tt ? `${tt.name} · ${tt.academicYear}` : 'Scheduling Board'}
            </span>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => setViewMode('class')}
                className={`px-3 py-1.5 transition-colors ${viewMode === 'class' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >By Class</button>
              <button
                onClick={() => setViewMode('teacher')}
                className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${viewMode === 'teacher' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >By Teacher</button>
            </div>
            <div className="w-px h-5 bg-gray-200 mx-1" />
            <div className="flex items-center gap-1 text-xs">
              <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(1)))}
                className="w-6 h-6 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold">−</button>
              <span className="w-10 text-center text-gray-500">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))}
                className="w-6 h-6 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 flex items-center justify-center font-bold">+</button>
              <button onClick={() => setZoom(1)} className="text-indigo-500 hover:underline ml-1">100%</button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {saving && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Saving…
                </span>
              )}
              <a href={pluginMode ? '/plugins/wattanam.timetable/timetables' : '/admin/timetable'} className="text-xs text-indigo-600 hover:underline">← Back to Timetable</a>
            </div>
          </div>

          {/* Grid area */}
          <div className="flex-1 overflow-auto p-4">
            {loading && (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <svg className="w-6 h-6 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Loading timetable…
              </div>
            )}
            {!loading && !tt && (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
                <svg className="w-14 h-14 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
                <p>Select a timetable from the left panel to start scheduling.</p>
              </div>
            )}
            {!loading && tt && (
              viewMode === 'class' ? buildClassGrid() : buildTeacherGrid()
            )}
          </div>

          {/* Legend */}
          {tt && (
            <div className="bg-white border-t border-gray-100 px-4 py-2 flex items-center gap-4 text-[10px] text-gray-400">
              <span className="font-semibold text-gray-500 uppercase tracking-wide">Subjects:</span>
              {tt.subjects.map(s => (
                <span key={s.id} className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: s.color ?? '#6366f1' }}/>
                  {s.short}
                </span>
              ))}
              <span className="ml-auto">Right-click card to remove · Drag to move</span>
            </div>
          )}
        </div>
      </div>

      {/* Classroom assignment modal */}
      {assignEntry && tt && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-72 p-5">
            <h3 className="font-bold text-gray-800 mb-1">Assign Classroom</h3>
            <p className="text-xs text-gray-500 mb-3">
              {assignEntry.subject.name} · {assignEntry.class.name} · {DAY_LABELS[assignEntry.day - 1]} P{assignEntry.period}
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
              <button
                onClick={() => assignClassroom(assignEntry.id, null)}
                className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors
                  ${!assignEntry.classroomId ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'}`}
              >— No classroom —</button>
              {tt.classrooms.map(rm => (
                <button
                  key={rm.id}
                  onClick={() => assignClassroom(assignEntry.id, rm.id)}
                  className={`w-full text-left px-3 py-2 rounded border text-sm transition-colors
                    ${assignEntry.classroomId === rm.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'}`}
                >
                  <span className="font-medium">{rm.name}</span>
                  <span className="text-gray-400 ml-2 text-xs">{rm.short}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setAssignEntry(null)}
              className="w-full py-1.5 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium
              ${t.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
            <span>{t.ok ? '✓' : '✕'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </AuthGuard>
  )
}

export default function SchedulePage() {
  const searchParams = useSearchParams()
  return <TimetableScheduleWorkspace pluginMode={searchParams.get('source') === 'plugin'} />
}

// ─── Entry Card Component ─────────────────────────────────────────────────────
function EntryCard({
  entry, onDragStart, onRemove, onAssign,
}: {
  entry: TEntry
  onDragStart: (e: DragEvent<HTMLDivElement>, entry: TEntry) => void
  onRemove: (id: string) => void
  onAssign: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <div
        draggable
        onDragStart={e => { setShowMenu(false); onDragStart(e, entry) }}
        onContextMenu={e => { e.preventDefault(); setShowMenu(v => !v) }}
        className="rounded mb-0.5 px-1.5 py-1 cursor-grab active:cursor-grabbing text-white text-[10px]
          leading-tight select-none hover:brightness-110 transition-all shadow-sm"
        style={{ backgroundColor: entry.subject.color ?? '#6366f1' }}
        title="Drag to move · Right-click for options"
      >
        <div className="font-bold">{entry.subject.short}</div>
        <div className="opacity-80 text-[9px]">{entry.teacher.short}</div>
        {entry.classroom && (
          <div className="opacity-60 text-[9px]">{entry.classroom.short}</div>
        )}
      </div>

      {showMenu && (
        <div className="absolute z-50 top-full left-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[130px]">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 border-b border-gray-100">
            {entry.subject.name}
          </div>
          <div className="px-3 py-1 text-[10px] text-gray-400">{entry.teacher.lastName}</div>
          <div className="px-3 py-1 text-[10px] text-gray-400">{entry.class.name}</div>
          <button
            onClick={() => { setShowMenu(false); onAssign() }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 transition-colors">
            📍 Assign classroom
          </button>
          <button
            onClick={() => { setShowMenu(false); onRemove(entry.id) }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-red-600 hover:bg-red-50 transition-colors">
            ✕ Remove from schedule
          </button>
        </div>
      )}
    </div>
  )
}
