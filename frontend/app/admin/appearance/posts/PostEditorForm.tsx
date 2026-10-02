'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '../../../../lib/api'
import { EMPTY_POST, ImageUpload, VideoEmbed, Post, PostType } from './shared'

/* ─── WordPress-style Add/Edit Post editor (full page) ────── */

export default function PostEditorForm({ postId }: { postId?: string }) {
  const router = useRouter()
  const isNew = !postId
  const [form, setForm] = useState({ ...EMPTY_POST })
  const [loading, setLoading] = useState(!isNew)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [confirmTrash, setConfirmTrash] = useState(false)

  useEffect(() => {
    if (!postId) return
    apiFetch(`/api/posts/${postId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((post: Post | null) => {
        if (!post) { setNotFound(true); return }
        setForm({
          title: post.title,
          excerpt: post.excerpt,
          body: post.body,
          type: post.type,
          imageUrl: post.imageUrl,
          videoUrl: post.videoUrl,
          published: post.published,
          pinned: post.pinned,
          tags: post.tags,
        })
        setCreatedAt(post.createdAt)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [postId])

  function set<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: val }))
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !form.tags.includes(t)) set('tags', [...form.tags, t])
    setTagInput('')
  }

  function removeTag(t: string) {
    set('tags', form.tags.filter((x) => x !== t))
  }

  async function save(forcePublished?: boolean) {
    if (!form.title.trim()) { setError('Title is required.'); return }
    const payload = forcePublished === undefined ? form : { ...form, published: forcePublished }
    setSaving(true); setError(null)
    try {
      const res = await apiFetch(
        isNew ? '/api/posts' : `/api/posts/${postId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) throw new Error(await res.text())
      router.push('/admin/appearance/posts')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!postId) return
    await apiFetch(`/api/posts/${postId}`, { method: 'DELETE' })
    router.push('/admin/appearance/posts')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#2271b1] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg font-semibold mb-2">Post not found</p>
        <Link href="/admin/appearance/posts" className="text-[#2271b1] hover:underline">← Back to Posts</Link>
      </div>
    )
  }

  const typeOptions: { value: PostType; label: string; icon: string }[] = [
    { value: 'text', label: 'Standard', icon: '📝' },
    { value: 'image', label: 'Image', icon: '🖼️' },
    { value: 'video', label: 'Video', icon: '🎬' },
  ]

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/appearance" className="hover:text-[#2271b1] transition-colors">Appearance</Link>
        <span>›</span>
        <Link href="/admin/appearance/posts" className="hover:text-[#2271b1] transition-colors">Posts</Link>
        <span>›</span>
        <span className="text-gray-900 font-medium">{isNew ? 'Add New' : 'Edit'}</span>
      </div>

      <h1 className="text-2xl font-normal text-gray-800">{isNew ? 'Add New Post' : 'Edit Post'}</h1>

      {error && (
        <div className="px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">
        {/* ── Main column ── */}
        <div className="space-y-4 min-w-0">
          <input
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Add title"
            className="w-full text-2xl font-normal px-3 py-3 border border-gray-300 rounded-sm focus:outline-none focus:ring-1 focus:ring-[#2271b1] focus:border-[#2271b1]"
          />

          {/* Content box */}
          <div className="bg-white border border-gray-300 rounded-sm">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Content
            </div>
            <textarea
              value={form.body}
              onChange={(e) => set('body', e.target.value)}
              rows={14}
              placeholder="Start writing…"
              className="w-full px-3 py-3 text-sm focus:outline-none resize-y rounded-b-sm"
            />
          </div>

          {/* Video URL — for video posts */}
          {form.type === 'video' && (
            <div className="bg-white border border-gray-300 rounded-sm">
              <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Video
              </div>
              <div className="p-3 space-y-2">
                <input
                  type="url"
                  value={form.videoUrl}
                  onChange={(e) => set('videoUrl', e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-[#2271b1]"
                />
                {form.videoUrl && <VideoEmbed url={form.videoUrl} />}
              </div>
            </div>
          )}

          {/* Excerpt box */}
          <div className="bg-white border border-gray-300 rounded-sm">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Excerpt
            </div>
            <div className="p-3">
              <textarea
                value={form.excerpt}
                onChange={(e) => set('excerpt', e.target.value)}
                rows={2}
                placeholder="Short summary shown in cards & feeds…"
                className="w-full px-3 py-2 border border-gray-200 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-[#2271b1] resize-none"
              />
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-4">
          {/* Publish box */}
          <div className="bg-white border border-gray-300 rounded-sm">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Publish
            </div>
            <div className="p-3 space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Status:</span>
                <button type="button" onClick={() => set('published', !form.published)}
                  className="text-[#2271b1] hover:underline font-medium">
                  {form.published ? 'Published' : 'Draft'}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Visibility:</span>
                <span className="text-gray-700">Public</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">{isNew ? 'Publish:' : 'Published:'}</span>
                <span className="text-gray-700">
                  {isNew ? 'Immediately' : createdAt ? new Date(createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </span>
              </div>
              <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                <input type="checkbox" checked={form.pinned} onChange={(e) => set('pinned', e.target.checked)} />
                <span className="text-gray-700">📌 Pin to top</span>
              </label>

              <div className="flex items-center justify-between pt-3 mt-1 border-t border-gray-200">
                {!isNew ? (
                  <button type="button" onClick={() => setConfirmTrash(true)}
                    className="text-red-600 hover:text-red-800 hover:underline text-sm">
                    Move to Trash
                  </button>
                ) : <span />}
                <button
                  type="button"
                  onClick={() => save(isNew ? true : undefined)}
                  disabled={saving}
                  className="px-4 py-1.5 bg-[#2271b1] hover:bg-[#135e96] text-white text-sm font-semibold rounded-sm disabled:opacity-60"
                >
                  {saving ? 'Saving…' : isNew ? 'Publish' : 'Update'}
                </button>
              </div>
              {isNew && (
                <button type="button" onClick={() => save(false)} disabled={saving}
                  className="w-full mt-1 px-4 py-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm rounded-sm disabled:opacity-60">
                  Save Draft
                </button>
              )}
            </div>
          </div>

          {/* Format box */}
          <div className="bg-white border border-gray-300 rounded-sm">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Format
            </div>
            <div className="p-3 space-y-1.5">
              {typeOptions.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="type" checked={form.type === opt.value} onChange={() => set('type', opt.value)} />
                  <span>{opt.icon} {opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tags box */}
          <div className="bg-white border border-gray-300 rounded-sm">
            <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Tags
            </div>
            <div className="p-3 space-y-2">
              <div className="flex gap-1.5">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="Add new tag"
                  className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-[#2271b1]"
                />
                <button type="button" onClick={addTag}
                  className="px-2.5 py-1.5 border border-gray-300 text-gray-700 text-sm rounded-sm hover:bg-gray-50">
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {form.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500">×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Featured image box — for text/image posts */}
          {(form.type === 'image' || form.type === 'text') && (
            <div className="bg-white border border-gray-300 rounded-sm">
              <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Featured Image
              </div>
              <div className="p-3">
                <ImageUpload value={form.imageUrl} onChange={(v) => set('imageUrl', v)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Trash confirm dialog */}
      {confirmTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-gray-900">Delete Post?</h3>
            <p className="text-sm text-gray-500">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmTrash(false)}
                className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDelete}
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
