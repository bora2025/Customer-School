'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { formatDOB } from '../../../lib/dateUtils';
import { useLanguage } from '../../../lib/i18n';
import {
  CardDesign,
  BLANK_CERTIFICATE_STUDENT,
  BLANK_CERTIFICATE_STAFF,
  DESIGN_STORAGE_KEY,
  loadSavedDesign,
  apiGetActiveDesign,
  saveDesign,
} from '../../../components/card-designer/types';
import { renderDesignToCanvas } from '../../../components/card-designer/renderDesignToCanvas';
import { downloadSingleCardPDF, downloadA4CardsPDF } from '../../../components/card-designer/generateCardPDF';

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function IcCertificate({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}
function IcSettings({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IcRefresh({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
function IcEdit({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </svg>
  );
}
function IcPalette({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}
function IcPrint({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
function IcGraduate({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}
function IcBriefcase({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
function IcTrophy({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
    </svg>
  );
}
function IcUsers({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IcSearch({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function IcDownload({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function IcCheck({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IcArrowLeft({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Student {
  id: string; studentNumber: string; name: string; photo: string | null;
  sex: string | null; dateOfBirth: string | null; address: string; email: string; phone: string;
}
interface StudyYear { id: string; year: number; label: string | null; isCurrent: boolean; }
interface ClassItem { id: string; name: string; subject: string | null; teacher: { name: string } | null; }
interface ClassWithStudents extends ClassItem { students: Student[]; }
interface StaffUser {
  id: string; name: string; email: string; phone?: string | null; role: string;
  photo: string | null; department?: { id: string; name: string; nameKh?: string } | null;
}
type ActiveTab = 'student' | 'staff';

// ── Scoring interfaces ────────────────────────────────────────────────────────

interface ScoringEntry { studentId: string; subjectId: string; score: number | null }
interface ScoringSubject { id: string; maxScore: number }
interface ScoringExamTab { id: string }
interface ScoringSheetClass { classId: string }
interface ScoringSheet {
  id: string; classes: ScoringSheetClass[]; subjects: ScoringSubject[]; examTabs: ScoringExamTab[];
}
interface StudentScoreStats {
  total: number; maxTotal: number; averagePct: number; gpa: number; grade: string; ranking: number;
}

const CERT_GRADE_MAP = [
  { min: 90, letter: 'A', point: 4.00 },
  { min: 75, letter: 'B', point: 3.00 },
  { min: 60, letter: 'C', point: 2.00 },
  { min: 50, letter: 'D', point: 1.00 },
  { min: 40, letter: 'E', point: 0.50 },
  { min: 0,  letter: 'F', point: 0.00 },
] as const;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CertificatePage() {
  const { lang } = useLanguage();
  const [activeTab, setActiveTab] = useState<ActiveTab>('student');

  // ── Student state ──
  const [studyYears, setStudyYears] = useState<StudyYear[]>([]);
  const [selectedStudyYear, setSelectedStudyYear] = useState<string>('');
  const [classes, setClasses] = useState<ClassWithStudents[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentPage, setStudentPage] = useState(1);
  const studentPageSize = 12;
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [topRankFilter, setTopRankFilter] = useState<number | 'all'>(() => {
    try {
      const v = typeof window !== 'undefined' ? localStorage.getItem('cert-student-rank-filter') : null;
      if (!v || v === 'all') return 'all';
      const n = Number(v);
      return [3, 4, 5].includes(n) ? (n as number) : 'all';
    } catch { return 'all'; }
  });
  const [studentDesign, setStudentDesign] = useState<CardDesign>(BLANK_CERTIFICATE_STUDENT);
  const [studentDesignLoading, setStudentDesignLoading] = useState(true);
  const [showStudentEditor, setShowStudentEditor] = useState(false);

  // ── Staff state ──
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffPage, setStaffPage] = useState(1);
  const staffPageSize = 12;
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>('ALL');
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [staffDesign, setStaffDesign] = useState<CardDesign>(BLANK_CERTIFICATE_STAFF);
  const [staffDesignLoading, setStaffDesignLoading] = useState(true);
  const [showStaffEditor, setShowStaffEditor] = useState(false);

  // ── Score state ──
  const [scoresByStudentId, setScoresByStudentId] = useState<Record<string, StudentScoreStats>>({});
  const [loadingScores, setLoadingScores] = useState(false);

  // ── UI state ──
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState(false);

  const certificateDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Design loaders ────────────────────────────────────────────────────────

  const reloadStudentDesign = useCallback(() => {
    setStudentDesignLoading(true);
    apiGetActiveDesign('certificate-student').then((d) => {
      if (d) { saveDesign(d); setStudentDesign(d); }
      else setStudentDesign(loadSavedDesign('certificate-student') ?? BLANK_CERTIFICATE_STUDENT);
    }).finally(() => setStudentDesignLoading(false));
  }, []);

  const reloadStaffDesign = useCallback(() => {
    setStaffDesignLoading(true);
    apiGetActiveDesign('certificate-staff').then((d) => {
      if (d) { saveDesign(d); setStaffDesign(d); }
      else setStaffDesign(loadSavedDesign('certificate-staff') ?? BLANK_CERTIFICATE_STAFF);
    }).finally(() => setStaffDesignLoading(false));
  }, []);

  useEffect(() => { reloadStudentDesign(); reloadStaffDesign(); }, [reloadStudentDesign, reloadStaffDesign]);
  useEffect(() => { if (!showStudentEditor) reloadStudentDesign(); }, [reloadStudentDesign, showStudentEditor]);
  useEffect(() => { if (!showStaffEditor) reloadStaffDesign(); }, [reloadStaffDesign, showStaffEditor]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === DESIGN_STORAGE_KEY) { reloadStudentDesign(); reloadStaffDesign(); } };
    window.addEventListener('storage', onStorage);
    const onVisibility = () => { if (document.visibilityState === 'visible') { reloadStudentDesign(); reloadStaffDesign(); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisibility); };
  }, [reloadStudentDesign, reloadStaffDesign]);

  // ── Data fetchers ─────────────────────────────────────────────────────────

  useEffect(() => { fetchStudyYears(); fetchStaff(); }, []);

  const fetchStudyYears = async () => {
    try {
      const res = await apiFetch('/api/study-years');
      if (res.ok) {
        const years: StudyYear[] = await res.json();
        setStudyYears(years);
        const current = years.find((y) => y.isCurrent);
        if (current) { setSelectedStudyYear(current.id); await fetchClasses(current.id); }
      }
    } catch { console.error('Failed to fetch study years'); }
    finally { setLoadingYears(false); }
  };

  const fetchClasses = async (studyYearId: string) => {
    setLoadingClasses(true); setSelectedClassId(null); setSelectedStudentIds(new Set());
    try {
      const res = await apiFetch(`/api/classes?studyYearId=${studyYearId}`);
      if (!res.ok) { setClasses([]); return; }
      const list: ClassItem[] = await res.json();
      const withStudents: ClassWithStudents[] = await Promise.all(
        list.map(async (cls) => {
          try {
            const r = await apiFetch(`/api/classes/${cls.id}/students`);
            return { ...cls, students: r.ok ? await r.json() : [] };
          } catch { return { ...cls, students: [] }; }
        })
      );
      setClasses(withStudents);
    } catch { console.error('Failed to fetch classes'); }
    finally { setLoadingClasses(false); }
  };

  const fetchStaff = async () => {
    try {
      const res = await apiFetch('/api/auth/users');
      if (res.ok) {
        const all: StaffUser[] = await res.json();
        setStaffUsers(all.filter((u) => !['STUDENT', 'PARENT'].includes(u.role)));
      }
    } catch { console.error('Failed to fetch staff'); }
    finally { setLoadingStaff(false); }
  };

  const fetchClassScores = async (classId: string) => {
    setLoadingScores(true); setScoresByStudentId({});
    try {
      const sheetsRes = await apiFetch('/api/scoring/sheets');
      if (!sheetsRes.ok) return;
      const allSheets: ScoringSheet[] = await sheetsRes.json();
      const classSheets = allSheets.filter((s) => s.classes.some((c) => c.classId === classId));
      if (classSheets.length === 0) return;
      const subjectMaxMap: Record<string, number> = {};
      const allEntries: ScoringEntry[] = [];
      for (const sheet of classSheets) {
        for (const subj of sheet.subjects) { subjectMaxMap[subj.id] = subj.maxScore > 0 ? subj.maxScore : 100; }
        for (const tab of sheet.examTabs) {
          try {
            const tabRes = await apiFetch(`/api/scoring/exam-tabs/${tab.id}/scores?classIds=${classId}`);
            if (!tabRes.ok) continue;
            const { entries } = await tabRes.json() as { entries: ScoringEntry[]; students: unknown[] };
            allEntries.push(...entries);
          } catch { /* skip */ }
        }
      }
      const entryByStudent: Record<string, ScoringEntry[]> = {};
      for (const entry of allEntries) {
        if (entry.score === null) continue;
        if (!entryByStudent[entry.studentId]) entryByStudent[entry.studentId] = [];
        entryByStudent[entry.studentId].push(entry);
      }
      const raw: Record<string, { total: number; maxTotal: number }> = {};
      for (const [sid, entries] of Object.entries(entryByStudent)) {
        let total = 0, maxTotal = 0;
        for (const e of entries) { total += e.score as number; maxTotal += subjectMaxMap[e.subjectId] ?? 100; }
        raw[sid] = { total, maxTotal };
      }
      const sorted = Object.entries(raw).sort(([, a], [, b]) => b.total - a.total);
      const finalStats: Record<string, StudentScoreStats> = {};
      sorted.forEach(([sid, { total, maxTotal }], idx) => {
        const averagePct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
        const gradeEntry = CERT_GRADE_MAP.find((g) => averagePct >= g.min) ?? CERT_GRADE_MAP[CERT_GRADE_MAP.length - 1];
        finalStats[sid] = { total, maxTotal, averagePct, gpa: gradeEntry.point, grade: gradeEntry.letter, ranking: idx + 1 };
      });
      setScoresByStudentId(finalStats);
    } catch (err) { console.error('Failed to fetch class scores', err); }
    finally { setLoadingScores(false); }
  };

  useEffect(() => {
    setSelectedStudentIds(new Set());
    if (selectedClassId) fetchClassScores(selectedClassId);
    else setScoresByStudentId({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  // ── Field value builders ──────────────────────────────────────────────────

  const buildStudentFields = (student: Student, className: string, studyYearLabel: string): Record<string, string> => {
    const stats = scoresByStudentId[student.id];
    return {
      '{{name}}': student.name, '{{studentNumber}}': student.studentNumber || '',
      '{{class}}': className, '{{studyYear}}': studyYearLabel,
      '{{dateOfBirth}}': formatDOB(student.dateOfBirth, lang),
      '{{sex}}': student.sex === 'MALE' ? 'ប្រុស' : student.sex === 'FEMALE' ? 'ស្រី' : '',
      '{{certificateDate}}': certificateDate, '{{schoolName}}': 'Wattanman Academy',
      '{{total}}': stats ? stats.total.toFixed(0) : '-',
      '{{average}}': stats ? stats.averagePct.toFixed(1) + '%' : '-',
      '{{gpa}}': stats ? stats.gpa.toFixed(2) : '-',
      '{{grade}}': stats ? stats.grade : '-',
      '{{ranking}}': stats ? String(stats.ranking) : '-',
      'Student Name': student.name, 'Student ID': student.studentNumber || '',
      'Class Name': className, 'Study Year': studyYearLabel,
    };
  };

  const buildStaffFields = (staff: StaffUser): Record<string, string> => ({
    '{{name}}': staff.name, '{{role}}': staff.role,
    '{{department}}': staff.department?.name || '', '{{email}}': staff.email,
    '{{certificateDate}}': certificateDate, '{{schoolName}}': 'Wattanman Academy',
    'Staff Name': staff.name, 'Position': staff.role, 'Emp ID': staff.id.slice(0, 8),
  });

  // ── Export helpers ────────────────────────────────────────────────────────

  const exportStudentPDF = async (student: Student, className: string, studyYearLabel: string) => {
    if (exporting) return; setExporting(true);
    try { await downloadSingleCardPDF(studentDesign, { name: student.name, fieldValues: buildStudentFields(student, className, studyYearLabel) }); }
    catch (e) { console.error(e); alert('Export failed.'); } finally { setExporting(false); }
  };
  const exportStudentPNG = async (student: Student, className: string, studyYearLabel: string) => {
    if (exporting) return; setExporting(true);
    try {
      const canvas = await renderDesignToCanvas(studentDesign, { fieldValues: buildStudentFields(student, className, studyYearLabel) });
      const a = document.createElement('a');
      a.download = `${student.name.replace(/[^a-zA-Z0-9]/g, '-')}-certificate.png`; a.href = canvas.toDataURL(); a.click();
    } catch (e) { console.error(e); alert('Export failed.'); } finally { setExporting(false); }
  };
  const exportAllStudentsPDF = async (title: string, studyYearLabel: string, students: Student[], className?: string) => {
    if (exporting || students.length === 0) return; setExporting(true);
    try {
      await downloadA4CardsPDF(studentDesign, students.map((s) => ({ name: s.name, fieldValues: buildStudentFields(s, className || title, studyYearLabel) })), title);
    } catch (e) { console.error(e); alert('Export failed.'); } finally { setExporting(false); }
  };
  const exportStaffPDF = async (staff: StaffUser) => {
    if (exporting) return; setExporting(true);
    try { await downloadSingleCardPDF(staffDesign, { name: staff.name, fieldValues: buildStaffFields(staff) }); }
    catch (e) { console.error(e); alert('Export failed.'); } finally { setExporting(false); }
  };
  const exportStaffPNG = async (staff: StaffUser) => {
    if (exporting) return; setExporting(true);
    try {
      const canvas = await renderDesignToCanvas(staffDesign, { fieldValues: buildStaffFields(staff) });
      const a = document.createElement('a');
      a.download = `${staff.name.replace(/[^a-zA-Z0-9]/g, '-')}-certificate.png`; a.href = canvas.toDataURL(); a.click();
    } catch (e) { console.error(e); alert('Export failed.'); } finally { setExporting(false); }
  };
  const exportAllStaffPDF = async (staffList: StaffUser[]) => {
    if (exporting || staffList.length === 0) return; setExporting(true);
    try { await downloadA4CardsPDF(staffDesign, staffList.map((s) => ({ name: s.name, fieldValues: buildStaffFields(s) })), 'Staff Certificates'); }
    catch (e) { console.error(e); alert('Export failed.'); } finally { setExporting(false); }
  };

  // ── Rank filter helper ────────────────────────────────────────────────────

  const updateRankFilter = (opt: number | 'all') => {
    setTopRankFilter(opt);
    try { localStorage.setItem('cert-student-rank-filter', String(opt)); } catch { /**/ }
    setStudentPage(1); setSelectedStudentIds(new Set());
  };

  // ── Print (bulk PDF for current view) ────────────────────────────────────

  const handlePrint = async () => {
    if (exporting) return;
    if (activeTab === 'student') {
      const students = selectedStudentIds.size > 0
        ? filteredStudents.filter((s) => selectedStudentIds.has(s.id))
        : filteredStudents;
      if (students.length === 0) return;
      await exportAllStudentsPDF(selectedClass?.name ?? studyYearLabel, studyYearLabel, students, selectedClass?.name);
    } else {
      const staff = selectedStaffIds.size > 0
        ? filteredStaff.filter((s) => selectedStaffIds.has(s.id))
        : filteredStaff;
      await exportAllStaffPDF(staff);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedYearObj = studyYears.find((y) => y.id === selectedStudyYear);
  const studyYearLabel = selectedYearObj?.label || selectedYearObj?.year?.toString() || '';
  const selectedClass = classes.find((c) => c.id === selectedClassId);
  const totalStudents = classes.reduce((s, c) => s + c.students.length, 0);
  const hasScores = Object.keys(scoresByStudentId).length > 0;

  const filteredStudents = (() => {
    if (!selectedClass) return [];
    let list = selectedClass.students.filter((s) =>
      !studentSearch ||
      s.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
      (s.studentNumber && s.studentNumber.toLowerCase().includes(studentSearch.toLowerCase()))
    );
    if (hasScores) list = [...list].sort((a, b) => (scoresByStudentId[a.id]?.ranking ?? 99999) - (scoresByStudentId[b.id]?.ranking ?? 99999));
    if (topRankFilter !== 'all' && hasScores) {
      list = list.filter((s) => { const rank = scoresByStudentId[s.id]?.ranking; return rank !== undefined && rank <= (topRankFilter as number); });
    }
    return list;
  })();
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / studentPageSize));
  const safeStudentPage = Math.min(studentPage, totalStudentPages);
  const pagedStudents = filteredStudents.slice((safeStudentPage - 1) * studentPageSize, safeStudentPage * studentPageSize);

  const filteredStaff = staffUsers.filter((u) => {
    const matchRole = staffRoleFilter === 'ALL' || u.role === staffRoleFilter;
    const matchSearch = !staffSearch || u.name.toLowerCase().includes(staffSearch.toLowerCase()) || u.email.toLowerCase().includes(staffSearch.toLowerCase());
    return matchRole && matchSearch;
  });
  const totalStaffPages = Math.max(1, Math.ceil(filteredStaff.length / staffPageSize));
  const safeStaffPage = Math.min(staffPage, totalStaffPages);
  const pagedStaff = filteredStaff.slice((safeStaffPage - 1) * staffPageSize, safeStaffPage * staffPageSize);
  const staffRoles = ['ALL', ...Array.from(new Set(staffUsers.map((u) => u.role))).sort()];

  const isStudent = activeTab === 'student';
  const designLoading = isStudent ? studentDesignLoading : staffDesignLoading;
  const showEditor = isStudent ? showStudentEditor : showStaffEditor;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-shell">
      {/* Exporting overlay */}
      {exporting && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4">
            <div className="relative w-14 h-14">
              <div className="w-14 h-14 rounded-full border-4 border-amber-100 flex items-center justify-center">
                <IcCertificate className="w-7 h-7 text-amber-500" />
              </div>
              <div className="absolute inset-0 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-800">Generating Certificates…</p>
              <p className="text-xs text-slate-400 mt-1">Please wait</p>
            </div>
          </div>
        </div>
      )}

      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />

      <div className="page-content">
        <div className="h-14 lg:hidden" />

        {/* ══════════════════════════════════════════════════
            PROFESSIONAL HEADER
        ══════════════════════════════════════════════════ */}
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-800 to-slate-900 px-6 py-6">
          <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-amber-500/10 pointer-events-none" />
          <div className="absolute -bottom-10 right-32 w-32 h-32 rounded-full bg-orange-400/8 pointer-events-none" />
          <div className="relative flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shrink-0">
                <IcCertificate className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Certificate Dashboard</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  {isStudent
                    ? selectedYearObj
                      ? `${studyYearLabel} · ${classes.length} classes · ${totalStudents} students`
                      : 'Select a study year to begin'
                    : `${filteredStaff.length} staff member${filteredStaff.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            {isStudent && (
              <select
                value={selectedStudyYear}
                onChange={(e) => { setSelectedStudyYear(e.target.value); if (e.target.value) fetchClasses(e.target.value); else setClasses([]); }}
                className="bg-white/10 border border-white/20 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/50 [&>option]:text-slate-800 [&>option]:bg-white min-w-[160px]"
              >
                <option value="">Select Study Year…</option>
                {studyYears.map((sy) => (
                  <option key={sy.id} value={sy.id}>{sy.label || sy.year}{sy.isCurrent ? ' (Current)' : ''}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            TABS + TOOLBAR BAR
        ══════════════════════════════════════════════════ */}
        <div className="bg-white border-b border-slate-200 shadow-sm sticky top-14 z-30">
          <div className="flex items-stretch justify-between px-2">
            {/* Tabs */}
            <div className="flex items-stretch">
              <CertTab active={isStudent} onClick={() => setActiveTab('student')} icon={<IcGraduate className="w-4 h-4" />} label="Student Certificates" />
              <CertTab active={!isStudent} onClick={() => setActiveTab('staff')} icon={<IcBriefcase className="w-4 h-4" />} label="Staff Certificates" />
            </div>
            {/* Toolbar */}
            <div className="flex items-center gap-0.5 px-2 py-2">
              <ToolbarBtn icon={<IcSettings className="w-4 h-4" />} label="Settings" active={showSettings} onClick={() => setShowSettings((v) => !v)} />
              <ToolbarBtn
                icon={designLoading
                  ? <span className="w-4 h-4 flex items-center justify-center"><span className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-amber-500 animate-spin inline-block" /></span>
                  : <IcRefresh className="w-4 h-4" />}
                label="Refresh"
                onClick={isStudent ? reloadStudentDesign : reloadStaffDesign}
                disabled={designLoading}
              />
              <ToolbarBtn
                icon={<IcEdit className="w-4 h-4" />}
                label="Edit Design"
                active={showEditor}
                onClick={() => isStudent ? setShowStudentEditor((v) => !v) : setShowStaffEditor((v) => !v)}
              />
              <ToolbarSep />
              <Link href="/admin/card-designer" className="outline-none">
                <ToolbarBtn icon={<IcPalette className="w-4 h-4" />} label="Designer" onClick={() => {}} />
              </Link>
              <ToolbarBtn icon={<IcPrint className="w-4 h-4" />} label="Print" onClick={handlePrint} disabled={exporting} accent />
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            SETTINGS PANEL
        ══════════════════════════════════════════════════ */}
        {showSettings && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200/80 px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                <IcTrophy className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-slate-700">Generate Certificates for:</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(['all', 3, 4, 5] as const).map((opt) => (
                  <button
                    key={String(opt)}
                    onClick={() => updateRankFilter(opt)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      topRankFilter === opt
                        ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-100'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    {opt === 'all'
                      ? <><IcUsers className="w-3.5 h-3.5" /><span>All Students</span></>
                      : <><IcTrophy className="w-3.5 h-3.5" /><span>Top {opt}</span></>}
                  </button>
                ))}
              </div>
              {topRankFilter !== 'all' && hasScores && (
                <span className="text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-full">
                  {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''} shown
                </span>
              )}
              {topRankFilter !== 'all' && !hasScores && (
                <span className="text-xs text-slate-400 italic">Open a class to apply ranking filter</span>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════
            INLINE EDITOR
        ══════════════════════════════════════════════════ */}
        {isStudent && showStudentEditor && (
          <InlineEditor cardType="certificate-student" onSave={reloadStudentDesign} onClose={() => { reloadStudentDesign(); setShowStudentEditor(false); }} />
        )}
        {!isStudent && showStaffEditor && (
          <InlineEditor cardType="certificate-staff" onSave={reloadStaffDesign} onClose={() => { reloadStaffDesign(); setShowStaffEditor(false); }} />
        )}

        {/* ══════════════════════════════════════════════════
            MAIN CONTENT
        ══════════════════════════════════════════════════ */}
        <div className="p-5 space-y-5">

          {/* ── STUDENT TAB ── */}
          {isStudent && (
            <>
              {!selectedStudyYear && !loadingYears && (
                <EmptyState icon={<IcGraduate className="w-10 h-10 text-slate-300" />} title="Select a Study Year" desc="Use the dropdown in the header to choose a study year." />
              )}

              {selectedStudyYear && loadingClasses && (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-slate-500 mt-3">Loading classes…</p>
                </div>
              )}

              {/* Class grid */}
              {selectedStudyYear && !loadingClasses && !selectedClassId && (
                <>
                  {classes.length === 0 ? (
                    <EmptyState icon={<IcGraduate className="w-10 h-10 text-slate-300" />} title="No classes found" desc="Create classes and add students first." />
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                          Select a class <span className="normal-case font-normal text-slate-400 ml-1">({classes.length})</span>
                        </h2>
                        {totalStudents > 0 && (
                          <button
                            onClick={() => exportAllStudentsPDF(studyYearLabel, studyYearLabel, classes.flatMap((c) => c.students))}
                            disabled={exporting}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
                          >
                            <IcDownload className="w-3.5 h-3.5" /> All Certificates ({totalStudents})
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {classes.map((cls) => (
                          <button
                            key={cls.id}
                            onClick={() => { setSelectedClassId(cls.id); setStudentSearch(''); setStudentPage(1); setSelectedStudentIds(new Set()); }}
                            className="group bg-white rounded-2xl overflow-hidden border border-slate-200 hover:border-amber-300 hover:shadow-lg hover:shadow-amber-50 hover:-translate-y-0.5 transition-all duration-200 text-left"
                          >
                            <div className="bg-gradient-to-br from-amber-400 to-orange-500 px-5 py-5">
                              <div className="flex items-start justify-between">
                                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                                  <IcGraduate className="w-5 h-5 text-white" />
                                </div>
                                <span className="bg-white/25 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                                  {cls.students.length}
                                </span>
                              </div>
                              <h3 className="text-white font-bold text-base mt-3 leading-tight">{cls.name}</h3>
                              {cls.subject && <p className="text-white/70 text-xs mt-0.5">{cls.subject}</p>}
                            </div>
                            <div className="px-5 py-3 flex items-center justify-between">
                              <span className="text-xs text-slate-500 truncate">{cls.teacher ? cls.teacher.name : 'No teacher'}</span>
                              <span className="text-xs font-semibold text-amber-500 group-hover:text-amber-600 transition-colors">Open →</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Class detail */}
              {selectedStudyYear && !loadingClasses && selectedClass && (
                <div className="space-y-4">
                  {/* Action bar */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      <button
                        onClick={() => { setSelectedClassId(null); setSelectedStudentIds(new Set()); }}
                        className="inline-flex items-center gap-1.5 text-slate-500 hover:text-amber-600 font-medium text-sm transition-colors shrink-0"
                      >
                        <IcArrowLeft className="w-4 h-4" /> Back
                      </button>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                          <IcGraduate className="w-4 h-4 text-white" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="font-bold text-slate-800 text-base leading-tight truncate">{selectedClass.name}</h2>
                          <p className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap">
                            {selectedClass.teacher && <span>{selectedClass.teacher.name}</span>}
                            {studyYearLabel && <><span className="text-slate-300">·</span><span>{studyYearLabel}</span></>}
                            <span className="text-slate-300">·</span>
                            <span>{filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}</span>
                            {loadingScores && (
                              <span className="inline-flex items-center gap-1 text-amber-500">
                                <span className="w-2.5 h-2.5 rounded-full border-2 border-amber-300 border-t-amber-600 animate-spin" />
                                Loading scores…
                              </span>
                            )}
                            {!loadingScores && hasScores && <span className="text-emerald-500 font-medium">· Scores ready</span>}
                          </p>
                        </div>
                      </div>
                      <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
                        <div className="relative">
                          <IcSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text" placeholder="Search…" value={studentSearch}
                            onChange={(e) => { setStudentSearch(e.target.value); setStudentPage(1); }}
                            className="pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-amber-300 focus:ring-2 focus:ring-amber-100 outline-none transition-all w-40"
                          />
                        </div>
                        <button onClick={() => setSelectedStudentIds(new Set(filteredStudents.map((s) => s.id)))} className="px-3 py-2 text-xs rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-medium transition-colors">☑ All</button>
                        <button onClick={() => setSelectedStudentIds(new Set())} className="px-3 py-2 text-xs rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-medium transition-colors">☐ None</button>
                        {filteredStudents.length > 0 && (
                          <button
                            onClick={() => {
                              const toExport = selectedStudentIds.size > 0 ? filteredStudents.filter((s) => selectedStudentIds.has(s.id)) : filteredStudents;
                              exportAllStudentsPDF(selectedClass.name, studyYearLabel, toExport, selectedClass.name);
                            }}
                            disabled={exporting}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm"
                          >
                            <IcDownload className="w-3.5 h-3.5" />
                            {selectedStudentIds.size > 0 ? `PDF (${selectedStudentIds.size})` : topRankFilter !== 'all' ? `PDF Top ${topRankFilter} (${filteredStudents.length})` : `PDF All (${filteredStudents.length})`}
                          </button>
                        )}
                      </div>
                    </div>
                    {selectedStudentIds.size > 0 && (
                      <div className="px-5 py-2.5 bg-amber-50 border-t border-amber-100 flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                          <IcCheck className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-xs font-medium text-amber-700">{selectedStudentIds.size} selected for export</span>
                        <button onClick={() => setSelectedStudentIds(new Set())} className="ml-auto text-xs text-amber-500 hover:text-amber-700 font-medium">Clear</button>
                      </div>
                    )}
                  </div>

                  {pagedStudents.length === 0 ? (
                    <EmptyState icon={<IcSearch className="w-10 h-10 text-slate-300" />} title="No students found" desc={studentSearch ? `No results for "${studentSearch}"` : 'No students in this class.'} />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      {pagedStudents.map((student) => (
                        <CertPreview
                          key={student.id}
                          name={student.name}
                          subtitle={`${selectedClass.name}${studyYearLabel ? ' · ' + studyYearLabel : ''}`}
                          design={studentDesign}
                          fieldValues={buildStudentFields(student, selectedClass.name, studyYearLabel)}
                          isSelected={selectedStudentIds.has(student.id)}
                          ranking={scoresByStudentId[student.id]?.ranking}
                          stats={scoresByStudentId[student.id]}
                          onToggleSelect={() => setSelectedStudentIds((prev) => {
                            const next = new Set(prev); next.has(student.id) ? next.delete(student.id) : next.add(student.id); return next;
                          })}
                          onDownloadPDF={() => exportStudentPDF(student, selectedClass.name, studyYearLabel)}
                          onDownloadPNG={() => exportStudentPNG(student, selectedClass.name, studyYearLabel)}
                        />
                      ))}
                    </div>
                  )}
                  {totalStudentPages > 1 && (
                    <PaginationBar page={safeStudentPage} total={totalStudentPages} onPage={setStudentPage}
                      from={(safeStudentPage - 1) * studentPageSize + 1}
                      to={Math.min(safeStudentPage * studentPageSize, filteredStudents.length)}
                      count={filteredStudents.length} accentClass="bg-amber-500 text-white border-amber-500"
                    />
                  )}
                </div>
              )}
            </>
          )}

          {/* ── STAFF TAB ── */}
          {!isStudent && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
                      <IcSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input type="text" placeholder="Search staff…" value={staffSearch}
                        onChange={(e) => { setStaffSearch(e.target.value); setStaffPage(1); }}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none transition-all"
                      />
                    </div>
                    <select value={staffRoleFilter}
                      onChange={(e) => { setStaffRoleFilter(e.target.value); setStaffPage(1); setSelectedStaffIds(new Set()); }}
                      className="text-sm rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:border-emerald-300"
                    >
                      {staffRoles.map((r) => <option key={r} value={r}>{r === 'ALL' ? 'All Roles' : r}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setSelectedStaffIds(new Set(filteredStaff.map((s) => s.id)))} className="px-3 py-2 text-xs rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-medium transition-colors">☑ All</button>
                    <button onClick={() => setSelectedStaffIds(new Set())} className="px-3 py-2 text-xs rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 font-medium transition-colors">☐ None</button>
                    {filteredStaff.length > 0 && (
                      <button
                        onClick={() => exportAllStaffPDF(selectedStaffIds.size > 0 ? filteredStaff.filter((s) => selectedStaffIds.has(s.id)) : filteredStaff)}
                        disabled={exporting}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 shadow-sm"
                      >
                        <IcDownload className="w-3.5 h-3.5" />
                        {selectedStaffIds.size > 0 ? `PDF (${selectedStaffIds.size})` : `PDF All (${filteredStaff.length})`}
                      </button>
                    )}
                  </div>
                </div>
                {selectedStaffIds.size > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                      <IcCheck className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-xs font-medium text-emerald-700">{selectedStaffIds.size} selected for export</span>
                    <button onClick={() => setSelectedStaffIds(new Set())} className="ml-auto text-xs text-emerald-500 hover:text-emerald-700 font-medium">Clear</button>
                  </div>
                )}
              </div>

              {loadingStaff ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-slate-500 mt-3">Loading staff…</p>
                </div>
              ) : pagedStaff.length === 0 ? (
                <EmptyState icon={<IcBriefcase className="w-10 h-10 text-slate-300" />} title="No staff found"
                  desc={staffSearch ? `No staff matching "${staffSearch}"` : 'No staff members for this filter.'} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {pagedStaff.map((staff) => (
                    <CertPreview key={staff.id} name={staff.name}
                      subtitle={`${staff.role}${staff.department ? ' · ' + staff.department.name : ''}`}
                      photo={staff.photo} design={staffDesign} fieldValues={buildStaffFields(staff)}
                      isSelected={selectedStaffIds.has(staff.id)}
                      onToggleSelect={() => setSelectedStaffIds((prev) => { const next = new Set(prev); next.has(staff.id) ? next.delete(staff.id) : next.add(staff.id); return next; })}
                      onDownloadPDF={() => exportStaffPDF(staff)}
                      onDownloadPNG={() => exportStaffPNG(staff)}
                    />
                  ))}
                </div>
              )}
              {!loadingStaff && totalStaffPages > 1 && (
                <PaginationBar page={safeStaffPage} total={totalStaffPages} onPage={setStaffPage}
                  from={(safeStaffPage - 1) * staffPageSize + 1}
                  to={Math.min(safeStaffPage * staffPageSize, filteredStaff.length)}
                  count={filteredStaff.length} accentClass="bg-emerald-600 text-white border-emerald-600"
                />
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CertTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`relative flex items-center gap-2 px-5 py-4 text-sm font-semibold border-b-2 transition-all duration-150 ${
      active ? 'text-amber-600 border-amber-500' : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-200'
    }`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function ToolbarBtn({ icon, label, onClick, active, disabled, accent }: {
  icon: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean; accent?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed min-w-[52px] ${
        active ? 'bg-amber-50 text-amber-600' :
        accent ? 'text-amber-600 hover:bg-amber-50' :
        'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
      }`}
    >
      <span className="flex items-center justify-center">{icon}</span>
      <span className="leading-none whitespace-nowrap">{label}</span>
    </button>
  );
}

function ToolbarSep() {
  return <div className="w-px h-8 bg-slate-200 mx-1 self-center" />;
}

function InlineEditor({ cardType, onSave, onClose }: {
  cardType: 'certificate-student' | 'certificate-staff'; onSave: () => void; onClose: () => void;
}) {
  const CardEditor = dynamic(() => import('../../../components/card-designer/CardEditor'), { ssr: false });
  const label = cardType === 'certificate-student' ? 'Student Certificate' : 'Staff Certificate';
  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <IcEdit className="w-4 h-4 text-amber-500" />
          <span className="font-semibold text-slate-800 text-sm">Editing {label} Design</span>
          <span className="text-xs text-slate-400">· Save to apply changes</span>
        </div>
        <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 font-medium px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">✕ Close</button>
      </div>
      <div className="p-3"><CardEditor initialCardType={cardType} onSave={onSave} /></div>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-16">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="mb-1">{icon}</div>
        <p className="font-semibold text-slate-600 text-base">{title}</p>
        <p className="text-sm text-slate-400 max-w-xs">{desc}</p>
      </div>
    </div>
  );
}

function PaginationBar({ page, total, onPage, from, to, count, accentClass }: {
  page: number; total: number; onPage: (p: number) => void;
  from: number; to: number; count: number; accentClass: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Showing {from}–{to} of {count}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">← Prev</button>
          {Array.from({ length: total }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === total || Math.abs(p - page) <= 1)
            .reduce<(number | string)[]>((acc, p, i, arr) => {
              if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
              acc.push(p); return acc;
            }, [])
            .map((p, i) => typeof p === 'string'
              ? <span key={`d${i}`} className="px-1 text-xs text-slate-400">…</span>
              : <button key={p} onClick={() => onPage(p)} className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${p === page ? accentClass : 'border-slate-200 hover:bg-slate-50'}`}>{p}</button>
            )}
          <button onClick={() => onPage(Math.min(total, page + 1))} disabled={page >= total} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next →</button>
        </div>
      </div>
    </div>
  );
}

function CertPreview({ name, subtitle, photo, design, fieldValues, isSelected, onToggleSelect, onDownloadPDF, onDownloadPNG, ranking, stats }: {
  name: string; subtitle: string; photo?: string | null; design: CardDesign;
  fieldValues: Record<string, string>; isSelected: boolean;
  onToggleSelect: () => void; onDownloadPDF: () => void; onDownloadPNG: () => void;
  ranking?: number; stats?: StudentScoreStats;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let cancelled = false; setRendering(true);
    renderDesignToCanvas(design, { fieldValues, photoUrl: photo }).then((canvas) => {
      if (!cancelled) { setImgSrc(canvas.toDataURL()); setRendering(false); }
    }).catch(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; };
  }, [design, fieldValues, photo]);

  const medal = ranking === 1 ? '🥇' : ranking === 2 ? '🥈' : ranking === 3 ? '🥉' : null;
  const gradeColor = stats?.grade === 'A' ? 'bg-green-100 text-green-700' :
    stats?.grade === 'B' ? 'bg-blue-100 text-blue-700' :
    stats?.grade === 'C' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';

  return (
    <div className={`group flex flex-col rounded-2xl overflow-hidden border-2 transition-all duration-200 ${
      isSelected ? 'border-amber-400 shadow-lg shadow-amber-100' : 'border-slate-200 shadow-sm hover:border-amber-200 hover:shadow-md'
    }`}>
      <div className="relative cursor-pointer bg-slate-100" style={{ aspectRatio: `${design.width} / ${design.height}` }} onClick={onToggleSelect} title="Click to select">
        {rendering || !imgSrc ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-7 h-7 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <img src={imgSrc} alt={`${name} certificate`} className="w-full h-full object-contain" />
        )}
        <div className={`absolute inset-0 transition-colors ${isSelected ? 'bg-amber-500/10' : 'hover:bg-black/5'}`} />
        {isSelected && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center shadow-md">
            <IcCheck className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        {medal && <div className="absolute top-2 left-2 text-2xl leading-none drop-shadow-md select-none pointer-events-none">{medal}</div>}
        {ranking && ranking > 3 && (
          <div className="absolute top-2 left-2 bg-slate-700/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow leading-none pointer-events-none">#{ranking}</div>
        )}
      </div>
      <div className="bg-white px-3 py-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
            <p className="text-xs text-slate-400 truncate">{subtitle}</p>
          </div>
          {ranking && <span className="text-xs font-bold text-amber-500 shrink-0">#{ranking}</span>}
        </div>
        {stats && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${gradeColor}`}>{stats.grade}</span>
            <span className="text-[11px] text-slate-500">GPA {stats.gpa.toFixed(2)}</span>
            <span className="text-[11px] text-slate-300">·</span>
            <span className="text-[11px] text-slate-500">{stats.averagePct.toFixed(1)}%</span>
            <span className="text-[11px] text-slate-300">·</span>
            <span className="text-[11px] text-slate-500">{stats.total.toFixed(0)} pts</span>
          </div>
        )}
        <div className="mt-2.5 flex gap-1.5">
          <button onClick={onDownloadPNG} disabled={!imgSrc}
            className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] px-2 py-1.5 rounded-lg font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40">
            <IcDownload className="w-3 h-3" /> PNG
          </button>
          <button onClick={onDownloadPDF} disabled={!imgSrc}
            className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] px-2 py-1.5 rounded-lg font-medium border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40">
            <IcPrint className="w-3 h-3" /> PDF
          </button>
        </div>
      </div>
    </div>
  );
}
