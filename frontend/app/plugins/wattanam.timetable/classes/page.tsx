'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
export default function Page() { const router = useRouter(); useEffect(() => { router.replace('/admin/timetable/classes?source=plugin') }, [router]); return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Opening classes…</div> }
