"use client"

import { Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import AuthGuard from '../../../../../components/AuthGuard'
import Sidebar from '../../../../../components/Sidebar'
import { teacherNav } from '../../../../../lib/teacher-nav'
import { adminNav } from '../../../../../lib/admin-nav'
import { apiFetch } from '../../../../../lib/api'
import ExamForm, { type ExamClassItem, type ExamEditInitialData } from '../../../../../components/ExamForm'
import { defaultQuestion } from '../../../../../components/ExamQuestionsEditor'

// This page (and its sibling ../new/page.tsx) is reachable from three places:
// admin's Examinations sidebar page, the Manage Classes exams panel, and the
// teacher's own Examinations page — one shared page instead of duplicating the
// exam builder per role, same reasoning as the grading page at
// /teacher/exams/[id]/attempts (which both roles already used before this).
// Sidebar/back-button adapt to whichever role is actually logged in.
export default function EditExamPage() {
  return (
    <Suspense>
      <EditExamPageContent />
    </Suspense>
  )
}

function EditExamPageContent() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const examId = params?.id as string
  const searchParams = useSearchParams()
  const returnTo = searchParams?.get('returnTo') || undefined
  const qc = useQueryClient()

  const isAdmin = typeof window !== 'undefined' && ['ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(localStorage.getItem('role') || '')
  const target = returnTo || (isAdmin ? '/admin/exams' : '/teacher/exams')

  const { data: classes = [] as ExamClassItem[] } = useQuery<ExamClassItem[]>({
    queryKey: ['classes-list'],
    queryFn: async () => { const r = await apiFetch('/api/classes'); if (!r.ok) throw new Error(); return r.json() },
  })

  const { data: initialData, isLoading, isError } = useQuery<ExamEditInitialData>({
    enabled: !!examId,
    queryKey: ['exam-edit', examId],
    queryFn: async () => {
      const r = await apiFetch(`/api/exams/${examId}`)
      if (!r.ok) throw new Error('Failed to load exam')
      const full = await r.json()
      return {
        title: full.title || '',
        description: full.description || '',
        classId: full.classId || full.class?.id || '',
        duration: full.duration ?? 60,
        totalMarks: full.totalMarks ?? 100,
        passMark: full.passMark ?? 50,
        maxAttempts: full.maxAttempts ?? 1,
        questions: (full.questions || []).length
          ? full.questions.map((q: any) => ({ text: q.text, type: q.type, marks: q.marks, data: q.data, section: q.section }))
          : [defaultQuestion()],
      }
    },
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
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">✏️ Edit Exam</h1>
            </div>
            {isLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="bg-white h-16 rounded-2xl animate-pulse border border-gray-100" />)}</div>
            ) : isError || !initialData ? (
              <div className="text-red-600 text-sm">Failed to load exam for editing.</div>
            ) : (
              <ExamForm
                classes={classes}
                examId={examId}
                initialData={initialData}
                onCancel={goBack}
                onSuccess={() => {
                  qc.invalidateQueries({ queryKey: ['exams'] })
                  qc.invalidateQueries({ queryKey: ['teacher-exams'] })
                  router.push(target)
                }}
              />
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
