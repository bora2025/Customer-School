'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import { pluginTimetableFetch } from '../../../../lib/timetable-plugin-api'

interface TimetableListItem { id: string; name: string; academicYear: string }
interface TClass { id: string; name: string; short: string }
interface TLesson {
  id: string; perWeek: number; lessonType: string
  teacherId: string; subjectId: string; classId: string
  teacher: { lastName: string; firstName: string; short: string; color: string | null }
  subject: { name: string; short: string; color: string | null }
  class: { name: string; short: string; color: string | null }
}
interface TTeacher {
  id: string; lastName: string; firstName: string; khmerName?: string | null; short: string
  sex: string | null; email: string | null; phone: string | null; photo?: string | null
  color: string | null; classTeacherId: string | null
  classTeacher: TClass | null
  lessons?: TLesson[]
}

const COLOR_PALETTE = [
  '#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6',
  '#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#22d3ee',
]
const LESSON_TYPES = ['SINGLE','DOUBLE','TRIPLE']

export default function TeachersPage() {
  const pluginMode = useSearchParams().get('source') === 'plugin'
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const router = useRouter()
  const [timetables, setTimetables] = useState<TimetableListItem[]>([])
  const [selectedTT, setSelectedTT] = useState('')
  const [teachers, setTeachers] = useState<TTeacher[]>([])
  const [classes, setClasses] = useState<TClass[]>([])
  const [allLessons, setAllLessons] = useState<TLesson[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTeacher, setSelectedTeacher] = useState<TTeacher | null>(null)

  // Teacher modal
  const [showTeacherModal, setShowTeacherModal] = useState(false)
  const [editingTeacher, setEditingTeacher] = useState<TTeacher | null>(null)
  const [fFullName, setFFullName] = useState('')
  const [fKhmerName, setFKhmerName] = useState('')
  const [fShort, setFShort] = useState('')
  const [fSex, setFSex] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fColor, setFColor] = useState('#22c55e')
  const [fPhoto, setFPhoto] = useState('')
  const [fClassTeacher, setFClassTeacher] = useState('')
  const [savingTeacher, setSavingTeacher] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [deleteTeacherId, setDeleteTeacherId] = useState<string | null>(null)

  // System teachers from app database
  const [systemTeachers, setSystemTeachers] = useState<{id: string; name: string; email: string | null; phone: string | null}[]>([])
  const [systemTeachersLoading, setSystemTeachersLoading] = useState(false)

  // Lesson modal
  const [showLessonModal, setShowLessonModal] = useState(false)
  const [editingLesson, setEditingLesson] = useState<TLesson | null>(null)
  const [allSubjects, setAllSubjects] = useState<{id: string; name: string; short: string}[]>([])
  const [fLTeacher, setFLTeacher] = useState('')
  const [fLSubject, setFLSubject] = useState('')
  const [fLClass, setFLClass] = useState('')
  const [fLPerWeek, setFLPerWeek] = useState(2)
  const [fLType, setFLType] = useState('SINGLE')
  const [savingLesson, setSavingLesson] = useState(false)
  const [deleteLessonId, setDeleteLessonId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const res = await timetableFetch('/api/timetable')
    if (res.ok) {
      const list = await res.json()
      setTimetables(list)
      if (list.length > 0 && !selectedTT) setSelectedTT(list[0].id)
    }
  }, [selectedTT])

  const fetchTimetableData = useCallback(async () => {
    if (!selectedTT) return
    setLoading(true)
    const res = await timetableFetch(`/api/timetable/${selectedTT}`)
    if (res.ok) {
      const tt = await res.json()
      setTeachers(tt.teachers ?? [])
      setClasses(tt.classes ?? [])
      setAllSubjects(tt.subjects ?? [])
      setAllLessons(tt.lessons ?? [])
    }
    setLoading(false)
  }, [selectedTT])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { fetchTimetableData() }, [fetchTimetableData])

  function openTeacherModal(item?: TTeacher) {
    setEditingTeacher(item ?? null)
    setFFullName(item ? `${item.firstName}${item.lastName ? ' ' + item.lastName : ''}` : '')
    setFKhmerName(item?.khmerName ?? '')
    setFShort(item?.short ?? ''); setFSex(item?.sex ?? '')
    setFEmail(item?.email ?? ''); setFPhone(item?.phone ?? '')
    setFColor(item?.color ?? '#22c55e'); setFClassTeacher(item?.classTeacherId ?? '')
    setFPhoto(item?.photo ?? '')
    setTeacherError('')
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

  async function saveTeacher() {
    if (!selectedTT || !fFullName || !fShort) return
    setSavingTeacher(true)
    setTeacherError('')
    const nameParts = fFullName.trim().split(/\s+/)
    const firstName = nameParts[0] ?? ''
    const lastName = nameParts.slice(1).join(' ')
    const url = editingTeacher ? `/api/timetable/teachers/${editingTeacher.id}` : `/api/timetable/${selectedTT}/teachers`
    const res = await timetableFetch(url, {
      method: editingTeacher ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lastName, firstName, khmerName: fKhmerName.trim() || null, short: fShort,
        sex: fSex || null, email: fEmail || null, phone: fPhone || null,        photo: fPhoto.trim() || null,        color: fColor, classTeacherId: fClassTeacher || null,
      }),
    })
    if (res.ok) {
      sessionStorage.setItem('timetable_needs_refresh', '1')
      await fetchTimetableData(); setShowTeacherModal(false)
    } else {
      const err = await res.json().catch(() => ({}))
      const reason = Array.isArray(err?.message) ? err.message[0] : (err?.message ?? `Error ${res.status}`)
      setTeacherError(reason)
    }
    setSavingTeacher(false)
  }

  async function deleteTeacher(id: string) {
    await timetableFetch(`/api/timetable/teachers/${id}`, { method: 'DELETE' })
    sessionStorage.setItem('timetable_needs_refresh', '1')
    await fetchTimetableData(); setDeleteTeacherId(null); setSelectedTeacher(null)
  }

  function openLessonModal(item?: TLesson, teacherId?: string) {
    setEditingLesson(item ?? null)
    setFLTeacher(item?.teacherId ?? teacherId ?? '')
    setFLSubject(item?.subjectId ?? '')
    setFLClass(item?.classId ?? '')
    setFLPerWeek(item?.perWeek ?? 2); setFLType(item?.lessonType ?? 'SINGLE')
    setShowLessonModal(true)
  }

  async function saveLesson() {
    if (!selectedTT || !fLTeacher || !fLSubject || !fLClass) return
    setSavingLesson(true)
    const url = editingLesson ? `/api/timetable/lessons/${editingLesson.id}` : `/api/timetable/${selectedTT}/lessons`
    await timetableFetch(url, {
      method: editingLesson ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId: fLTeacher, subjectId: fLSubject, classId: fLClass, perWeek: fLPerWeek, lessonType: fLType }),
    })
    sessionStorage.setItem('timetable_needs_refresh', '1')
    await fetchTimetableData(); setShowLessonModal(false); setSavingLesson(false)
  }

  async function deleteLesson(id: string) {
    await timetableFetch(`/api/timetable/lessons/${id}`, { method: 'DELETE' })
    sessionStorage.setItem('timetable_needs_refresh', '1')
    await fetchTimetableData(); setDeleteLessonId(null)
  }

  const teacherLessons = allLessons.filter(l => l.teacherId === selectedTeacher?.id)

  return (
    <AuthGuard allowedRoles={['ADMIN']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-100 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div>
              <button onClick={() => router.push(pluginMode ? '/plugins/wattanam.timetable/timetables' : '/admin/timetable')} className="text-indigo-600 text-sm hover:underline mb-1">← Back to Timetable</button>
              <h1 className="text-xl font-bold text-gray-800">Teachers</h1>
              <p className="text-sm text-gray-500">Manage timetable teachers and their lesson contracts</p>
            </div>
            <button onClick={() => openTeacherModal()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">+ New Teacher</button>
          </div>
          <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-3">
            <label className="text-sm text-gray-600 font-medium">Timetable:</label>
            <select className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={selectedTT} onChange={e => setSelectedTT(e.target.value)}>
              {timetables.map(tt => <option key={tt.id} value={tt.id}>{tt.name} · {tt.academicYear}</option>)}
            </select>
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 ml-2">
              Timetable teachers are separate from the school's main teacher accounts
            </span>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {loading ? <div className="text-gray-400 text-center py-20">Loading…</div>
              : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Teacher list */}
                  <div className="lg:col-span-2">
                    {teachers.length === 0 ? (
                      <div className="text-center py-20 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                        <p className="text-lg mb-2">No teachers yet</p>
                        <p className="text-sm">Click "+ New Teacher" to add one.</p>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600">Short</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600">Contact</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600">Class Teacher</th>
                            <th className="px-4 py-3 text-center font-semibold text-gray-600">Lessons</th>
                            <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                          </tr></thead>
                          <tbody>
                            {teachers.map(t => (
                              <tr key={t.id}
                                className={`border-b border-gray-100 cursor-pointer ${selectedTeacher?.id === t.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                                onClick={() => setSelectedTeacher(t)}>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {t.photo ? (
                                      <img src={t.photo} alt={t.firstName} className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-gray-200" onError={e => { e.currentTarget.style.display = 'none' }} />
                                    ) : (
                                      <span className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: t.color ?? '#22c55e' }}>
                                        {(t.firstName?.[0] ?? '').toUpperCase()}
                                      </span>
                                    )}
                                    <span className="font-medium text-gray-800">{[t.firstName, t.lastName].filter(Boolean).join(' ')}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white"
                                    style={{ backgroundColor: t.color ?? '#22c55e' }}>{t.short}</span>
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs">
                                  {t.email && <div>{t.email}</div>}
                                  {t.phone && <div>{t.phone}</div>}
                                </td>
                                <td className="px-4 py-3 text-gray-600 text-sm">
                                  {t.classTeacher?.short ?? '—'}
                                </td>
                                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                  {(() => {
                                    const cnt = allLessons.filter(l => l.teacherId === t.id).length
                                    return cnt > 0
                                      ? <button onClick={() => setSelectedTeacher(t)}
                                          className="bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full px-2.5 py-0.5 hover:bg-emerald-200">
                                          {cnt} lesson{cnt !== 1 ? 's' : ''}
                                        </button>
                                      : <span className="text-gray-300 text-xs">none</span>
                                  })()}
                                </td>
                                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                  <button onClick={() => openTeacherModal(t)} className="text-blue-600 hover:underline text-sm mr-2">Edit</button>
                                  <button onClick={() => { setSelectedTeacher(t); openLessonModal(undefined, t.id) }} className="text-emerald-600 hover:underline text-sm mr-2">+ Lesson</button>
                                  <button onClick={() => setDeleteTeacherId(t.id)} className="text-red-500 hover:underline text-sm">Remove</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Lesson contracts panel */}
                  <div className="bg-white rounded-xl border border-gray-200 flex flex-col">
                    <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-700 text-sm">
                        {selectedTeacher ? `${[selectedTeacher.firstName, selectedTeacher.lastName].filter(Boolean).join(' ')} — Lessons` : 'Select a teacher'}
                      </h3>
                      {selectedTeacher && (
                        <button onClick={() => openLessonModal(undefined, selectedTeacher.id)}
                          className="text-xs bg-indigo-600 text-white px-2 py-1 rounded font-medium">+ New Lesson</button>
                      )}
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                      {!selectedTeacher ? (
                        <p className="text-gray-400 text-xs text-center mt-8">Click a teacher row to see their lesson contracts</p>
                      ) : teacherLessons.length === 0 ? (
                        <div className="text-center mt-8">
                          <p className="text-gray-400 text-xs mb-3">No lesson contracts yet</p>
                          <button onClick={() => openLessonModal(undefined, selectedTeacher.id)}
                            className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded font-medium hover:bg-indigo-700">
                            + Add First Lesson
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {teacherLessons.map(l => (
                            <div key={l.id} className="border border-gray-200 rounded-lg p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white flex-shrink-0"
                                      style={{ backgroundColor: l.subject.color ?? '#6366f1' }}>{l.subject.short}</span>
                                    <span className="text-sm text-gray-800 truncate">{l.subject.name}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white flex-shrink-0"
                                      style={{ backgroundColor: l.class.color ?? '#f97316' }}>{l.class.short}</span>
                                    <span className="text-sm text-gray-600">{l.class.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2 pt-0.5">
                                    <span className="bg-indigo-50 text-indigo-700 text-[10px] font-semibold rounded px-1.5 py-0.5">
                                      {l.perWeek}×/week
                                    </span>
                                    <span className="text-gray-400 text-[10px] capitalize">{l.lessonType.toLowerCase()}</span>
                                  </div>
                                </div>
                                <div className="flex flex-col gap-1 flex-shrink-0">
                                  <button onClick={() => openLessonModal(l)}
                                    className="text-xs text-blue-600 hover:underline text-right">Edit</button>
                                  <button onClick={() => setDeleteLessonId(l.id)}
                                    className="text-xs text-red-500 hover:underline text-right">Remove</button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-3 border-t border-gray-200">
                      <button onClick={() => router.push('/admin/timetable/teacher-attendance')}
                        className="w-full text-sm text-indigo-600 hover:underline">
                        → Teacher Attendance Report
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Teacher modal */}
      {showTeacherModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editingTeacher ? 'Edit Teacher' : 'New Teacher'}</h2>
              <button onClick={() => setShowTeacherModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {!editingTeacher && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">From existing teachers</label>
                  {systemTeachersLoading ? (
                    <p className="text-xs text-gray-400">Loading…</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {systemTeachers
                        .filter(st => !teachers.some(tt => tt.email && tt.email === st.email))
                        .map(st => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              setFFullName(st.name)
                              const nameParts = st.name.trim().split(/\s+/)
                              const initials = nameParts.length === 1
                                ? st.name.slice(0, 5).toUpperCase()
                                : nameParts.map((w: string) => w[0]).join('').slice(0, 6).toUpperCase()
                              setFShort(initials)
                              setFEmail(st.email ?? '')
                              setFPhone(st.phone ?? '')
                            }}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              fEmail === st.email && st.email
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-emerald-400 hover:text-emerald-700'
                            }`}
                          >
                            {st.name}
                          </button>
                        ))
                      }
                      {!systemTeachersLoading && systemTeachers.filter(st => !teachers.some(tt => tt.email && tt.email === st.email)).length === 0 && (
                        <p className="text-xs text-gray-400">All existing teachers are already added, or no teachers found in the system.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }}
                  value={fFullName} onChange={e => setFFullName(e.target.value)} placeholder="e.g. John Smith" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Khmer Name · ឈ្មោះខ្មែរ</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fKhmerName}
                  onChange={e => setFKhmerName(e.target.value)}
                  placeholder="ឧ. សុខ ដារ៉ា"
                  style={{ fontFamily: '"Khmer", var(--font-khmer), sans-serif' }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Short Name</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  style={{ fontFamily: '"Khmer", Inter, Arial, sans-serif' }}
                  value={fShort} onChange={e => setFShort(e.target.value)} maxLength={8} placeholder="e.g. SmithJ" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Sex</label>
                <div className="flex gap-4">
                  {['MALE','FEMALE'].map(s => (
                    <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="teacher-sex" value={s} checked={fSex === s} onChange={() => setFSex(s)} />
                      {s === 'MALE' ? 'Male' : 'Female'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">E-mail</label>
                  <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={fEmail} onChange={e => setFEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={fPhone} onChange={e => setFPhone(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Class Teacher for</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fClassTeacher} onChange={e => setFClassTeacher(e.target.value)}>
                  <option value="">— None —</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Color</label>
                <div className="flex flex-wrap gap-2 items-center">
                  {COLOR_PALETTE.map(c => (
                    <button key={c} type="button" onClick={() => setFColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${fColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={fColor} onChange={e => setFColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Photo URL <span className="font-normal text-gray-400">(optional)</span></label>
                <div className="flex items-center gap-3">
                  <input
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={fPhoto}
                    onChange={e => setFPhoto(e.target.value)}
                    placeholder="https://..."
                  />
                  {fPhoto ? (
                    <img
                      src={fPhoto}
                      alt="preview"
                      className="w-14 h-14 rounded-full object-cover border-2 border-gray-200 flex-shrink-0"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xl font-bold"
                      style={{ backgroundColor: fColor }}>
                      {(fFullName?.[0] ?? '?').toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex flex-col gap-2">
              {teacherError && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                  ⚠️ {teacherError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowTeacherModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">Cancel</button>
                <button onClick={saveTeacher} disabled={savingTeacher || !fFullName || !fShort}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
                  {savingTeacher ? 'Saving…' : 'OK'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lesson modal */}
      {showLessonModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editingLesson ? 'Edit Lesson' : 'New Lesson'}</h2>
              <button onClick={() => setShowLessonModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {[
                { label: 'Teacher', val: fLTeacher, set: setFLTeacher, opts: teachers.map(t => ({ id: t.id, name: [t.firstName, t.lastName].filter(Boolean).join(' ') })) },
                { label: 'Subject', val: fLSubject, set: setFLSubject, opts: allSubjects.map(s => ({ id: s.id, name: s.name })) },
                { label: 'Class', val: fLClass, set: setFLClass, opts: classes.map(c => ({ id: c.id, name: c.name })) },
              ].map(({ label, val, set, opts }) => (
                <div key={label}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={val} onChange={e => set(e.target.value)}>
                    <option value="">Select {label.toLowerCase()}</option>
                    {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Lessons / Week</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fLPerWeek} onChange={e => setFLPerWeek(+e.target.value)}>
                  {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} per week</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fLType} onChange={e => setFLType(e.target.value)}>
                  {LESSON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowLessonModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={saveLesson} disabled={savingLesson || !fLTeacher || !fLSubject || !fLClass}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40">
                {savingLesson ? 'Saving…' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirms */}
      {deleteTeacherId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-gray-800 font-semibold mb-4">Remove this teacher? Their lesson contracts will also be removed.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteTeacherId(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => deleteTeacher(deleteTeacherId)} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete lesson confirm */}
      {deleteLessonId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-gray-800 font-semibold mb-2">Remove this lesson contract?</p>
            <p className="text-xs text-gray-500 mb-4">Scheduled entries linked to this lesson will lose their lesson reference.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteLessonId(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => deleteLesson(deleteLessonId)} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Remove</button>
            </div>
          </div>
        </div>
      )}
    </AuthGuard>
  )
}
