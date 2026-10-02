'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import Sidebar from '../../../../components/Sidebar'
import AuthGuard from '../../../../components/AuthGuard'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'

/* ─── Types ─────────────────────────────────────────────── */

interface AboutSettings {
  aboutBadge: string
  aboutTitle: string
  aboutDescription: string
  aboutImageUrl: string
  aboutFeatures: string[]
  aboutCtaLabel: string
  aboutCtaHref: string
  primaryColor: string
  siteName: string
}

const DEFAULTS: AboutSettings = {
  aboutBadge: 'About Us',
  aboutTitle: 'A Smarter Way to Manage Your School',
  aboutDescription: 'Wattaman is an all-in-one school management platform designed for modern educational institutions. From QR-code attendance to fee management, timetables, and parent communication — everything runs seamlessly in one place.',
  aboutImageUrl: '',
  aboutFeatures: [
    'Full-day & session attendance tracking',
    'Automated reports & CSV exports',
    'Parent portal with push notifications',
    'Role-based access for every user type',
  ],
  aboutCtaLabel: 'Get Started Today',
  aboutCtaHref: '/login',
  primaryColor: '#FF6B2C',
  siteName: 'Wattaman',
}

/* ─── Image compression ──────────────────────────────────── */

function compressImage(file: File, maxW = 900, maxH = 700, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = e.target!.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* ─── ImageUpload ─────────────────────────────────────────── */

function ImageUpload({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dragging, setDragging] = useState(false)

  async function pick(file: File) {
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return }
    if (file.size > 15 * 1024 * 1024) { setErr('File too large (max 15 MB).'); return }
    setErr(''); setBusy(true)
    try { onChange(await compressImage(file)) }
    catch { setErr('Could not process image.') }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200 group">
          <img src={value} alt="preview" className="w-full h-52 object-cover" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <button type="button" onClick={() => ref.current?.click()}
              className="px-3 py-1.5 bg-white text-gray-800 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors">
              Replace
            </button>
            <button type="button" onClick={() => onChange('')}
              className="px-3 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition-colors">
              Remove
            </button>
          </div>
          <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/50 rounded text-white text-[10px]">
            {value.startsWith('data:') ? 'Uploaded' : 'URL'}
          </div>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-xl cursor-pointer transition-all ${dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'}`}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f) }}
        >
          <div className="flex flex-col items-center py-10 gap-2 text-center">
            {busy ? (
              <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-700">Click to upload or drag & drop</p>
                <p className="text-xs text-gray-400">{hint || 'JPEG, PNG, WebP — max 15 MB'}</p>
              </>
            )}
          </div>
        </div>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
    </div>
  )
}

/* ─── Feature list editor ─────────────────────────────────── */

function FeatureListEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('')

  function add() {
    const t = input.trim()
    if (t && !items.includes(t)) onChange([...items, t])
    setInput('')
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...items]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next)
  }

  function edit(idx: number, val: string) {
    const next = [...items]
    next[idx] = val
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 group">
          <div className="flex flex-col gap-0.5">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
              className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7"/>
              </svg>
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}
              className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
          </div>
          <div className="flex-none w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <input
            value={item}
            onChange={(e) => edit(i, e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button type="button" onClick={() => remove(i)}
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add a feature point and press Enter…"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="button" onClick={add}
          className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg transition-colors">
          + Add
        </button>
      </div>
    </div>
  )
}

/* ─── Live preview ─────────────────────────────────────────── */

