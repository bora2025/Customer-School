"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Sidebar from '../../../components/Sidebar'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'

interface Department {
  id: string
  name: string
  nameKh?: string
  description?: string
  _count?: { users: number }
}

interface User {
  id: string
  email: string
  name: string
  phone?: string
  photo?: string
  role: string
  departmentId?: string
  department?: { id: string; name: string; nameKh?: string }
  createdAt: string
}

// Roles that should NEVER appear on the "Manage Officers" page.
// Admin-tier accounts are managed from the dedicated Admins page.
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SCHOOL_ADMIN', 'WATTAMAN', 'STUDENT', 'PARENT']

const EMPLOYEE_ROLES = [
  'TEACHER','PRIMARY_SCHOOL_PRINCIPAL','SECONDARY_SCHOOL_PRINCIPAL','HIGH_SCHOOL_PRINCIPAL',
  'UNIVERSITY_RECTOR','OFFICER','STAFF','OFFICE_HEAD','DEPUTY_OFFICE_HEAD','DEPARTMENT_HEAD',
  'DEPUTY_DEPARTMENT_HEAD','GENERAL_DEPARTMENT_DIRECTOR','DEPUTY_GENERAL_DEPARTMENT_DIRECTOR',
  'COMPANY_CEO','CREDIT_OFFICER','SECURITY_GUARD','JANITOR','PROJECT_MANAGER','BRANCH_MANAGER',
  'EXECUTIVE_DIRECTOR','HR_MANAGER','ATHLETE_MALE','ATHLETE_FEMALE','TRAINER','BARISTA',
  'CASHIER','RECEPTIONIST','GENERAL_MANAGER','CLASS_ADMIN',
]

const employeeRoles = EMPLOYEE_ROLES

function normalizePhotoUrl(url: string): string {
  if (!url) return url
  const match1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (match1) return `https://lh3.googleusercontent.com/d/${match1[1]}`
  const match2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/)
  if (match2) return `https://lh3.googleusercontent.com/d/${match2[1]}`
  const match3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/)
  if (match3) return `https://lh3.googleusercontent.com/d/${match3[1]}`
  return url
}

