"use client"

import { useEffect, useMemo, useRef } from 'react'
import DOMPurify from 'isomorphic-dompurify'
import { useMathJax } from '../lib/useMathJax'
import MathText from './MathText'

const HTML_TAG_RE = /<([a-z][a-z0-9]*)\b[^>]*>/i
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** Adds a speed selector next to every <audio> in the container (idempotent —
 * safe to call again after re-renders). Plain DOM manipulation rather than React
 * since this runs over a dangerouslySetInnerHTML subtree React doesn't manage. */
function enhanceAudioPlayers(container: HTMLElement) {
  container.querySelectorAll('audio').forEach((audio) => {
    if (audio.dataset.enhanced) return
    audio.dataset.enhanced = '1'
    audio.className = `${audio.className} max-w-full`.trim()

    const wrap = document.createElement('div')
    wrap.className = 'flex items-center gap-1.5 mt-1'
    const label = document.createElement('span')
    label.className = 'text-xs text-slate-500'
    label.textContent = 'Speed:'
    const select = document.createElement('select')
    select.className = 'text-xs border border-slate-200 rounded px-1 py-0.5 bg-white'
    PLAYBACK_RATES.forEach((rate) => {
      const opt = document.createElement('option')
      opt.value = String(rate)
      opt.textContent = `${rate}x`
      if (rate === 1) opt.selected = true
      select.appendChild(opt)
    })
    select.addEventListener('change', () => {
      audio.playbackRate = Number(select.value)
    })

    wrap.appendChild(label)
    wrap.appendChild(select)
    audio.insertAdjacentElement('afterend', wrap)

    // Playback failures (unsupported codec, corrupt data, etc.) otherwise fail
    // completely silently — the native controls just never respond to play.
    audio.addEventListener('error', () => {
      const err = audio.error
      const reason = err?.code === MediaError.MEDIA_ERR_DECODE ? 'This audio file is corrupted or uses an unsupported encoding.'
        : err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "This browser can't play this audio format."
        : 'This audio failed to load.'
      const notice = document.createElement('p')
      notice.className = 'text-xs text-red-600 mt-1'
      notice.textContent = `⚠ ${reason}`
      wrap.insertAdjacentElement('afterend', notice)
    })
  })
}

/** Renders a question's rich text (authored via RichTextEditor). Content authored
 * before this feature existed is plain text (possibly with LaTeX delimiters) —
 * detected by the absence of any real HTML tag and rendered via the existing
 * MathText component unchanged, so no data migration is needed. Content that does
 * contain HTML tags is sanitized (DOMPurify) and rendered as markup, then MathJax
 * typesets any \( \) / \[ \] LaTeX found inside it, and any <audio> element gets a
 * speed-control dropdown added next to its native play/pause/seek controls. */
export default function RichText({
  html, as = 'div', className,
}: { html: string | null | undefined; as?: 'div' | 'span' | 'p'; className?: string }) {
  const value = html ?? ''
  const looksLikeHtml = HTML_TAG_RE.test(value)
  const ready = useMathJax()
  const ref = useRef<HTMLElement>(null)

  // Sanitizing a large question (e.g. one with an embedded audio file, whose
  // base64 data URI can run into the megabytes) takes real time — recomputing
  // it on every render, rather than only when the content itself changes,
  // blocked the main thread on a ~200ms loop anywhere this re-rendered on a
  // timer (an exam countdown ticking every second), which is enough to make
  // the whole page feel like it's stuttering/reloading and can starve a media
  // element's own event handling at the same cadence.
  const clean = useMemo(() => {
    if (!looksLikeHtml) return ''
    return DOMPurify.sanitize(value, { ADD_TAGS: ['audio'], ADD_ATTR: ['controls', 'preload'] })
  }, [value, looksLikeHtml])

  useEffect(() => {
    if (!looksLikeHtml || !ref.current) return
    enhanceAudioPlayers(ref.current)
  }, [value, looksLikeHtml])

  useEffect(() => {
    if (!looksLikeHtml || !ready || !ref.current) return
    const el = ref.current
    window.MathJax?.typesetPromise?.([el]).catch(() => {
      // Leave the rendered HTML visible even if a LaTeX fragment fails to typeset.
    })
    return () => {
      try { window.MathJax?.typesetClear?.([el]) } catch {}
    }
  }, [ready, value, looksLikeHtml])

  if (!looksLikeHtml) {
    return <MathText as={as} text={value} className={className} />
  }

  const Tag = as as any
  return <Tag ref={ref} className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
