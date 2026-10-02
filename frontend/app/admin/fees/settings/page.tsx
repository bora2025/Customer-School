'use client'

import AuthGuard from '../../../../components/AuthGuard'
import Sidebar from '../../../../components/Sidebar'
import { adminNav } from '../../../../lib/admin-nav'
import { FeeSettingsDashboard } from '../../../../components/FeeSettingsDashboard'

export default function FeeSettingsPage() {
  return (
    <AuthGuard allowedRoles={['ADMIN', 'ACCOUNTER']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Admin" navItems={adminNav} accentColor="indigo" />
        <FeeSettingsDashboard />
      </div>
    </AuthGuard>
  )
}
