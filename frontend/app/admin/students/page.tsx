"use client";

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../../lib/i18n';
import { downloadStudentsCsv } from '../../../lib/exportCsv';

/* â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
interface StudyYear { id: string; year: number; label: string | null; isCurrent: boolean }
interface Grade { id: string; name: string; subject: string; teacher?: { name: string }; studyYearId?: string }
interface Student {
  id: string; userId: string; studentNumber: string; name: string; nameKh?: string; email: string; phone: string;
  photo: string | null; sex: string | null; dateOfBirth: string | null;
  address: string; generation?: string; parentId?: string | null;
  customFieldValues?: Record<string, string | string[]>;
}
interface ParentOption { id: string; name: string; email: string; phone: string | null }
interface CustomFieldDef { id: string; key: string; label: string; required: boolean; fieldType: 'TEXT' | 'SELECT' | 'MULTI_SELECT'; options: string[] | null }

export default function ManageStudentsPage() {
  return <Suspense><ManageStudents /></Suspense>;
}

function ManageStudents() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlClassId = searchParams.get('classId');

  /* â”€â”€ data â”€â”€ */
  const [studyYears, setStudyYears] = useState<StudyYear[]>([]);
  const [selectedStudyYearId, setSelectedStudyYearId] = useState('');
  const [grades, setGrades] = useState<Grade[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<Grade | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [parents, setParents] = useState<ParentOption[]>([]);

  /* â”€â”€ loading / error â”€â”€ */
  const [loadingGrades, setLoadingGrades] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);

  /* â”€â”€ search â”€â”€ */
  const [gradeSearch, setGradeSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  /* â”€â”€ student counts per grade â”€â”€ */
  const [gradeCounts, setGradeCounts] = useState<Record<string, number>>({});

  /* â”€â”€ edit â”€â”€ */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: '', nameKh: '', sex: '', phone: '', photo: '', dateOfBirth: '', address: '', generation: '', studentNumber: '', parentId: '' });
  const [editCustomFields, setEditCustomFields] = useState<Record<string, string | string[]>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* â”€â”€ custom fields (registration form) â”€â”€ */
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);

  /* â”€â”€ add new student â”€â”€ */
  const [showAddForm, setShowAddForm] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', nameKh: '', email: '', password: '', sex: '', phone: '', photo: '', dateOfBirth: '', address: '', generation: '', studentNumber: '' });
  const [addingStudent, setAddingStudent] = useState(false);

  /* â”€â”€ CSV â”€â”€ */
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<{ total: number; success: number; errors: number; skipped: number } | null>(null);

  /* â”€â”€ reset password â”€â”€ */
  const [resetStudent, setResetStudent] = useState<Student | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetMsg, setResetMsg] = useState<{ text: string; ok: boolean } | null>(null);

  /* â”€â”€ view mode â”€â”€ */
  const [studentViewMode, setStudentViewMode] = useState<'cards' | 'table'>('cards');

  /* â”€â”€ edit modal â”€â”€ */
  const [editModalOpen, setEditModalOpen] = useState(false);

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ fetch helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const fetchStudyYears = async () => {
    try {
      const res = await apiFetch('/api/study-years');
      if (res.ok) setStudyYears(await res.json());
    } catch {}
  };

  const fetchGrades = async (studyYearId: string) => {
    setLoadingGrades(true);
    try {
      const q = studyYearId ? `?studyYearId=${studyYearId}` : '';
      const res = await apiFetch(`/api/classes${q}`);
      if (res.ok) {
        const data: Grade[] = await res.json();
        setGrades(data);
        fetchGradeCounts(data);
      }
    } catch {} finally { setLoadingGrades(false); }
  };

  const fetchGradeCounts = async (list: Grade[]) => {
    const counts: Record<string, number> = {};
    await Promise.all(list.map(async g => {
      try {
        const r = await apiFetch(`/api/classes/${g.id}/students`);
        if (r.ok) { const d = await r.json(); counts[g.id] = Array.isArray(d) ? d.length : 0; }
      } catch { counts[g.id] = 0; }
    }));
    setGradeCounts(counts);
  };

  const fetchStudents = async (classId: string) => {
    setLoadingStudents(true);
    setStudents([]);
    try {
      const res = await apiFetch(`/api/classes/${classId}/students`);
      if (res.ok) setStudents(await res.json());
    } catch {} finally { setLoadingStudents(false); }
  };

  const fetchParents = async () => {
    if (parents.length > 0) return;
    try {
      const r = await apiFetch('/api/classes/parents');
      if (r.ok) { const d = await r.json(); setParents(Array.isArray(d) ? d : []); }
    } catch {}
  };

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  useEffect(() => { fetchStudyYears(); }, []);

  useEffect(() => {
    (async () => {
      try {
        // Public endpoint — reused here purely to read the currently enabled
        // custom fields, regardless of the viewer's admin/teacher role.
        const res = await apiFetch('/api/class-registrations/public/form-config');
        if (res.ok) { const d = await res.json(); setCustomFieldDefs(d.fields || []); }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (studyYears.length > 0 && !selectedStudyYearId) {
      const cur = studyYears.find(s => s.isCurrent);
      setSelectedStudyYearId(cur?.id ?? studyYears[0]?.id ?? '');
    }
  }, [studyYears]);

  useEffect(() => { fetchGrades(selectedStudyYearId); setSelectedGrade(null); setStudents([]); }, [selectedStudyYearId]);

  /* auto-select from URL param */
  useEffect(() => {
    if (urlClassId && grades.length > 0 && !selectedGrade) {
      const g = grades.find(x => x.id === urlClassId);
      if (g) selectGrade(g);
    }
  }, [urlClassId, grades]);

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const selectGrade = (g: Grade) => {
    setSelectedGrade(g);
    setStudentSearch('');
    setEditingId(null);
    setEditModalOpen(false);
    setShowAddForm(false);
    setCsvResult(null);
    fetchStudents(g.id);
    router.replace(`/admin/students?classId=${g.id}`, { scroll: false });
  };

  const handleEdit = (s: Student) => {
    setEditingId(s.id);
    setSaveError(null);
    setEditData({
      name: s.name || '', nameKh: s.nameKh || '', sex: s.sex || '', phone: s.phone || '', photo: s.photo || '',
      dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '',
      address: s.address || '', generation: s.generation || '',
      studentNumber: s.studentNumber || '', parentId: s.parentId || '',
    });
    setEditCustomFields(s.customFieldValues || {});
    setEditModalOpen(true);
    fetchParents();
  };

  const handleSave = async () => {
    if (!selectedGrade || !editingId) return;
    setSaving(true); setSaveError(null);
    try {
      const res = await apiFetch(`/api/classes/${selectedGrade.id}/students/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editData, parentId: editData.parentId || null, customFieldValues: editCustomFields }),
      });
      if (res.ok) { setEditingId(null); setEditModalOpen(false); await fetchStudents(selectedGrade.id); }
      else {
        let msg = `Save failed (${res.status})`;
        try { const j = await res.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message; } catch {}
        setSaveError(msg);
      }
    } catch (e: any) { setSaveError(e?.message || 'Error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (s: Student) => {
    if (!selectedGrade) return;
    const confirmed = window.confirm(
      `Permanently delete "${s.name}" from the database?\n\nThis removes all attendance records, fee records, and their user account. Cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const res = await apiFetch(`/api/classes/${selectedGrade.id}/students/${s.id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchStudents(selectedGrade.id);
        setGradeCounts(prev => ({ ...prev, [selectedGrade.id]: Math.max(0, (prev[selectedGrade.id] ?? 1) - 1) }));
      } else {
        const b = await res.json().catch(() => ({}));
        alert(`Delete failed: ${b?.message ?? res.statusText}`);
      }
    } catch (e) { console.error(e); }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGrade) return;
    if (!newForm.email.trim() && !newForm.phone.trim()) {
      alert('Enter an email or a phone number');
      return;
    }
    setAddingStudent(true);
    try {
      const pwd = newForm.password.trim() || `student${(newForm.email.split('@')[0] || newForm.phone.replace(/\D/g, '')) || 'account'}`;
      const reg = await apiFetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, password: pwd, role: 'STUDENT' }),
      });
      if (!reg.ok) { const d = await reg.json(); alert(d.message || 'Registration failed'); return; }
      const newUser = await reg.json();
      const add = await apiFetch(`/api/classes/${selectedGrade.id}/students`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: newUser.user.id }),
      });
      if (!add.ok) { const d = await add.json(); alert(d.message || 'Failed to add to class'); return; }
      const added = await add.json();
      const fields = ['nameKh', 'sex', 'photo', 'dateOfBirth', 'address', 'generation', 'studentNumber'] as const;
      if (fields.some(f => newForm[f])) {
        const sid = added.id || added.student?.id;
        if (sid) await apiFetch(`/api/classes/${selectedGrade.id}/students/${sid}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(fields.filter(f => newForm[f]).map(f => [f, newForm[f]]))),
        });
      }
      setNewForm({ name: '', nameKh: '', email: '', password: '', sex: '', phone: '', photo: '', dateOfBirth: '', address: '', generation: '', studentNumber: '' });
      setShowAddForm(false);
      await fetchStudents(selectedGrade.id);
      setGradeCounts(prev => ({ ...prev, [selectedGrade.id]: (prev[selectedGrade.id] ?? 0) + 1 }));
    } finally { setAddingStudent(false); }
  };

  const handleResetPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetStudent) return;
    if (resetPwd.length < 6) { setResetMsg({ text: 'Password must be at least 6 characters', ok: false }); return; }
    try {
      const res = await apiFetch(`/api/auth/users/${resetStudent.userId}/password`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPwd }),
      });
      if (res.ok) {
        setResetMsg({ text: `Password reset for ${resetStudent.name}`, ok: true });
        setTimeout(() => { setResetStudent(null); setResetPwd(''); setResetMsg(null); }, 1500);
      } else {
        const d = await res.json().catch(() => ({}));
        setResetMsg({ text: d.message || 'Failed to reset password', ok: false });
      }
    } catch { setResetMsg({ text: 'Network error', ok: false }); }
  };

  const handleCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedGrade) return;
    setCsvUploading(true); setCsvResult(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await apiFetch(`/api/classes/${selectedGrade.id}/students/bulk-csv`, { method: 'POST', body: fd });
      if (res.ok) {
        const r = await res.json(); setCsvResult(r);
        await fetchStudents(selectedGrade.id);
        setGradeCounts(prev => ({ ...prev, [selectedGrade.id]: students.length + (r.success ?? 0) }));
      } else { const d = await res.json(); alert(d.message || 'CSV upload failed'); }
    } finally { setCsvUploading(false); e.target.value = ''; }
  };

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ derived â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const filteredGrades = useMemo(() => {
    const q = gradeSearch.trim().toLowerCase();
    return q ? grades.filter(g => g.name.toLowerCase().includes(q) || g.subject?.toLowerCase().includes(q)) : grades;
  }, [grades, gradeSearch]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return q ? students.filter(s => s.name.toLowerCase().includes(q) || (s.studentNumber || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q)) : students;
  }, [students, studentSearch]);

  const totalStudentsAll = useMemo(() => Object.values(gradeCounts).reduce((a, b) => a + b, 0), [gradeCounts]);
  const maleCount = useMemo(() => students.filter(s => s.sex === 'MALE').length, [students]);
  const femaleCount = useMemo(() => students.filter(s => s.sex === 'FEMALE').length, [students]);

  const avatarInitials = (name: string) => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarColor = (name: string) => {
    const colors = ['bg-indigo-500','bg-violet-500','bg-emerald-500','bg-sky-500','bg-amber-500','bg-rose-500','bg-teal-500','bg-fuchsia-500'];
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return colors[h % colors.length];
  };

  /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />

        {/* â”€â”€ Page Header â”€â”€ */}
        <div className="page-header">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/></svg>
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Student Management</h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Manage students organized by grade / class</p>
              </div>
            </div>
            {/* Summary chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                {grades.length} Grades
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100 text-violet-700 text-xs font-semibold">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg>
                {totalStudentsAll} Students
              </div>
              {selectedGrade && (
                <>
                  <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold">M {maleCount}</div>
                  <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-pink-50 border border-pink-100 text-pink-700 text-xs font-semibold">F {femaleCount}</div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="page-body">
          <div className="flex gap-4" style={{ height: 'calc(100vh - 13rem)' }}>

            {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                LEFT PANEL â€” Grade / Class list
            â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="w-72 shrink-0 flex flex-col gap-2">

              {/* Study Year selector */}
              <select
                value={selectedStudyYearId}
                onChange={e => setSelectedStudyYearId(e.target.value)}
                className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white shadow-sm w-full focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">All Study Years</option>
                {studyYears.map(sy => (
                  <option key={sy.id} value={sy.id}>{sy.label || sy.year}{sy.isCurrent ? ' (Current)' : ''}</option>
                ))}
              </select>

              {/* Grade search */}
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
                <input
                  type="text" value={gradeSearch} onChange={e => setGradeSearch(e.target.value)}
                  placeholder="Search grade..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-white shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                {gradeSearch && <button onClick={() => setGradeSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>}
              </div>

              {/* Grade list */}
              <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                {loadingGrades ? (
                  <div className="py-12 flex flex-col items-center gap-3 text-slate-400">
                    <svg className="w-8 h-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                    <span className="text-sm">Loading grades...</span>
                  </div>
                ) : filteredGrades.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-sm">No grades found</div>
                ) : filteredGrades.map(g => {
                  const isActive = selectedGrade?.id === g.id;
                  const count = gradeCounts[g.id];
                  return (
                    <button
                      key={g.id}
                      onClick={() => selectGrade(g)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-0 transition-all group
                        ${isActive ? 'bg-gradient-to-r from-indigo-50 to-violet-50 border-l-4 border-l-indigo-500' : 'border-l-4 border-l-transparent hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-indigo-700' : 'text-slate-800 group-hover:text-indigo-600'}`}>
                          {g.name}
                        </span>
                        <span className={`shrink-0 min-w-[28px] text-center text-xs font-bold px-2 py-0.5 rounded-full transition-colors
                          ${isActive ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600'}`}>
                          {count ?? '...'}
                        </span>
                      </div>
                      {g.teacher && (
                        <p className={`text-xs mt-0.5 truncate ${isActive ? 'text-indigo-500' : 'text-slate-400'}`}>
                          {g.teacher.name}
                        </p>
                      )}
                      {g.subject && (
                        <p className={`text-xs truncate ${isActive ? 'text-violet-500' : 'text-slate-400'}`}>
                          {g.subject}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Summary footer */}
              <div className="text-xs text-slate-400 text-center pb-1">
                {filteredGrades.length} grade{filteredGrades.length !== 1 ? 's' : ''} / {totalStudentsAll} total students
              </div>
            </div>

            {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                RIGHT PANEL â€” Student Roster
            â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
              {!selectedGrade ? (
                /* Empty state */
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center">
                    <svg className="w-12 h-12 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </div>
                  <div className="text-center">
                    <p className="text-base font-semibold text-slate-600">Select a Grade</p>
                    <p className="text-sm mt-1">Choose a class from the left panel to view and manage its students</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* â”€â”€ Class Banner â”€â”€ */}
                  <div className="rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 p-4 text-white shadow-lg shadow-indigo-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                      </div>
                      <div>
                        <h2 className="text-base font-bold leading-tight">{selectedGrade.name}</h2>
                        <p className="text-indigo-200 text-xs mt-0.5">
                          {selectedGrade.subject && <span>{selectedGrade.subject}</span>}
                          {selectedGrade.teacher && <span> / {selectedGrade.teacher.name}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="bg-white/20 backdrop-blur rounded-lg px-3 py-1.5 text-sm font-semibold">{students.length} students</div>
                      <div className="bg-white/20 backdrop-blur rounded-lg px-2.5 py-1.5 text-xs font-medium">M {maleCount}</div>
                      <div className="bg-white/20 backdrop-blur rounded-lg px-2.5 py-1.5 text-xs font-medium">F {femaleCount}</div>
                    </div>
                  </div>

                  {/* â”€â”€ Toolbar â”€â”€ */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Search */}
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
                      <input
                        type="text" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                        placeholder="Search by name, ID, email..."
                        className="pl-8 pr-8 py-1.5 text-sm rounded-xl border border-slate-200 bg-white shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 w-56"
                      />
                      {studentSearch && <button onClick={() => setStudentSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* View toggle */}
                      <div className="inline-flex rounded-xl border border-slate-200 bg-white shadow-sm p-0.5">
                        <button onClick={() => setStudentViewMode('cards')} title="Card view"
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${studentViewMode === 'cards' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} strokeLinecap="round"/><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} strokeLinecap="round"/><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} strokeLinecap="round"/><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2} strokeLinecap="round"/></svg>
                        </button>
                        <button onClick={() => setStudentViewMode('table')} title="Table view"
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${studentViewMode === 'table' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                        </button>
                      </div>

                      {/* CSV upload */}
                      <label title="Import CSV" className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white shadow-sm text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors ${csvUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        {csvUploading ? (
                          <svg className="w-4 h-4 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
                        )}
                        {csvUploading ? 'Uploading...' : 'Import CSV'}
                        <input type="file" accept=".csv" className="hidden" onChange={handleCsv} />
                      </label>

                      {/* CSV export */}
                      <button
                        type="button"
                        title="Export CSV"
                        disabled={filteredStudents.length === 0}
                        onClick={() => downloadStudentsCsv(
                          filteredStudents,
                          customFieldDefs,
                          `${selectedGrade?.name || 'students'}.csv`,
                        )}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white shadow-sm text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M7 10l5 5 5-5M12 15V3" /></svg>
                        Export CSV
                      </button>

                      {/* Add student */}
                      <button
                        onClick={() => { setShowAddForm(f => !f); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold shadow-sm transition-all
                          ${showAddForm ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-indigo-200 hover:shadow-md hover:shadow-indigo-200'}`}
                      >
                        <svg className={`w-4 h-4 transition-transform ${showAddForm ? 'rotate-45' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {showAddForm ? 'Cancel' : 'Add Student'}
                      </button>
                    </div>
                  </div>

                  {/* CSV result banner */}
                  {csvResult && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-800 flex items-center justify-between">
                      <span>CSV imported: <b>{csvResult.success}</b> added / {csvResult.skipped} skipped / {csvResult.errors} errors / {csvResult.total} total</span>
                      <button onClick={() => setCsvResult(null)} className="text-emerald-400 hover:text-emerald-600 ml-3"><svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
                    </div>
                  )}

                  {/* Add student form */}
                  {showAddForm && (
                    <form onSubmit={handleAddStudent} className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-4 space-y-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-indigo-800 flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-lg bg-indigo-500 text-white flex items-center justify-center text-xs">+</span>
                          New Student
                        </h4>
                      </div>
                      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                        <div className="sm:col-span-2">
                          <label className="form-label text-xs">Full Name *</label>
                          <input type="text" required value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} placeholder="Full name" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="form-label text-xs">Khmer Name</label>
                          <input type="text" value={newForm.nameKh} onChange={e => setNewForm({ ...newForm, nameKh: e.target.value })} placeholder="Khmer name" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="form-label text-xs">Email <span className="text-slate-400 font-normal">(or phone below)</span></label>
                          <input type="text" value={newForm.email} onChange={e => setNewForm({ ...newForm, email: e.target.value })} placeholder="student@school.edu" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Password <span className="text-slate-400 font-normal">(auto)</span></label>
                          <input type="text" value={newForm.password} onChange={e => setNewForm({ ...newForm, password: e.target.value })} placeholder="leave blank" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Student ID</label>
                          <input type="text" value={newForm.studentNumber} onChange={e => setNewForm({ ...newForm, studentNumber: e.target.value })} placeholder="0001" className="font-mono" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Sex</label>
                          <select value={newForm.sex} onChange={e => setNewForm({ ...newForm, sex: e.target.value })}>
                            <option value="">Select...</option>
                            <option value="MALE">Male</option>
                            <option value="FEMALE">Female</option>
                          </select>
                        </div>
                        <div>
                          <label className="form-label text-xs">Phone</label>
                          <input type="text" value={newForm.phone} onChange={e => setNewForm({ ...newForm, phone: e.target.value })} placeholder="012 345 678" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Date of Birth</label>
                          <input type="date" value={newForm.dateOfBirth} onChange={e => setNewForm({ ...newForm, dateOfBirth: e.target.value })} />
                        </div>
                        <div>
                          <label className="form-label text-xs">Generation</label>
                          <input type="number" min="1" value={newForm.generation} onChange={e => setNewForm({ ...newForm, generation: e.target.value })} placeholder="1" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Address</label>
                          <input type="text" value={newForm.address} onChange={e => setNewForm({ ...newForm, address: e.target.value })} placeholder="Province/City" />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button type="submit" disabled={addingStudent}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold shadow-sm hover:shadow-md disabled:opacity-60">
                          {addingStudent ? <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>Adding...</> : 'Add Student'}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* â”€â”€ Student Content â”€â”€ */}
                  <div className="flex-1 overflow-auto">
                    {loadingStudents ? (
                      <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
                        <svg className="w-10 h-10 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                        <span className="text-sm">Loading students...</span>
                      </div>
                    ) : filteredStudents.length === 0 ? (
                      <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                          {studentSearch
                            ? <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
                            : <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          }
                        </div>
                        <p className="text-sm font-medium text-slate-500">{studentSearch ? 'No students match your search' : 'No students in this grade yet'}</p>
                        {!studentSearch && <button onClick={() => setShowAddForm(true)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">+ Add the first student</button>}
                      </div>
                    ) : studentViewMode === 'cards' ? (

                      /* â”€â”€ Card Grid View â”€â”€ */
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pb-2">
                        {filteredStudents.map((s, idx) => (
                          <div key={s.id} className="group relative bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden flex flex-col">
                            {/* Photo area */}
                            <div className="relative h-28 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden">
                              {s.photo ? (
                                <img src={s.photo} alt={s.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              ) : (
                                <div className={`w-16 h-16 rounded-2xl ${avatarColor(s.name)} flex items-center justify-center text-white text-xl font-bold shadow-lg`}>
                                  {avatarInitials(s.name)}
                                </div>
                              )}
                              {/* Sex badge */}
                              {s.sex && (
                                <span className={`absolute top-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm ${s.sex === 'MALE' ? 'bg-blue-500/80 text-white' : 'bg-pink-500/80 text-white'}`}>
                                  {s.sex === 'MALE' ? 'M' : 'F'}
                                </span>
                              )}
                              {/* ID badge */}
                              <span className="absolute bottom-2 left-2 text-[10px] font-mono font-bold bg-black/40 text-white backdrop-blur-sm px-1.5 py-0.5 rounded">
                                {s.studentNumber || String(idx + 1).padStart(4, '0')}
                              </span>
                            </div>

                            {/* Info */}
                            <div className="p-2.5 flex-1 flex flex-col gap-0.5 min-w-0">
                              <p className="text-xs font-bold text-slate-800 truncate leading-tight">{s.name}</p>
                              {s.nameKh && <p className="text-[10px] text-slate-500 truncate">{s.nameKh}</p>}
                              <p className="text-[10px] text-slate-400 truncate">{s.email}</p>
                              {s.generation && <p className="text-[10px] text-violet-500 font-medium">Gen {s.generation}</p>}
                            </div>

                            {/* Actions â€” visible on hover */}
                            <div className="px-2.5 pb-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEdit(s)} title="Edit"
                                className="flex-1 flex items-center justify-center gap-1 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 text-[10px] font-semibold transition-colors">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => { setResetStudent(s); setResetPwd(''); setResetMsg(null); }} title="Reset password"
                                className="flex items-center justify-center p-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                              </button>
                              <button onClick={() => handleDelete(s)} title="Delete"
                                className="flex items-center justify-center p-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                    ) : (

                      /* â”€â”€ Table View â”€â”€ */
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-16">#ID</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Sex</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">DOB</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Phone</th>
                            <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Gen</th>
                            <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredStudents.map((s, idx) => (
                            <tr key={s.id} className="hover:bg-indigo-50/40 transition-colors group">
                              <td className="px-3 py-2.5 text-slate-400 font-mono text-xs">{s.studentNumber || String(idx + 1).padStart(4, '0')}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-8 h-8 rounded-xl overflow-hidden ${s.photo ? 'bg-slate-100' : avatarColor(s.name)} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                                    {s.photo ? <img src={s.photo} alt={s.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : avatarInitials(s.name)}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 truncate text-sm">{s.name}{s.nameKh && <span className="text-slate-400 font-normal"> · {s.nameKh}</span>}</p>
                                    <p className="text-xs text-slate-400 truncate">{s.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                {s.sex ? (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.sex === 'MALE' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>
                                    {s.sex === 'MALE' ? 'Male' : 'Female'}
                                  </span>
                              ) : <span className="text-slate-300 text-xs">-</span>}
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 text-xs">{s.dateOfBirth ? new Date(s.dateOfBirth).toLocaleDateString() : <span className="text-slate-300">-</span>}</td>
                              <td className="px-3 py-2.5 text-slate-500 text-xs">{s.phone || <span className="text-slate-300">-</span>}</td>
                              <td className="px-3 py-2.5 text-xs">{s.generation ? <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">G{s.generation}</span> : <span className="text-slate-300">-</span>}</td>
                              <td className="px-3 py-2.5 text-right">
                                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleEdit(s)} title="Edit" className="p-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                  </button>
                                  <button onClick={() => { setResetStudent(s); setResetPwd(''); setResetMsg(null); }} title="Reset password" className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 transition-colors">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                                  </button>
                                  <button onClick={() => handleDelete(s)} title="Delete" className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition-colors">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Footer — sits right below the cards/table */}
                    {filteredStudents.length > 0 && (
                      <p className="text-xs text-slate-400 text-right pt-2 pb-1">
                        {filteredStudents.length} of {students.length} students shown
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          EDIT STUDENT MODAL
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {editModalOpen && editingId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setEditModalOpen(false); setEditingId(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Edit Student</h3>
                  <p className="text-xs text-slate-400">{students.find(s => s.id === editingId)?.name}</p>
                </div>
              </div>
              <button onClick={() => { setEditModalOpen(false); setEditingId(null); }} className="text-slate-400 hover:text-slate-600"><svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {saving && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-white border border-amber-100 shadow-2xl">
                    <svg className="w-10 h-10 text-amber-500 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
                    <p className="text-sm font-semibold text-slate-700">Saving...</p>
                  </div>
                </div>
              )}
              {saveError && <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{saveError}</div>}

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-xs">Student ID</label>
                  <input type="text" value={editData.studentNumber} onChange={e => setEditData({ ...editData, studentNumber: e.target.value })} className="font-mono" placeholder="0001" />
                </div>
                <div>
                  <label className="form-label text-xs">Full Name</label>
                  <input type="text" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                </div>
                <div>
                  <label className="form-label text-xs">Khmer Name</label>
                  <input type="text" value={editData.nameKh} onChange={e => setEditData({ ...editData, nameKh: e.target.value })} />
                </div>
                <div>
                  <label className="form-label text-xs">Sex</label>
                  <select value={editData.sex} onChange={e => setEditData({ ...editData, sex: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Phone</label>
                  <input type="text" value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} placeholder="012 345 678" />
                </div>
                <div>
                  <label className="form-label text-xs">Date of Birth</label>
                  <input type="date" value={editData.dateOfBirth} onChange={e => setEditData({ ...editData, dateOfBirth: e.target.value })} />
                </div>
                <div>
                  <label className="form-label text-xs">Generation</label>
                  <input type="number" min="1" value={editData.generation} onChange={e => setEditData({ ...editData, generation: e.target.value })} placeholder="1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label text-xs">Address</label>
                  <input type="text" value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} placeholder="Province / City" />
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label text-xs">Photo URL</label>
                  <input type="text" value={editData.photo} onChange={e => setEditData({ ...editData, photo: e.target.value })} placeholder="https://..." />
                  {editData.photo && (
                    <img src={editData.photo} alt="preview" className="mt-2 w-16 h-16 rounded-xl object-cover border border-slate-200" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="form-label text-xs">Parent</label>
                  <select value={editData.parentId} onChange={e => setEditData({ ...editData, parentId: e.target.value })}>
                    <option value="">-- None / Unlink --</option>
                    {parents.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.email}){p.phone ? ` / ${p.phone}` : ''}</option>
                    ))}
                  </select>
                </div>
                {customFieldDefs.map(f => (
                  <div key={f.id} className="sm:col-span-2">
                    <label className="form-label text-xs">{f.label}{f.required && ' *'}</label>
                    {f.fieldType === 'MULTI_SELECT' ? (
                      <div className="flex flex-wrap gap-3 pt-1">
                        {(f.options || []).map(opt => {
                          const selected = Array.isArray(editCustomFields[f.key]) ? (editCustomFields[f.key] as string[]) : []
                          return (
                            <label key={opt} className="flex items-center gap-1.5 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={selected.includes(opt)}
                                onChange={e => setEditCustomFields(prev => {
                                  const cur = Array.isArray(prev[f.key]) ? (prev[f.key] as string[]) : []
                                  const next = e.target.checked ? [...cur, opt] : cur.filter(o => o !== opt)
                                  return { ...prev, [f.key]: next }
                                })}
                              />
                              {opt}
                            </label>
                          )
                        })}
                      </div>
                    ) : f.fieldType === 'SELECT' ? (
                      <select
                        value={(editCustomFields[f.key] as string) || ''}
                        onChange={e => setEditCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      >
                        <option value="">-- Select --</option>
                        {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={(editCustomFields[f.key] as string) || ''}
                        onChange={e => setEditCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button onClick={() => { setEditModalOpen(false); setEditingId(null); }} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow-sm hover:shadow-md disabled:opacity-60">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          RESET PASSWORD MODAL
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {resetStudent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setResetStudent(null); setResetMsg(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                </div>
                <h3 className="text-base font-bold text-slate-800">Reset Password</h3>
              </div>
              <button onClick={() => { setResetStudent(null); setResetMsg(null); }} className="text-slate-400 hover:text-slate-600"><svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
            </div>
            <form onSubmit={handleResetPwd} className="px-6 py-4 space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className={`w-10 h-10 rounded-xl ${avatarColor(resetStudent.name)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {avatarInitials(resetStudent.name)}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-sm">{resetStudent.name}</p>
                  <p className="text-xs text-slate-400 truncate">{resetStudent.email}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">Existing sessions will be revoked after password reset.</p>
              <div>
                <label className="form-label text-xs">New Password</label>
                <input
                  type="text" value={resetPwd}
                  onChange={e => { setResetPwd(e.target.value); setResetMsg(null); }}
                  required minLength={6} placeholder="Min 6 characters" autoFocus
                />
              </div>
              {resetMsg && (
                <div className={`px-3 py-2 rounded-xl text-sm font-medium ${resetMsg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {resetMsg.ok ? 'Done: ' : 'Error: '}{resetMsg.text}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setResetStudent(null); setResetMsg(null); }} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold shadow-sm hover:shadow-md">Reset Password</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
