'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { adminNav } from '../../../lib/admin-nav'
import { apiFetch } from '../../../lib/api'

/* ─── Types ─────────────────────────────────────────────── */

interface HeroSlide {
  id: string
  imageUrl: string
  title: string
  subtitle: string
  ctaLabel: string
  ctaHref: string
}

interface SiteSettings {
  siteName: string
  siteTagline: string
  logoUrl: string
  heroSlides: HeroSlide[]
  footerAddress: string
  footerPhone: string
  footerEmail: string
  footerFacebook: string
  footerInstagram: string
  footerTwitter: string
  footerYoutube: string
  footerCopyright: string
  primaryColor: string
  customCss: string
}

const DEFAULT: SiteSettings = {
  siteName: 'Wattaman',
  siteTagline: 'Smart School Management',
  logoUrl: '',
  heroSlides: [],
  footerAddress: '',
  footerPhone: '',
  footerEmail: '',
  footerFacebook: '',
  footerInstagram: '',
  footerTwitter: '',
  footerYoutube: '',
  footerCopyright: `© ${new Date().getFullYear()} Wattaman School. All rights reserved.`,
  primaryColor: '#4f46e5',
  customCss: '',
}

/* ─── Helpers ────────────────────────────────────────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Compress an image File to a JPEG data URL using <canvas>.
 * `maxW` / `maxH` are the maximum output dimensions (aspect ratio is preserved).
 * `quality` is the JPEG quality 0–1.
 */
function compressImage(
  file: File,
  maxW: number,
  maxH: number,
  quality = 0.82,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        // Scale down to fit within maxW × maxH
        let w = img.width
        let h = img.height
        if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW }
        if (h > maxH) { w = Math.round((w * maxH) / h); h = maxH }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = e.target!.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* ─── ImageUploader ──────────────────────────────────────── */

/**
 * Drag-and-drop / click-to-upload image picker.
 * Compresses the chosen image and returns a JPEG data URL via `onChange`.
 * Also accepts a direct URL as a fallback.
 */
