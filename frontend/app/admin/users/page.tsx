"use client"

import { useState, useEffect } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import { frontendDistribution } from '../../../lib/navigation-registry'

interface User {
  id: string
  email: string
  name: string
  phone?: string
  photo?: string
  role: string
  createdAt: string
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SCHOOL_ADMIN: 'School Admin / Principal',
  DEPARTMENT_ADMIN: 'Department Admin',
  OFFICE_ADMIN: 'Office Admin',
  STUDENT: 'Student',
  PARENT: 'Parent',
  PRIMARY_SCHOOL_PRINCIPAL: 'នាយកសាលាបឋម',
  SECONDARY_SCHOOL_PRINCIPAL: 'នាយកសាលាអនុវិទ្យាល័យ',
  HIGH_SCHOOL_PRINCIPAL: 'នាយកសាលាវិទ្យាល័យ',
  UNIVERSITY_RECTOR: 'នាយកសាលាសាកលវិទ្យាល័យ',
  OFFICER: 'មន្ត្រី',
  STAFF: 'បុគ្គិល',
  OFFICE_HEAD: 'ប្រធានការិយាល័យ',
  DEPUTY_OFFICE_HEAD: 'អនុប្រធានការិយាល័យ',
  DEPARTMENT_HEAD: 'ប្រធាននាយកដ្ឋាន',
  DEPUTY_DEPARTMENT_HEAD: 'អនុប្រធាននាយកដ្ឋាន',
  GENERAL_DEPARTMENT_DIRECTOR: 'អគ្គនាយកដ្ឋាន',
  DEPUTY_GENERAL_DEPARTMENT_DIRECTOR: 'អគ្គរងនាយកដ្ឋាន',
  COMPANY_CEO: 'អគ្គនាយកក្រុមហ៊ុន',
  CREDIT_OFFICER: 'មន្ត្រីឥណទាន',
  SECURITY_GUARD: 'សន្តិសុខ',
  JANITOR: 'បុគ្គិលអនាម័យ',
  PROJECT_MANAGER: 'ប្រធានគម្រោង',
  BRANCH_MANAGER: 'ប្រធានសាខា',
  EXECUTIVE_DIRECTOR: 'នាយកប្រតិបត្តិ',
  HR_MANAGER: 'ប្រធានធនធានមនុស្ស',
  ATHLETE_MALE: 'កីឡាករ',
  ATHLETE_FEMALE: 'កីឡាការិនី',
  TRAINER: 'គ្រូបង្វិក',
  BARISTA: 'Barista',
  CASHIER: 'អ្នកគិតលុយ',
  RECEPTIONIST: 'អ្នកទទួលភ្ញៀវ',
  GENERAL_MANAGER: 'អ្នកគ្រប់គ្រងទូទៅ',
  WATTAMAN: 'Wattaman',
  WATTAMAN_REPORTER: 'Wattaman Reporter',
  ACCOUNTER: 'Accounter',
}

const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'badge-red',
  ADMIN: 'badge-blue',
  SCHOOL_ADMIN: 'badge-blue',
  DEPARTMENT_ADMIN: 'badge-blue',
  OFFICE_ADMIN: 'badge-blue',
  TEACHER: 'badge-green',
  STUDENT: 'badge-yellow',
  PARENT: 'badge-gray',
  WATTAMAN: 'badge-teal',
  WATTAMAN_REPORTER: 'badge-teal',
  ACCOUNTER: 'badge-purple',
}

// Roles considered admin-level for the Manage Users screen filter.
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SCHOOL_ADMIN', 'DEPARTMENT_ADMIN', 'OFFICE_ADMIN', 'WATTAMAN', 'WATTAMAN_REPORTER']

const coreDistribution = frontendDistribution() === 'core'
const allRoles = coreDistribution ? ['SUPER_ADMIN', 'ADMIN'] : Object.keys(roleLabels).filter(r => r !== 'STUDENT')

function getRoleBadgeClass(role: string) {
  return roleBadge[role] || 'badge-gray'
}

function getRoleLabel(role: string) {
  return roleLabels[role] || role
}

