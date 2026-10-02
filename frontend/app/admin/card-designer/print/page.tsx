'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import AuthGuard from '../../../../components/AuthGuard';
import Sidebar from '../../../../components/Sidebar';
import { adminNav } from '../../../../lib/admin-nav';
import { apiFetch } from '../../../../lib/api';
import { formatDOB } from '../../../../lib/dateUtils';
import {
  CardDesign, CardType, CARD_TYPE_FIELDS,
  apiGetActiveDesign,
  STUDENT_TEMPLATE, STAFF_TEMPLATE,
} from '../../../../components/card-designer/types';
import { renderDesignToCanvas } from '../../../../components/card-designer/renderDesignToCanvas';
import { downloadSingleCardPDF, downloadA4CardsPDF } from '../../../../components/card-designer/generateCardPDF';

/* ── Interfaces ─────────────────────────────────────────────────────────── */
interface StudyYear {
  id: string;
  year: number;
  label: string | null;
  isCurrent: boolean;
}
interface ClassItem {
  id: string;
  name: string;
  subject: string | null;
  teacher: { name: string } | null;
  studyYear?: { id: string; year: number; label: string | null } | null;
}
interface Student {
  id: string;
  studentNumber: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  qrCode: string | null;
  photo: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  address: string;
  className?: string | null;
}
interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  photo?: string | null;
  department?: string | null;
}

interface TptTeacher {
  id: string;
  name: string;
  khmerName: string | null;
  short: string;
  sex: string | null;
  color: string | null;
  photo: string | null;
  qrCode: string | null;
  timetableId: string;
  timetableName: string;
  weeklyLessons: number;
  lessons: { subjectName: string; className: string; perWeek: number }[];
}

interface CertEntry {
  id: string;
  name: string;
  preview?: string;
  fieldValues: Record<string, string>;
  qrDataUrl?: string;
  photoUrl?: string | null;
}

type Mode = 'certificate-student' | 'certificate-staff' | 'teacher-part-time';

