"use client"

import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { adminNav } from '../../../lib/admin-nav'
import { useLanguage } from '../../../lib/i18n'

function ManageHubContent() {
  const { t } = useLanguage()

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattaman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />

        <div className="page-header">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">{t('nav.manageUsers')}</h1>
          <p className="text-sm text-slate-500 mt-1">Quick management shortcuts for mobile</p>
        </div>

        <div className="page-body">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/admin/classes" className="card-hover p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl">📚</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-800">{t('nav.manageClasses')}</h2>
              <p className="mt-1 text-sm text-slate-500">Manage classes and class assignments.</p>
            </Link>

            <Link href="/admin/employees?section=departments" className="card-hover p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="w-12 h-12 rounded-xl bg-cyan-50 text-cyan-600 flex items-center justify-center text-xl">🏢</div>
              <h2 className="mt-4 text-lg font-semibold text-slate-800">{t('nav.manageOfficer')}</h2>
              <p className="mt-1 text-sm text-slate-500">Open department management only.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ManageHubPage() {
  return (
    <AuthGuard requiredRole="ADMIN">
      <ManageHubContent />
    </AuthGuard>
  )
}
