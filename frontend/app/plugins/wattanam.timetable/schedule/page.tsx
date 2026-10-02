'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TimetablePluginSchedulePage() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/timetable/schedule?source=plugin') }, [router])
  return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Opening schedule…</div>
}
