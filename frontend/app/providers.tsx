'use client'

import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageProvider } from '../lib/i18n'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  }))

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Defer registration until after first paint so we never block hydration.
    const onLoad = () => {
      // Version the URL as well as the cache name so CDN/browser caches cannot
      // hide a newly deployed service worker from installed scanner devices.
      navigator.serviceWorker.register('/sw.js?v=2', { updateViaCache: 'none' })
        .then(registration => registration.update())
        .catch(() => { /* ignore */ })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })

    // Deliberately NOT reloading the page when a new service worker takes
    // control (e.g. after a redeploy while this tab was open). That used to
    // call window.location.reload() here, but a forced reload can land at
    // any moment — including mid-exam for a student with this tab open —
    // silently discarding whatever they were doing. A stale bundle after a
    // deploy is a much smaller problem than that.
    return () => {
      window.removeEventListener('load', onLoad)
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  )
}

