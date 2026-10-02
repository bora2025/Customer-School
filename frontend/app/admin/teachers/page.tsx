"use client"

import PortalManager from '../../../components/PortalManager'

export default function ManageTeachersPage() {
  return (
    <PortalManager
      title="Teacher Portal"
      subtitle="Manage teacher accounts"
      roles={['TEACHER']}
      accent="emerald"
    />
  )
}
