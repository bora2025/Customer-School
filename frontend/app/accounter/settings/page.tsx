'use client'

import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { accounterNav } from '../../../lib/accounter-nav'
import { FeeSettingsDashboard } from '../../../components/FeeSettingsDashboard'

export default function AccounterFeeSettingsPage() {
  return (
    <AuthGuard allowedRoles={['ACCOUNTER']}>
      <div className="flex min-h-screen lg:h-screen bg-gray-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
        <Sidebar title="Accounter" navItems={accounterNav} accentColor="emerald" />
        <FeeSettingsDashboard />
      </div>
    </AuthGuard>
  )
}