function LivePreview({ s }: { s: AboutSettings }) {
  const primary = s.primaryColor || '#FF6B2C'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <div className="flex gap-1">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <span className="text-xs text-gray-400 mx-auto">Live Preview</span>
      </div>
      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-6 items-center">
          {/* Image side */}
          <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm" style={{ minHeight: 200 }}>
            {s.aboutImageUrl ? (
              <img src={s.aboutImageUrl} alt="about" className="w-full h-48 object-cover" />
            ) : (
              <div className="h-48 flex items-center justify-center text-center p-6"
                style={{ background: 'linear-gradient(135deg, #FFF7ED, #FEF3C7)' }}>
                <div>
                  <div className="text-5xl mb-2">🏫</div>
                  <p className="text-sm font-bold text-gray-600">{s.siteName || 'Wattaman'}</p>
                </div>
              </div>
            )}
          </div>
          {/* Text side */}
          <div className="space-y-3">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-bold"
              style={{ backgroundColor: `${primary}18`, color: primary }}>
              {s.aboutBadge || 'About Us'}
            </span>
            <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
              {s.aboutTitle || 'Your School Title'}
            </h2>
            {s.aboutDescription && (
              <p className="text-xs text-gray-500 leading-relaxed">{s.aboutDescription}</p>
            )}
            {s.aboutFeatures.length > 0 && (
              <ul className="space-y-1.5">
                {s.aboutFeatures.slice(0, 4).map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="w-4 h-4 rounded-full flex items-center justify-center flex-none"
                      style={{ backgroundColor: primary }}>
                      <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            )}
            {s.aboutCtaLabel && (
              <button className="px-4 py-1.5 rounded-xl text-xs font-bold text-white transition-all"
                style={{ backgroundColor: primary }}>
                {s.aboutCtaLabel} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Main content ─────────────────────────────────────────── */

function AboutContent() {
  const [settings, setSettings] = useState<AboutSettings>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/site-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSettings({ ...DEFAULTS, ...data })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function patch<K extends keyof AboutSettings>(key: K, value: AboutSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const save = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      const res = await apiFetch('/api/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aboutBadge: settings.aboutBadge,
          aboutTitle: settings.aboutTitle,
          aboutDescription: settings.aboutDescription,
          aboutImageUrl: settings.aboutImageUrl,
          aboutFeatures: settings.aboutFeatures,
          aboutCtaLabel: settings.aboutCtaLabel,
          aboutCtaHref: settings.aboutCtaHref,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [settings])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/admin/appearance" className="hover:text-indigo-600 transition-colors">Appearance</Link>
            <span>›</span>
            <span className="text-gray-900 font-medium">About</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">About Section</h1>
          <p className="text-sm text-gray-500 mt-0.5">Edit the "About Us" section on the public homepage</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
              Saved
            </span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60"
          >
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ─ Left: form ─ */}
        <div className="space-y-5">

          {/* Badge & title */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-3">Section Heading</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Badge Label</label>
              <p className="text-xs text-gray-400 mb-1">Small pill shown above the title (e.g. "About Us")</p>
              <input
                value={settings.aboutBadge}
                onChange={(e) => patch('aboutBadge', e.target.value)}
                placeholder="About Us"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Main Title</label>
              <input
                value={settings.aboutTitle}
                onChange={(e) => patch('aboutTitle', e.target.value)}
                placeholder="A Smarter Way to Manage Your School"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={settings.aboutDescription}
                onChange={(e) => patch('aboutDescription', e.target.value)}
                rows={4}
                placeholder="Describe your school and its mission…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </div>
          </div>

          {/* Feature checklist */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-3">Feature Checklist</h2>
            <p className="text-xs text-gray-400">Bullet points shown as a ✓ checklist beside the description.</p>
            <FeatureListEditor items={settings.aboutFeatures} onChange={(v) => patch('aboutFeatures', v)} />
          </div>

          {/* CTA button */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-3">Call-to-Action Button</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Button Label</label>
                <input
                  value={settings.aboutCtaLabel}
                  onChange={(e) => patch('aboutCtaLabel', e.target.value)}
                  placeholder="Get Started Today"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Button Link</label>
                <input
                  value={settings.aboutCtaHref}
                  onChange={(e) => patch('aboutCtaHref', e.target.value)}
                  placeholder="/login"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            {!settings.aboutCtaLabel && (
              <p className="text-xs text-amber-600">Leave blank to hide the button.</p>
            )}
          </div>

          {/* Photo */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-3">Section Photo</h2>
            <p className="text-xs text-gray-400">Displayed on the left side of the About section. Leave blank to show the school name illustration.</p>
            <ImageUpload
              value={settings.aboutImageUrl}
              onChange={(v) => patch('aboutImageUrl', v)}
              hint="Portrait or landscape — recommended 900×700 px"
            />
          </div>
        </div>

        {/* ─ Right: live preview ─ */}
        <div className="space-y-4">
          <div className="sticky top-6 space-y-4">
            <LivePreview s={settings} />
            <div className="bg-indigo-50 rounded-xl p-4 text-sm text-indigo-700 space-y-1">
              <p className="font-semibold">💡 Tips</p>
              <ul className="text-xs space-y-1 text-indigo-600 list-disc list-inside">
                <li>Keep the title under 60 characters for best readability.</li>
                <li>3–5 feature points work best in the checklist.</li>
                <li>The photo appears on the <strong>left</strong> on desktop, below the text on mobile.</li>
                <li>Primary color is set in <Link href="/admin/appearance" className="underline">Appearance → Theme</Link>.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom save bar */}
      <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-gray-200 -mx-6 px-6 py-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">Changes apply to the public homepage immediately after saving.</p>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-60"
        >
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

/* ─── Page export ─────────────────────────────────────────── */

export default function AboutPage() {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-gray-50">
        <Sidebar title="Admin" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <AboutContent />
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