/** Convert Google Drive sharing URLs to direct image URLs */
function normalizePhotoUrl(url: string): string {
  if (!url) return url
  // https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const match1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (match1) return `https://lh3.googleusercontent.com/d/${match1[1]}`
  // https://drive.google.com/open?id=FILE_ID
  const match2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/)
  if (match2) return `https://lh3.googleusercontent.com/d/${match2[1]}`
  // https://drive.google.com/uc?id=FILE_ID&export=view
  const match3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/)
  if (match3) return `https://lh3.googleusercontent.com/d/${match3[1]}`
  return url
}

export default function ManageUsers() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('ADMIN')
  const [newPhoto, setNewPhoto] = useState('')
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [users, setUsers] = useState<User[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('ALL')
  const [importPreview, setImportPreview] = useState<{ name: string; email: string; password: string; role: string; photo: string }[]>([])
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  // Edit state
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editPhoto, setEditPhoto] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => { fetchUsers() }, [])

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (u?.id) setCurrentUserId(u.id) })
      .catch(() => {})
  }, [])

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/auth/users')
      const data = await res.json()
      // Show only admin/system roles here; employees are managed in /admin/employees
      const adminRoles = [...ADMIN_ROLES, 'PARENT']
      setUsers(data.filter((u: User) => adminRoles.includes(u.role)))
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text)
    setMsgType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, role }),
      })
      const data = await res.json()
      if (res.ok) {
        // Upload photo if provided
        if (newPhoto && data.user?.id) {
          await apiFetch(`/api/auth/users/${data.user.id}/photo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: normalizePhotoUrl(newPhoto) }),
          })
        }
        showMessage('User created successfully!', 'success')
        setEmail(''); setPassword(''); setName(''); setPhone(''); setNewPhoto(''); setShowForm(false)
        fetchUsers()
      } else {
        showMessage('Error: ' + data.message, 'error')
      }
    } catch (error) {
      showMessage('Error creating user', 'error')
    }
  }

  const openEditModal = (user: User) => {
    setEditingUser(user)
    setEditName(user.name)
    setEditEmail(user.email)
    setEditPhone(user.phone || '')
    setEditRole(user.role)
    setEditPhoto(user.photo || '')
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    try {
      const res = await apiFetch(`/api/auth/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, email: editEmail, phone: editPhone, role: editRole }),
      })
      if (res.ok) {
        // Update photo separately if changed
        if (editPhoto !== (editingUser.photo || '')) {
          await apiFetch(`/api/auth/users/${editingUser.id}/photo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: normalizePhotoUrl(editPhoto) }),
          })
        }
        showMessage('User updated successfully!', 'success')
        setEditingUser(null)
        fetchUsers()
      } else {
        const data = await res.json()
        showMessage('Error: ' + (data.message || 'Failed to update'), 'error')
      }
    } catch (error) {
      showMessage('Error updating user', 'error')
    }
  }

  const exportCSV = () => {
    const csv = 'Name,Email,Password,Possition,Photo\n' + users.map(u => `${u.name},${u.email},,${u.role},${u.photo || ''}`).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'users.csv'
    a.click()
  }

  const downloadTemplate = () => {
    const csv = 'Name,Email,Password,Possition,Photo\nJohn Doe,john@school.com,password123,TEACHER,https://example.com/photo.jpg\nJane Smith,jane@school.com,password123,OFFICER,'
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Bulk Staff - Template.csv'
    a.click()
  }

  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return []
    return lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim())
      return {
        name: cols[0] || '',
        email: cols[1] || '',
        password: cols[2] || 'defaultpassword',
        role: (cols[3] || 'STAFF').toUpperCase().replace(/\s+/g, '_'),
        photo: normalizePhotoUrl(cols[4] || ''),
      }
    }).filter(u => u.name && u.email)
  }

  const parseHTML = (html: string) => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const rows = Array.from(doc.querySelectorAll('table tr')).slice(1) // skip header
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent?.trim() || '')
      return {
        name: cells[0] || '',
        email: cells[1] || '',
        password: cells[2] || 'defaultpassword',
        role: (cells[3] || 'STAFF').toUpperCase().replace(/\s+/g, '_'),
        photo: normalizePhotoUrl(cells[4] || ''),
      }
    }).filter(u => u.name && u.email)
  }

  const handleFileSelect = async (f: File | null) => {
    setFile(f)
    setImportPreview([])
    setShowImportPreview(false)
    if (!f) return
    const text = await f.text()
    let parsed: typeof importPreview = []
    if (f.name.endsWith('.html') || f.name.endsWith('.htm')) {
      parsed = parseHTML(text)
    } else {
      parsed = parseCSV(text)
    }
    if (parsed.length > 0) {
      setImportPreview(parsed)
      setShowImportPreview(true)
    } else {
      showMessage('No valid data found in file. Expected columns: Name, Email, Password, Position, Photo', 'error')
    }
  }

  const handleImport = async () => {
    if (importPreview.length === 0) return
    setImporting(true)
    try {
      const res = await apiFetch('/api/auth/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: importPreview }),
      })
      if (res.ok) {
        showMessage(`${importPreview.length} users imported successfully!`, 'success')
        setImportPreview([])
        setShowImportPreview(false)
        setFile(null)
        fetchUsers()
      } else {
        showMessage('Error importing users', 'error')
      }
    } catch (error) {
      showMessage('Error importing users', 'error')
    }
    setImporting(false)
  }

  const filteredUsers = filter === 'ALL' ? users : users.filter(u => u.role === filter)
  const activeRoles = ['ALL', ...Array.from(new Set(users.map(u => u.role)))]
  const roleCounts: Record<string, number> = { ALL: users.length }
  users.forEach(u => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1 })

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await apiFetch(`/api/auth/users/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        showMessage('User deleted successfully', 'success')
        fetchUsers()
      } else {
        const data = await res.json()
        showMessage('Error: ' + (data.message || 'Failed to delete'), 'error')
      }
    } catch (error) {
      showMessage('Error deleting user', 'error')
    }
    setDeleteId(null)
  }

  return (
    <AuthGuard allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{t('users.title')}</h1>
          </div>
          <div className="flex gap-2">
            {!coreDistribution && <button onClick={() => { setShowBulk(!showBulk); setShowForm(false) }} className="btn-outline">
              {showBulk ? t('common.cancel') : t('users.importBulk')}
            </button>}
            <button onClick={() => { setShowForm(!showForm); setShowBulk(false) }} className="btn-primary">
              {showForm ? t('common.cancel') : '+ ' + t('users.addUser')}
            </button>
          </div>
        </div>

        <div className="page-body space-y-6">
          {/* Message */}
          {message && (
            <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
              msgType === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message}
            </div>
          )}

          {/* Add User Form */}
          {showForm && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Add New User</h3>
              <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-3">
                  {newPhoto ? (
                    <img src={normalizePhotoUrl(newPhoto)} alt="Preview" className="w-12 h-12 rounded-full object-cover border-2 border-slate-200 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center shrink-0">
                      <span className="text-lg text-slate-400">📷</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <label className="form-label">Photo URL</label>
                    <input type="url" value={newPhoto} onChange={(e) => setNewPhoto(e.target.value)} placeholder="https://example.com/photo.jpg" />
                  </div>
                  <label className="btn-outline btn-sm cursor-pointer shrink-0 self-end mb-0.5">
                    📁 Upload
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 2 * 1024 * 1024) { showMessage('Photo must be under 2MB', 'error'); return }
                      const reader = new FileReader()
                      reader.onload = () => setNewPhoto(reader.result as string)
                      reader.readAsDataURL(f)
                    }} />
                  </label>
                  {newPhoto && (
                    <button type="button" onClick={() => setNewPhoto('')} className="text-xs text-red-500 hover:text-red-700 self-end mb-1">Remove</button>
                  )}
                </div>
                <div>
                  <label className="form-label">Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Full name" />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="user@school.com" />
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Min 6 chars" />
                </div>
                <div>
                  <label className="form-label">Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    {allRoles.map(r => (
                      <option key={r} value={r}>{getRoleLabel(r)}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <button type="submit" className="btn-primary">Create User</button>
                </div>
              </form>
            </div>
          )}

          {/* Import / Export */}
          {showBulk && (<>
            <div className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={downloadTemplate} className="btn-primary btn-sm">
                📄 Download Template CSV
              </button>
              <button onClick={exportCSV} className="btn-outline btn-sm">
                📥 Export Users CSV
              </button>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".csv,.html,.htm"
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                  className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 file:cursor-pointer"
                />
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">Columns: Name, Email, Password, Possition, Photo (URL). Accepts CSV or HTML table.</p>
          </div>

          {/* Import Preview */}
          {showImportPreview && importPreview.length > 0 && (
            <div className="card p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Import Preview ({importPreview.length} users)</h3>
                <div className="flex gap-2">
                  <button onClick={() => { setShowImportPreview(false); setImportPreview([]); setFile(null) }} className="btn-outline btn-sm">Cancel</button>
                  <button onClick={handleImport} disabled={importing} className="btn-primary btn-sm">
                    {importing ? 'Importing...' : `📤 Import ${importPreview.length} Users`}
                  </button>
                </div>
              </div>
              <div className="table-container max-h-72 overflow-y-auto">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Photo</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Password</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.map((u, i) => (
                      <tr key={i}>
                        <td className="text-slate-400">{i + 1}</td>
                        <td>
                          {u.photo ? (
                            <img src={u.photo} alt="" className="w-8 h-8 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="font-medium text-slate-800">{u.name}</td>
                        <td className="text-slate-500">{u.email}</td>
                        <td className="text-slate-400">{'•'.repeat(Math.min(u.password.length, 8))}</td>
                        <td><span className={getRoleBadgeClass(u.role)}>{getRoleLabel(u.role)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>)}

          {/* Role Filter Tabs */}
          <div className="flex gap-1 flex-wrap">
            {activeRoles.map((r) => (
              <button
                key={r}
                onClick={() => setFilter(r)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === r
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {r === 'ALL' ? 'All' : getRoleLabel(r)} ({roleCounts[r] || 0})
              </button>
            ))}
          </div>

          {/* Users Table */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        {user.photo ? (
                          <img src={normalizePhotoUrl(user.photo)} alt={user.name} className="w-8 h-8 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <div className="avatar avatar-sm">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-slate-800">{user.name}</span>
                      </div>
                    </td>
                    <td className="text-slate-500">{user.email}</td>
                    <td className="text-slate-500">{user.phone || '—'}</td>
                    <td><span className={getRoleBadgeClass(user.role)}>{getRoleLabel(user.role)}</span></td>
                    <td className="text-slate-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(user)}
                          className="btn-outline btn-sm"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => setDeleteId(user.id)}
                          className="btn-danger btn-sm"
                          disabled={user.id === currentUserId}
                          title={user.id === currentUserId ? 'Cannot delete your own account' : undefined}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-400">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Edit User</h3>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                {editPhoto ? (
                  <img src={normalizePhotoUrl(editPhoto)} alt="User photo" className="w-12 h-12 rounded-full object-cover border-2 border-slate-200 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center shrink-0">
                    <span className="text-lg text-slate-400">📷</span>
                  </div>
                )}
                <div className="flex-1">
                  <label className="form-label">Photo URL</label>
                  <input type="url" value={editPhoto} onChange={(e) => setEditPhoto(e.target.value)} placeholder="https://example.com/photo.jpg" />
                </div>
                <label className="btn-outline btn-sm cursor-pointer shrink-0 self-end mb-0.5">
                  📁 Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (f.size > 2 * 1024 * 1024) { showMessage('Photo must be under 2MB', 'error'); return }
                    const reader = new FileReader()
                    reader.onload = () => setEditPhoto(reader.result as string)
                    reader.readAsDataURL(f)
                  }} />
                </label>
                {editPhoto && (
                  <button type="button" onClick={() => setEditPhoto('')} className="text-xs text-red-500 hover:text-red-700 self-end mb-1">Remove</button>
                )}
              </div>
              <div>
                <label className="form-label">Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required placeholder="Full name" />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required placeholder="user@school.com" />
              </div>
              <div>
                <label className="form-label">Phone</label>
                <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone number" />
              </div>
              <div>
                <label className="form-label">Role</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                  {allRoles.map(r => (
                    <option key={r} value={r}>{getRoleLabel(r)}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1">Save Changes</button>
                <button type="button" onClick={() => setEditingUser(null)} className="btn-outline flex-1">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">⚠️</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">Delete User</h3>
              <p className="text-sm text-slate-500 mb-6">Are you sure you want to delete this user? This action cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteId(null)} className="btn-outline flex-1">Cancel</button>
                <button onClick={handleDelete} className="btn-danger flex-1">Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </AuthGuard>
  )
}
