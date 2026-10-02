'use client'

import { useState, useEffect } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { useLanguage } from '../../../lib/i18n'
import { apiFetch } from '../../../lib/api'

interface CacheItem {
  key: string
  label: string
  description: string
  size: string
  removable: boolean
}

function getStorageSize(key: string): string {
  const val = localStorage.getItem(key)
  if (!val) return '0 B'
  const bytes = new Blob([val]).size
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getTotalStorageSize(): string {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key) {
      const val = localStorage.getItem(key) || ''
      total += new Blob([key + val]).size
    }
  }
  if (total < 1024) return `${total} B`
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`
  return `${(total / (1024 * 1024)).toFixed(1)} MB`
}

function getCacheItems(): CacheItem[] {
  const known: Record<string, { label: string; description: string; removable: boolean }> = {
    token: { label: 'Auth Token', description: 'JWT authentication token (clearing will log you out)', removable: false },
    role: { label: 'User Role', description: 'Current user role (clearing will log you out)', removable: false },
    'Wattanman-card-designs': { label: 'Card Designs', description: 'Saved student & staff card design templates', removable: false },
    notificationSettings: { label: 'Notification Settings', description: 'Alert preferences and configuration', removable: true },
  }

  const items: CacheItem[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    const info = known[key]
    items.push({
      key,
      label: info?.label || key,
      description: info?.description || 'Cached application data',
      size: getStorageSize(key),
      removable: info?.removable ?? true,
    })
  }
  return items.sort((a, b) => (a.removable === b.removable ? 0 : a.removable ? -1 : 1))
}

export default function SettingsPage() {
  const { t } = useLanguage()
  const [items, setItems] = useState<CacheItem[]>([])
  const [totalSize, setTotalSize] = useState('')
  const [message, setMessage] = useState('')
  const [msgType, setMsgType] = useState<'success' | 'error'>('success')
  const [cleaningUp, setCleaningUp] = useState(false)

  const refresh = () => {
    setItems(getCacheItems())
    setTotalSize(getTotalStorageSize())
  }

  // Load on mount
  useEffect(() => { refresh() }, [])

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage(text)
    setMsgType(type)
    setTimeout(() => setMessage(''), 3000)
  }

  const clearItem = (key: string) => {
    localStorage.removeItem(key)
    refresh()
    showMsg(`Cleared "${key}" successfully`)
  }

  const clearAllCache = () => {
    const protectedKeys = ['token', 'role', 'Wattanman-card-designs']
    // Remove everything except auth and card designs
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && !protectedKeys.includes(key)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))

    refresh()
    showMsg(`Cleared ${keysToRemove.length} cached item${keysToRemove.length !== 1 ? 's' : ''}`)
  }

  const clearNextCache = async () => {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map(name => caches.delete(name)))
      showMsg(`Cleared ${names.length} browser cache${names.length !== 1 ? 's' : ''}`)
    } else {
      showMsg('Browser cache API not available', 'error')
    }
  }

  const cleanupOrphanedStudents = async () => {
    if (!confirm('This will permanently delete all students that are not assigned to any class. Continue?')) return
    setCleaningUp(true)
    try {
      const res = await apiFetch('/api/classes/cleanup-orphaned-students', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        showMsg(`Cleaned up ${data.deleted} orphaned student${data.deleted !== 1 ? 's' : ''} successfully`)
      } else {
        showMsg(data.message || 'Failed to cleanup', 'error')
      }
    } catch {
      showMsg('Failed to cleanup orphaned students', 'error')
    } finally {
      setCleaningUp(false)
    }
  }

  const removableItems = items.filter(i => i.removable)
  const authItems = items.filter(i => !i.removable)

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="h-14 lg:hidden" />
          <div className="page-header">
            <h1 className="text-2xl font-bold text-slate-800">{t('settings.title')}</h1>
            <p className="text-sm text-slate-500 mt-1">{t('settings.subtitle')}</p>
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

            {/* Storage Overview */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">{t('settings.storageOverview')}</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {items.length} item{items.length !== 1 ? 's' : ''} stored &bull; {totalSize} total
                  </p>
                </div>
                <button onClick={refresh} className="btn-outline text-sm px-3 py-1.5">
                  🔄 Refresh
                </button>
              </div>

              {/* Storage bar */}
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (items.length / 20) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">{items.length} / ~20 typical cached items</p>
            </div>

            {/* Quick Actions */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="card p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-lg shadow-sm flex-shrink-0">
                    🧹
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-800">{t('settings.clearAppCache')}</h3>
                    <p className="text-sm text-slate-500 mt-1 mb-3">
                      Remove saved designs, settings, and temp data. Auth stays intact.
                    </p>
                    <button
                      onClick={clearAllCache}
                      disabled={removableItems.length === 0}
                      className="btn-warning text-sm px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Clear {removableItems.length} item{removableItems.length !== 1 ? 's' : ''}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-lg shadow-sm flex-shrink-0">
                    🌐
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-800">{t('settings.clearBrowserCache')}</h3>
                    <p className="text-sm text-slate-500 mt-1 mb-3">
                      Remove cached pages and assets. May reload resources on next visit.
                    </p>
                    <button onClick={clearNextCache} className="btn-primary text-sm px-3 py-1.5">
                      Clear Browser Cache
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Database Cleanup */}
            <div className="card p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-lg shadow-sm flex-shrink-0">
                  🗑️
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-800">Cleanup Orphaned Students</h3>
                  <p className="text-sm text-slate-500 mt-1 mb-3">
                    Remove students that are not assigned to any class. This happens when classes are deleted but students remain in the database.
                  </p>
                  <button
                    onClick={cleanupOrphanedStudents}
                    disabled={cleaningUp}
                    className="btn-danger text-sm px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cleaningUp ? 'Cleaning up...' : 'Cleanup Orphaned Students'}
                  </button>
                </div>
              </div>
            </div>

            {/* Cached Data Items */}
            {removableItems.length > 0 && (
              <div className="card">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800">{t('settings.removableCache')}</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {removableItems.map(item => (
                    <div key={item.key} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-slate-400 font-mono">{item.size}</span>
                        <button
                          onClick={() => clearItem(item.key)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auth Items (protected) */}
            {authItems.length > 0 && (
              <div className="card">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-800">{t('settings.protectedData')}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Auth and card designs are protected from cache cleanup.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {authItems.map(item => (
                    <div key={item.key} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-slate-400 font-mono">{item.size}</span>
                        <span className="badge-blue text-xs">Protected</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 && (
              <div className="empty-state">
                <p className="text-lg">No cached data</p>
                <p className="text-sm text-slate-400 mt-1">Your app is clean!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
