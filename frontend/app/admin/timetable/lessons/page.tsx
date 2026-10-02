'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import { pluginTimetableFetch } from '../../../../lib/timetable-plugin-api'

interface TimetableListItem { id: string; name: string; academicYear: string }
interface TTeacher { id: string; lastName: string; firstName: string; short: string; color: string | null }
interface TSubject { id: string; name: string; short: string; color: string | null }
interface TClass { id: string; name: string; short: string; color: string | null }
interface TLesson {
  id: string
  teacherId: string; subjectId: string; classId: string
  perWeek: number; lessonType: string
  teacher: TTeacher; subject: TSubject; class: TClass
}

const LESSON_TYPES = [
  { value: 'SINGLE', label: 'Single (1 period)' },
  { value: 'DOUBLE', label: 'Double (2 periods)' },
  { value: 'TRIPLE', label: 'Triple (3 periods)' },
]

export default function LessonsPage() {
  const pluginMode = useSearchParams().get('source') === 'plugin'
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const router = useRouter()
  const [timetables, setTimetables] = useState<TimetableListItem[]>([])
  const [selectedTT, setSelectedTT] = useState('')
  const [lessons, setLessons] = useState<TLesson[]>([])
  const [teachers, setTeachers] = useState<TTeacher[]>([])
  const [subjects, setSubjects] = useState<TSubject[]>([])
  const [classes, setClasses] = useState<TClass[]>([])
  const [loading, setLoading] = useState(false)

  // Filter
  const [filterTeacher, setFilterTeacher] = useState('')

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<TLesson | null>(null)
  const [fTeacher, setFTeacher] = useState('')
  const [fSubject, setFSubject] = useState('')
  const [fClass, setFClass] = useState('')
  const [fPerWeek, setFPerWeek] = useState(2)
  const [fType, setFType] = useState('SINGLE')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const fetchTimetables = useCallback(async () => {
    const res = await timetableFetch('/api/timetable')
    if (res.ok) {
      const list = await res.json()
      setTimetables(list)
      if (list.length > 0 && !selectedTT) setSelectedTT(list[0].id)
    }
  }, [selectedTT])

  const fetchData = useCallback(async () => {
    if (!selectedTT) return
    setLoading(true)
    const res = await timetableFetch(`/api/timetable/${selectedTT}`)
    if (res.ok) {
      const tt = await res.json()
      setLessons(tt.lessons ?? [])
      setTeachers(tt.teachers ?? [])
      setSubjects(tt.subjects ?? [])
      setClasses(tt.classes ?? [])
    }
    setLoading(false)
  }, [selectedTT])

  useEffect(() => { fetchTimetables() }, [fetchTimetables])
  useEffect(() => { fetchData() }, [fetchData])

  function openModal(item?: TLesson) {
    setEditing(item ?? null)
    setFTeacher(item?.teacherId ?? '')
    setFSubject(item?.subjectId ?? '')
    setFClass(item?.classId ?? '')
    setFPerWeek(item?.perWeek ?? 2)
    setFType(item?.lessonType ?? 'SINGLE')
    setSaveError('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!selectedTT || !fTeacher || !fSubject || !fClass) {
      setSaveError('Please fill in all fields.')
      return
    }
    setSaving(true); setSaveError('')
    const url = editing
      ? `/api/timetable/lessons/${editing.id}`
      : `/api/timetable/${selectedTT}/lessons`
    const res = await timetableFetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId: fTeacher, subjectId: fSubject, classId: fClass, perWeek: fPerWeek, lessonType: fType }),
    })
    if (res.ok) {
      sessionStorage.setItem('timetable_needs_refresh', '1')
      await fetchData(); setShowModal(false)
    } else {
      const err = await res.json().catch(() => ({}))
      const msg = Array.isArray(err?.message) ? err.message[0] : (err?.message ?? `Error ${res.status}`)
      setSaveError(msg)
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    await timetableFetch(`/api/timetable/lessons/${id}`, { method: 'DELETE' })
    sessionStorage.setItem('timetable_needs_refresh', '1')
    await fetchData(); setDeleteId(null)
  }

  // Displayed lessons (optionally filtered by teacher)
  const displayed = filterTeacher
    ? lessons.filter(l => l.teacherId === filterTeacher)
    : lessons

  function colorBadge(color: string | null, text: string) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
        style={{ backgroundColor: color ?? '#6366f1' }}>{text}</span>
    )
  }

  return (
    <AuthGuard allowedRoles={['ADMIN']}>
      <div className="flex h-screen bg-gray-100">
        <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Header */}
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div>
              <button onClick={() => router.push(pluginMode ? '/plugins/wattanam.timetable/timetables' : '/admin/timetable')} className="text-indigo-600 text-sm hover:underline mb-1">← Back to Timetable</button>
              <h1 className="text-xl font-bold text-gray-800">Lesson Contracts</h1>
              <p className="text-sm text-gray-500">Manage teacher–subject–class assignments and lessons per week</p>
            </div>
            <button onClick={() => openModal()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">
              + New Lesson
            </button>
          </div>

          {/* Toolbar: timetable selector + teacher filter */}
          <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 font-medium">Timetable:</label>
              <select
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={selectedTT} onChange={e => setSelectedTT(e.target.value)}>
                {timetables.map(tt => <option key={tt.id} value={tt.id}>{tt.name} · {tt.academicYear}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 font-medium">Teacher:</label>
              <select
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)}>
                <option value="">All teachers</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.lastName} {t.firstName}</option>)}
              </select>
            </div>
            {filterTeacher && (
              <span className="text-xs text-gray-500">{displayed.length} lesson{displayed.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="text-gray-400 text-center py-20">Loading…</div>
            ) : displayed.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-lg mb-2">No lesson contracts yet</p>
                <p className="text-sm">Click "+ New Lesson" to add the first contract.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Teacher</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Subject</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Class</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Lessons/Week</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Type</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map(l => (
                      <tr key={l.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: l.teacher.color ?? '#22c55e' }} />
                            <span className="text-gray-800">{l.teacher.lastName} {l.teacher.firstName}</span>
                            <span className="text-gray-400 text-xs">({l.teacher.short})</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {colorBadge(l.subject.color, l.subject.short)}
                            <span className="text-gray-700">{l.subject.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {colorBadge(l.class.color, l.class.short)}
                            <span className="text-gray-700">{l.class.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block bg-indigo-50 text-indigo-700 font-semibold rounded px-2 py-0.5 text-xs">
                            {l.perWeek}×/week
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs capitalize">
                          {l.lessonType.toLowerCase()}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button onClick={() => openModal(l)} className="text-blue-600 hover:underline text-sm mr-3">Edit</button>
                          <button onClick={() => setDeleteId(l.id)} className="text-red-500 hover:underline text-sm">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editing ? 'Edit Lesson' : 'New Lesson'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {saveError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{saveError}</div>
              )}

              {/* Teacher */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Teacher</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fTeacher} onChange={e => setFTeacher(e.target.value)}>
                  <option value="">Select teacher</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>{t.lastName} {t.firstName} ({t.short})</option>
                  ))}
                </select>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Subject</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fSubject} onChange={e => setFSubject(e.target.value)}>
                  <option value="">Select subject</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.short})</option>
                  ))}
                </select>
              </div>

              {/* Class */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Class</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fClass} onChange={e => setFClass(e.target.value)}>
                  <option value="">Select class</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.short})</option>
                  ))}
                </select>
              </div>

              {/* Lessons per week */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Lessons / Week</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fPerWeek} onChange={e => setFPerWeek(+e.target.value)}>
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? 'time' : 'times'} per week</option>
                  ))}
                </select>
              </div>

              {/* Lesson Type */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Lesson Type</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fType} onChange={e => setFType(e.target.value)}>
                  {LESSON_TYPES.map(lt => (
                    <option key={lt.value} value={lt.value}>{lt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving || !fTeacher || !fSubject || !fClass}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-gray-800 font-semibold mb-2">Remove this lesson contract?</p>
            <p className="text-xs text-gray-500 mb-4">Scheduled entries linked to this lesson will lose their lesson reference.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Remove</button>
            </div>
          </div>
        </div>
      )}
    </AuthGuard>
  )
}
