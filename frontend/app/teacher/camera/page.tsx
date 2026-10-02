"use client"

import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { teacherNav } from '../../../lib/teacher-nav'
import { useLanguage } from '../../../lib/i18n'

function TeacherCameraHubContent() {
  const { t } = useLanguage()

  return (
    <div className="page-shell">
      <Sidebar title="Teacher Portal" subtitle="Wattanman" navItems={teacherNav} accentColor="emerald" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />

        <div className="page-header">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">{t('nav.takeAttendance')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('camera.chooseAttendanceMode')}</p>
        </div>

        <div className="page-body">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/teacher/staff-attendance" className="card-hover p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">🧑</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-800">{t('camera.selfAttendanceTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('camera.selfAttendanceDesc')}</p>
            </Link>

            <Link href="/teacher/attendance" className="card-hover p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="w-12 h-12 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center text-xl">📚</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-800">{t('camera.classAttendanceTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('camera.classAttendanceTeacherDesc')}</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TeacherCameraHubPage() {
  return (
    <AuthGuard requiredRole="TEACHER">
      <TeacherCameraHubContent />
    </AuthGuard>
  )
}
