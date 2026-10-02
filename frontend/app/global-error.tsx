'use client'

import { useEffect } from 'react'

/**
 * Root error boundary. Next.js's Server Action / RSC payload IDs are tied to
 * a specific build. If a browser tab stays open across a redeploy (e.g. a
 * rebuild triggered by changing a NEXT_PUBLIC_* env var or a domain), any
 * request it makes with the OLD build's IDs is rejected by the NEW build's
 * server with: "Failed to find Server Action ... This request might be from
 * an older or newer deployment." The fix is simply to reload so the tab
 * fetches the current deployment's JS bundle.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
    const message = `${error?.message ?? ''} ${error?.digest ?? ''}`
    if (/Failed to find Server Action|older or newer deployment/i.test(message)) {
      window.location.reload()
    }
  }, [error])

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: 0 }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 420, margin: 0 }}>
            A new version of the app may have just been deployed. Reloading the page usually fixes this.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => reset()}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '8px 16px', borderRadius: 8, background: '#00C9A7', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
