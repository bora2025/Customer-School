'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGuard from '../../components/AuthGuard';
import Sidebar from '../../components/Sidebar';
import AnnouncementFeed from '../../components/AnnouncementFeed';
import TimetableGrid from '../../components/TimetableGrid';
import { apiFetch, getCurrentUser } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  class?: {
    name: string;
    subject: string;
  } | null;
}

interface AssignmentLite {
  id: string;
  title: string;
  dueDate: string | null;
  totalMarks: number;
  class?: { name: string; subject: string } | null;
  submission: { marks: number | null; isLate: boolean } | null;
}

interface ExamLite {
  id: string;
  title: string;
  status: string;
  duration: number;
  totalMarks: number;
  passMark: number;
  class?: { name: string } | null;
  attempts: { status: string; score: number | null }[];
}

const studentNav = [
  { label: 'nav.dashboard', href: '/student', icon: 'dashboard' },
  { label: 'Courses', href: '/student/courses', icon: 'book' },
  { label: 'Assignments', href: '/student/assignments', icon: 'book' },
  { label: 'My Scores', href: '/student/scores', icon: 'chart' },
  { label: 'Exams', href: '/student/exams', icon: 'clipboard' },
  { label: 'Messages', href: '/student/messages', icon: 'clipboard', badgeKey: 'messages' as const },
  { label: 'My Parent', href: '/student/parent', icon: 'users' },
];

