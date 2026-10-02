'use client';

import { useEffect, useState } from 'react';
import Sidebar from '../../../components/Sidebar';
import { teacherNav } from '../../../lib/teacher-nav';
import { apiFetch, getCurrentUser } from '../../../lib/api';
import { formatCambodiaTime } from '../../../lib/dateUtils';

interface ClassRow {
  id: string;
  name: string;
  subject?: string;
}
interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  classId: string | null;
  audience: string;
  pinned: boolean;
  channels: string;
  sentAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  class?: { id: string; name: string } | null;
  _count?: { reads: number };
}

export default function TeacherAnnouncementsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [history, setHistory] = useState<AnnouncementRow[]>([]);
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [channels, setChannels] = useState<string[]>(['IN_APP']);
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) return;
      const res = await apiFetch(`/api/classes?teacherId=${user.userId}`);
      if (res.ok) {
        const data = await res.json();
        setClasses(data);
        if (data[0]) setClassId(data[0].id);
      }
      await loadHistory();
    })();
  }, []);

  const loadHistory = async () => {
    const res = await apiFetch('/api/announcements/feed');
    if (res.ok) {
      const data: AnnouncementRow[] = await res.json();
      // Show only CLASS-audience entries authored by anyone for this teacher
      setHistory(data.filter((a) => a.audience === 'CLASS'));
    }
  };

  const toggleChannel = (ch: string) => {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!classId || !title.trim() || !body.trim()) {
      setMsg('Class, title, and body are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          audience: 'CLASS',
          classId,
          channels,
          pinned,
          scheduledAt: scheduledAt || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg(err.message || 'Failed to send');
      } else {
        setTitle('');
        setBody('');
        setPinned(false);
        setScheduledAt('');
        setMsg('Announcement sent.');
        await loadHistory();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 pt-14 lg:pt-0 pb-[72px] lg:pb-0">
      <Sidebar title="Teacher Portal" subtitle="Wattanman" navItems={teacherNav} accentColor="emerald" />
      <main className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mb-1">Class Announcements</h1>
        <p className="text-slate-500 mb-6 text-sm">
          Broadcast to one of your classes — reaches students and their parents.
        </p>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              {classes.length === 0 && <option value="">No classes assigned</option>}
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.subject ? `— ${c.subject}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Quiz on Friday"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Message</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-[120px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your announcement..."
            />
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <label className="text-sm font-medium text-slate-700">Channels:</label>
            {['IN_APP', 'EMAIL', 'SMS'].map((ch) => (
              <label key={ch} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={channels.includes(ch)}
                  onChange={() => toggleChannel(ch)}
                />
                {ch === 'IN_APP' ? 'In-app' : ch === 'EMAIL' ? 'Email' : 'SMS'}
                {ch === 'SMS' && <span className="text-amber-600 text-xs">(billable)</span>}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              Pin to top
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              Schedule:
              <input
                type="datetime-local"
                className="border border-slate-300 rounded px-2 py-1 text-sm"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
          </div>

          {msg && <p className="text-sm text-slate-600">{msg}</p>}

          <button
            type="submit"
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? 'Sending...' : 'Send announcement'}
          </button>
        </form>

        <h2 className="text-lg font-semibold text-slate-800 mt-8 mb-3">Recent class announcements</h2>
        <div className="space-y-2">
          {history.length === 0 && (
            <p className="text-sm text-slate-500">No class announcements yet.</p>
          )}
          {history.map((a) => (
            <div key={a.id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-slate-800">
                  {a.pinned && <span className="mr-1">📌</span>}
                  {a.title}
                </div>
                <span className="text-xs text-slate-500">
                  {formatCambodiaTime(a.sentAt || a.createdAt)}
                </span>
              </div>
              <div className="text-sm text-slate-600 mt-1">{a.body}</div>
              {a.class && (
                <div className="text-xs text-emerald-700 mt-1">{a.class.name}</div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
