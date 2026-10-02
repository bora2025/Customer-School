'use client'

import Sidebar from '../../../../../components/Sidebar'
import AuthGuard from '../../../../../components/AuthGuard'
import { adminNav } from '../../../../../lib/admin-nav'
import PostEditorForm from '../PostEditorForm'

export default function NewPostPage() {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-[#f0f0f1]">
        <Sidebar title="Admin" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <PostEditorForm />
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
