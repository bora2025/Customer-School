"use client"

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../components/AuthGuard'
import Sidebar from '../../../../components/Sidebar'
import { teacherNav } from '../../../../lib/teacher-nav'
import { adminNav } from '../../../../lib/admin-nav'
import { apiFetch } from '../../../../lib/api'
import ExamForm, { type ExamClassItem } from '../../../../components/ExamForm'

// Reachable from admin's Examinations page, the Manage Classes exams panel
// (with ?classId= to pre-select and scope it), and the teacher's own
// Examinations page — see [id]/edit/page.tsx's comment for why this pair of
// pages lives under /teacher/exams rather than duplicated per role.
export default function NewExamPage() {
  return (
    <Suspense>
      <NewExamPageContent />
    </Suspense>
  )
}

function NewExamPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const classId = searchParams?.get('classId') || undefined
  const returnTo = searchParams?.get('returnTo') || undefined

  const isAdmin = typeof window !== 'undefined' && ['ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(localStorage.getItem('role') || '')
  const target = returnTo || (isAdmin ? '/admin/exams' : '/teacher/exams')

  const { data: classes = [] as ExamClassItem[] } = useQuery<ExamClassItem[]>({
    queryKey: ['classes-list'],
    queryFn: async () => { const r = await apiFetch('/api/classes'); if (!r.ok) throw new Error(); return r.json() },
  })

  function goBack() { router.push(target) }

  return (
    <AuthGuard allowedRoles={['TEACHER', 'ADMIN', 'SUPER_ADMIN']}>
      <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title={isAdmin ? 'Admin Panel' : 'Teacher'} subtitle={isAdmin ? 'Wattanman' : 'Portal'} navItems={isAdmin ? adminNav : teacherNav} accentColor={isAdmin ? 'indigo' : 'sky'} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <div className="flex items-center gap-3 mb-6">
              <button onClick={goBack} className="text-sm text-gray-500 hover:text-gray-800">← Back</button>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📝 Create Exam</h1>
            </div>
            <ExamForm
              classes={classes}
              defaultClassId={classId}
              onCancel={goBack}
              onSuccess={() => {
                qc.invalidateQueries({ queryKey: ['exams'] })
                qc.invalidateQueries({ queryKey: ['teacher-exams'] })
                router.push(target)
              }}
            />
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
