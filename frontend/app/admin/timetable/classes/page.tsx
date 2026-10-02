'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import { pluginTimetableFetch } from '../../../../lib/timetable-plugin-api'

interface TimetableListItem { id: string; name: string; academicYear: string }
interface SystemClass { id: string; name: string; studyYear?: { label?: string | null; year: number } | null }
interface TTeacher {
  id: string; lastName: string; firstName: string; short: string
  color: string | null; classTeacherId: string | null
}
interface TClass {
  id: string; name: string; short: string
  color: string | null; printSubjectPicture: boolean
}

const COLOR_PALETTE = [
  '#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6',
  '#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#64748b',
]

export default function ClassesPage() {
  const pluginMode = useSearchParams().get('source') === 'plugin'
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const router = useRouter()
  const [timetables, setTimetables] = useState<TimetableListItem[]>([])
  const [selectedTT, setSelectedTT] = useState('')
  const [classes, setClasses] = useState<TClass[]>([])
  const [teachers, setTeachers] = useState<TTeacher[]>([])
  const [loading, setLoading] = useState(false)

  // Class modal
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<TClass | null>(null)
  const [fName, setFName] = useState('')
  const [fShort, setFShort] = useState('')
  const [fColor, setFColor] = useState('#3b82f6')
  const [fPrint, setFPrint] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [systemClasses, setSystemClasses] = useState<SystemClass[]>([])
  const [systemClassesLoading, setSystemClassesLoading] = useState(false)

  // Teacher management panel
  const [managingClass, setManagingClass] = useState<TClass | null>(null)
  const [assigning, setAssigning] = useState(false)

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
      setClasses(tt.classes ?? [])
      setTeachers(tt.teachers ?? [])
    }
    setLoading(false)
  }, [selectedTT])

  useEffect(() => { fetchTimetables() }, [fetchTimetables])
  useEffect(() => { fetchData() }, [fetchData])

  function autoShort(name: string) {
    const words = name.trim().split(/\s+/)
    if (words.length === 1) return name.slice(0, 5).toUpperCase()
    return words.map(w => w[0]).join('').slice(0, 6).toUpperCase()
  }

  async function openModal(item?: TClass) {
    setEditing(item ?? null)
    setFName(item?.name ?? ''); setFShort(item?.short ?? '')
    setFColor(item?.color ?? '#3b82f6'); setFPrint(item?.printSubjectPicture ?? false)
    if (!item) {
      setSystemClassesLoading(true)
      const res = await apiFetch('/api/classes')
      if (res.ok) setSystemClasses(await res.json())
      setSystemClassesLoading(false)
    }
    setShowModal(true)
  }

  async function handleSave() {
    if (!selectedTT || !fName || !fShort) return
    setSaving(true)
    const url = editing ? `/api/timetable/classes/${editing.id}` : `/api/timetable/${selectedTT}/classes`
    await timetableFetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fName, short: fShort, color: fColor, printSubjectPicture: fPrint }),
    })
    sessionStorage.setItem('timetable_needs_refresh', '1')
    await fetchData(); setShowModal(false); setSaving(false)
  }

  async function handleDelete(id: string) {
    await timetableFetch(`/api/timetable/classes/${id}`, { method: 'DELETE' })
    sessionStorage.setItem('timetable_needs_refresh', '1')
    await fetchData(); setDeleteId(null)
    if (managingClass?.id === id) setManagingClass(null)
  }

  // Teachers assigned to the managing class
  const assignedTeachers = managingClass
    ? teachers.filter(t => t.classTeacherId === managingClass.id)
    : []
  const unassignedTeachers = managingClass
    ? teachers.filter(t => t.classTeacherId !== managingClass.id)
    : []

  async function assignTeacher(teacherId: string) {
    if (!managingClass) return
    setAssigning(true)
    await timetableFetch(`/api/timetable/teachers/${teacherId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classTeacherId: managingClass.id }),
    })
    await fetchData()
    setAssigning(false)
  }

  async function removeTeacherFromClass(teacherId: string) {
    setAssigning(true)
    await timetableFetch(`/api/timetable/teachers/${teacherId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classTeacherId: null }),
    })
    await fetchData()
    setAssigning(false)
  }

  // Count teachers per class for display
  function teacherCount(classId: string) {
    return teachers.filter(t => t.classTeacherId === classId).length
  }

  return (
    <AuthGuard allowedRoles={['ADMIN']}>
      <div className="flex h-screen bg-gray-100">
        <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div>
              <button onClick={() => router.push(pluginMode ? '/plugins/wattanam.timetable/timetables' : '/admin/timetable')} className="text-indigo-600 text-sm hover:underline mb-1">← Back to Timetable</button>
              <h1 className="text-xl font-bold text-gray-800">Classes</h1>
              <p className="text-sm text-gray-500">Manage classes and assign multiple teachers per class</p>
            </div>
            <button onClick={() => openModal()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700">+ New Class</button>
          </div>
          <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-3">
            <label className="text-sm text-gray-600 font-medium">Timetable:</label>
            <select className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={selectedTT} onChange={e => setSelectedTT(e.target.value)}>
              {timetables.map(tt => <option key={tt.id} value={tt.id}>{tt.name} · {tt.academicYear}</option>)}
            </select>
          </div>

          <div className="flex-1 overflow-hidden flex">
            {/* Class list */}
            <div className={`flex-1 overflow-auto p-6 ${managingClass ? 'hidden lg:block' : ''}`}>
              {loading ? <div className="text-gray-400 text-center py-20">Loading…</div>
                : classes.length === 0 ? (
                  <div className="text-center py-20 text-gray-400">
                    <p className="text-lg mb-2">No classes yet</p>
                    <p className="text-sm">Click "+ New Class" to add the first class.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Short</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Color</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Teachers</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
                      </tr></thead>
                      <tbody>
                        {classes.map(c => {
                          const count = teacherCount(c.id)
                          const isManaging = managingClass?.id === c.id
                          return (
                            <tr key={c.id} className={`border-b border-gray-100 transition-colors ${isManaging ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                              <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                              <td className="px-4 py-3">
                                <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white"
                                  style={{ backgroundColor: c.color ?? '#3b82f6' }}>{c.short}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-block w-5 h-5 rounded-full border border-gray-200" style={{ backgroundColor: c.color ?? '#3b82f6' }} />
                              </td>
                              <td className="px-4 py-3">
                                {count === 0 ? (
                                  <span className="text-gray-400 text-xs">No teachers</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {teachers
                                      .filter(t => t.classTeacherId === c.id)
                                      .slice(0, 4)
                                      .map(t => (
                                        <span key={t.id}
                                          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                                          style={{ backgroundColor: t.color ?? '#6366f1' }}>
                                          {t.short}
                                        </span>
                                      ))
                                    }
                                    {count > 4 && (
                                      <span className="text-xs text-gray-500 self-center">+{count - 4} more</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => setManagingClass(isManaging ? null : c)}
                                  className={`text-sm mr-3 font-medium transition-colors ${isManaging ? 'text-indigo-700 underline' : 'text-indigo-600 hover:underline'}`}>
                                  {isManaging ? 'Close panel' : `Teachers (${count})`}
                                </button>
                                <button onClick={() => openModal(c)} className="text-blue-600 hover:underline text-sm mr-3">Edit</button>
                                <button onClick={() => setDeleteId(c.id)} className="text-red-500 hover:underline text-sm">Remove</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>

            {/* Teacher management side panel */}
            {managingClass && (
              <div className="w-full lg:w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 bg-indigo-50 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-indigo-800 text-sm">Teachers — {managingClass.name}</h3>
                    <p className="text-xs text-indigo-500 mt-0.5">{assignedTeachers.length} assigned</p>
                  </div>
                  <button onClick={() => setManagingClass(null)}
                    className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* Assigned teachers */}
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                      Assigned to this class
                    </p>
                    {assignedTeachers.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4 border-2 border-dashed border-gray-100 rounded-lg">
                        No teachers assigned yet.<br/>Add from the list below.
                      </p>
                    )}
                    <div className="space-y-1">
                      {assignedTeachers.map(t => (
                        <div key={t.id}
                          className="flex items-center justify-between px-3 py-2 bg-indigo-50 rounded-lg border border-indigo-100">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: t.color ?? '#6366f1' }} />
                            <div>
                              <div className="text-sm font-medium text-gray-800 leading-tight">
                                {t.lastName} {t.firstName}
                              </div>
                              <div className="text-[10px] text-gray-500">{t.short}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => removeTeacherFromClass(t.id)}
                            disabled={assigning}
                            className="text-red-400 hover:text-red-600 text-xs font-medium disabled:opacity-40 shrink-0">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Separator */}
                  <div className="px-4 py-3">
                    <div className="border-t border-gray-100" />
                  </div>

                  {/* Unassigned teachers to add */}
                  <div className="px-4 pb-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                      Available teachers
                    </p>
                    {unassignedTeachers.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">
                        All teachers are assigned to this class.
                      </p>
                    )}
                    <div className="space-y-1">
                      {unassignedTeachers.map(t => (
                        <div key={t.id}
                          className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 hover:border-indigo-200 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: t.color ?? '#6366f1' }} />
                            <div>
                              <div className="text-sm text-gray-700 leading-tight">
                                {t.lastName} {t.firstName}
                              </div>
                              <div className="text-[10px] text-gray-400">
                                {t.short}
                                {t.classTeacherId && (
                                  <span className="ml-1 text-orange-500">
                                    (in {classes.find(c => c.id === t.classTeacherId)?.short ?? 'other class'})
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => assignTeacher(t.id)}
                            disabled={assigning}
                            className="text-indigo-600 hover:text-indigo-800 text-xs font-medium disabled:opacity-40 shrink-0">
                            + Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editing ? 'Edit Class' : 'New Class'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {!editing && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">From existing classes</label>
                  {systemClassesLoading ? (
                    <p className="text-xs text-gray-400">Loading…</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {systemClasses
                        .filter(sc => !classes.some(tc => tc.name.toLowerCase() === sc.name.toLowerCase()))
                        .map(sc => (
                          <button
                            key={sc.id}
                            type="button"
                            onClick={() => { setFName(sc.name); setFShort(autoShort(sc.name)) }}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              fName === sc.name
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-indigo-400 hover:text-indigo-700'
                            }`}
                          >
                            {sc.name}{sc.studyYear ? ` · ${sc.studyYear.label ?? sc.studyYear.year}` : ''}
                          </button>
                        ))
                      }
                      {systemClasses.filter(sc => !classes.some(tc => tc.name.toLowerCase() === sc.name.toLowerCase())).length === 0 && (
                        <p className="text-xs text-gray-400">All existing classes are already added.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Class Name</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Grade 1A" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Short Name</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fShort} onChange={e => setFShort(e.target.value)} maxLength={8} placeholder="e.g. G1A" />
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
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={fPrint} onChange={e => setFPrint(e.target.checked)} className="rounded" />
                Print subject picture on timetable
              </label>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={handleSave} disabled={saving || !fName || !fShort}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-gray-800 font-semibold mb-2">Remove this class?</p>
            <p className="text-xs text-gray-500 mb-4">All teacher assignments for this class will be cleared.</p>
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
