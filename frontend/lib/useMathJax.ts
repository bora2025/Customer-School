'use client'

import { useEffect, useState } from 'react'

declare global {
  interface Window {
    MathJax?: any
  }
}

let loadStarted = false

/** Loads MathJax v3 (TeX input, SVG output) from CDN exactly once for the whole
 * app, however many components call this hook. Configured with the same
 * \( \) / \[ \] delimiters as the standalone /tools/latex-editor page, so
 * LaTeX typed anywhere (question prompts, choices, course content) renders
 * consistently. */
export function useMathJax(): boolean {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.MathJax?.typesetPromise)

  useEffect(() => {
    if (window.MathJax?.typesetPromise) { setReady(true); return }
    if (loadStarted) {
      // Another component already kicked off the load — poll until it's ready.
      const id = setInterval(() => {
        if (window.MathJax?.typesetPromise) { setReady(true); clearInterval(id) }
      }, 100)
      return () => clearInterval(id)
    }
    loadStarted = true
    window.MathJax = {
      tex: {
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]']],
      },
      svg: { fontCache: 'global' },
      startup: { typeset: false },
    }
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js'
    script.async = true
    script.onload = () => setReady(true)
    document.head.appendChild(script)
  }, [])

  return ready
}
