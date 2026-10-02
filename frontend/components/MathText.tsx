"use client"

import { useEffect, useRef } from 'react'
import { useMathJax } from '../lib/useMathJax'

/** Renders a string that may contain LaTeX (\( \) inline, \[ \] block) as
 * live-typeset math via MathJax, while plain text (including Khmer) passes
 * through untouched. Used everywhere a question prompt, choice, or lesson
 * body is displayed — read-only rendering only; authoring stays plain-text
 * textareas where teachers type the LaTeX source (compose/verify it with
 * /tools/latex-editor if needed). Skips MathJax entirely when the text has
 * no delimiters, so plain questions pay zero extra cost. */
export default function MathText({
  text, as = 'span', className,
}: { text: string | null | undefined; as?: 'span' | 'div' | 'p'; className?: string }) {
  const ready = useMathJax()
  const ref = useRef<HTMLElement>(null)
  const value = text ?? ''
  const hasMath = /\\\(|\\\[/.test(value)

  useEffect(() => {
    if (!ready || !hasMath || !ref.current) return
    const el = ref.current
    el.textContent = value
    window.MathJax?.typesetPromise?.([el]).catch(() => {
      // Leave the raw LaTeX source visible rather than a blank element.
    })
    return () => {
      try { window.MathJax?.typesetClear?.([el]) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, value, hasMath])

  const Tag = as as any
  return <Tag ref={ref} className={className}>{hasMath ? null : value}</Tag>
}