export default function StudentPortal() {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentLite[]>([]);
  const [exams, setExams] = useState<ExamLite[]>([]);
  const [studentName, setStudentName] = useState<string>('');
  const [studentUserId, setStudentUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    getCurrentUser().then(u => { if (u) { setStudentName(u.name || ''); setStudentUserId(u.userId); } });
    fetchAttendance();
    fetchAssignments();
    fetchExams();
  }, []);

  const fetchAttendance = async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;
      const res = await apiFetch(`/api/reports/student-attendance?userId=${user.userId}`);
      if (res.ok) {
        const data = await res.json();
        setAttendance(Array.isArray(data) ? data : []);
      }
    } catch (err) { console.error('Failed to fetch attendance', err); }
    finally { setLoading(false); }
  };

  const fetchAssignments = async () => {
    try {
      const res = await apiFetch('/api/assignments/student/my-assignments');
      if (res.ok) {
        const data = await res.json();
        setAssignments(Array.isArray(data) ? data : []);
      }
    } catch { /* silent */ }
  };

  const fetchExams = async () => {
    try {
      const res = await apiFetch('/api/exams/student/my-exams');
      if (res.ok) {
        const data = await res.json();
        setExams(Array.isArray(data) ? data : []);
      }
    } catch { /* silent */ }
  };

  const downloadReport = () => {
    const csv = 'Date,Class,Subject,Status\n' +
      attendance.map(r => `${r.date},${r.class?.name ?? ''},${r.class?.subject ?? ''},${r.status}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance-report.csv';
    a.click();
  };

  const presentCount = attendance.filter(r => r.status === 'PRESENT').length;
  const rate = attendance.length > 0 ? ((presentCount / attendance.length) * 100).toFixed(0) : '--';

  const now = Date.now();
  const pendingAssignments = assignments.filter(a => !a.submission && (!a.dueDate || new Date(a.dueDate).getTime() >= now));
  const overdueAssignments = assignments.filter(a => !a.submission && a.dueDate && new Date(a.dueDate).getTime() < now);
  const upcomingDeadlines = assignments
    .filter(a => !a.submission && a.dueDate && new Date(a.dueDate).getTime() >= now)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 5);
  const activeExams = exams.filter(e => e.status === 'ACTIVE' && e.attempts.length === 0);

  const gradedAssignments = assignments.filter(a => a.submission && a.submission.marks !== null);
  const overallGrade = gradedAssignments.length
    ? Math.round(
        gradedAssignments.reduce(
          (sum, a) => sum + ((a.submission!.marks ?? 0) / Math.max(1, a.totalMarks)) * 100,
          0,
        ) / gradedAssignments.length,
      )
    : null;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-10 h-10 border-3 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-sm text-slate-500 mt-3">{t('common.loading')}</p>
      </div>
    </div>
  );

  return (
    <AuthGuard requiredRole="STUDENT">
      {/* ── Mobile layout (matches mobile app) ── */}
      <div className="lg:hidden">
        <div className="page-shell">
          <Sidebar title="Student" subtitle="Portal" navItems={studentNav} accentColor="emerald" />
          <div className="page-content">
            <div className="h-14" />
            <div className="page-header">
              <h1 className="text-xl font-bold text-slate-800">
                👋 Hello{studentName ? `, ${studentName}` : ''}
              </h1>
              <p className="text-sm text-slate-500 mt-1">{t('student.subtitle')}</p>
            </div>
            <div className="page-body space-y-4">
              {/* Quick actions */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { href: '/student/courses', icon: '🎓', label: 'Courses', bg: 'from-rose-500 to-pink-500', count: 0 },
                  { href: '/student/assignments', icon: '📚', label: 'Assignments', bg: 'from-emerald-500 to-teal-500', count: pendingAssignments.length },
                  { href: '/student/exams', icon: '📝', label: 'Exams', bg: 'from-violet-500 to-purple-500', count: activeExams.length },
                  { href: '/student/scores', icon: '📊', label: 'Scores', bg: 'from-sky-500 to-blue-500', count: 0 },
                  { href: '/student/messages', icon: '💬', label: 'Messages', bg: 'from-amber-500 to-orange-500', count: 0 },
                ].map(a => (
                  <Link key={a.href} href={a.href} className="group relative">
                    <div className={`rounded-2xl bg-gradient-to-br ${a.bg} p-3 text-white shadow-sm active:scale-[0.97] transition-transform h-full flex flex-col items-center justify-center gap-1`}>
                      <span className="text-2xl" aria-hidden>{a.icon}</span>
                      <span className="text-[10px] font-semibold text-center leading-tight">{a.label}</span>
                    </div>
                    {a.count > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
                        {a.count > 9 ? '9+' : a.count}
                      </span>
                    )}
                  </Link>
                ))}
              </div>

              {/* Announcements */}
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">📣 Announcements</h3>
                <AnnouncementFeed accent="emerald" limit={5} />
              </div>

              {/* My Schedule */}
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">📅 My Schedule</h3>
                {studentUserId && <TimetableGrid userId={studentUserId} role="student" />}
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="stat-card text-center">
                  <p className="stat-value">{attendance.length}</p>
                  <p className="stat-label">{t('student.totalRecords')}</p>
                </div>
                <div className="stat-card text-center">
                  <p className="stat-value" style={{ color: 'var(--color-primary)' }}>{presentCount}</p>
                  <p className="stat-label">{t('common.present')}</p>
                </div>
                <div className="stat-card text-center">
                  <p className="stat-value">{rate}%</p>
                  <p className="stat-label">{t('student.rate')}</p>
                </div>
              </div>

              {/* Attendance list */}
              <div className="card divide-y divide-slate-100">
                {attendance.map((record) => (
                  <div key={record.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      record.status === 'PRESENT' ? 'bg-emerald-500' :
                      record.status === 'ABSENT' ? 'bg-red-500' : 'bg-amber-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {record.class?.name ?? '—'} — {record.class?.subject ?? ''}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(record.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <span className={
                      record.status === 'PRESENT' ? 'badge-green' :
                      record.status === 'ABSENT' ? 'badge-red' : 'badge-yellow'
                    }>
                      {record.status.toLowerCase()}
                    </span>
                  </div>
                ))}
                {attendance.length === 0 && (
                  <div className="empty-state py-12">
                    <p className="text-4xl mb-3">📋</p>
                    <p className="font-semibold text-slate-600">{t('student.noRecords')}</p>
                    <p className="text-sm text-slate-400 mt-1">Your records will appear here once attendance is taken.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Desktop layout (emerald root brand) ── */}
      <div className="hidden lg:block min-h-screen bg-slate-50">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">
                  👋 Hello{studentName ? `, ${studentName}` : ''}
                </h1>
                <p className="text-emerald-100 text-sm mt-1">{t('student.subtitle')}</p>
              </div>
              <Link href="/" className="px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/20 transition-colors">
                ← Home
              </Link>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
                <p className="text-xs text-emerald-100 uppercase tracking-wider">{t('student.totalRecords')}</p>
                <p className="text-2xl font-bold mt-1">{attendance.length}</p>
              </div>
              <div className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
                <p className="text-xs text-emerald-100 uppercase tracking-wider">{t('common.present')}</p>
                <p className="text-2xl font-bold mt-1">{presentCount}</p>
              </div>
              <div className="bg-white/10 rounded-xl px-4 py-3 backdrop-blur-sm">
                <p className="text-xs text-emerald-100 uppercase tracking-wider">{t('student.rate')}</p>
                <p className="text-2xl font-bold mt-1">{rate}%</p>
              </div>
            </div>
          </div>
        </div>

        <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
          {/* My Schedule */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">📅 My Schedule</h2>
            {studentUserId && <TimetableGrid userId={studentUserId} role="student" />}
          </div>

          {/* Quick Access */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Assignments', href: '/student/assignments', icon: '📚', count: pendingAssignments.length, badge: overdueAssignments.length, badgeLabel: 'overdue', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
              { label: 'Exams', href: '/student/exams', icon: '📝', count: activeExams.length, badge: 0, color: 'bg-purple-50 text-purple-700 border-purple-200' },
              { label: 'My Scores', href: '/student/scores', icon: '📊', count: gradedAssignments.length, badge: 0, color: 'bg-sky-50 text-sky-700 border-sky-200' },
              { label: 'Messages', href: '/student/messages', icon: '💬', count: 0, badge: 0, color: 'bg-amber-50 text-amber-700 border-amber-200' },
            ].map(item => (
              <Link key={item.href} href={item.href}
                className={`flex flex-col items-start p-4 rounded-xl border ${item.color} hover:opacity-90 transition-opacity relative`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-sm font-semibold">{item.label}</span>
                </div>
                {item.count > 0 && <p className="text-2xl font-bold leading-none mt-1">{item.count}</p>}
                {item.badge > 0 && (
                  <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                    {item.badge} {item.badgeLabel}
                  </span>
                )}
              </Link>
            ))}
          </div>

          {/* Upcoming Deadlines */}
          {upcomingDeadlines.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">⏰ Upcoming Deadlines</h2>
                <Link href="/student/assignments" className="text-xs text-emerald-600 hover:underline">View all</Link>
              </div>
              <div className="space-y-2">
                {upcomingDeadlines.map(a => {
                  const days = Math.ceil((new Date(a.dueDate!).getTime() - now) / (1000 * 60 * 60 * 24));
                  const urgency = days <= 1 ? 'text-red-600' : days <= 3 ? 'text-amber-600' : 'text-slate-500';
                  return (
                    <Link key={a.id} href="/student/assignments" className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.title}</p>
                        <p className="text-xs text-slate-400 truncate">{a.class?.name ?? ''} · {a.class?.subject ?? ''}</p>
                      </div>
                      <div className={`text-xs font-semibold ${urgency} flex-shrink-0`}>
                        {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active Exams */}
          {activeExams.length > 0 && (
            <div className="card p-5 border-2 border-purple-200 bg-purple-50/30">
              <h2 className="text-sm font-bold text-purple-700 uppercase tracking-wide mb-3">📝 Active Exams — Take Now</h2>
              <div className="space-y-2">
                {activeExams.map(e => (
                  <Link key={e.id} href={`/student/exams/${e.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-purple-100 hover:border-purple-300">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{e.title}</p>
                      <p className="text-xs text-slate-400">{e.class?.name ?? 'General'} · {e.duration} min · Pass {e.passMark}/{e.totalMarks}</p>
                    </div>
                    <span className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg font-semibold">Start</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Performance summary */}
          {overallGrade !== null && (
            <div className="card p-5 flex items-center gap-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white ${overallGrade >= 70 ? 'bg-emerald-500' : overallGrade >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}>
                {overallGrade}
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-800">Overall Grade: {overallGrade}%</p>
                <p className="text-xs text-slate-500">{gradedAssignments.length} graded assignment(s) — attendance rate {rate}%</p>
              </div>
              <Link href="/student/scores" className="text-sm text-emerald-600 hover:underline">Details →</Link>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end">
            <button onClick={downloadReport} className="btn-primary btn-sm">
              📥 {t('student.downloadReport')}
            </button>
          </div>

          {/* Attendance List */}
          <div className="card divide-y divide-slate-100">
            {attendance.map((record) => (
              <div key={record.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  record.status === 'PRESENT' ? 'bg-emerald-500' :
                  record.status === 'ABSENT' ? 'bg-red-500' : 'bg-amber-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {record.class?.name ?? '—'} — {record.class?.subject ?? ''}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(record.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <span className={
                  record.status === 'PRESENT' ? 'badge-green' :
                  record.status === 'ABSENT' ? 'badge-red' : 'badge-yellow'
                }>
                  {record.status.toLowerCase()}
                </span>
              </div>
            ))}
            {attendance.length === 0 && (
              <div className="empty-state py-12">
                <p className="text-4xl mb-3">📋</p>
                <p className="font-semibold text-slate-600">{t('student.noRecords')}</p>
                <p className="text-sm text-slate-400 mt-1">Your records will appear here once attendance is taken.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}