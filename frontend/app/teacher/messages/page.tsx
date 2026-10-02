"use client"

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import Link from 'next/link'
import AuthGuard from '../../../components/AuthGuard'
import Sidebar from '../../../components/Sidebar'
import { teacherNav } from '../../../lib/teacher-nav'
import { apiFetch, getCurrentUser } from '../../../lib/api'
import { formatCambodiaTime } from '../../../lib/dateUtils'
import { useMessageSocket } from '../../../lib/messageSocket'

interface Message { id: string; content: string; createdAt: string; readAt: string | null; sender: { id: string; name: string; photo: string | null }; receiver: { id: string; name: string } }
interface Inbox { partner: { id: string; name: string; photo: string | null; role: string }; lastMessage: Message }
interface Contact { id: string; name: string; role: string }

export default function TeacherMessagesPage() {
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null)
  const [showContactList, setShowContactList] = useState(false)
  const [contactFilter, setContactFilter] = useState<'ALL' | 'PARENT' | 'STUDENT'>('ALL')
  const [search, setSearch] = useState('')
  const [myId, setMyId] = useState<string>('')
  const qc = useQueryClient()

  useEffect(() => { getCurrentUser().then(u => u && setMyId(u.userId)) }, [])
  useMessageSocket(myId || undefined, {
    onMessage: () => {
      qc.invalidateQueries({ queryKey: ['conversation', selectedPartnerId] })
      qc.invalidateQueries({ queryKey: ['teacher-inbox'] })
    },
  })

  const { data: inbox = [] as Inbox[], isLoading } = useQuery<Inbox[]>({
    queryKey: ['teacher-inbox'],
    queryFn: async () => { const r = await apiFetch('/api/messages/inbox'); if (!r.ok) throw new Error(); return r.json() },
  })
  const { data: contacts = [] as Contact[] } = useQuery<Contact[]>({
    queryKey: ['message-contacts'],
    queryFn: async () => { const r = await apiFetch('/api/messages/parents-students'); if (!r.ok) throw new Error(); return r.json() },
  })
  const { data: conversation = [] as Message[] } = useQuery<Message[]>({
    queryKey: ['conversation', selectedPartnerId],
    queryFn: async () => { const r = await apiFetch(`/api/messages/conversation/${selectedPartnerId}`); if (!r.ok) throw new Error(); return r.json() },
    enabled: !!selectedPartnerId,
  })

  const sendMutation = useMutation({
    mutationFn: (data: { receiverId: string; content: string }) =>
      apiFetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversation', selectedPartnerId] }); qc.invalidateQueries({ queryKey: ['teacher-inbox'] }) },
  })

  const markReadMutation = useMutation({
    mutationFn: (partnerId: string) =>
      apiFetch(`/api/messages/read/${partnerId}`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-inbox'] }),
  })

  const onSelectPartner = (id: string) => {
    setSelectedPartnerId(id)
    markReadMutation.mutate(id)
  }

  const { register, handleSubmit, reset } = useForm<{ content: string }>()
  const onSend = (data: { content: string }) => {
    if (!selectedPartnerId || !data.content?.trim()) return
    sendMutation.mutate({ receiverId: selectedPartnerId, content: data.content.trim() })
    reset()
  }

  const filteredContacts = contacts
    .filter(c => contactFilter === 'ALL' || c.role === contactFilter)
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  const selectedPartner = inbox.find(i => i.partner.id === selectedPartnerId)?.partner
    ?? contacts.find(c => c.id === selectedPartnerId)

  return (
    <AuthGuard requiredRole="TEACHER">
      <div className="flex min-h-screen bg-slate-50 pb-[72px] lg:pb-0">
        <Sidebar title="Teacher" subtitle="Portal" navItems={teacherNav} accentColor="emerald" />
        {/* Mobile top spacer for fixed bar */}
        <div className="h-14 lg:hidden" />
        <aside className={`${selectedPartnerId ? 'hidden lg:flex' : 'flex'} w-full lg:w-72 bg-white border-r border-slate-200 flex-col`}>
          <div className="p-4 border-b border-slate-100">
            <Link href="/teacher" className="text-xs text-sky-600">← Back</Link>
            <p className="text-sm font-bold text-slate-700 mt-2">Messages</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <button onClick={() => setShowContactList(s => !s)}
              className="w-full text-xs text-sky-600 py-2 hover:underline">+ New Message</button>

            {showContactList && (
              <div className="mb-3 border border-slate-200 rounded-lg p-2 bg-slate-50">
                <input
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="w-full text-xs border border-slate-200 rounded-md px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-sky-300"
                />
                <div className="flex gap-1 mb-2">
                  {(['ALL', 'PARENT', 'STUDENT'] as const).map(f => (
                    <button key={f} onClick={() => setContactFilter(f)}
                      className={`text-[10px] px-2 py-1 rounded-full font-semibold ${contactFilter === f ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
                      {f === 'ALL' ? 'All' : f === 'PARENT' ? 'Parents' : 'Students'}
                    </button>
                  ))}
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredContacts.length === 0 && (
                    <p className="text-[11px] text-slate-400 px-2 py-1">No matches</p>
                  )}
                  {filteredContacts.map(c => (
                    <button key={c.id}
                      onClick={() => { onSelectPartner(c.id); setShowContactList(false); setSearch('') }}
                      className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-white text-slate-700 flex items-center justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${c.role === 'PARENT' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                        {c.role}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="animate-pulse h-10 bg-slate-100 rounded-lg m-2" />
            ) : inbox.length === 0 ? (
              <p className="text-xs text-slate-400 px-3 py-4 text-center">No conversations yet. Tap “New Message” to start one.</p>
            ) : inbox.map(item => {
              const lm = item.lastMessage
              const unread = !lm?.readAt && lm?.sender?.id === item.partner.id
              return (
                <button key={item.partner.id} onClick={() => onSelectPartner(item.partner.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${selectedPartnerId === item.partner.id ? 'bg-sky-100 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate ${unread ? 'font-bold text-slate-800' : 'font-medium'}`}>{item.partner.name}</p>
                    {unread && <span className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />}
                  </div>
                  <p className="text-xs truncate text-slate-400">{lm?.content ?? ''}</p>
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
                <p className="text-xs text-slate-400 mt-1">or start a new one with any parent or student.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sticky top-0 z-10">
                <button onClick={() => setSelectedPartnerId(null)} className="lg:hidden w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 active:scale-95 transition-transform" aria-label="Back to conversations">←</button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400 text-white font-bold flex items-center justify-center shadow-sm">
                  {(selectedPartner?.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{selectedPartner?.name ?? 'Chat'}</p>
                  <p className="text-xs text-slate-400">{selectedPartner?.role ?? ''}</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 bg-slate-50">
                {conversation.length === 0 && (
                  <p className="text-center text-sm text-slate-400 mt-8">No messages yet — say hello 👋</p>
                )}
                {conversation.map((msg, i) => {
                  const mine = msg.sender.id !== selectedPartnerId
                  const prev = conversation[i - 1]
                  const showAvatar = !mine && (!prev || prev.sender.id !== msg.sender.id)
                  return (
                    <div key={msg.id} className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                      {!mine && (
                        showAvatar ? (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-emerald-400 text-white text-xs font-bold flex items-center justify-center shrink-0">
                            {(selectedPartner?.name || '?').charAt(0).toUpperCase()}
                          </div>
                        ) : <div className="w-7 shrink-0" />
                      )}
                      <div className={`max-w-[80%] sm:max-w-md px-3.5 py-2 rounded-2xl text-sm shadow-sm ${mine ? 'bg-sky-600 text-white rounded-br-md' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md'}`}>
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${mine ? 'text-sky-100' : 'text-slate-400'}`}>
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
                  className="flex-1 border border-slate-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                <button type="submit" disabled={sendMutation.isPending}
                  className="bg-sky-600 text-white px-4 sm:px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-60 active:scale-95 transition-transform">
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
