'use client'

import { useRef, useState } from 'react'

/* ─── Types ─────────────────────────────────────────────── */

export type PostType = 'text' | 'image' | 'video'

export interface Post {
  id: string
  title: string
  excerpt: string
  body: string
  type: PostType
  imageUrl: string
  videoUrl: string
  published: boolean
  pinned: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export const EMPTY_POST: Omit<Post, 'id' | 'createdAt' | 'updatedAt'> = {
  title: '',
  excerpt: '',
  body: '',
  type: 'text',
  imageUrl: '',
  videoUrl: '',
  published: true,   // new posts are published by default
  pinned: false,
  tags: [],
}

/* ─── Image compression helper ───────────────────────────── */

export function compressImage(file: File, maxW = 1200, maxH = 800, quality = 0.82): Promise<string> {
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

export function ImageUpload({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

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
        <div className="relative rounded-sm overflow-hidden border border-gray-200 group">
          <img src={value} alt="preview" className="w-full h-40 object-cover" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <button type="button" onClick={() => ref.current?.click()}
              className="px-3 py-1.5 bg-white text-gray-800 text-xs font-semibold rounded">Replace</button>
            <button type="button" onClick={() => onChange('')}
              className="px-3 py-1.5 bg-red-500 text-white text-xs font-semibold rounded">Remove</button>
          </div>
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-gray-300 rounded-sm cursor-pointer hover:border-[#2271b1] hover:bg-gray-50 transition-all"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pick(f) }}
        >
          <div className="flex flex-col items-center py-6 gap-2 text-center">
            {busy ? (
              <div className="w-6 h-6 border-2 border-[#2271b1] border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-7 h-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                </svg>
                <p className="text-xs font-medium text-gray-600">Click or drag image here</p>
                <p className="text-[11px] text-gray-400">JPEG, PNG, WebP — max 15 MB</p>
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

/* ─── Video embed helper ──────────────────────────────────── */

export function VideoEmbed({ url }: { url: string }) {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
  if (ytMatch) {
    return (
      <div className="relative rounded-sm overflow-hidden bg-black" style={{ paddingBottom: '56.25%' }}>
        <iframe
          src={`https://www.youtube.com/embed/${ytMatch[1]}`}
          className="absolute inset-0 w-full h-full"
          allowFullScreen
          title="video"
        />
      </div>
    )
  }
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) {
    return (
      <div className="relative rounded-sm overflow-hidden bg-black" style={{ paddingBottom: '56.25%' }}>
        <iframe
          src={`https://player.vimeo.com/video/${vimeoMatch[1]}`}
          className="absolute inset-0 w-full h-full"
          allowFullScreen
          title="video"
        />
      </div>
    )
  }
  return <video src={url} controls className="w-full rounded-sm max-h-52" />
}

export const TYPE_ICON: Record<PostType, string> = { text: '📝', image: '🖼️', video: '🎬' }
