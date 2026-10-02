"use client"

import PortalManager from '../../../components/PortalManager'

export default function ManageParentsPage() {
  return (
    <PortalManager
      title="Parent Portal"
      subtitle="Manage parent accounts"
      roles={['PARENT']}
      accent="violet"
    />
  )
}