function ImageUploader({
  value,
  onChange,
  aspectLabel = '1920×600 px recommended',
  maxW = 1920,
  maxH = 800,
}: {
  value: string
  onChange: (dataUrl: string) => void
  aspectLabel?: string
  maxW?: number
  maxH?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [urlMode, setUrlMode] = useState(!value.startsWith('data:') && value.startsWith('http'))
  const [urlInput, setUrlInput] = useState(value.startsWith('http') ? value : '')
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, WebP, GIF).')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('File is too large. Maximum 15 MB.')
      return
    }
    setError(null)
    setCompressing(true)
    try {
      const dataUrl = await compressImage(file, maxW, maxH)
      onChange(dataUrl)
      setUrlMode(false)
    } catch {
      setError('Could not process image. Try a different file.')
    } finally {
      setCompressing(false)
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function applyUrl() {
    if (urlInput.trim()) {
      onChange(urlInput.trim())
    }
  }

  const hasImage = !!value

  return (
    <div className="space-y-3">
      {/* Current image preview */}
      {hasImage && (
        <div className="relative rounded-xl overflow-hidden border border-gray-200 group">
          <img
            src={value}
            alt="preview"
            className="w-full h-44 object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          {/* Overlay actions */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-800 text-xs font-semibold rounded-lg shadow hover:bg-gray-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
              </svg>
              Replace
            </button>
            <button
              type="button"
              onClick={() => { onChange(''); setUrlInput('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-lg shadow hover:bg-red-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Remove
            </button>
          </div>
          {/* Size badge */}
          <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/50 rounded text-white text-[10px] font-medium">
            {value.startsWith('data:') ? 'Uploaded' : 'URL'}
          </div>
        </div>
      )}

      {/* Upload zone (shown when no image OR compressing) */}
      {!hasImage && (
        <div
          className={`relative border-2 border-dashed rounded-xl transition-all cursor-pointer ${
            dragging
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
            {compressing ? (
              <>
                <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-indigo-600 font-medium">Compressing image…</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center">
                  <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    Click to upload or drag & drop
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    JPEG, PNG, WebP, GIF — max 15 MB · {aspectLabel}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* URL fallback toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setUrlMode((m) => !m)}
          className="text-xs text-indigo-500 hover:text-indigo-700 underline transition-colors"
        >
          {urlMode ? 'Hide URL input' : 'Or paste an image URL instead'}
        </button>
        {hasImage && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-gray-500 hover:text-gray-700 underline transition-colors"
          >
            Upload different image
          </button>
        )}
      </div>

      {/* URL input */}
      {urlMode && (
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl() } }}
            placeholder="https://example.com/banner.jpg"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
          <button
            type="button"
            onClick={applyUrl}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Apply
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
          {error}
        </p>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────── */

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
    />
  )
}

function SlideCard({
  slide,
  index,
  total,
  onMove,
  onChange,
  onDelete,
}: {
  slide: HeroSlide
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onChange: (updated: HeroSlide) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(index === 0)

  function set(key: keyof HeroSlide, val: string) {
    onChange({ ...slide, [key]: val })
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          {slide.imageUrl ? (
            <img
              src={slide.imageUrl}
              alt=""
              className="w-10 h-7 object-cover rounded"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="w-10 h-7 rounded bg-gray-200 flex items-center justify-center">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            </div>
          )}
          <span className="text-sm font-medium text-gray-700">
            Slide {index + 1}{slide.title ? ` — ${slide.title}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move up"
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/>
            </svg>
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Move down"
            className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          <button
            onClick={onDelete}
            title="Remove slide"
            className="p-1 rounded hover:bg-red-50 text-red-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </div>

      {/* Slide fields */}
      {open && (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Title">
              <Input value={slide.title} onChange={(v) => set('title', v)} placeholder="Hero headline" />
            </Field>
            <Field label="Subtitle">
              <Input value={slide.subtitle} onChange={(v) => set('subtitle', v)} placeholder="Supporting text" />
            </Field>
          </div>
          <Field label="Banner Image" hint="Upload a photo or paste a URL. Compressed automatically to JPEG for fast loading.">
            <ImageUploader
              value={slide.imageUrl}
              onChange={(v) => set('imageUrl', v)}
              aspectLabel="1920×600 px recommended"
              maxW={1920}
              maxH={800}
            />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Button Label">
              <Input value={slide.ctaLabel} onChange={(v) => set('ctaLabel', v)} placeholder="Learn More" />
            </Field>
            <Field label="Button Link">
              <Input value={slide.ctaHref} onChange={(v) => set('ctaHref', v)} placeholder="/about" />
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────────── */

type Tab = 'header' | 'hero' | 'footer' | 'theme'

function AppearanceContent() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('hero')

  /* Load settings on mount */
  useEffect(() => {
    apiFetch('/api/site-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSettings({ ...DEFAULT, ...data })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function patch<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  /* Hero slides helpers */
  function addSlide() {
    patch('heroSlides', [
      ...settings.heroSlides,
      { id: uid(), imageUrl: '', title: '', subtitle: '', ctaLabel: '', ctaHref: '' },
    ])
  }

  function updateSlide(idx: number, updated: HeroSlide) {
    const slides = [...settings.heroSlides]
    slides[idx] = updated
    patch('heroSlides', slides)
  }

  function moveSlide(idx: number, dir: -1 | 1) {
    const slides = [...settings.heroSlides]
    const target = idx + dir
    if (target < 0 || target >= slides.length) return
    ;[slides[idx], slides[target]] = [slides[target], slides[idx]]
    patch('heroSlides', slides)
  }

  function removeSlide(idx: number) {
    patch('heroSlides', settings.heroSlides.filter((_, i) => i !== idx))
  }

  /* Save */
  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
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

  /* Tabs */
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'hero',
      label: 'Hero Banner',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      ),
    },
    {
      id: 'header',
      label: 'Header',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h8"/>
        </svg>
      ),
    },
    {
      id: 'footer',
      label: 'Footer',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 18h16M4 14h16M4 10h8"/>
        </svg>
      ),
    },
    {
      id: 'theme',
      label: 'Theme & CSS',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>
        </svg>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Appearance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Customize the public-facing web frontend</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
              </svg>
              Saved
            </span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
              </svg>
            )}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Hero Banner ── */}
      {activeTab === 'hero' && (
        <div className="space-y-4">
          <SectionCard title="Hero Banner Slides">
            <p className="text-sm text-gray-500">
              These slides rotate automatically on the homepage. Drag to reorder or click the arrows.
            </p>
            <div className="space-y-3">
              {settings.heroSlides.length === 0 && (
                <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                  <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  <p className="text-sm">No slides yet. Add your first slide below.</p>
                </div>
              )}
              {settings.heroSlides.map((slide, i) => (
                <SlideCard
                  key={slide.id}
                  slide={slide}
                  index={i}
                  total={settings.heroSlides.length}
                  onMove={(dir) => moveSlide(i, dir)}
                  onChange={(updated) => updateSlide(i, updated)}
                  onDelete={() => removeSlide(i)}
                />
              ))}
            </div>
            <button
              onClick={addSlide}
              className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-indigo-300 text-indigo-600 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors w-full justify-center"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              Add Slide
            </button>
          </SectionCard>

          {/* Live preview */}
          {settings.heroSlides.length > 0 && settings.heroSlides[0].imageUrl && (
            <SectionCard title="Preview — Slide 1">
              <div className="relative rounded-xl overflow-hidden">
                <img
                  src={settings.heroSlides[0].imageUrl}
                  alt="hero preview"
                  className="w-full h-56 object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-6">
                  {settings.heroSlides[0].title && (
                    <h3 className="text-white text-2xl font-bold">{settings.heroSlides[0].title}</h3>
                  )}
                  {settings.heroSlides[0].subtitle && (
                    <p className="text-white/80 text-sm mt-1">{settings.heroSlides[0].subtitle}</p>
                  )}
                  {settings.heroSlides[0].ctaLabel && (
                    <div className="mt-3">
                      <span
                        className="inline-block px-4 py-1.5 rounded-lg text-sm font-semibold text-white"
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        {settings.heroSlides[0].ctaLabel}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* ── Header ── */}
      {activeTab === 'header' && (
        <SectionCard title="Site Header">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Site Name" hint="Shown in the browser tab and site header">
              <Input
                value={settings.siteName}
                onChange={(v) => patch('siteName', v)}
                placeholder="Wattaman"
              />
            </Field>
            <Field label="Tagline" hint="Shown below the site name in the header">
              <Input
                value={settings.siteTagline}
                onChange={(v) => patch('siteTagline', v)}
                placeholder="Smart School Management"
              />
            </Field>
          </div>
          <Field label="Logo" hint="Upload your school logo or paste a URL. Displayed in the header and footer.">
            <ImageUploader
              value={settings.logoUrl}
              onChange={(v) => patch('logoUrl', v)}
              aspectLabel="Square PNG/WebP recommended (e.g. 200×200 px)"
              maxW={400}
              maxH={400}
            />
          </Field>
          {settings.logoUrl && (
            <div className="mt-2 flex items-center gap-4 p-4 border border-gray-200 rounded-xl bg-gray-50">
              <img
                src={settings.logoUrl}
                alt="logo preview"
                className="h-12 object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
              />
              <div>
                <p className="text-sm font-semibold text-gray-800">{settings.siteName}</p>
                <p className="text-xs text-gray-500">{settings.siteTagline}</p>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Footer ── */}
      {activeTab === 'footer' && (
        <div className="space-y-4">
          <SectionCard title="Contact Information">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Address">
                <Input value={settings.footerAddress} onChange={(v) => patch('footerAddress', v)} placeholder="123 School St, Phnom Penh" />
              </Field>
              <Field label="Phone">
                <Input value={settings.footerPhone} onChange={(v) => patch('footerPhone', v)} placeholder="+855 23 000 000" />
              </Field>
              <Field label="Email">
                <Input value={settings.footerEmail} onChange={(v) => patch('footerEmail', v)} placeholder="info@school.edu.kh" type="email" />
              </Field>
              <Field label="Copyright Text">
                <Input
                  value={settings.footerCopyright}
                  onChange={(v) => patch('footerCopyright', v)}
                  placeholder={`© ${new Date().getFullYear()} Your School`}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Social Media Links">
            <p className="text-sm text-gray-500">Leave blank to hide the social icon in the footer.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Facebook">
                <div className="flex items-center gap-2">
                  <span className="flex-none w-8 h-8 flex items-center justify-center rounded-lg bg-blue-100">
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/>
                    </svg>
                  </span>
                  <Input value={settings.footerFacebook} onChange={(v) => patch('footerFacebook', v)} placeholder="https://facebook.com/yourpage" />
                </div>
              </Field>
              <Field label="Instagram">
                <div className="flex items-center gap-2">
                  <span className="flex-none w-8 h-8 flex items-center justify-center rounded-lg bg-pink-100">
                    <svg className="w-4 h-4 text-pink-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" strokeWidth={1.5}/>
                      <circle cx="12" cy="12" r="4" strokeWidth={1.5}/>
                      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" strokeWidth={0}/>
                    </svg>
                  </span>
                  <Input value={settings.footerInstagram} onChange={(v) => patch('footerInstagram', v)} placeholder="https://instagram.com/yourpage" />
                </div>
              </Field>
              <Field label="Twitter / X">
                <div className="flex items-center gap-2">
                  <span className="flex-none w-8 h-8 flex items-center justify-center rounded-lg bg-sky-100">
                    <svg className="w-4 h-4 text-sky-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </span>
                  <Input value={settings.footerTwitter} onChange={(v) => patch('footerTwitter', v)} placeholder="https://twitter.com/yourpage" />
                </div>
              </Field>
              <Field label="YouTube">
                <div className="flex items-center gap-2">
                  <span className="flex-none w-8 h-8 flex items-center justify-center rounded-lg bg-red-100">
                    <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 001.46 6.42 29 29 0 001 12a29 29 0 00.46 5.58 2.78 2.78 0 001.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 001.95-1.96A29 29 0 0023 12a29 29 0 00-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/>
                    </svg>
                  </span>
                  <Input value={settings.footerYoutube} onChange={(v) => patch('footerYoutube', v)} placeholder="https://youtube.com/yourchannel" />
                </div>
              </Field>
            </div>
          </SectionCard>

          {/* Footer preview */}
          <SectionCard title="Footer Preview">
            <div className="rounded-xl bg-gray-900 text-white p-6 space-y-4">
              <div className="flex flex-col md:flex-row gap-6 justify-between">
                <div className="space-y-1">
                  <p className="font-bold text-lg">{settings.siteName || 'Wattaman'}</p>
                  <p className="text-gray-400 text-sm">{settings.siteTagline || 'Smart School Management'}</p>
                  {settings.footerAddress && <p className="text-gray-400 text-sm">{settings.footerAddress}</p>}
                  {settings.footerPhone && <p className="text-gray-400 text-sm">{settings.footerPhone}</p>}
                  {settings.footerEmail && <p className="text-gray-400 text-sm">{settings.footerEmail}</p>}
                </div>
                <div className="flex gap-3 items-start">
                  {settings.footerFacebook && (
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/>
                      </svg>
                    </div>
                  )}
                  {settings.footerTwitter && (
                    <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    </div>
                  )}
                  {settings.footerInstagram && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" strokeWidth={1.5}/>
                        <circle cx="12" cy="12" r="4" strokeWidth={1.5}/>
                        <circle cx="17.5" cy="6.5" r="0.5" fill="white" strokeWidth={0}/>
                      </svg>
                    </div>
                  )}
                  {settings.footerYoutube && (
                    <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 001.46 6.42 29 29 0 001 12a29 29 0 00.46 5.58 2.78 2.78 0 001.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 001.95-1.96A29 29 0 0023 12a29 29 0 00-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z"/>
                      </svg>
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-gray-700 pt-4 text-center text-gray-500 text-xs">
                {settings.footerCopyright || `© ${new Date().getFullYear()} Wattaman School. All rights reserved.`}
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Theme ── */}
      {activeTab === 'theme' && (
        <div className="space-y-4">
          <SectionCard title="Brand Color">
            <Field label="Primary Color" hint="Used for buttons, links, and accents across the site.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={settings.primaryColor}
                  onChange={(e) => patch('primaryColor', e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
                />
                <Input
                  value={settings.primaryColor}
                  onChange={(v) => patch('primaryColor', v)}
                  placeholder="#4f46e5"
                />
                <div
                  className="flex-none w-10 h-10 rounded-lg border border-gray-200"
                  style={{ backgroundColor: settings.primaryColor }}
                />
              </div>
            </Field>
            <div className="mt-4 grid grid-cols-6 gap-2">
              {[
                '#4f46e5', '#7c3aed', '#db2777', '#dc2626',
                '#d97706', '#059669', '#0284c7', '#0f172a',
              ].map((color) => (
                <button
                  key={color}
                  onClick={() => patch('primaryColor', color)}
                  title={color}
                  className={`h-8 rounded-lg border-2 transition-all ${settings.primaryColor === color ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Custom CSS">
            <Field label="Advanced CSS" hint="Injected into the <head> of every page. Use sparingly — this overrides built-in styles.">
              <textarea
                value={settings.customCss}
                onChange={(e) => patch('customCss', e.target.value)}
                rows={10}
                placeholder={`:root {\n  /* Override CSS variables here */\n}`}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 resize-y"
              />
            </Field>
          </SectionCard>
        </div>
      )}

      {/* Bottom save bar */}
      <div className="sticky bottom-0 bg-white/90 backdrop-blur border-t border-gray-200 -mx-6 px-6 py-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Changes are applied site-wide after saving.
        </p>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
              </svg>
              Saved successfully
            </span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Page export ─────────────────────────────────────────── */

export default function AppearancePage() {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-gray-50">
        <Sidebar
          title="Admin"
          navItems={adminNav}
          accentColor="indigo"
        />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <AppearanceContent />
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