export default function ManageEmployees() {
  const { t } = useLanguage()
  const getRoleLabel = (role: string) => t('role.' + role.toLowerCase()) || role
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [filter, setFilter] = useState('ALL')
  const [deptFilter, setDeptFilter] = useState('ALL')
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [search, setSearch] = useState('')
  const [activeSection, setActiveSection] = useState<'employees' | 'departments'>('employees')

  // Create form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('OFFICER')
  const [customRole, setCustomRole] = useState('')
  const [photo, setPhoto] = useState('')
  const [departmentId, setDepartmentId] = useState('')

  // Edit state
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRole, setEditRole] = useState('')
  const [editCustomRole, setEditCustomRole] = useState('')
  const [editPhoto, setEditPhoto] = useState('')
  const [editDepartmentId, setEditDepartmentId] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Department form state
  const [showDeptForm, setShowDeptForm] = useState(false)
  const [deptName, setDeptName] = useState('')
  const [deptNameKh, setDeptNameKh] = useState('')
  const [deptDescription, setDeptDescription] = useState('')
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [editDeptName, setEditDeptName] = useState('')
  const [editDeptNameKh, setEditDeptNameKh] = useState('')
  const [editDeptDescription, setEditDeptDescription] = useState('')
  const [deleteDeptId, setDeleteDeptId] = useState<string | null>(null)

  useEffect(() => { fetchUsers(); fetchDepartments() }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('section') === 'departments') {
      setActiveSection('departments')
    }
  }, [])

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/auth/users')
      const data = await res.json()
      setUsers(data.filter((u: User) => !ADMIN_ROLES.includes(u.role)))
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchDepartments = async () => {
    try {
      const res = await apiFetch('/api/departments')
      if (res.ok) setDepartments(await res.json())
    } catch { /* ignore */ }
  }

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage(text)
    setMsgType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const effectiveRole = role === '__custom__' ? customRole.trim() : role
    if (!effectiveRole) {
      showMsg('Please type the new position name.', 'error')
      return
    }
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, role: effectiveRole, ...(departmentId ? { departmentId } : {}) }),
      })
      const data = await res.json()
      if (res.ok) {
        if ((photo || phone) && data.user?.id) {
          if (phone) {
            await apiFetch(`/api/auth/users/${data.user.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, email, phone, role: effectiveRole }),
            })
          }
          if (photo) {
            await apiFetch(`/api/auth/users/${data.user.id}/photo`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ photo: normalizePhotoUrl(photo) }),
            })
          }
        }
        showMsg('Employee created successfully!', 'success')
        setName(''); setEmail(''); setPassword(''); setPhone(''); setPhoto(''); setDepartmentId(''); setCustomRole(''); setShowForm(false)
        fetchUsers()
      } else {
        showMsg('Error: ' + data.message, 'error')
      }
    } catch {
      showMsg('Error creating employee', 'error')
    }
  }

  const openEdit = (user: User) => {
    setEditingUser(user)
    setEditName(user.name)
    setEditEmail(user.email)
    setEditPhone(user.phone || '')
    if (employeeRoles.includes(user.role)) {
      setEditRole(user.role)
      setEditCustomRole('')
    } else {
      setEditRole('__custom__')
      setEditCustomRole(user.role)
    }
    setEditPhoto(user.photo || '')
    setEditDepartmentId(user.departmentId || '')
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    const effectiveEditRole = editRole === '__custom__' ? editCustomRole.trim() : editRole
    if (!effectiveEditRole) {
      showMsg('Please type the new position name.', 'error')
      return
    }
    try {
      const res = await apiFetch(`/api/auth/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, email: editEmail, phone: editPhone, role: effectiveEditRole, departmentId: editDepartmentId || null }),
      })
      if (res.ok) {
        if (editPhoto !== (editingUser.photo || '')) {
          await apiFetch(`/api/auth/users/${editingUser.id}/photo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: normalizePhotoUrl(editPhoto) }),
          })
        }
        showMsg('Employee updated!', 'success')
        setEditingUser(null)
        fetchUsers()
      } else {
        const data = await res.json()
        showMsg('Error: ' + (data.message || 'Failed'), 'error')
      }
    } catch {
      showMsg('Error updating employee', 'error')
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await apiFetch(`/api/auth/users/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        showMsg('Employee deleted', 'success')
        fetchUsers()
      } else {
        showMsg('Error deleting employee', 'error')
      }
    } catch {
      showMsg('Error deleting employee', 'error')
    }
    setDeleteId(null)
  }

  // Department CRUD
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await apiFetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deptName, nameKh: deptNameKh || undefined, description: deptDescription || undefined }),
      })
      if (res.ok) {
        showMsg('Department created!', 'success')
        setDeptName(''); setDeptNameKh(''); setDeptDescription(''); setShowDeptForm(false)
        fetchDepartments()
      } else {
        const data = await res.json()
        showMsg('Error: ' + (data.message || 'Failed'), 'error')
      }
    } catch {
      showMsg('Error creating department', 'error')
    }
  }

  const openEditDept = (dept: Department) => {
    setEditingDept(dept)
    setEditDeptName(dept.name)
    setEditDeptNameKh(dept.nameKh || '')
    setEditDeptDescription(dept.description || '')
  }

  const handleEditDeptSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingDept) return
    try {
      const res = await apiFetch(`/api/departments/${editingDept.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editDeptName, nameKh: editDeptNameKh || undefined, description: editDeptDescription || undefined }),
      })
      if (res.ok) {
        showMsg('Department updated!', 'success')
        setEditingDept(null)
        fetchDepartments(); fetchUsers()
      } else {
        const data = await res.json()
        showMsg('Error: ' + (data.message || 'Failed'), 'error')
      }
    } catch {
      showMsg('Error updating department', 'error')
    }
  }

  const handleDeleteDept = async () => {
    if (!deleteDeptId) return
    try {
      const res = await apiFetch(`/api/departments/${deleteDeptId}`, { method: 'DELETE' })
      if (res.ok) {
        showMsg('Department deleted', 'success')
        fetchDepartments(); fetchUsers()
      } else {
        showMsg('Error deleting department', 'error')
      }
    } catch {
      showMsg('Error deleting department', 'error')
    }
    setDeleteDeptId(null)
  }

  // Filter & search
  const filtered = users.filter(u => {
    if (filter !== 'ALL' && u.role !== filter) return false
    if (deptFilter !== 'ALL') {
      if (deptFilter === 'NONE') { if (u.departmentId) return false }
      else { if (u.departmentId !== deptFilter) return false }
    }
    if (search) {
      const q = search.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone || '').toLowerCase().includes(q)
    }
    return true
  })

  const presentRoles = Array.from(new Set(users.map(u => u.role)))

  return (
    <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
      <Sidebar title="Admin" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />

      <main className="flex-1 lg:ml-0">
        <div className="lg:hidden h-14" />
        <div className="page-shell">
          <div className="page-content">
            {/* Header */}
            <div className="page-header">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{t('employees.title')}</h1>
                <p className="text-sm text-slate-500 mt-1">{filtered.length} {t('employees.employees')} · {departments.length} {t('employees.departments')}</p>
              </div>
              <div className="flex gap-2">
                <Link href="/admin/staff-cards" className="btn-outline flex items-center gap-1">
                  {t('employees.idCards')}
                </Link>
              </div>
            </div>

            {/* Messages */}
            {message && (
              <div className={`mx-4 mb-4 p-3 rounded-lg text-sm font-medium ${msgType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {message}
              </div>
            )}

            <div className="page-body space-y-4">

              {/* Section Tabs */}
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveSection('employees')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'employees' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'}`}
                >
                  {t('employees.employees')} ({users.length})
                </button>
                <button
                  onClick={() => setActiveSection('departments')}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'departments' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'}`}
                >
                  {t('employees.departments')} ({departments.length})
                </button>
              </div>

              {activeSection === 'employees' ? (
                <>
                  {/* Add Employee Button */}
                  <div className="flex justify-end">
                    <button onClick={() => setShowForm(!showForm)} className="btn-primary">
                      {showForm ? '✕' : '+ ' + t('employees.addEmployee')}
                    </button>
                  </div>

                  {/* Create Form */}
                  {showForm && (
                    <div className="card p-5">
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">{t('employees.newEmployee')}</h3>
                      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <div>
                          <label className="form-label">Name *</label>
                          <input value={name} onChange={e => setName(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Full name" />
                        </div>
                        <div>
                          <label className="form-label">Email *</label>
                          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="email@company.com" />
                        </div>
                        <div>
                          <label className="form-label">Password *</label>
                          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="••••••••" />
                        </div>
                        <div>
                          <label className="form-label">Phone</label>
                          <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="012 345 678" />
                        </div>
                        <div>
                          <label className="form-label">Position *</label>
                          <select value={role} onChange={e => { setRole(e.target.value); if (e.target.value !== '__custom__') setCustomRole('') }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            {employeeRoles.map(r => (
                              <option key={r} value={r}>{getRoleLabel(r)} ({r})</option>
                            ))}
                            <option value="__custom__">＋ Add new position...</option>
                          </select>
                          {role === '__custom__' && (
                            <input
                              value={customRole}
                              onChange={e => setCustomRole(e.target.value)}
                              required
                              className="w-full mt-1.5 rounded-lg border border-indigo-400 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300"
                              placeholder="Type new position name..."
                            />
                          )}
                        </div>
                        <div>
                          <label className="form-label">Department</label>
                          <select value={departmentId} onChange={e => setDepartmentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                            <option value="">— No Department —</option>
                            {departments.map(d => (
                              <option key={d.id} value={d.id}>{d.name}{d.nameKh ? ` (${d.nameKh})` : ''}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="form-label">Photo URL</label>
                          <input type="url" value={photo} onChange={e => setPhoto(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="https://..." />
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-2">
                          <button type="button" onClick={() => setShowForm(false)} className="btn-outline btn-sm">Cancel</button>
                          <button type="submit" className="btn-primary btn-sm">Create Employee</button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder={t('employees.searchPlaceholder')}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64"
                    />
                    <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      <option value="ALL">{t('employees.allDepartments')}</option>
                      <option value="NONE">{t('employees.noDepartment')}</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}{d.nameKh ? ` (${d.nameKh})` : ''}</option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => setFilter('ALL')} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === 'ALL' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                        {t('common.all')} ({users.length})
                      </button>
                      {presentRoles.map(r => (
                        <button key={r} onClick={() => setFilter(r)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === r ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                          {getRoleLabel(r)} ({users.filter(u => u.role === r).length})
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Employee Table */}
                  <div className="card">
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('common.name')}</th>
                            <th>{t('common.email')}</th>
                            <th>{t('common.phone')}</th>
                            <th>{t('common.role')}</th>
                            <th>{t('employees.departments')}</th>
                            <th>{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(user => (
                            <tr key={user.id}>
                              <td>
                                <div className="flex items-center gap-3">
                                  {user.photo ? (
                                    <img src={normalizePhotoUrl(user.photo)} alt={user.name} className="w-8 h-8 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                  ) : (
                                    <div className="avatar avatar-sm">{user.name.charAt(0).toUpperCase()}</div>
                                  )}
                                  <span className="font-medium text-slate-800">{user.name}</span>
                                </div>
                              </td>
                              <td className="text-slate-500">{user.email}</td>
                              <td className="text-slate-500">{user.phone || '—'}</td>
                              <td><span className="badge-gray">{getRoleLabel(user.role)}</span></td>
                              <td>
                                {user.department ? (
                                  <span className="badge-blue">{user.department.name}</span>
                                ) : (
                                  <span className="text-slate-400 text-xs">—</span>
                                )}
                              </td>
                              <td>
                                <div className="flex gap-1">
                                  <Link href={`/admin/employees/${user.id}/cv`} className="btn-outline btn-sm" title="Curriculum Vitae">📄</Link>
                                  <button onClick={() => openEdit(user)} className="btn-outline btn-sm">✏️</button>
                                  <button onClick={() => setDeleteId(user.id)} className="btn-outline btn-sm text-red-500 hover:bg-red-50">🗑️</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {filtered.length === 0 && (
                            <tr>
                              <td colSpan={6} className="text-center text-slate-400 py-8">{t('employees.noEmployeesFound')}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                /* ========== DEPARTMENTS SECTION ========== */
                <>
                  <div className="flex justify-end">
                    <button onClick={() => setShowDeptForm(!showDeptForm)} className="btn-primary">
                      {showDeptForm ? '✕ Close' : '➕ Add Department'}
                    </button>
                  </div>

                  {/* Create Department Form */}
                  {showDeptForm && (
                    <div className="card p-5">
                      <h3 className="text-sm font-semibold text-slate-700 mb-3">New Department</h3>
                      <form onSubmit={handleCreateDept} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="form-label">Name (English) *</label>
                          <input value={deptName} onChange={e => setDeptName(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. Human Resources" />
                        </div>
                        <div>
                          <label className="form-label">Name (Khmer)</label>
                          <input value={deptNameKh} onChange={e => setDeptNameKh(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. ធនធានមនុស្ស" />
                        </div>
                        <div>
                          <label className="form-label">Description</label>
                          <input value={deptDescription} onChange={e => setDeptDescription(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Optional description" />
                        </div>
                        <div className="sm:col-span-3 flex justify-end gap-2">
                          <button type="button" onClick={() => setShowDeptForm(false)} className="btn-outline btn-sm">Cancel</button>
                          <button type="submit" className="btn-primary btn-sm">Create Department</button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Departments Grid */}
                  {departments.length === 0 ? (
                    <div className="card p-12 text-center">
                      <p className="text-4xl mb-3">🏢</p>
                      <p className="font-semibold text-slate-600">No departments yet</p>
                      <p className="text-sm text-slate-400 mt-1">Create your first department to organize employees</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {departments.map(dept => (
                        <div key={dept.id} className="card p-5 hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="font-semibold text-slate-800">{dept.name}</h3>
                              {dept.nameKh && <p className="text-sm text-slate-500">{dept.nameKh}</p>}
                            </div>
                            <div className="flex gap-1">
                              <button onClick={() => openEditDept(dept)} className="btn-outline btn-sm">✏️</button>
                              <button onClick={() => setDeleteDeptId(dept.id)} className="btn-outline btn-sm text-red-500 hover:bg-red-50">🗑️</button>
                            </div>
                          </div>
                          {dept.description && <p className="text-xs text-slate-400 mb-3">{dept.description}</p>}
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                              👥 {dept._count?.users || 0} employees
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Edit Employee Modal */}
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingUser(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-800 mb-4">Edit Employee</h3>
              <form onSubmit={handleEditSubmit} className="space-y-3">
                <div>
                  <label className="form-label">Name</label>
                  <input value={editName} onChange={e => setEditName(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Phone</label>
                  <input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Position</label>
                  <select value={editRole} onChange={e => { setEditRole(e.target.value); if (e.target.value !== '__custom__') setEditCustomRole('') }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    {employeeRoles.map(r => (
                      <option key={r} value={r}>{getRoleLabel(r)} ({r})</option>
                    ))}
                    <option value="__custom__">＋ Add new position...</option>
                  </select>
                  {editRole === '__custom__' && (
                    <input
                      value={editCustomRole}
                      onChange={e => setEditCustomRole(e.target.value)}
                      required
                      className="w-full mt-1.5 rounded-lg border border-indigo-400 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300"
                      placeholder="Type new position name..."
                    />
                  )}
                </div>
                <div>
                  <label className="form-label">Department</label>
                  <select value={editDepartmentId} onChange={e => setEditDepartmentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="">— No Department —</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.nameKh ? ` (${d.nameKh})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Photo URL</label>
                  <input type="url" value={editPhoto} onChange={e => setEditPhoto(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setEditingUser(null)} className="btn-outline btn-sm">Cancel</button>
                  <button type="submit" className="btn-primary btn-sm">Save Changes</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Department Modal */}
        {editingDept && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingDept(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-800 mb-4">Edit Department</h3>
              <form onSubmit={handleEditDeptSubmit} className="space-y-3">
                <div>
                  <label className="form-label">Name (English) *</label>
                  <input value={editDeptName} onChange={e => setEditDeptName(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Name (Khmer)</label>
                  <input value={editDeptNameKh} onChange={e => setEditDeptNameKh(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="form-label">Description</label>
                  <input value={editDeptDescription} onChange={e => setEditDeptDescription(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button type="button" onClick={() => setEditingDept(null)} className="btn-outline btn-sm">Cancel</button>
                  <button type="submit" className="btn-primary btn-sm">Save Changes</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Employee Confirmation */}
        {deleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteId(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 text-center" onClick={e => e.stopPropagation()}>
              <div className="text-4xl mb-3">⚠️</div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Employee?</h3>
              <p className="text-sm text-slate-500 mb-4">This will permanently remove this employee and all their attendance records.</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => setDeleteId(null)} className="btn-outline">Cancel</button>
                <button onClick={handleDelete} className="btn-danger">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Department Confirmation */}
        {deleteDeptId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteDeptId(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 text-center" onClick={e => e.stopPropagation()}>
              <div className="text-4xl mb-3">⚠️</div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Department?</h3>
              <p className="text-sm text-slate-500 mb-4">Employees in this department will be unassigned. This cannot be undone.</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => setDeleteDeptId(null)} className="btn-outline">Cancel</button>
                <button onClick={handleDeleteDept} className="btn-danger">Delete</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
