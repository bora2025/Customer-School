'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function ResetPasswordForm() {
  const token = useSearchParams().get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password.length < 12) return setMessage('Password must be at least 12 characters.')
    if (password !== confirm) return setMessage('Passwords do not match.')
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(Array.isArray(error.message) ? error.message[0] : error.message || 'Reset link is invalid or expired.')
      }
      setDone(true)
    } catch (error: any) {
      setMessage(error.message || 'Unable to reset password.')
    } finally {
      setLoading(false)
    }
  }

  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
    <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-slate-200">
      <h1 className="text-2xl font-bold text-slate-900">Reset password</h1>
      {done ? <div className="mt-6 space-y-4"><p className="text-green-700">Your password was reset and all previous sessions were signed out.</p><Link className="inline-block rounded-lg bg-teal-700 px-5 py-3 text-white" href="/login">Continue to login</Link></div> :
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {!token && <p className="text-red-700">This reset link is missing its token.</p>}
        <label className="block text-sm font-medium">New password<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label className="block text-sm font-medium">Confirm password<input className="mt-1 w-full rounded-lg border p-3" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
        <button className="w-full rounded-lg bg-teal-700 p-3 font-semibold text-white disabled:opacity-50" disabled={!token || loading}>{loading ? 'Resetting…' : 'Reset password'}</button>
      </form>}
    </section>
  </main>
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="min-h-screen bg-slate-50 flex items-center justify-center">Loading…</main>}><ResetPasswordForm /></Suspense>
}
