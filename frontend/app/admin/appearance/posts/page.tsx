'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import { Post, TYPE_ICON } from './shared'

/* ─── WordPress-style "All Posts" list table ─────────────── */

type StatusFilter = 'all' | 'published' | 'draft'
type BulkAction = '' | 'publish' | 'draft' | 'trash'

function PostsListContent() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<BulkAction>('')
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/api/posts')
      .then((r) => (r.ok ? r.json() : []))
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const counts = {
    all: posts.length,
    published: posts.filter((p) => p.published).length,
    draft: posts.filter((p) => !p.published).length,
  }

  const filtered = posts.filter((p) => {
    if (statusFilter === 'published' && !p.published) return false
    if (statusFilter === 'draft' && p.published) return false
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) &&
        !p.excerpt.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length && filtered.length > 0 ? new Set() : new Set(filtered.map((p) => p.id))))
  }

  async function togglePublish(post: Post) {
    const res = await apiFetch(`/api/posts/${post.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: !post.published }),
    })
    if (res.ok) {
      const updated = await res.json()
      setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    }
  }

  async function applyBulk() {
    if (!bulkAction || selected.size === 0) return
    const ids = Array.from(selected)
    if (bulkAction === 'trash') { setConfirmDelete(ids); return }
    await Promise.all(ids.map((id) => apiFetch(`/api/posts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: bulkAction === 'publish' }),
    })))
    setSelected(new Set())
    setBulkAction('')
    load()
  }

  async function confirmDeleteAction() {
    if (!confirmDelete) return
    await Promise.all(confirmDelete.map((id) => apiFetch(`/api/posts/${id}`, { method: 'DELETE' })))
    setPosts((prev) => prev.filter((p) => !confirmDelete.includes(p.id)))
    setSelected(new Set())
    setBulkAction('')
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/appearance" className="hover:text-[#2271b1] transition-colors">Appearance</Link>
        <span>›</span>
        <span className="text-gray-900 font-medium">Posts</span>
      </div>

      {/* Heading row */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-normal text-gray-800">Posts</h1>
        <Link
          href="/admin/appearance/posts/new"
          className="px-3 py-1.5 text-sm font-medium border border-[#2271b1] text-[#2271b1] rounded-sm hover:bg-[#2271b1] hover:text-white transition-colors"
        >
          Add New
        </Link>
      </div>

      {/* Status subnav + search */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-gray-200 pb-3">
        <div className="flex items-center gap-2 text-sm">
          {([
            ['all', 'All'],
            ['published', 'Published'],
            ['draft', 'Drafts'],
          ] as const).map(([key, label], i) => (
            <span key={key} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-300">|</span>}
              <button
                onClick={() => setStatusFilter(key)}
                className={statusFilter === key ? 'text-gray-900 font-semibold' : 'text-[#2271b1] hover:text-[#135e96]'}
              >
                {label} <span className="text-gray-400">({counts[key]})</span>
              </button>
            </span>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Posts"
          className="px-2.5 py-1.5 border border-gray-300 rounded-sm text-sm w-56 focus:outline-none focus:ring-1 focus:ring-[#2271b1] focus:border-[#2271b1]"
        />
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center gap-2">
        <select
          value={bulkAction}
          onChange={(e) => setBulkAction(e.target.value as BulkAction)}
          className="px-2 py-1.5 border border-gray-300 rounded-sm text-sm bg-white"
        >
          <option value="">Bulk actions</option>
          <option value="publish">Publish</option>
          <option value="draft">Move to Draft</option>
          <option value="trash">Move to Trash</option>
        </select>
        <button
          onClick={applyBulk}
          className="px-3 py-1.5 border border-gray-300 rounded-sm text-sm text-gray-700 hover:bg-gray-50 bg-white"
        >
          Apply
        </button>
        <span className="ml-auto text-sm text-gray-500">
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="border border-gray-300 rounded-sm overflow-hidden bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-300 bg-gray-50 text-left text-gray-700">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="px-3 py-2 font-semibold">Title</th>
              <th className="px-3 py-2 font-semibold">Tags</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-14 text-center text-gray-400">
                <div className="w-6 h-6 border-2 border-[#2271b1] border-t-transparent rounded-full animate-spin mx-auto" />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-14 text-center text-gray-400">
                {posts.length === 0 ? 'No posts yet. Create your first post!' : 'No posts found.'}
              </td></tr>
            ) : filtered.map((post, i) => (
              <tr
                key={post.id}
                className={`group border-b border-gray-200 last:border-0 hover:bg-[#f6f7f7] ${i % 2 === 1 ? 'bg-gray-50/60' : ''}`}
              >
                <td className="px-3 py-3 align-top">
                  <input type="checkbox" checked={selected.has(post.id)} onChange={() => toggleSelect(post.id)} />
                </td>
                <td className="px-3 py-3 align-top max-w-xs">
                  <Link href={`/admin/appearance/posts/${post.id}`} className="font-semibold text-[#2271b1] hover:text-[#135e96]">
                    {post.title || '(no title)'}
                  </Link>
                  {post.pinned && <span className="ml-2 text-xs text-amber-600" title="Pinned">📌</span>}
                  {post.excerpt && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{post.excerpt}</p>}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity text-xs mt-1 flex items-center gap-1.5">
                    <Link href={`/admin/appearance/posts/${post.id}`} className="text-[#2271b1] hover:text-[#135e96] hover:underline">Edit</Link>
                    <span className="text-gray-300">|</span>
                    <button onClick={() => togglePublish(post)} className="text-[#2271b1] hover:text-[#135e96] hover:underline">
                      {post.published ? 'Unpublish' : 'Publish'}
                    </button>
                    <span className="text-gray-300">|</span>
                    <button onClick={() => setConfirmDelete([post.id])} className="text-red-600 hover:text-red-800 hover:underline">Trash</button>
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex flex-wrap gap-1 max-w-[160px]">
                    {post.tags.length === 0 ? (
                      <span className="text-gray-300">—</span>
                    ) : post.tags.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[11px] rounded">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 align-top text-gray-600 whitespace-nowrap">
                  {TYPE_ICON[post.type]} <span className="capitalize">{post.type}</span>
                </td>
                <td className="px-3 py-3 align-top">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${post.published ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {post.published ? 'Published' : 'Draft'}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-gray-500 text-xs whitespace-nowrap">
                  {new Date(post.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom bulk bar */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value as BulkAction)}
            className="px-2 py-1.5 border border-gray-300 rounded-sm text-sm bg-white"
          >
            <option value="">Bulk actions</option>
            <option value="publish">Publish</option>
            <option value="draft">Move to Draft</option>
            <option value="trash">Move to Trash</option>
          </select>
          <button
            onClick={applyBulk}
            className="px-3 py-1.5 border border-gray-300 rounded-sm text-sm text-gray-700 hover:bg-gray-50 bg-white"
          >
            Apply
          </button>
        </div>
      )}

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-gray-900">
              {confirmDelete.length > 1 ? `Delete ${confirmDelete.length} posts?` : 'Delete Post?'}
            </h3>
            <p className="text-sm text-gray-500">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmDeleteAction}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Page export ─────────────────────────────────────────── */

export default function PostsPage() {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-[#f0f0f1]">
        <Sidebar title="Admin" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <PostsListContent />
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
