"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import { useMathJax } from '../../../lib/useMathJax'

const EXAMPLES = [
  { label: 'Inline: √16 = 4', value: String.raw`\(\sqrt{16} = 4\)` },
  { label: 'Block: ∫₀¹ x² dx', value: String.raw`\[\int_0^1 x^2 \, dx\]` },
  { label: 'Pythagorean theorem', value: String.raw`\(x^2 + y^2 = z^2\)` },
  { label: 'Fraction', value: String.raw`\[\frac{1}{2} + \frac{1}{3} = \frac{5}{6}\]` },
]

const SNIPPETS: { label: string; insert: string; caretOffset: number }[] = [
  { label: '( )', insert: '\\(\\)', caretOffset: 2 },
  { label: '[ ]', insert: '\\[\\]', caretOffset: 2 },
  { label: 'Fraction', insert: '\\frac{}{}', caretOffset: 6 },
  { label: '√', insert: '\\sqrt{}', caretOffset: 6 },
  { label: 'x²', insert: '^{}', caretOffset: 2 },
  { label: 'Integral', insert: '\\int_{}^{}', caretOffset: 5 },
  { label: 'Sum', insert: '\\sum_{}^{}', caretOffset: 5 },
]

const DEFAULT_INPUT = String.raw`\(\sqrt{16} = 4\)`

export default function LatexEditorPage() {
  const [input, setInput] = useState(DEFAULT_INPUT)
  const mathJaxReady = useMathJax()
  const [renderError, setRenderError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Live preview — debounced re-typeset on every input change.
  useEffect(() => {
    if (!mathJaxReady || !outputRef.current) return
    const timer = setTimeout(async () => {
      const container = outputRef.current
      if (!container) return
      container.innerHTML = ''
      const holder = document.createElement('div')
      // Set as text (never innerHTML) so raw LaTeX/backslashes are never
      // interpreted as markup — MathJax scans the text content for its own
      // delimiters and leaves everything else as plain text.
      holder.textContent = input
      container.appendChild(holder)
      try {
        await window.MathJax.typesetPromise([holder])
        const errs = holder.querySelectorAll('[data-mjx-error], .mjx-merror')
        setRenderError(errs.length > 0 ? 'Some LaTeX could not be rendered — check for typos or unbalanced braces/brackets.' : null)
      } catch (e: any) {
        setRenderError(e?.message || 'Failed to render LaTeX.')
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [input, mathJaxReady])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1800)
  }, [])

  function insertSnippet(snippet: string, caretOffset: number) {
    const ta = textareaRef.current
    if (!ta) { setInput(v => v + snippet); return }
    const start = ta.selectionStart ?? input.length
    const end = ta.selectionEnd ?? input.length
    const next = input.slice(0, start) + snippet + input.slice(end)
    setInput(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + caretOffset
      ta.setSelectionRange(pos, pos)
    })
  }

  async function copyLatex() {
    try {
      await navigator.clipboard.writeText(input)
      showToast('LaTeX copied to clipboard')
    } catch {
      showToast('Copy failed — select and copy manually')
    }
  }

  async function copyRenderedHtml() {
    if (!outputRef.current?.innerHTML) { showToast('Nothing to copy yet'); return }
    try {
      await navigator.clipboard.writeText(outputRef.current.innerHTML)
      showToast('Rendered HTML copied to clipboard')
    } catch {
      showToast('Copy failed — select and copy manually')
    }
  }

  function firstSvg(): SVGSVGElement | null {
    return outputRef.current?.querySelector('svg') ?? null
  }

  function downloadSvg() {
    const svg = firstSvg()
    if (!svg) { showToast('Nothing rendered yet'); return }
    const serialized = new XMLSerializer().serializeToString(svg)
    const withNs = serialized.includes('xmlns=')
      ? serialized
      : serialized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    const blob = new Blob([withNs], { type: 'image/svg+xml' })
    triggerDownload(URL.createObjectURL(blob), 'math.svg')
  }

  function downloadPng() {
    const svg = firstSvg()
    if (!svg) { showToast('Nothing rendered yet'); return }
    const serialized = new XMLSerializer().serializeToString(svg)
    const withNs = serialized.includes('xmlns=')
      ? serialized
      : serialized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(withNs)
    const img = new Image()
    img.onload = () => {
      const scale = 3 // export at higher resolution than the on-screen SVG
      const w = (img.width || 200) * scale
      const h = (img.height || 60) * scale
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      triggerDownload(canvas.toDataURL('image/png'), 'math.png')
    }
    img.onerror = () => showToast('Failed to export PNG')
    img.src = svgUrl
  }

  function triggerDownload(href: string, filename: string) {
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    a.click()
  }

  return (
    <div
      className="min-h-screen bg-slate-50 py-6 px-3 sm:py-10 sm:px-6"
      style={{ fontFamily: "'Noto Sans Khmer', 'Khmer OS', ui-sans-serif, system-ui, sans-serif" }}
    >
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">∑ LaTeX Live Editor</h1>
          <p className="text-sm text-slate-500 mt-1">
            Type LaTeX using <code className="bg-slate-100 px-1 rounded">\( ... \)</code> for inline math or{' '}
            <code className="bg-slate-100 px-1 rounded">\[ ... \]</code> for block math. Plain text (including Khmer)
            outside those delimiters renders as-is.
          </p>
        </div>

        {/* Quick examples */}
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setInput(ex.value)}
              className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-sky-300 hover:text-sky-700"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 sm:p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Input (LaTeX)</label>
            <div className="flex flex-wrap gap-1.5">
              {SNIPPETS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => insertSnippet(s.insert, s.caretOffset)}
                  title={s.insert}
                  className="text-[11px] px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 font-mono"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={5}
            spellCheck={false}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-sky-300"
            placeholder={String.raw`e.g. \(\sqrt{16} = 4\)  or  \[\int_0^1 x^2 dx\]`}
          />
        </div>

        {/* Output area */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 sm:p-4 space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live Preview</label>
          <div
            ref={outputRef}
            className="min-h-[64px] border border-dashed border-slate-200 rounded-lg px-3 py-3 text-base overflow-x-auto"
          >
            {!mathJaxReady && <span className="text-xs text-slate-400">Loading MathJax…</span>}
          </div>
          {renderError && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              ⚠️ {renderError}
            </p>
          )}
        </div>

        {/* Copy / export */}
        <div className="flex flex-wrap gap-2">
          <button onClick={copyLatex} className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-700">
            📋 Copy LaTeX
          </button>
          <button onClick={copyRenderedHtml} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">
            📋 Copy Rendered (HTML)
          </button>
          <button onClick={downloadSvg} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">
            ⬇️ Download SVG
          </button>
          <button onClick={downloadPng} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50">
            ⬇️ Download PNG
          </button>
        </div>

        <p className="text-[11px] text-slate-400">
          This page has no login and no app chrome by design, so it can be embedded directly in an LMS quiz editor
          (e.g. Moodle) via an <code className="bg-slate-100 px-1 rounded">&lt;iframe&gt;</code>.
        </p>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
