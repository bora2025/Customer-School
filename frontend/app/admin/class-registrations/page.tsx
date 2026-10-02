"use client"

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import ConfirmModal from '../../../components/ConfirmModal'
import { adminNav, classAdminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'

interface ClassRegistrationItem {
  id: string
  nameKh: string
  nameEn: string
  email: string | null
  phone: string | null
  generatedPassword: string | null
  photo: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectReason: string | null
  createdAt: string
  resolvedAt: string | null
  class: { id: string; name: string } | null
}

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'
type View = 'requests' | 'form'

type FieldMode = 'REQUIRED' | 'OPTIONAL' | 'HIDDEN'

interface ClassRegistrationSettings {
  khmerNameMode: FieldMode
  phoneMode: FieldMode
  emailMode: FieldMode
  photoMode: FieldMode
  passwordMode: FieldMode
  sexMode: FieldMode
  dateOfBirthMode: FieldMode
  addressMode: FieldMode
  generationMode: FieldMode
}

interface ClassRegistrationField {
  id: string
  key: string
  label: string
  fieldType: 'TEXT' | 'SELECT' | 'MULTI_SELECT'
  options: string[] | null
  required: boolean
  enabled: boolean
  order: number
}

export default function AdminClassRegistrationsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('PENDING')
  const [view, setView] = useState<View>('requests')
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})
  const isClassAdmin = typeof window !== 'undefined' && localStorage.getItem('role') === 'CLASS_ADMIN'

  const { data, isLoading } = useQuery<ClassRegistrationItem[]>({
    queryKey: ['admin-class-registrations', tab],
    queryFn: async () => {
      const qs = tab === 'ALL' ? '' : `?status=${tab}`
      const r = await apiFetch(`/api/class-registrations${qs}`)
      if (!r.ok) throw new Error('Failed to load registrations')
      return r.json()
    },
  })

  const resolveMutation = useMutation({
    mutationFn: async ({ id, action, rejectReason }: { id: string; action: 'APPROVE' | 'REJECT'; rejectReason?: string }) => {
      const r = await apiFetch(`/api/class-registrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectReason }),
      })
      if (!r.ok) {
        let msg = `Failed (${r.status})`
        try { const j = await r.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message } catch {}
        throw new Error(msg)
      }
      return r.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-class-registrations'] })
    },
    onError: (e: any, vars) => setErrorMap(m => ({ ...m, [vars.id]: e?.message ?? 'Failed' })),
  })

  const approve = (id: string) => {
    setErrorMap(m => ({ ...m, [id]: '' }))
    resolveMutation.mutate({ id, action: 'APPROVE' })
  }
  const reject = (id: string) => {
    const reason = window.prompt('Reason for rejecting (optional):') ?? undefined
    setErrorMap(m => ({ ...m, [id]: '' }))
    resolveMutation.mutate({ id, action: 'REJECT', rejectReason: reason })
  }

  return (
    <AuthGuard requiredRole="CLASS_ADMIN">
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin" subtitle="Portal" navItems={isClassAdmin ? classAdminNav : adminNav} accentColor="indigo" />
        <main className="flex-1 p-6">
          <div className="mb-4">
            <Link href="/admin" className="text-xs text-indigo-600 hover:underline">← Dashboard</Link>
            <h1 className="text-2xl font-bold text-slate-800 mt-2">Class Registrations</h1>
            <p className="text-sm text-slate-500 mt-1">Approve or reject student self-registration requests submitted from the public registration page.</p>
          </div>

          {!isClassAdmin && (
            <div className="flex gap-2 mb-4 border-b border-slate-200">
              {([{ id: 'requests', label: 'Requests' }, { id: 'form', label: 'Form Settings' }] as { id: View; label: string }[]).map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${view === v.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {view === 'form' && !isClassAdmin ? (
            <FormSettingsView />
          ) : (
          <>
          <div className="flex gap-2 mb-4">
            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs rounded-lg border ${tab === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-slate-500 text-sm">Loading…</div>
          ) : !data?.length ? (
            <div className="bg-white border border-slate-100 rounded-xl p-6 text-sm text-slate-500">No registrations.</div>
          ) : (
            <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs">
                  <tr>
                    <th className="text-left px-4 py-2">Photo</th>
                    <th className="text-left px-4 py-2">Name</th>
                    <th className="text-left px-4 py-2">Class</th>
                    <th className="text-left px-4 py-2">Email</th>
                    <th className="text-left px-4 py-2">Phone</th>
                    <th className="text-left px-4 py-2">Password</th>
                    <th className="text-left px-4 py-2">Submitted</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-right px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <div className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center text-xs font-bold text-slate-500">
                          {r.photo ? <img src={r.photo} alt={r.nameEn} className="w-full h-full object-cover" /> : r.nameEn.charAt(0).toUpperCase()}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-800">{r.nameEn}</div>
                        <div className="text-xs text-slate-500">{r.nameKh}</div>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{r.class?.name ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-700">{r.email}</td>
                      <td className="px-4 py-2 text-slate-600">{r.phone}</td>
                      <td className="px-4 py-2">
                        {r.generatedPassword ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5" title="Auto-generated — share this with the student">
                            🔑 {r.generatedPassword}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${r.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {r.status}
                        </span>
                        {r.status === 'REJECTED' && r.rejectReason && (
                          <div className="text-xs text-red-600 mt-1">{r.rejectReason}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {r.status === 'PENDING' ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => approve(r.id)}
                              disabled={resolveMutation.isPending}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1 rounded disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => reject(r.id)}
                              disabled={resolveMutation.isPending}
                              className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                        {errorMap[r.id] && <div className="text-xs text-red-600 mt-1">{errorMap[r.id]}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}

const MODE_LABELS: Record<FieldMode, string> = { REQUIRED: 'Required', OPTIONAL: 'Optional', HIDDEN: 'Hidden' }

function ModeToggle({ label, value, onChange, disableHidden }: { label: string; value: FieldMode; onChange: (m: FieldMode) => void; disableHidden?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
        {(['REQUIRED', 'OPTIONAL', 'HIDDEN'] as FieldMode[]).map(m => {
          const disabled = m === 'HIDDEN' && disableHidden && value !== 'HIDDEN'
          return (
            <button
              key={m}
              onClick={() => onChange(m)}
              disabled={disabled}
              title={disabled ? 'Email and Phone cannot both be hidden' : undefined}
              className={`px-3 py-1.5 text-xs font-medium ${value === m ? 'bg-indigo-600 text-white' : disabled ? 'bg-slate-50 text-slate-300 cursor-not-allowed' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {MODE_LABELS[m]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LockedFieldRow({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400">
        {note || 'Always required'}
      </span>
    </div>
  )
}

// "Online, Class" -> ["Online", "Class"] — trims, dedupes, drops blanks.
function parseOptions(raw: string): string[] {
  return Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)))
}

function FormSettingsView() {
  const qc = useQueryClient()
  const [newLabel, setNewLabel] = useState('')
  const [newRequired, setNewRequired] = useState(false)
  const [newFieldType, setNewFieldType] = useState<'TEXT' | 'SELECT' | 'MULTI_SELECT'>('TEXT')
  const [newOptions, setNewOptions] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ClassRegistrationField | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editFieldType, setEditFieldType] = useState<'TEXT' | 'SELECT' | 'MULTI_SELECT'>('TEXT')
  const [editOptions, setEditOptions] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const { data: settings, isLoading: settingsLoading } = useQuery<ClassRegistrationSettings>({
    queryKey: ['admin-registration-settings'],
    queryFn: async () => {
      const r = await apiFetch('/api/class-registrations/settings')
      if (!r.ok) throw new Error('Failed to load settings')
      return r.json()
    },
  })

  const { data: fields = [], isLoading: fieldsLoading } = useQuery<ClassRegistrationField[]>({
    queryKey: ['admin-registration-fields'],
    queryFn: async () => {
      const r = await apiFetch('/api/class-registrations/fields')
      if (!r.ok) throw new Error('Failed to load fields')
      return r.json()
    },
  })

  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<ClassRegistrationSettings>) => {
      const r = await apiFetch('/api/class-registrations/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) {
        let msg = 'Failed to save'
        try { const j = await r.json(); if (j?.message) msg = j.message } catch {}
        throw new Error(msg)
      }
      return r.json()
    },
    onSuccess: () => { setSettingsError(null); qc.invalidateQueries({ queryKey: ['admin-registration-settings'] }) },
    onError: (e: any) => setSettingsError(e?.message || 'Failed to save'),
  })

  const [createFieldError, setCreateFieldError] = useState<string | null>(null)

  const createField = useMutation({
    mutationFn: async () => {
      const r = await apiFetch('/api/class-registrations/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim(),
          required: newRequired,
          fieldType: newFieldType,
          options: (newFieldType === 'SELECT' || newFieldType === 'MULTI_SELECT') ? parseOptions(newOptions) : undefined,
        }),
      })
      if (!r.ok) {
        let msg = 'Failed to add field'
        try { const j = await r.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message } catch {}
        throw new Error(msg)
      }
      return r.json()
    },
    onSuccess: () => {
      setNewLabel('')
      setNewRequired(false)
      setNewFieldType('TEXT')
      setNewOptions('')
      setCreateFieldError(null)
      qc.invalidateQueries({ queryKey: ['admin-registration-fields'] })
    },
    onError: (e: any) => setCreateFieldError(e?.message || 'Failed to add field'),
  })

  const updateField = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ClassRegistrationField> }) => {
      const r = await apiFetch(`/api/class-registrations/fields/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) {
        let msg = 'Failed to save field'
        try { const j = await r.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message } catch {}
        throw new Error(msg)
      }
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-registration-fields'] }),
  })

  const startEdit = (f: ClassRegistrationField) => {
    setEditingFieldId(f.id)
    setEditLabel(f.label)
    setEditFieldType(f.fieldType)
    setEditOptions((f.options || []).join(', '))
    setEditError(null)
  }

  const saveEdit = (id: string) => {
    setEditError(null)
    updateField.mutate(
      {
        id,
        patch: {
          label: editLabel.trim(),
          fieldType: editFieldType,
          options: (editFieldType === 'SELECT' || editFieldType === 'MULTI_SELECT') ? (parseOptions(editOptions) as any) : undefined,
        },
      },
      {
        onSuccess: () => setEditingFieldId(null),
        onError: (e: any) => setEditError(e?.message || 'Failed to save field'),
      },
    )
  }

  const deleteField = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiFetch(`/api/class-registrations/fields/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to delete field')
      return r.json()
    },
    onSuccess: () => {
      setDeleteTarget(null)
      qc.invalidateQueries({ queryKey: ['admin-registration-fields'] })
    },
  })

  const reorderFields = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await apiFetch('/api/class-registrations/fields/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!r.ok) throw new Error('Failed to reorder')
      return r.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-registration-fields'] }),
  })

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= fields.length) return
    const ids = fields.map(f => f.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorderFields.mutate(ids)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Built-in fields</h2>
        <p className="text-xs text-slate-500 mb-2">Listed in the same order students see them. Class and English Name are always required to create a student's account and can't be changed. Email and Phone can each be set independently, but not both Hidden at once — a student needs at least one to log in. If Password isn't Required and a student leaves it blank, one is auto-generated — check the Requests tab to see it.</p>
        {settingsError && <div className="mb-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{settingsError}</div>}
        {settingsLoading || !settings ? (
          <div className="text-sm text-slate-400 py-4">Loading…</div>
        ) : (
          <div>
            <LockedFieldRow label="Class" />
            <ModeToggle label="Khmer Name" value={settings.khmerNameMode} onChange={(m) => updateSettings.mutate({ khmerNameMode: m })} />
            <LockedFieldRow label="English Name" />
            <ModeToggle label="Phone" value={settings.phoneMode} onChange={(m) => updateSettings.mutate({ phoneMode: m })} disableHidden={settings.emailMode === 'HIDDEN'} />
            <ModeToggle label="Email" value={settings.emailMode} onChange={(m) => updateSettings.mutate({ emailMode: m })} disableHidden={settings.phoneMode === 'HIDDEN'} />
            <ModeToggle label="Photo" value={settings.photoMode} onChange={(m) => updateSettings.mutate({ photoMode: m })} />
            <ModeToggle label="Password" value={settings.passwordMode} onChange={(m) => updateSettings.mutate({ passwordMode: m })} />
            <ModeToggle label="Sex" value={settings.sexMode} onChange={(m) => updateSettings.mutate({ sexMode: m })} />
            <ModeToggle label="Date of Birth" value={settings.dateOfBirthMode} onChange={(m) => updateSettings.mutate({ dateOfBirthMode: m })} />
            <ModeToggle label="Address" value={settings.addressMode} onChange={(m) => updateSettings.mutate({ addressMode: m })} />
            <ModeToggle label="Generation" value={settings.generationMode} onChange={(m) => updateSettings.mutate({ generationMode: m })} />
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Custom fields</h2>
        <p className="text-xs text-slate-500 mb-3">Extra fields shown on the registration form, in this order — free text or a choose box with fixed options.</p>

        {fieldsLoading ? (
          <div className="text-sm text-slate-400 py-4">Loading…</div>
        ) : fields.length === 0 ? (
          <div className="text-sm text-slate-400 py-2">No custom fields yet.</div>
        ) : (
          <ul className="space-y-2 mb-4">
            {fields.map((f, i) => (
              <li key={f.id} className="border border-slate-200 rounded-lg px-3 py-2">
                {editingFieldId === f.id ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Field label"
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                    />
                    <select
                      value={editFieldType}
                      onChange={(e) => setEditFieldType(e.target.value as 'TEXT' | 'SELECT' | 'MULTI_SELECT')}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                    >
                      <option value="TEXT">Text</option>
                      <option value="SELECT">Choose box (single)</option>
                      <option value="MULTI_SELECT">Multi-choice</option>
                    </select>
                    {(editFieldType === 'SELECT' || editFieldType === 'MULTI_SELECT') && (
                      <input
                        type="text"
                        value={editOptions}
                        onChange={(e) => setEditOptions(e.target.value)}
                        placeholder="Options, comma-separated — e.g. Online, Class"
                        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
                      />
                    )}
                    {editError && <p className="text-xs text-red-600">{editError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingFieldId(null)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600">Cancel</button>
                      <button
                        onClick={() => saveEdit(f.id)}
                        disabled={!editLabel.trim() || updateField.isPending}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-60"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs leading-none">▲</button>
                      <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 text-xs leading-none">▼</button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-slate-800">{f.label}</span>
                        {f.fieldType === 'SELECT' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Choose box</span>
                        )}
                        {f.fieldType === 'MULTI_SELECT' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">Multi-choice</span>
                        )}
                      </div>
                      {(f.fieldType === 'SELECT' || f.fieldType === 'MULTI_SELECT') && (f.options?.length ?? 0) > 0 && (
                        <p className="text-[11px] text-slate-400 mt-0.5">{f.options!.join(' · ')}</p>
                      )}
                    </div>
                    <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                      <input type="checkbox" checked={f.required} onChange={(e) => updateField.mutate({ id: f.id, patch: { required: e.target.checked } })} />
                      Required
                    </label>
                    <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                      <input type="checkbox" checked={f.enabled} onChange={(e) => updateField.mutate({ id: f.id, patch: { enabled: e.target.checked } })} />
                      Enabled
                    </label>
                    <button onClick={() => startEdit(f)} className="text-xs text-indigo-600 hover:underline shrink-0">Edit</button>
                    <button onClick={() => setDeleteTarget(f)} className="text-xs text-red-600 hover:underline shrink-0">Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); if (newLabel.trim()) createField.mutate() }}
          className="space-y-2 pt-3 border-t border-slate-100"
        >
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New field label, e.g. Course Study Mode"
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={newFieldType}
              onChange={(e) => setNewFieldType(e.target.value as 'TEXT' | 'SELECT' | 'MULTI_SELECT')}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white shrink-0"
            >
              <option value="TEXT">Text</option>
              <option value="SELECT">Choose box (single)</option>
              <option value="MULTI_SELECT">Multi-choice</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
              <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
              Required
            </label>
            <button
              type="submit"
              disabled={!newLabel.trim() || createField.isPending}
              className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-60"
            >
              + Add field
            </button>
          </div>
          {(newFieldType === 'SELECT' || newFieldType === 'MULTI_SELECT') && (
            <input
              type="text"
              value={newOptions}
              onChange={(e) => setNewOptions(e.target.value)}
              placeholder="Options, comma-separated — e.g. Online, Class"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
          )}
          {createFieldError && <p className="text-xs text-red-600">{createFieldError}</p>}
        </form>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Delete custom field?"
          message={`"${deleteTarget.label}" will be removed from the registration form. Past submissions keep their stored value.`}
          confirmLabel="Delete"
          danger
          pending={deleteField.isPending}
          onConfirm={() => deleteField.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
