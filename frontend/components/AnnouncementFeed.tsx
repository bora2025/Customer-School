"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { formatCambodiaTime } from '../lib/dateUtils'

interface FeedAnnouncement {
  id: string
  title: string
  body: string
  audience: 'SCHOOL' | 'ROLE' | 'CLASS'
  targetRole: string | null
  channels: string
  pinned: boolean
  sentAt: string | null
  createdAt: string
  author: { id: string; name: string; role: string }
  class: { id: string; name: string } | null
  read: boolean
  readAt: string | null
}

interface AnnouncementFeedProps {
  accent?: 'indigo' | 'emerald' | 'sky'
  limit?: number
  /** Show a compact "preview" widget (no body, top N only). */
  compact?: boolean
}

const accentClasses = {
  indigo: { bar: 'bg-indigo-500', dot: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700', btn: 'text-indigo-600 hover:text-indigo-700' },
  emerald: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', btn: 'text-emerald-600 hover:text-emerald-700' },
  sky: { bar: 'bg-sky-500', dot: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700', btn: 'text-sky-600 hover:text-sky-700' },
}

export default function AnnouncementFeed({ accent = 'indigo', limit, compact = false }: AnnouncementFeedProps) {
  const qc = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: feed = [], isLoading } = useQuery<FeedAnnouncement[]>({
    queryKey: ['announcements-feed'],
    queryFn: async () => {
      const r = await apiFetch('/api/announcements/feed')
      if (!r.ok) return []
      return r.json()
    },
    refetchInterval: 60_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/announcements/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements-feed'] })
      qc.invalidateQueries({ queryKey: ['announcements-unread'] })
    },
  })

  const items = limit ? feed.slice(0, limit) : feed
  const c = accentClasses[accent]

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-slate-400">
        <p className="text-2xl mb-2">📣</p>
        <p>No announcements yet</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map(a => {
        const open = expandedId === a.id
        const handleOpen = () => {
          setExpandedId(open ? null : a.id)
          if (!a.read && !open) markRead.mutate(a.id)
        }
        return (
          <li
            key={a.id}
            className={`relative rounded-xl border bg-white overflow-hidden ${a.read ? 'border-slate-200' : 'border-slate-300 shadow-sm'}`}
          >
            {!a.read && <span className={`absolute left-0 top-0 bottom-0 w-1 ${c.bar}`} aria-hidden />}
            <button
              type="button"
              onClick={handleOpen}
              className="w-full text-left px-4 py-3 hover:bg-slate-50 transition"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {a.pinned && <span title="Pinned" className="text-amber-500 text-xs">📌</span>}
                    <h4 className={`text-sm truncate ${a.read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                      {a.title}
                    </h4>
                    {!a.read && <span className={`w-2 h-2 rounded-full ${c.dot} flex-shrink-0`} aria-label="unread" />}
                  </div>
                  {!compact && (
                    <p className={`text-xs text-slate-500 ${open ? '' : 'line-clamp-1'} whitespace-pre-wrap break-words`}>
                      {a.body}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                    <span className={`px-1.5 py-0.5 rounded-full font-semibold ${c.badge}`}>
                      {a.audience === 'SCHOOL' && 'School'}
                      {a.audience === 'ROLE' && (a.targetRole === 'ALL' ? 'Everyone' : a.targetRole)}
                      {a.audience === 'CLASS' && (a.class?.name ?? 'Class')}
                    </span>
                    <span>·</span>
                    <span>{a.author.name}</span>
                    <span>·</span>
                    <span>{a.sentAt ? formatCambodiaTime(a.sentAt) : formatCambodiaTime(a.createdAt)}</span>
                  </div>
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
