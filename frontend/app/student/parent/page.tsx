"use client"

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { apiFetch } from '../../../lib/api'

const studentNav = [
  { label: 'nav.dashboard', href: '/student', icon: 'dashboard' },
  { label: 'Assignments', href: '/student/assignments', icon: 'book' },
  { label: 'My Scores', href: '/student/scores', icon: 'chart' },
  { label: 'Exams', href: '/student/exams', icon: 'clipboard' },
  { label: 'Messages', href: '/student/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'My Parent', href: '/student/parent', icon: 'users' },
]

interface ParentInfo {
  studentExists: boolean
  studentId?: string
  parent: { id: string; name: string; email: string; phone: string | null; photo: string | null } | null
}
interface LinkRequest {
  id: string
  parentEmail: string
  parentName: string | null
  parentPhone: string | null
  note: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectReason: string | null
  createdAt: string
  resolvedAt: string | null
}

interface FormValues {
  parentEmail: string
  parentName?: string
  parentPhone?: string
  note?: string
}

export default function StudentParentPage() {
  const qc = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: parentInfo, isLoading: parentLoading } = useQuery<ParentInfo>({
    queryKey: ['my-parent'],
    queryFn: async () => {
      const r = await apiFetch('/api/parent/my-parent')
      if (!r.ok) throw new Error('Failed to load parent info')
      return r.json()
    },
  })

  const { data: latestRequest, isLoading: requestLoading } = useQuery<LinkRequest | null>({
    queryKey: ['my-parent-request'],
    queryFn: async () => {
      const r = await apiFetch('/api/parent/my-parent/request')
      if (!r.ok) return null
      const v = await r.json()
      return v && v.id ? v : null
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>()

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const r = await apiFetch('/api/parent/my-parent/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!r.ok) {
        let msg = `Request failed (${r.status})`
        try { const j = await r.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message } catch {}
        throw new Error(msg)
      }
      return r.json()
    },
    onSuccess: () => {
      setSubmitError(null)
      reset()
      qc.invalidateQueries({ queryKey: ['my-parent-request'] })
    },
    onError: (e: any) => setSubmitError(e?.message ?? 'Submission failed'),
  })

  const onSubmit = (v: FormValues) => createMutation.mutate(v)

  const isLoading = parentLoading || requestLoading
  const hasParent = !!parentInfo?.parent
  const pending = latestRequest?.status === 'PENDING'

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Student" subtitle="Portal" navItems={studentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />
        <main className="flex-1 p-4 sm:p-6 max-w-2xl mx-auto w-full">
          <div className="mb-6">
            <Link href="/student" className="text-xs text-emerald-600 hover:underline">← Dashboard</Link>
            <h1 className="text-2xl font-bold text-slate-800 mt-2">👨‍👩‍👧 My Parent</h1>
            <p className="text-sm text-slate-500 mt-1">View your linked parent or request a link.</p>
          </div>

          {isLoading ? (
            <div className="text-slate-500 text-sm">Loading…</div>
          ) : hasParent ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center gap-4">
                {parentInfo!.parent!.photo ? (
                  <img src={parentInfo!.parent!.photo} alt="" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-2xl font-bold">
                    {parentInfo!.parent!.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-lg font-semibold text-slate-800">{parentInfo!.parent!.name}</p>
                  <p className="text-sm text-slate-500">{parentInfo!.parent!.email}</p>
                  {parentInfo!.parent!.phone && <p className="text-sm text-slate-500">{parentInfo!.parent!.phone}</p>}
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-4">
                To change the linked parent, please contact the school admin.
              </p>
              <Link
                href={`/student/messages`}
                className="inline-block mt-4 text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg"
              >
                💬 Message my parent
              </Link>
            </div>
          ) : pending ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <p className="font-semibold text-amber-800">Pending review</p>
              <p className="text-sm text-amber-700 mt-1">
                You requested to link parent <strong>{latestRequest!.parentEmail}</strong> on{' '}
                {new Date(latestRequest!.createdAt).toLocaleDateString()}. An admin will approve or reject your request soon.
              </p>
            </div>
          ) : (
            <>
              {latestRequest?.status === 'REJECTED' && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                  Your last request for <strong>{latestRequest.parentEmail}</strong> was rejected.
                  {latestRequest.rejectReason && <> Reason: {latestRequest.rejectReason}</>}
                  <br />You can submit a new request below.
                </div>
              )}
              <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-4">
                <p className="text-sm text-slate-600">
                  Enter your parent's information. Admin will review and approve the link.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Parent email <span className="text-red-500">*</span></label>
                  <input
                    type="email"
                    {...register('parentEmail', { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    placeholder="parent@example.com"
                  />
                  {errors.parentEmail && <p className="text-xs text-red-600 mt-1">A valid email is required.</p>}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Parent name (optional)</label>
                    <input
                      type="text"
                      {...register('parentName')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Parent phone (optional)</label>
                    <input
                      type="tel"
                      {...register('parentPhone')}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Note for admin (optional)</label>
                  <textarea
                    rows={2}
                    {...register('note')}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    placeholder="e.g. mother, contact during the day"
                  />
                </div>
                {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
                >
                  {createMutation.isPending ? 'Submitting…' : 'Submit request'}
                </button>
              </form>
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
