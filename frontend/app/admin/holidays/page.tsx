'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch, getCurrentUser } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'

interface Holiday {
  id: string
  date: string
  name: string
  description: string | null
  type: string
  createdById: string
  createdAt: string
}

const HOLIDAY_TYPES = [
  { value: 'HOLIDAY', label: 'Public Holiday', color: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'SCHOOL_EVENT', label: 'School Event', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'CUSTOM', label: 'Custom', color: 'bg-purple-100 text-purple-700 border-purple-200' },
]

function getTypeStyle(type: string) {
  return HOLIDAY_TYPES.find(t => t.value === type)?.color || 'bg-gray-100 text-gray-700 border-gray-200'
}

function getTypeLabel(type: string) {
  return HOLIDAY_TYPES.find(t => t.value === type)?.label || type
}

/** Format date as YYYY-MM-DD */
function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Get Cambodia date (GMT+7) */
function getCambodiaDate(): Date {
  const now = new Date()
  const utc = now.getTime() + now.getTimezoneOffset() * 60000
  return new Date(utc + 7 * 3600000)
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function HolidaysPage() {
  const { t } = useLanguage()
  const cambodiaToday = getCambodiaDate()
  const [currentYear, setCurrentYear] = useState(cambodiaToday.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(cambodiaToday.getMonth())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null)
  const [formDate, setFormDate] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formType, setFormType] = useState('HOLIDAY')
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const fetchHolidays = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/holidays?year=${currentYear}&month=${currentMonth + 1}`)
      if (res.ok) {
        const data = await res.json()
        setHolidays(data)
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }, [currentYear, currentMonth])

  useEffect(() => { fetchHolidays() }, [fetchHolidays])

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(y => y - 1)
    } else {
      setCurrentMonth(m => m - 1)
    }
  }

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(y => y + 1)
    } else {
      setCurrentMonth(m => m + 1)
    }
  }

  const goToday = () => {
    const today = getCambodiaDate()
    setCurrentYear(today.getFullYear())
    setCurrentMonth(today.getMonth())
  }

  /** Open modal for adding holiday on a specific date */
  const openAddModal = (dateStr: string) => {
    setEditingHoliday(null)
    setFormDate(dateStr)
    setFormName('')
    setFormDescription('')
    setFormType('HOLIDAY')
    setShowModal(true)
  }

  /** Open modal for editing */
  const openEditModal = (h: Holiday) => {
    setEditingHoliday(h)
    setFormDate(h.date.split('T')[0])
    setFormName(h.name)
    setFormDescription(h.description || '')
    setFormType(h.type)
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!formDate || !formName.trim()) return
    setSaving(true)
    try {
      if (editingHoliday) {
        await apiFetch(`/api/holidays/${editingHoliday.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: formDate, name: formName, description: formDescription || null, type: formType }),
        })
      } else {
        // Get user ID from the auth endpoint
        let createdById = 'unknown'
        const user = await getCurrentUser()
        if (user) createdById = user.userId
        await apiFetch('/api/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: formDate, name: formName, description: formDescription || null, type: formType, createdById }),
        })
      }
      setShowModal(false)
      fetchHolidays()
    } catch {
      // ignore
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/holidays/${id}`, { method: 'DELETE' })
      setDeleteId(null)
      fetchHolidays()
    } catch { /* ignore */ }
  }

  // Calendar data
  const daysInMonth = getDaysInMonth(currentYear, currentMonth)
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth)
  const todayStr = toDateStr(cambodiaToday)

  /** Map date string → holidays for quick lookup */
  const holidayMap = new Map<string, Holiday[]>()
  holidays.forEach(h => {
    const ds = h.date.split('T')[0]
    if (!holidayMap.has(ds)) holidayMap.set(ds, [])
    holidayMap.get(ds)!.push(h)
  })

  // Build calendar grid cells
  const cells: { day: number; dateStr: string }[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(currentMonth + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    cells.push({ day: d, dateStr: `${currentYear}-${mm}-${dd}` })
  }

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <div className="page-content lg:ml-0">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <h1 className="text-2xl font-bold text-slate-800">{t('holidays.title')}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {t('holidays.subtitle')}
            </p>
          </div>

          <div className="page-body space-y-6">
            {/* Month Navigation */}
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <button onClick={prevMonth} className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium">
                  ← {t('common.previous')}
                </button>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-slate-800">
                    {MONTH_NAMES[currentMonth]} {currentYear}
                  </h2>
                  <button onClick={goToday} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md font-medium hover:bg-indigo-100 transition">
                    {t('common.today')}
                  </button>
                </div>
                <button onClick={nextMonth} className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium">
                  {t('common.next')} →
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="card overflow-hidden">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {DAY_NAMES.map(d => (
                  <div key={d} className="p-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar days */}
              <div className="grid grid-cols-7">
                {/* Empty cells for days before the 1st */}
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-slate-100 bg-slate-50/50" />
                ))}

                {cells.map(({ day, dateStr }) => {
                  const isToday = dateStr === todayStr
                  const dayHolidays = holidayMap.get(dateStr) || []
                  const isSunday = new Date(currentYear, currentMonth, day).getDay() === 0
                  const isSaturday = new Date(currentYear, currentMonth, day).getDay() === 6

                  return (
                    <div
                      key={dateStr}
                      className={`min-h-[80px] border-b border-r border-slate-100 p-1.5 cursor-pointer transition group hover:bg-indigo-50/50 ${
                        isToday ? 'bg-indigo-50/70' : dayHolidays.length > 0 ? 'bg-red-50/50' : ''
                      }`}
                      onClick={() => openAddModal(dateStr)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                            isToday
                              ? 'bg-indigo-600 text-white'
                              : isSunday
                              ? 'text-red-500'
                              : isSaturday
                              ? 'text-orange-500'
                              : 'text-slate-700'
                          }`}
                        >
                          {day}
                        </span>
                        <span className="opacity-0 group-hover:opacity-100 text-xs text-indigo-500 transition">+ Add</span>
                      </div>
                      {dayHolidays.map(h => (
                        <div
                          key={h.id}
                          className={`text-xs px-1.5 py-0.5 rounded mb-0.5 truncate border cursor-pointer ${getTypeStyle(h.type)}`}
                          onClick={(e) => { e.stopPropagation(); openEditModal(h) }}
                          title={h.description || h.name}
                        >
                          {h.name}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Holiday List */}
            <div className="card">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">
                  Holidays in {MONTH_NAMES[currentMonth]} {currentYear}
                  <span className="text-sm font-normal text-slate-400 ml-2">({holidays.length})</span>
                </h3>
                <button
                  onClick={() => openAddModal(toDateStr(getCambodiaDate()))}
                  className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition flex items-center gap-1"
                >
                  + {t('holidays.addHoliday')}
                </button>
              </div>
              {loading ? (
                <div className="p-8 text-center text-slate-400">Loading...</div>
              ) : holidays.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <div className="text-3xl mb-2">🎉</div>
                  <p>No holidays this month. Click a date on the calendar or press &quot;+ Add Holiday&quot; to add one.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {holidays.map(h => (
                    <div key={h.id} className="p-4 flex items-center gap-4 hover:bg-slate-50 transition">
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-slate-100 flex flex-col items-center justify-center">
                        <span className="text-xs font-medium text-slate-400">
                          {new Date(h.date).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })}
                        </span>
                        <span className="text-lg font-bold text-slate-700 leading-tight">
                          {new Date(h.date).getUTCDate()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{h.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${getTypeStyle(h.type)}`}>
                            {getTypeLabel(h.type)}
                          </span>
                        </div>
                        {h.description && (
                          <p className="text-sm text-slate-500 mt-0.5 truncate">{h.description}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(h.date).toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => openEditModal(h)}
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50 transition"
                        >
                          {t('common.edit')}
                        </button>
                        {deleteId === h.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(h.id)}
                              className="text-sm text-red-600 font-medium px-2 py-1 rounded bg-red-50 hover:bg-red-100 transition"
                            >
                              {t('common.confirm')}
                            </button>
                            <button
                              onClick={() => setDeleteId(null)}
                              className="text-sm text-slate-500 font-medium px-2 py-1 rounded hover:bg-slate-100 transition"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(h.id)}
                            className="text-sm text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Add/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4">
                {editingHoliday ? t('holidays.editHoliday') : t('holidays.addHoliday')}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{t('common.date')}</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{t('holidays.holidayName')}</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="e.g., Khmer New Year"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{t('common.description')}</label>
                  <textarea
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                    rows={2}
                    placeholder="Add details about this holiday..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">{t('common.type')}</label>
                  <div className="flex flex-wrap gap-2">
                    {HOLIDAY_TYPES.map(t => (
                      <button
                        key={t.value}
                        onClick={() => setFormType(t.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                          formType === t.value
                            ? t.color + ' ring-2 ring-offset-1 ring-indigo-400'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formDate || !formName.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t('common.loading') : editingHoliday ? t('common.save') : t('holidays.saveHoliday')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthGuard>
  )
}
