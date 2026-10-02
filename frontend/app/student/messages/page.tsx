"use client"

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { apiFetch, getCurrentUser } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import { useMessageSocket } from '../../../lib/messageSocket'

const studentNav = [
  { label: 'nav.dashboard', href: '/student', icon: 'dashboard' },
  { label: 'Assignments', href: '/student/assignments', icon: 'book' },
  { label: 'My Scores', href: '/student/scores', icon: 'chart' },
  { label: 'Exams', href: '/student/exams', icon: 'clipboard' },
  { label: 'Messages', href: '/student/messages', icon: '💬', badgeKey: 'messages' as const },
  { label: 'My Parent', href: '/student/parent', icon: 'users' },
]

interface Message { id: string; content: string; createdAt: string; readAt: string | null; sender: { id: string; name: string; photo: string | null }; receiver: { id: string; name: string } }
interface Inbox { partner: { id: string; name: string; photo: string | null; role: string }; lastMessage: Message }
interface Teacher { id: string; name: string; role: string }
interface FamilyContact { id: string; name: string; role: string; relation: 'parent' | 'child' }

export default function StudentMessagesPage() {
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null)
  const [showNewList, setShowNewList] = useState(false)
  const [myId, setMyId] = useState<string>('')
  const qc = useQueryClient()

  useEffect(() => { getCurrentUser().then(u => u && setMyId(u.userId)) }, [])
  useMessageSocket(myId || undefined, {
    onMessage: () => {
      qc.invalidateQueries({ queryKey: ['conversation', selectedPartnerId] })
      qc.invalidateQueries({ queryKey: ['student-inbox'] })
    },
  })

  const { data: inbox = [] as Inbox[], isLoading } = useQuery<Inbox[]>({
    queryKey: ['student-inbox'],
    queryFn: async () => { const r = await apiFetch('/api/messages/inbox'); if (!r.ok) throw new Error(); return r.json() },
  })
  const { data: teachers = [] as Teacher[] } = useQuery<Teacher[]>({
    queryKey: ['message-teachers'],
    queryFn: async () => { const r = await apiFetch('/api/messages/teachers'); if (!r.ok) throw new Error(); return r.json() },
  })
  const { data: family = [] as FamilyContact[] } = useQuery<FamilyContact[]>({
    queryKey: ['student-family-contacts'],
    queryFn: async () => {
      const r = await apiFetch('/api/messages/family-contacts')
      if (!r.ok) return []
      const list = await r.json()
      return Array.isArray(list) ? list : []
    },
  })
  const { data: conversation = [] as Message[] } = useQuery<Message[]>({
    queryKey: ['conversation', selectedPartnerId],
    queryFn: async () => { const r = await apiFetch(`/api/messages/conversation/${selectedPartnerId}`); if (!r.ok) throw new Error(); return r.json() },
    enabled: !!selectedPartnerId,
  })

  const sendMutation = useMutation({
    mutationFn: (data: { receiverId: string; content: string }) =>
      apiFetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversation', selectedPartnerId] }); qc.invalidateQueries({ queryKey: ['student-inbox'] }) },
  })

  const { register, handleSubmit, reset } = useForm<{ content: string }>()
  const onSend = (data: { content: string }) => {
    if (!selectedPartnerId || !data.content?.trim()) return
    sendMutation.mutate({ receiverId: selectedPartnerId, content: data.content.trim() })
    reset()
  }

  const selectedPartner = inbox.find(i => i.partner.id === selectedPartnerId)?.partner
    ?? teachers.find(t => t.id === selectedPartnerId)
    ?? family.find(f => f.id === selectedPartnerId)

  return (
    <AuthGuard requiredRole="STUDENT">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Student" subtitle="Portal" navItems={studentNav} accentColor="emerald" />
        <div className="h-14 lg:hidden" />

        <aside className={`${selectedPartnerId ? 'hidden lg:flex' : 'flex'} w-full lg:w-72 bg-white border-r border-slate-200 flex-col`}>
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-700">Messages</p>
            <button onClick={() => setShowNewList(v => !v)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500 text-white active:scale-95 transition-transform">
              {showNewList ? 'Close' : '+ New'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {showNewList && (
              <div className="border-b border-slate-100 pb-2">
                {family.length > 0 && (
                  <>
                    <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-slate-400">My family</p>
                    {family.map(f => (
                      <button key={f.id} onClick={() => { setSelectedPartnerId(f.id); setShowNewList(false) }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50 text-emerald-700 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">{f.name.charAt(0).toUpperCase()}</span>
                        <span>{f.name} <span className="text-slate-400 text-xs">(Parent)</span></span>
                      </button>
                    ))}
                  </>
                )}
                <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wide text-slate-400">School staff</p>
                {teachers.map(t => (
                  <button key={t.id} onClick={() => { setSelectedPartnerId(t.id); setShowNewList(false) }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center">{t.name.charAt(0).toUpperCase()}</span>
                    <span>{t.name} <span className="text-slate-400 text-xs">({t.role})</span></span>
                  </button>
                ))}
              </div>
            )}
            {isLoading ? (
              <div className="p-3 space-y-2">{[1,2,3].map(i => <div key={i} className="animate-pulse h-14 bg-slate-100 rounded-xl" />)}</div>
            ) : inbox.length === 0 ? (
              <div className="empty-state py-12">
                <p className="text-4xl mb-2">💬</p>
                <p className="text-sm text-slate-500">No conversations yet</p>
                <p className="text-xs text-slate-400 mt-1">Tap “+ New” to start one.</p>
              </div>
            ) : inbox.map(item => {
              const active = selectedPartnerId === item.partner.id
              return (
                <button key={item.partner.id} onClick={() => setSelectedPartnerId(item.partner.id)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-slate-50 ${active ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-400 text-white text-sm font-bold flex items-center justify-center shrink-0">
                    {(item.partner.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate text-sm">{item.partner.name}</p>
                    <p className="text-xs text-slate-400 truncate">{item.lastMessage?.content ?? ''}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main className={`${selectedPartnerId ? 'flex' : 'hidden lg:flex'} flex-1 flex-col`}>
          {!selectedPartnerId ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <p className="text-5xl mb-3">💬</p>
                <p className="text-slate-500 font-medium">Select a conversation</p>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sticky top-0 z-10">
                <button onClick={() => setSelectedPartnerId(null)} className="lg:hidden w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 active:scale-95 transition-transform" aria-label="Back">←</button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-400 text-white font-bold flex items-center justify-center shadow-sm">
                  {(selectedPartner?.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{selectedPartner?.name ?? 'Chat'}</p>
                  <p className="text-xs text-slate-400">Verified School</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 bg-slate-50">
                {conversation.length === 0 && (
                  <p className="text-center text-sm text-slate-400 mt-8">No messages yet — say hello 👋</p>
                )}
                {conversation.map((msg, i) => {
                  const fromPartner = msg.sender?.id === selectedPartnerId
                  const prev = conversation[i - 1]
                  const showAvatar = fromPartner && (!prev || prev.sender?.id !== msg.sender?.id)
                  return (
                    <div key={msg.id} className={`flex items-end gap-2 ${fromPartner ? 'justify-start' : 'justify-end'}`}>
                      {fromPartner && (
                        showAvatar ? (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-400 text-white text-xs font-bold flex items-center justify-center shrink-0">
                            {(selectedPartner?.name || '?').charAt(0).toUpperCase()}
                          </div>
                        ) : <div className="w-7 shrink-0" />
                      )}
                      <div className={`max-w-[80%] sm:max-w-md px-3.5 py-2 rounded-2xl text-sm shadow-sm ${fromPartner ? 'bg-white border border-slate-200 text-slate-800 rounded-bl-md' : 'bg-emerald-600 text-white rounded-br-md'}`}>
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${fromPartner ? 'text-slate-400' : 'text-emerald-100'}`}>
                          {formatCambodiaTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
              <form onSubmit={handleSubmit(onSend)} className="bg-white border-t border-slate-200 p-3 sm:p-4 flex gap-2 sm:gap-3 sticky bottom-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
                <input {...register('content', { required: true })}
                  placeholder="Type a message…" autoComplete="off"
                  className="flex-1 border border-slate-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                <button type="submit" disabled={sendMutation.isPending}
                  className="bg-emerald-600 text-white px-4 sm:px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-60 active:scale-95 transition-transform">
                  {sendMutation.isPending ? '…' : 'Send'}
                </button>
              </form>
            </>
          )}
        </main>
      </div>
    </AuthGuard>
  )
}
