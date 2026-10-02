'use client'

import { useParams } from 'next/navigation'
import Sidebar from '../../../../../components/Sidebar'
import AuthGuard from '../../../../../components/AuthGuard'
import { adminNav } from '../../../../../lib/admin-nav'
import PostEditorForm from '../PostEditorForm'

export default function EditPostPage() {
  const params = useParams<{ id: string }>()
  const postId = params?.id as string

  return (
    <AuthGuard>
      <div className="flex h-screen bg-[#f0f0f1]">
        <Sidebar title="Admin" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-8">
            {postId && <PostEditorForm postId={postId} />}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
