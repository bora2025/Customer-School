"use client"

import { useState, useEffect, useMemo } from 'react'
import Sidebar from './Sidebar'
import { adminNav } from '../lib/admin-nav'
import { apiFetch } from '../lib/api'
import { useLanguage } from '../lib/i18n'

/** ---------------------------------------------------------------------------
 *  PortalManager
 *  ---------------------------------------------------------------------------
 *  Reusable admin panel for managing the users that belong to a single
 *  "portal" (Teachers, Students, or Parents). Each portal page mounts this
 *  component with a different set of `roles` plus a few labels.
 *
 *  Features:
 *    – List + role/department filter + search
 *    – Add user (name, email, password, phone, photo)
 *    – Edit user
 *    – Reset password
 *    – Delete user
 * -------------------------------------------------------------------------- */

export interface PortalUser {
  id: string
  email: string
  name: string
  phone?: string
  photo?: string
  role: string
  createdAt: string
  updatedAt?: string
  studentProfile?: {
    id?: string
    studentNumber?: string
    parentId?: string | null
    class?: { id: string; name: string } | null
    parent?: { id: string; name: string; email: string; phone: string | null } | null
  } | null
  parentStudents?: { id: string; user: { name: string } }[]
}

export interface ParentOption {
  id: string
  name: string
  email: string
  phone: string | null
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString()
}

export interface PortalManagerProps {
  /** Page title (e.g. "Teacher Portal"). */
  title: string
  /** Page subtitle. */
  subtitle?: string
  /** Roles to include in this portal. The first one is used as the default
   *  role for newly-created users. */
  roles: string[]
  /** Default role for the create form. Falls back to `roles[0]`. */
  defaultRole?: string
  /** Optional accent class for header underline / button color (Tailwind). */
  accent?: 'indigo' | 'emerald' | 'amber' | 'sky' | 'violet'
}

function normalizePhotoUrl(url: string): string {
  if (!url) return url
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/)
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`
  const m3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/)
  if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`
  return url
}

const accentBtn: Record<NonNullable<PortalManagerProps['accent']>, string> = {
  indigo: 'bg-indigo-600 hover:bg-indigo-700',
  emerald: 'bg-emerald-600 hover:bg-emerald-700',
  amber: 'bg-amber-600 hover:bg-amber-700',
  sky: 'bg-sky-600 hover:bg-sky-700',
  violet: 'bg-violet-600 hover:bg-violet-700',
}
const accentRing: Record<NonNullable<PortalManagerProps['accent']>, string> = {
  indigo: 'ring-indigo-500',
  emerald: 'ring-emerald-500',
  amber: 'ring-amber-500',
  sky: 'ring-sky-500',
  violet: 'ring-violet-500',
}

