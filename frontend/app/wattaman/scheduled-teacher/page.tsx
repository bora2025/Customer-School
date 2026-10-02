'use client'

import { useState, useEffect, useRef } from 'react'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { pluginTimetableFetch } from '../../../lib/timetable-plugin-api'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  IconBarChart, IconIdCard, IconUsers, IconEdit, IconBook, IconCalendar,
} from '../../../components/Icons'

interface ScheduledTeacher {
  id: string
  timetableId: string
  timetableName: string
  timetableStatus: string
  name: string
  short: string
  sex: string | null
  color: string | null
  photo?: string | null
  qrCode: string | null
  email?: string | null
  phone?: string | null
  khmerName?: string | null
  weeklyLessons: number
  lessons: { id: string; subjectName: string; className: string; perWeek: number }[]
  todayPeriods: number[]
  totalEntries: number
}

// -- Color swatch palette ----------------------------------------------------
const COLORS = [
  '#00C9A7','#4F46E5','#EC4899','#F59E0B','#10B981',
  '#3B82F6','#EF4444','#8B5CF6','#06B6D4','#84CC16',
  '#F97316','#64748B',
]

// -- Card Preview (live) -----------------------------------------------------
function CardPreview({
  firstName, lastName, khmerName, short, color, orgName, schoolLogoUrl,
  subjects,
}: {
  firstName: string; lastName: string; khmerName: string; short: string
  color: string; orgName: string; schoolLogoUrl: string; subjects: string[]
}) {
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Teacher Name'
  const displayShort = short || 'SH'
  const displayColor = color || '#00C9A7'
  const uniqueSubjects = [...new Set(subjects)].slice(0, 3)

  return (
    <div
      style={{
        width: '85.6mm',
        height: '54mm',
        display: 'flex',
        flexDirection: 'row',
        border: `1px solid #e2e8f0`,
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#fff',
        boxSizing: 'border-box',
        fontFamily: 'Inter, Arial, sans-serif',
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
      }}
    >
      {/* Left color strip */}
      <div style={{ width: '12mm', background: displayColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '7pt', letterSpacing: '0.05em', writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
          TEACHER
        </span>
      </div>

      {/* Center info */}
      <div style={{ flex: 1, padding: '4mm 3mm', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}>
        {/* School header: logo + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', marginBottom: '1mm' }}>
          {schoolLogoUrl && (
            <img src={schoolLogoUrl} alt="School" style={{ width: '5.5mm', height: '5.5mm', objectFit: 'contain', flexShrink: 0 }} />
          )}
          {orgName && (
            <div style={{ fontSize: '6pt', color: '#64748b', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>
              {orgName}
            </div>
          )}
        </div>

        {/* Teacher name */}
        <div>
          <div style={{ fontSize: '9pt', fontWeight: 700, color: '#1e293b', lineHeight: 1.2, wordBreak: 'break-word', fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>
            {displayName}
          </div>
          {khmerName && (
            <div style={{ fontSize: '8.5pt', fontWeight: 400, color: '#374151', lineHeight: 1.3, marginTop: '0.5mm', wordBreak: 'break-word', fontFamily: '"Khmer", var(--font-khmer), sans-serif' }}>
              {khmerName}
            </div>
          )}
          <div style={{ display: 'inline-block', marginTop: '1mm', background: displayColor + '22', color: displayColor, fontWeight: 700, fontSize: '6.5pt', padding: '0.5mm 2mm', borderRadius: '3px', letterSpacing: '0.05em' }}>
            {displayShort}
          </div>
        </div>

        {/* Subjects */}
        <div style={{ marginTop: '1.5mm' }}>
          {uniqueSubjects.length > 0 ? uniqueSubjects.map((s, i) => (
            <div key={i} style={{ fontSize: '6pt', color: '#475569', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {s}</div>
          )) : (
            <div style={{ fontSize: '6pt', color: '#cbd5e1', fontStyle: 'italic' }}>No subjects assigned</div>
          )}
        </div>

        <div style={{ fontSize: '5pt', color: '#94a3b8', marginTop: '1mm' }}>Teacher ID Card</div>
      </div>

      {/* Right QR placeholder */}
      <div style={{ width: '22mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #f1f5f9', background: '#fafafa', padding: '2mm', flexShrink: 0 }}>
        <div style={{ width: '16mm', height: '16mm', background: '#e2e8f0', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            <path d="M14 14h1v1h-1zM17 14h1v1h-1zM14 17h1v1h-1zM17 17h3v3h-3z" />
          </svg>
        </div>
        <div style={{ fontSize: '4.5pt', color: '#94a3b8', marginTop: '1.5mm', textAlign: 'center', lineHeight: 1.3 }}>SCAN TO<br />CHECK IN</div>
      </div>
    </div>
  )
}

// -- Edit Modal --------------------------------------------------------------
interface EditForm {
  firstName: string
  lastName: string
  khmerName: string
  short: string
  sex: string
  email: string
  phone: string
  color: string
}

function EditModal({
  teacher, orgName, schoolLogoUrl, request, onClose, onSaved,
}: {
  teacher: ScheduledTeacher
  orgName: string
  schoolLogoUrl: string
  request: typeof apiFetch
  onClose: () => void
  onSaved: (updated: Partial<ScheduledTeacher>) => void
}) {
  const nameParts = teacher.name.split(' ')
  const [form, setForm] = useState<EditForm>({
    firstName: nameParts.slice(0, -1).join(' ') || nameParts[0],
    lastName: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
    khmerName: teacher.khmerName ?? '',
    short: teacher.short ?? '',
    sex: teacher.sex ?? '',
    email: teacher.email ?? '',
    phone: teacher.phone ?? '',
    color: teacher.color ?? '#00C9A7',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof EditForm, val: string) => setForm(f => ({ ...f, [key]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.firstName.trim() || !form.lastName.trim() || !form.short.trim()) {
      setError('First name, last name and short code are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await request(`/api/timetable/teachers/${teacher.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          khmerName: form.khmerName.trim() || null,
          short: form.short.trim(),
          sex: form.sex || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          color: form.color,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      onSaved({
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        khmerName: form.khmerName.trim() || null,
        short: form.short.trim(),
        sex: form.sex || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        color: form.color,
      })
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  const subjects = teacher.lessons.map(l => l.subjectName)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-auto overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Edit Teacher ID Card</h3>
            <p className="text-xs text-slate-400 mt-0.5">Changes preview instantly on the card</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col md:flex-row overflow-auto max-h-[80vh]">

          {/* Left: Live card preview */}
          <div className="md:w-80 flex-shrink-0 bg-slate-50 flex flex-col items-center justify-start gap-4 p-6 border-b md:border-b-0 md:border-r border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide self-start">Card Preview</p>
            {/* Scale card to fit the panel */}
            <div style={{ transform: 'scale(0.85)', transformOrigin: 'top center', width: '85.6mm' }}>
              <CardPreview
                firstName={form.firstName}
                lastName={form.lastName}
                khmerName={form.khmerName}
                short={form.short}
                color={form.color}
                orgName={orgName}
                schoolLogoUrl={schoolLogoUrl}
                subjects={subjects}
              />
            </div>
            <div className="mt-2 text-center">
              <p className="text-xs text-slate-400">85.6 × 54 mm (credit card size)</p>
            </div>
          </div>

          {/* Right: Form */}
          <form id="card-edit-form" onSubmit={handleSubmit} className="flex-1 p-6 space-y-4 overflow-y-auto">

            {/* Name */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Name</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">First Name *</label>
                  <input value={form.firstName} onChange={e => set('firstName', e.target.value)} required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="First name" />
                </div>
                <div>
                  <label className="form-label">Last Name *</label>
                  <input value={form.lastName} onChange={e => set('lastName', e.target.value)} required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Last name" />
                </div>
              </div>
            </div>

            <div>
              <label className="form-label">Khmer Name · ឈ្មោះខ្មែរ</label>
              <input
                value={form.khmerName}
                onChange={e => set('khmerName', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="ឧ. សុខ ដារ៉ា"
                style={{ fontFamily: 'var(--font-khmer), "Noto Sans Khmer", sans-serif' }}
              />
            </div>

            {/* Short + Sex */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Card Badge</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Short Code *</label>
                  <input
                    value={form.short}
                    onChange={e => set('short', e.target.value.toUpperCase())}
                    maxLength={6}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. SMITH"
                  />
                </div>
                <div>
                  <label className="form-label">Sex</label>
                  <select value={form.sex} onChange={e => set('sex', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">— unset —</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Card color */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Card Color</p>
              <div className="flex flex-wrap gap-2">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => set('color', c)}
                    className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${form.color === c ? 'border-slate-700 scale-110 ring-2 ring-slate-400 ring-offset-1' : 'border-transparent'}`}
                    style={{ background: c }}
                    title={c}
                  />
                ))}
                <label className="w-8 h-8 rounded-full border-2 border-slate-200 overflow-hidden cursor-pointer hover:scale-110 transition-all" title="Custom color">
                  <input type="color" value={form.color} onChange={e => set('color', e.target.value)} className="opacity-0 w-full h-full cursor-pointer" />
                  <div className="w-8 h-8 -mt-8 rounded-full" style={{ background: COLORS.includes(form.color) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : form.color }} />
                </label>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">Selected: <span className="font-mono">{form.color}</span></p>
            </div>

            {/* Contact */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Contact</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="teacher@school.edu" />
                </div>
                <div>
                  <label className="form-label">Phone</label>
                  <input value={form.phone} onChange={e => set('phone', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="+855..." />
                </div>
              </div>
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-400">Card updates live as you type</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-outline btn-sm">Cancel</button>
            <button type="submit" form="card-edit-form" disabled={saving} className="btn-primary btn-sm min-w-[100px]">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// -- Main content -------------------------------------------------------------
function ManageTeachersContent() {
  const pluginMode = useSearchParams().get('source') === 'plugin'
  const timetableFetch = pluginMode ? pluginTimetableFetch : apiFetch
  const [teachers, setTeachers] = useState<ScheduledTeacher[]>([])
  const [loading, setLoading] = useState(true)
  const [timetableFilter, setTimetableFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [editTeacher, setEditTeacher] = useState<ScheduledTeacher | null>(null)
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [orgName, setOrgName] = useState<string>('School')
  const [schoolLogoUrl, setSchoolLogoUrl] = useState<string>('')
  const [teacherMenuOpen, setTeacherMenuOpen] = useState(false)
  const teacherMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (teacherMenuRef.current && !teacherMenuRef.current.contains(e.target as Node))
        setTeacherMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('wattaman-org-name')
    if (saved) setOrgName(saved)
    // Fetch current study year for school name + logo
    timetableFetch('/api/study-years/current')
      .then(r => r.ok ? r.json() : null)
      .then(sy => {
        if (sy?.schoolName && !localStorage.getItem('wattaman-org-name')) setOrgName(sy.schoolName)
        if (sy?.logoUrl) setSchoolLogoUrl(sy.logoUrl)
      })
      .catch(() => {})
    fetchTeachers()
  }, [])

  const fetchTeachers = async () => {
    setLoading(true)
    try {
      const res = await timetableFetch('/api/timetable/scheduled-teachers/all')
      if (!res.ok) throw new Error()
      setTeachers(await res.json())
    } catch {
      showMsg('Failed to load teachers.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage(text)
    setMsgType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const applyEdit = (id: string, patch: Partial<ScheduledTeacher>) => {
    setTeachers(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    setEditTeacher(null)
    showMsg('Teacher updated!', 'success')
  }

  const timetables = [...new Map(teachers.map(t => [t.timetableId, { name: t.timetableName, status: t.timetableStatus }])).entries()]

  const filtered = teachers.filter(t => {
    if (timetableFilter !== 'ALL' && t.timetableId !== timetableFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        t.name.toLowerCase().includes(q) ||
        t.short.toLowerCase().includes(q) ||
        (t.email || '').toLowerCase().includes(q) ||
        (t.phone || '').toLowerCase().includes(q) ||
        t.timetableName.toLowerCase().includes(q)
      )
    }
    return true
  })

  const printCards = (ids: string[]) => {
    window.open(
      `/wattaman/scheduled-teacher/print?teacherIds=${ids.join(',')}`,
      '_blank'
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar title="Admin" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />

      <main className="flex-1 lg:ml-0">
        <div className="lg:hidden h-14" />
        <div className="page-shell">
          <div className="page-content">

            {/* Header */}
            <div className="page-header">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Manage Part Time Teacher</h1>
                <p className="text-sm font-medium mt-0.5" style={{ fontFamily: 'var(--font-khmer), "Noto Sans Khmer", sans-serif', color: '#64748b' }}>គ្រូជួលក្រៅម៉ោង</p>
                <p className="text-sm text-slate-500 mt-1">
                  {filtered.length} teacher{filtered.length !== 1 ? 's' : ''} · {timetables.length} timetable{timetables.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Toolbar */}
            <div className="mx-4 mb-1 bg-white border border-slate-200 rounded-xl shadow-sm flex items-stretch overflow-visible">

              {/* Report */}
              <button
                onClick={() => {
                  const id = timetableFilter !== 'ALL' ? timetableFilter : (timetables[0]?.[0] ?? '')
                  if (id) window.open(`/wattaman/teacher-reports?timetableId=${id}`, '_blank')
                }}
                disabled={timetables.length === 0}
                title="View attendance report"
                className="flex flex-col items-center justify-center gap-1.5 px-6 py-3 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-l-xl"
              >
                <IconBarChart size={20} />
                <span className="text-[10px] font-semibold leading-none tracking-wide uppercase">Report</span>
              </button>

              <div className="w-px bg-slate-100 my-2" />

              {/* ID Cards */}
              <button
                onClick={() => printCards(filtered.map(t => t.id))}
                disabled={filtered.length === 0}
                title="Print ID cards for visible teachers"
                className="flex flex-col items-center justify-center gap-1.5 px-6 py-3 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <IconIdCard size={20} />
                <span className="text-[10px] font-semibold leading-none tracking-wide uppercase">ID Cards</span>
              </button>

              <div className="w-px bg-slate-100 my-2" />

              {/* Teacher dropdown */}
              <div className="relative" ref={teacherMenuRef}>
                <button
                  onClick={() => setTeacherMenuOpen(v => !v)}
                  title="Teacher management options"
                  className={`flex flex-col items-center justify-center gap-1.5 px-6 py-3 transition-colors ${
                    teacherMenuOpen ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  <IconUsers size={20} />
                  <span className="text-[10px] font-semibold leading-none tracking-wide uppercase flex items-center gap-0.5">
                    Teacher
                    <svg viewBox="0 0 10 6" width="8" height="8" fill="currentColor" className="mt-px">
                      <path d="M0 0l5 6 5-6z" />
                    </svg>
                  </span>
                </button>
                {teacherMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 z-30 py-1 overflow-hidden">
                    <Link
                      href="/admin/timetable/teachers"
                      onClick={() => setTeacherMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <IconUsers size={15} />
                      List
                    </Link>
                    <button
                      onClick={() => {
                        const first = filtered[0] ?? null
                        if (first) { setEditTeacher(first) }
                        setTeacherMenuOpen(false)
                      }}
                      disabled={filtered.length === 0}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <IconEdit size={15} />
                      Edit
                    </button>
                    <div className="h-px bg-slate-100 my-1" />
                    <Link
                      href={`/admin/timetable/classes${timetableFilter !== 'ALL' ? '?timetableId=' + timetableFilter : ''}`}
                      onClick={() => setTeacherMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <IconCalendar size={15} />
                      Class
                    </Link>
                    <Link
                      href={`/admin/timetable/lessons${timetableFilter !== 'ALL' ? '?timetableId=' + timetableFilter : ''}`}
                      onClick={() => setTeacherMenuOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <IconBook size={15} />
                      Lesson
                    </Link>
                  </div>
                )}
              </div>

              <div className="w-px bg-slate-100 my-2" />

              {/* Print attendance */}
              <button
                onClick={() => {
                  const id = timetableFilter !== 'ALL' ? timetableFilter : (timetables[0]?.[0] ?? '')
                  const url = id ? `/wattaman/teacher-reports?timetableId=${id}` : '/wattaman/teacher-reports'
                  window.open(url, '_blank')
                }}
                title="Print attendance report"
                className="flex flex-col items-center justify-center gap-1.5 px-6 py-3 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors rounded-r-xl"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                <span className="text-[10px] font-semibold leading-none tracking-wide uppercase">Print</span>
              </button>

            </div>

            {/* Messages */}
            {message && (
              <div className={`mx-4 mb-4 p-3 rounded-lg text-sm font-medium ${msgType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {message}
              </div>
            )}

            <div className="page-body space-y-4">

              {/* Timetable tabs */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setTimetableFilter('ALL')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${timetableFilter === 'ALL' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'}`}
                >
                  All Timetables ({teachers.length})
                </button>
                {timetables.map(([id, { name, status }]) => (
                  <button
                    key={id}
                    onClick={() => setTimetableFilter(id)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5 ${timetableFilter === id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'}`}
                  >
                    {name} ({teachers.filter(t => t.timetableId === id).length})
                    <span className={`text-xs px-1 py-0.5 rounded ${timetableFilter === id ? 'bg-white/20 text-white' : status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {status}
                    </span>
                  </button>
                ))}
              </div>

              {/* Search + Attendance Report link */}
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, short code, email..."
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64"
                />
                {timetableFilter !== 'ALL' && (
                  <Link
                    href={`/wattaman/teacher-reports?timetableId=${timetableFilter}`}
                    className="btn-outline flex items-center gap-1 text-sm"
                  >
                    Attendance Report
                  </Link>
                )}
              </div>

              {/* Table */}
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : teachers.length === 0 ? (
                <div className="card p-12 text-center">
                  <p className="text-4xl mb-3">No teachers found</p>
                  <p className="font-semibold text-slate-600">No scheduled teachers</p>
                  <p className="text-sm text-slate-400 mt-1">Add teachers to a timetable first.</p>
                </div>
              ) : (
                <div className="card">
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Short</th>
                          <th>Timetable</th>
                          <th>Sex</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Lessons/wk</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(teacher => (
                          <tr key={teacher.id}>
                            <td>
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                  style={{ background: teacher.color || '#00C9A7' }}
                                >
                                  {teacher.short.charAt(0)}
                                </div>
                                <span className="font-medium text-slate-800">{teacher.name}</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge-gray font-mono text-xs">{teacher.short}</span>
                            </td>
                            <td className="text-slate-500">
                              <div className="flex items-center gap-1.5">
                                {teacher.timetableName}
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${teacher.timetableStatus === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {teacher.timetableStatus}
                                </span>
                              </div>
                            </td>
                            <td className="text-slate-500">
                              {teacher.sex === 'MALE' ? 'Male' : teacher.sex === 'FEMALE' ? 'Female' : '—'}
                            </td>
                            <td className="text-slate-500">{teacher.email || '—'}</td>
                            <td className="text-slate-500">{teacher.phone || '—'}</td>
                            <td className="text-slate-500">{teacher.weeklyLessons}</td>
                            <td>
                              <div className="flex gap-1">
                                <button onClick={() => setEditTeacher(teacher)} className="btn-outline btn-sm">Edit</button>
                                <button onClick={() => printCards([teacher.id])} className="btn-outline btn-sm" title="Print ID card">Print</button>
                                <Link href={`/wattaman/teacher-reports?timetableId=${teacher.timetableId}`} className="btn-outline btn-sm" title="Attendance report">Report</Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filtered.length === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center text-slate-400 py-8">No teachers match your search.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Edit Modal */}
        {editTeacher && (
          <EditModal
            teacher={editTeacher}
            orgName={orgName}
            schoolLogoUrl={schoolLogoUrl}
            request={timetableFetch}
            onClose={() => setEditTeacher(null)}
            onSaved={(patch) => applyEdit(editTeacher.id, patch)}
          />
        )}
      </main>
    </div>
  )
}

export default function ManageTeachersPage() {
  return (
    <AuthGuard requiredRole="ADMIN">
      <ManageTeachersContent />
    </AuthGuard>
  )
}