function normalizePhoto(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  return url;
}

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function CertificatePrintPage() {
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as Mode | null) ?? 'certificate-student';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [design, setDesign] = useState<CardDesign | null>(null);
  const [designLoading, setDesignLoading] = useState(true);
  const [schoolName, setSchoolName] = useState('Wattaman School');

  // Student data
  const [studyYears, setStudyYears] = useState<StudyYear[]>([]);
  const [selectedStudyYear, setSelectedStudyYear] = useState('');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [students, setStudents] = useState<Student[]>([]);

  // Staff data
  const [staff, setStaff] = useState<StaffUser[]>([]);

  // TPT teacher data
  const [tptTeachers, setTptTeachers] = useState<TptTeacher[]>([]);

  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<CertEntry[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewed, setPreviewed] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [studyYearLabel, setStudyYearLabel] = useState('');
  const cancelRef = useRef(false);

  // Load design
  useEffect(() => {
    apiFetch('/api/auth/me').then((r) => r.ok ? r.json() : null).then((me) => {
      if (me?.department?.name) setSchoolName(me.department.name);
      else if (me?.name) setSchoolName(me.name);
    }).catch(() => {});
  }, []);

  // Load design
  useEffect(() => {
    setDesignLoading(true);
    const cardType: CardType = mode;
    apiGetActiveDesign(cardType).then((d) => {
      setDesign(d ?? (mode === 'certificate-student' ? STUDENT_TEMPLATE : STAFF_TEMPLATE));
    }).catch(() => {
      setDesign(mode === 'certificate-student' ? STUDENT_TEMPLATE : STAFF_TEMPLATE);
    }).finally(() => setDesignLoading(false));
  }, [mode]);

  // Load TPT teachers
  const loadTptTeachers = useCallback(async () => {
    setLoading(true); setTptTeachers([]); setEntries([]); setSelected(new Set());
    try {
      const r = await apiFetch('/api/timetable/scheduled-teachers/all');
      const all: TptTeacher[] = r.ok ? await r.json() : [];
      setTptTeachers(all);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (mode === 'teacher-part-time') loadTptTeachers();
  }, [mode, loadTptTeachers]);

  // Load study years on mount
  useEffect(() => {
    apiFetch('/api/study-years').then((r) => r.ok ? r.json() : []).then((data: StudyYear[]) => {
      setStudyYears(data);
      const cur = data.find((y) => y.isCurrent);
      if (cur) { setSelectedStudyYear(cur.id); setStudyYearLabel(cur.label ?? String(cur.year)); }
    }).catch(() => {});
  }, []);

  // Load classes when study year changes (student mode)
  useEffect(() => {
    if (mode !== 'certificate-student' || !selectedStudyYear) return;
    setClasses([]); setSelectedClass(''); setStudents([]); setEntries([]);
    apiFetch(`/api/classes?studyYearId=${selectedStudyYear}`).then((r) => r.ok ? r.json() : [])
      .then((data: ClassItem[]) => setClasses(data)).catch(() => {});
  }, [selectedStudyYear, mode]);

  // Load students when class selected
  const loadStudents = useCallback(async (classId: string) => {
    setLoading(true); setStudents([]); setEntries([]); setSelected(new Set());
    try {
      const r = await apiFetch(`/api/classes/${classId}/students`);
      const data: Student[] = r.ok ? await r.json() : [];
      setStudents(data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (mode === 'certificate-student' && selectedClass) loadStudents(selectedClass);
  }, [selectedClass, mode, loadStudents]);

  // Load staff (staff mode)
  const loadStaff = useCallback(async () => {
    setLoading(true); setStaff([]); setEntries([]); setSelected(new Set());
    try {
      const r = await apiFetch('/api/auth/users');
      const all: StaffUser[] = r.ok ? await r.json() : [];
      setStaff(all.filter((u) => !['STUDENT', 'PARENT'].includes(u.role)));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (mode === 'certificate-staff') loadStaff();
  }, [mode, loadStaff]);

  // Build field values for a student
  const todayFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const studentFieldValues = (s: Student, className: string): Record<string, string> => ({
    '{{name}}': s.name,
    '{{studentNumber}}': s.studentNumber ?? '',
    '{{class}}': className,
    '{{email}}': s.email ?? '',
    '{{phone}}': s.phone ?? '',
    '{{sex}}': s.sex ?? '',
    '{{dateOfBirth}}': s.dateOfBirth ? formatDOB(s.dateOfBirth) : '',
    '{{address}}': s.address ?? '',
    '{{qrCode}}': s.qrCode ?? s.id,
    '{{studyYear}}': studyYearLabel,
    '{{schoolName}}': schoolName,
    '{{certificateDate}}': todayFormatted,
  });

  const staffFieldValues = (u: StaffUser): Record<string, string> => ({
    '{{name}}': u.name,
    '{{email}}': u.email ?? '',
    '{{phone}}': u.phone ?? '',
    '{{role}}': u.role,
    '{{department}}': u.department ?? '',
    '{{qrCode}}': u.id,
    '{{schoolName}}': schoolName,
    '{{certificateDate}}': todayFormatted,
  });

  const tptFieldValues = (t: TptTeacher): Record<string, string> => ({
    '{{name}}': t.name,
    '{{khmerName}}': t.khmerName ?? '',
    '{{short}}': t.short,
    '{{timetableName}}': t.timetableName,
    '{{subjects}}': [...new Set(t.lessons.map((l) => l.subjectName).filter(Boolean))].join(', '),
    '{{sex}}': t.sex ?? '',
    '{{weeklyLessons}}': String(t.weeklyLessons),
    '{{qrCode}}': t.qrCode ?? t.id,
  });

  // Generate QR data URL
  const genQR = async (data: string): Promise<string> => {
    try { return await QRCode.toDataURL(data, { width: 200, margin: 1 }); } catch { return ''; }
  };

  // Build preview entries (renders all canvases)
  const buildPreviews = useCallback(async () => {
    if (!design) return;
    cancelRef.current = false;
    setPreviewing(true); setPreviewed(0);

    const cls = classes.find((c) => c.id === selectedClass);
    const className = cls?.name ?? '';
    const people = mode === 'certificate-student'
      ? filteredStudents.map((s) => ({
          id: s.id,
          name: s.name,
          fieldValues: studentFieldValues(s, className),
          qrData: s.qrCode ?? s.id,
          photoUrl: normalizePhoto(s.photo),
        }))
      : mode === 'teacher-part-time'
      ? filteredTpt.map((t) => ({
          id: t.id,
          name: t.name,
          fieldValues: tptFieldValues(t),
          qrData: t.qrCode ?? t.id,
          photoUrl: normalizePhoto(t.photo),
        }))
      : filteredStaff.map((u) => ({
          id: u.id,
          name: u.name,
          fieldValues: staffFieldValues(u),
          qrData: u.id,
          photoUrl: normalizePhoto(u.photo ?? null),
        }));

    const built: CertEntry[] = [];
    for (let i = 0; i < people.length; i++) {
      if (cancelRef.current) break;
      const p = people[i];
      const qrDataUrl = await genQR(p.qrData);
      let preview: string | undefined;
      try {
        const canvas = await renderDesignToCanvas(design, {
          fieldValues: p.fieldValues,
          qrDataUrl,
          photoUrl: p.photoUrl ?? null,
          scale: 1,
        });
        preview = canvas.toDataURL('image/jpeg', 0.75);
      } catch { /* skip preview */ }
      built.push({ id: p.id, name: p.name, fieldValues: p.fieldValues, qrDataUrl, photoUrl: p.photoUrl ?? null, preview });
      setPreviewed(i + 1);
    }
    setEntries(built);
    // Auto-select all
    setSelected(new Set(built.map((e) => e.id)));
    setPreviewing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, mode, students, staff, tptTeachers, selectedClass, classes, studyYearLabel, search]);

  const filteredTpt = tptTeachers.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.khmerName ?? '').includes(search)
  );
  const filteredStudents = students.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.studentNumber?.includes(search)
  );
  const filteredStaff = staff.filter((u) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  );
  const totalPeople = mode === 'certificate-student' ? filteredStudents.length
    : mode === 'teacher-part-time' ? filteredTpt.length
    : filteredStaff.length;
  const selectedEntries = entries.filter((e) => selected.has(e.id));

  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    if (selected.size === entries.length) setSelected(new Set());
    else setSelected(new Set(entries.map((e) => e.id)));
  };

  // Export PDF
  const handleExportAll = async () => {
    if (!design || selectedEntries.length === 0) return;
    setExporting(true);
    try {
      if (selectedEntries.length === 1) {
        await downloadSingleCardPDF(design, selectedEntries[0]);
      } else {
        await downloadA4CardsPDF(design, selectedEntries, `Cards – ${mode === 'certificate-student' ? 'Students' : mode === 'teacher-part-time' ? 'TPT Teachers' : 'Staff'}`);
      }
    } finally { setExporting(false); }
  };

  const handleExportSingle = async (entry: CertEntry) => {
    if (!design) return;
    await downloadSingleCardPDF(design, entry);
  };

  const canGenerate = mode === 'certificate-student' ? filteredStudents.length > 0
    : mode === 'teacher-part-time' ? filteredTpt.length > 0
    : filteredStaff.length > 0;
  const hasEntries = entries.length > 0;

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <div className="page-content lg:ml-0">
          <div className="h-14 lg:hidden" />

          {/* ── Header ── */}
          <div className="page-header flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                <Link href="/admin/card-designer" className="hover:text-indigo-600 transition-colors">← Designer</Link>
                <span>/</span>
                <span className="text-slate-700 font-medium">Print Certificates</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-800">Print Certificates</h1>
              <p className="text-sm text-slate-500 mt-1">Preview, select and export certificates as PDF.</p>
            </div>
            {hasEntries && (
              <button
                onClick={handleExportAll}
                disabled={exporting || selectedEntries.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors shadow-sm"
              >
                {exporting ? (
                  <><svg viewBox="0 0 16 16" className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="8" cy="8" r="5" strokeOpacity={0.3}/><path d="M8 3a5 5 0 0 1 5 5"/></svg> Exporting…</>
                ) : (
                  <><svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/></svg> Export {selectedEntries.length} PDF</>
                )}
              </button>
            )}
          </div>

          <div className="px-6 py-4 space-y-5">

            {/* ── Mode & Filter row ── */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">

              {/* Mode toggle */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Card Type</p>
                <div className="flex gap-2 flex-wrap">
                  {([
                    { v: 'certificate-student' as Mode, label: 'Student Certificates', icon: '🎓' },
                    { v: 'certificate-staff' as Mode, label: 'Staff Certificates', icon: '👨\u200d🏫' },
                    { v: 'teacher-part-time' as Mode, label: 'TPT ID Cards', icon: '⏰' },
                  ]).map(({ v, label, icon }) => (
                    <button key={v} onClick={() => { setMode(v); setEntries([]); setSelected(new Set()); setSearch(''); }}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === v ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filters: TPT mode */}
              {mode === 'teacher-part-time' && (
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Search Teacher</label>
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or Khmer name…"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  {loading && <p className="text-xs text-slate-400">Loading teachers…</p>}
                  {!loading && tptTeachers.length === 0 && <p className="text-xs text-amber-600">No scheduled teachers found in any timetable.</p>}
                </div>
              )}

              {/* Filters: student mode */}
              {mode === 'certificate-student' && (
                <div className="flex flex-wrap gap-3 items-end">
                  {/* Study year */}
                  <div className="min-w-[140px]">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Study Year</label>
                    <select value={selectedStudyYear} onChange={(e) => { setSelectedStudyYear(e.target.value); const y = studyYears.find((y) => y.id === e.target.value); setStudyYearLabel(y?.label ?? String(y?.year ?? '')); }}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                      <option value="">All Years</option>
                      {studyYears.map((y) => (
                        <option key={y.id} value={y.id}>{y.label ?? y.year}{y.isCurrent ? ' (Current)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  {/* Class */}
                  <div className="min-w-[160px]">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Class</label>
                    <select value={selectedClass} onChange={(e) => { setSelectedClass(e.target.value); setEntries([]); setSelected(new Set()); }}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      disabled={classes.length === 0}>
                      <option value="">Select class…</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.subject ? ` — ${c.subject}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  {/* Search */}
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Search Student</label>
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or student ID…"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                </div>
              )}

              {/* Filters: staff mode */}
              {mode === 'certificate-staff' && (
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Search Staff</label>
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email…"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                </div>
              )}

              {/* Design status */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className={`w-2 h-2 rounded-full ${designLoading ? 'bg-amber-400 animate-pulse' : design ? 'bg-emerald-400' : 'bg-red-400'}`} />
                {designLoading ? 'Loading design…' : design ? `Design loaded (${design.cardType})` : 'No design found — using default'}
                {!designLoading && (
                  <Link href={`/admin/card-designer/new`} className="ml-2 text-indigo-500 hover:text-indigo-700 underline">Edit Design</Link>
                )}
              </div>

              {/* Generate button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={buildPreviews}
                  disabled={!canGenerate || !design || previewing || designLoading}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
                >
                  {previewing ? (
                    <><svg viewBox="0 0 16 16" className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="8" cy="8" r="5" strokeOpacity={0.3}/><path d="M8 3a5 5 0 0 1 5 5"/></svg>
                    Generating {previewed}/{totalPeople}…</>
                  ) : (
                    <><svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M1.5 8C1.5 8 4 3.5 8 3.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>
                    Generate Previews ({totalPeople})</>
                  )}
                </button>
                {previewing && (
                  <button onClick={() => { cancelRef.current = true; }} className="text-sm text-red-500 hover:underline">Cancel</button>
                )}
                {hasEntries && !previewing && (
                  <span className="text-xs text-slate-500">{entries.length} certificates ready · {selectedEntries.length} selected</span>
                )}
              </div>
            </div>

            {/* ── Preview grid ── */}
            {hasEntries && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-700 font-medium">
                      <input type="checkbox" className="w-4 h-4 accent-indigo-600 rounded"
                        checked={selected.size === entries.length && entries.length > 0}
                        onChange={toggleAll} />
                      Select All ({entries.length})
                    </label>
                    {selected.size > 0 && selected.size < entries.length && (
                      <span className="text-xs text-slate-500">{selected.size} of {entries.length} selected</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportAll}
                      disabled={exporting || selectedEntries.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                    >
                      <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v7M4.5 5.5l2.5 2.5 2.5-2.5"/><path d="M2 9v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9"/></svg>
                      Export {selectedEntries.length > 1 ? `${selectedEntries.length} PDFs` : 'PDF'}
                    </button>
                  </div>
                </div>

                {/* Cards grid */}
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {entries.map((entry) => {
                    const isSel = selected.has(entry.id);
                    return (
                      <div key={entry.id}
                        className={`relative rounded-xl border-2 cursor-pointer transition-all group overflow-hidden ${isSel ? 'border-indigo-500 shadow-md shadow-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}
                        onClick={() => toggleSelect(entry.id)}
                      >
                        {/* Checkbox */}
                        <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${isSel ? 'bg-indigo-600 border-indigo-600' : 'bg-white/80 border-slate-300 group-hover:border-indigo-400'}`}>
                          {isSel && <svg viewBox="0 0 12 12" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg>}
                        </div>

                        {/* Preview image */}
                        <div className="bg-slate-100 aspect-[3/4] flex items-center justify-center overflow-hidden">
                          {entry.preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.preview} alt={entry.name} className="w-full h-full object-contain" />
                          ) : (
                            <div className="text-slate-400 text-center p-4">
                              <div className="text-2xl mb-1">📄</div>
                              <p className="text-[10px]">No preview</p>
                            </div>
                          )}
                        </div>

                        {/* Name / action */}
                        <div className="px-2 py-1.5 bg-white border-t border-slate-100">
                          <p className="text-[11px] font-medium text-slate-700 truncate leading-tight">{entry.name}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExportSingle(entry); }}
                            className="mt-1 w-full text-[9px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5"
                          >
                            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 1v6M4 5l2 2 2-2"/><path d="M1 8v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8"/></svg>
                            Export PDF
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!hasEntries && !previewing && (
              <div className="bg-white rounded-2xl border border-slate-200 py-16 flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-3xl">📋</div>
                <p className="text-slate-600 font-semibold">No certificates generated yet</p>
                <p className="text-sm text-slate-400 max-w-xs">
                  {mode === 'certificate-student'
                    ? 'Select a study year and class, then click "Generate Previews".'
                    : 'Click "Generate Previews" to render all staff certificates.'}
                </p>
              </div>
            )}

          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