export default function PortalManager({
  title,
  subtitle,
  roles,
  defaultRole,
  accent = 'indigo',
}: PortalManagerProps) {
  const { t } = useLanguage()

  const [users, setUsers] = useState<PortalUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<string>('ALL')

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState(defaultRole || roles[0])
  const [photo, setPhoto] = useState('')

  const [editingUser, setEditingUser] = useState<PortalUser | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editPhoto, setEditPhoto] = useState('')
  const [editParentId, setEditParentId] = useState<string>('')
  const [parents, setParents] = useState<ParentOption[]>([])
  const [parentsLoaded, setParentsLoaded] = useState(false)

  const [resetUser, setResetUser] = useState<PortalUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const [deleteUser, setDeleteUser] = useState<PortalUser | null>(null)

  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')

  function showMessage(text: string, type: 'success' | 'error' = 'success') {
    setMessage(text)
    setMsgType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/auth/users?roles=${roles.join(',')}`)
      const data = await res.json()
      // Server should already filter, but be defensive.
      setUsers(Array.isArray(data) ? data.filter((u: PortalUser) => roles.includes(u.role)) : [])
    } catch (e) {
      console.error(e)
      showMessage('Failed to load users', 'error')
    }
    setLoading(false)
  }
  useEffect(() => { fetchUsers() }, [roles.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (filterRole !== 'ALL' && u.role !== filterRole) return false
      if (!q) return true
      return (
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q) ||
        u.studentProfile?.studentNumber?.toLowerCase().includes(q)
      )
    })
  }, [users, search, filterRole])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || password.length < 6) {
      showMessage('Name, email and a password (≥6 chars) are required', 'error')
      return
    }
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim(), role }),
      })
      const data = await res.json()
      if (!res.ok) {
        showMessage('Error: ' + (data.message || 'Failed to create'), 'error')
        return
      }
      // Photo + phone in follow-up calls (register doesn't accept them).
      const newId = data.user?.id
      if (newId) {
        if (photo) {
          await apiFetch(`/api/auth/users/${newId}/photo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: normalizePhotoUrl(photo) }),
          })
        }
        if (phone) {
          await apiFetch(`/api/auth/users/${newId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone }),
          })
        }
      }
      showMessage('User created', 'success')
      setName(''); setEmail(''); setPassword(''); setPhone(''); setPhoto('')
      setRole(defaultRole || roles[0])
      setShowForm(false)
      fetchUsers()
    } catch {
      showMessage('Error creating user', 'error')
    }
  }

  function openEdit(u: PortalUser) {
    setEditingUser(u)
    setEditName(u.name)
    setEditEmail(u.email)
    setEditPhone(u.phone || '')
    setEditRole(u.role)
    setEditPhoto(u.photo || '')
    setEditParentId(u.studentProfile?.parentId || '')
    if (u.role === 'STUDENT' && !parentsLoaded) {
      apiFetch('/api/classes/parents')
        .then(r => r.ok ? r.json() : [])
        .then((list: ParentOption[]) => {
          setParents(Array.isArray(list) ? list : [])
          setParentsLoaded(true)
        })
        .catch(() => setParentsLoaded(true))
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    try {
      const res = await apiFetch(`/api/auth/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, email: editEmail, phone: editPhone, role: editRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showMessage('Error: ' + (data.message || 'Failed to update'), 'error')
        return
      }
      if (editPhoto !== (editingUser.photo || '')) {
        await apiFetch(`/api/auth/users/${editingUser.id}/photo`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo: normalizePhotoUrl(editPhoto) }),
        })
      }
      if (editingUser.role === 'STUDENT') {
        const currentParentId = editingUser.studentProfile?.parentId || ''
        if (editParentId !== currentParentId) {
          const pr = await apiFetch(`/api/auth/users/${editingUser.id}/parent`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentId: editParentId || null }),
          })
          if (!pr.ok) {
            const data = await pr.json().catch(() => ({}))
            showMessage('Error: ' + (data.message || 'Failed to update parent'), 'error')
            return
          }
        }
      }
      showMessage('User updated', 'success')
      setEditingUser(null)
      fetchUsers()
    } catch {
      showMessage('Error updating user', 'error')
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!resetUser) return
    if (resetPassword.length < 6) {
      showMessage('Password must be at least 6 characters', 'error')
      return
    }
    try {
      const res = await apiFetch(`/api/auth/users/${resetUser.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showMessage('Error: ' + (data.message || 'Failed to reset password'), 'error')
        return
      }
      showMessage(`Password reset for ${resetUser.name}`, 'success')
      setResetUser(null)
      setResetPassword('')
    } catch {
      showMessage('Error resetting password', 'error')
    }
  }

  async function handleDelete() {
    if (!deleteUser) return
    try {
      const res = await apiFetch(`/api/auth/users/${deleteUser.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showMessage('Error: ' + (data.message || 'Failed to delete'), 'error')
        return
      }
      showMessage('User deleted', 'success')
      setDeleteUser(null)
      fetchUsers()
    } catch {
      showMessage('Error deleting user', 'error')
    }
  }

  function getRoleLabel(r: string) {
    return t('role.' + r.toLowerCase()) || r
  }

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor={accent} />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
            {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(s => !s)}
              className={`text-white px-4 py-2 rounded-lg text-sm font-medium ${accentBtn[accent]}`}
            >
              {showForm ? 'Cancel' : '+ Add user'}
            </button>
          </div>
        </div>

        <div className="page-body space-y-6">
          {message && (
            <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
              msgType === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
            }`}>{message}</div>
          )}

          {showForm && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Add new {title.replace(' Portal', '').toLowerCase()}</h3>
              <form onSubmit={handleCreate} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
                  {photo ? (
                    <img src={normalizePhotoUrl(photo)} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-slate-200 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center shrink-0">
                      <span className="text-lg text-slate-400">📷</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <label className="form-label">Photo URL (optional)</label>
                    <input type="url" value={photo} onChange={e => setPhoto(e.target.value)} placeholder="https://…" />
                  </div>
                  <label className="btn-outline btn-sm cursor-pointer shrink-0 self-end mb-0.5">
                    📁 Upload
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 2 * 1024 * 1024) { showMessage('Photo must be under 2MB', 'error'); return }
                      const reader = new FileReader()
                      reader.onload = () => setPhoto(reader.result as string)
                      reader.readAsDataURL(f)
                    }} />
                  </label>
                </div>
                <div>
                  <label className="form-label">Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Full name" />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="user@school.com" />
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min 6 chars" />
                </div>
                <div>
                  <label className="form-label">Phone</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
                </div>
                {roles.length > 1 && (
                  <div>
                    <label className="form-label">Role</label>
                    <select value={role} onChange={e => setRole(e.target.value)}>
                      {roles.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
                    </select>
                  </div>
                )}
                <div className="sm:col-span-2 lg:col-span-4">
                  <button type="submit" className={`text-white px-4 py-2 rounded-lg text-sm font-medium ${accentBtn[accent]}`}>
                    Create user
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, phone…"
              className="flex-1 min-w-[14rem]"
            />
            {roles.length > 1 && (
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className="w-auto">
                <option value="ALL">All roles ({users.length})</option>
                {roles.map(r => (
                  <option key={r} value={r}>
                    {getRoleLabel(r)} ({users.filter(u => u.role === r).length})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-slate-400">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                {users.length === 0 ? 'No users yet — click "+ Add user".' : 'No users match filter.'}
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      {roles.length > 1 && <th>Role</th>}
                      <th>Extra</th>
                      <th>Last updated</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.id}>
                        <td>
                          {(u.photo || u.studentProfile) ? (
                            <img
                              src={normalizePhotoUrl(u.photo || '')}
                              alt={u.name}
                              className="w-9 h-9 rounded-full object-cover bg-slate-100"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-semibold">
                              {u.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                          )}
                        </td>
                        <td className="font-medium text-slate-800">{u.name}</td>
                        <td className="text-slate-500">{u.email}</td>
                        <td className="text-slate-500">{u.phone || '—'}</td>
                        {roles.length > 1 && <td><span className="badge-blue">{getRoleLabel(u.role)}</span></td>}
                        <td className="text-xs text-slate-500">
                          {u.studentProfile?.studentNumber && <div>#{u.studentProfile.studentNumber}</div>}
                          {u.studentProfile?.class?.name && <div>{u.studentProfile.class.name}</div>}
                          {u.role === 'STUDENT' && (
                            u.studentProfile?.parent
                              ? <div className="text-emerald-600">👪 {u.studentProfile.parent.name}</div>
                              : <div className="text-amber-600">No parent linked</div>
                          )}
                          {u.parentStudents && u.parentStudents.length > 0 && (
                            <div>{u.parentStudents.length} child{u.parentStudents.length !== 1 ? 'ren' : ''}</div>
                          )}
                        </td>
                        <td className="text-xs text-slate-500 whitespace-nowrap" title={u.updatedAt ? new Date(u.updatedAt).toLocaleString() : undefined}>
                          {formatRelativeTime(u.updatedAt)}
                        </td>
                        <td className="text-right space-x-2 whitespace-nowrap">
                          <button onClick={() => openEdit(u)} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">Edit</button>
                          <button onClick={() => { setResetUser(u); setResetPassword('') }} className="text-amber-600 hover:text-amber-800 text-sm font-medium">Reset PW</button>
                          <button onClick={() => setDeleteUser(u)} className="text-red-600 hover:text-red-800 text-sm font-medium">Delete</button>
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

      {/* Edit modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingUser(null)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800">Edit user</h3>
            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div className="flex items-center gap-3">
                {editPhoto ? (
                  <img src={normalizePhotoUrl(editPhoto)} alt="" className={`w-14 h-14 rounded-full object-cover border-2 ring-2 ${accentRing[accent]}`} />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-slate-100 border-2 border-dashed border-slate-300" />
                )}
                <div className="flex-1">
                  <label className="form-label">Photo URL</label>
                  <input type="url" value={editPhoto} onChange={e => setEditPhoto(e.target.value)} />
                </div>
                <label className="btn-outline btn-sm cursor-pointer">
                  Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (f.size > 2 * 1024 * 1024) { showMessage('Photo must be under 2MB', 'error'); return }
                    const reader = new FileReader()
                    reader.onload = () => setEditPhoto(reader.result as string)
                    reader.readAsDataURL(f)
                  }} />
                </label>
              </div>
              <div>
                <label className="form-label">Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} required />
              </div>
              <div>
                <label className="form-label">Phone</label>
                <input type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
              </div>
              {roles.length > 1 && (
                <div>
                  <label className="form-label">Role</label>
                  <select value={editRole} onChange={e => setEditRole(e.target.value)}>
                    {roles.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
                  </select>
                </div>
              )}
              {editingUser?.role === 'STUDENT' && (
                <div>
                  <label className="form-label">Parent</label>
                  <select value={editParentId} onChange={e => setEditParentId(e.target.value)}>
                    <option value="">— No parent linked —</option>
                    {parents.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Don’t see the parent? Create them first in the <strong>Parent Portal</strong>.
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingUser(null)} className="btn-outline">Cancel</button>
                <button type="submit" className={`text-white px-4 py-2 rounded-lg text-sm font-medium ${accentBtn[accent]}`}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setResetUser(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-800">Reset password</h3>
            <p className="text-sm text-slate-500">
              Set a new password for <strong className="text-slate-800">{resetUser.name}</strong> ({resetUser.email}).
              Existing sessions will be revoked.
            </p>
            <form onSubmit={handleResetSubmit} className="space-y-3">
              <div>
                <label className="form-label">New password</label>
                <input
                  type="text"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Min 6 chars"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setResetUser(null)} className="btn-outline">Cancel</button>
                <button type="submit" className={`text-white px-4 py-2 rounded-lg text-sm font-medium ${accentBtn[accent]}`}>Reset password</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteUser(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-600">Delete user?</h3>
            <p className="text-sm text-slate-600">
              <strong>{deleteUser.name}</strong> ({deleteUser.email}) will be permanently removed.
              This also deletes their student profile / attendance records (if any).
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteUser(null)} className="btn-outline">Cancel</button>
              <button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
