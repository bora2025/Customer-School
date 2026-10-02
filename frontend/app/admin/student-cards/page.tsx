'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import QRCode from 'qrcode';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../../lib/i18n';
import { formatDOB } from '../../../lib/dateUtils';
import { CardDesign, STUDENT_TEMPLATE, DESIGN_STORAGE_KEY, loadSavedDesign, apiGetActiveDesign, saveDesign } from '../../../components/card-designer/types';
import { renderDesignToCanvas } from '../../../components/card-designer/renderDesignToCanvas';
import { downloadSingleCardPDF, downloadA4CardsPDF } from '../../../components/card-designer/generateCardPDF';

// Lazy-load the heavy card editor (QRCode + jsPDF + canvas + ~50KB) so the
// student-cards page itself loads instantly. The editor only mounts when the
// admin actually opens it.
const CardEditor = dynamic(() => import('../../../components/card-designer/CardEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full">
      <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

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
}

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

interface ClassWithStudents extends ClassItem {
  students: Student[];
}

function normalizePhotoUrl(url: string): string {
  if (!url) return url;
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  return url;
}

export default function StudentCardsPage() {
  const { t, lang } = useLanguage();
  const [studyYears, setStudyYears] = useState<StudyYear[]>([]);
  const [selectedStudyYear, setSelectedStudyYear] = useState<string>('');
  const [classes, setClasses] = useState<ClassWithStudents[]>([]);
  const [qrCodes, setQrCodes] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [selectedStudentClass, setSelectedStudentClass] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(20);
  const [showEditor, setShowEditor] = useState(false);
  const [liveDesign, setLiveDesign] = useState<CardDesign>(STUDENT_TEMPLATE);
  const [designLoading, setDesignLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchStudyYears();
  }, []);

  const reloadDesign = useCallback(() => {
    setDesignLoading(true);
    // Try API first so all users see the shared active design
    apiGetActiveDesign('student').then((apiDesign) => {
      if (apiDesign) {
        saveDesign(apiDesign);
        setLiveDesign(apiDesign);
      } else {
        setLiveDesign(loadSavedDesign('student') ?? STUDENT_TEMPLATE);
      }
    }).finally(() => setDesignLoading(false));
  }, []);

  useEffect(() => { reloadDesign(); }, [reloadDesign]);
  useEffect(() => { if (!showEditor) reloadDesign(); }, [reloadDesign, showEditor]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === DESIGN_STORAGE_KEY) reloadDesign(); };
    window.addEventListener('storage', onStorage);
    // Re-fetch when the tab becomes visible again (e.g. user switches back)
    const onVisibility = () => { if (document.visibilityState === 'visible') reloadDesign(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reloadDesign]);

  const fetchStudyYears = async () => {
    try {
      const res = await apiFetch('/api/study-years');
      if (res.ok) {
        const years: StudyYear[] = await res.json();
        setStudyYears(years);
        const current = years.find((y) => y.isCurrent);
        if (current) {
          setSelectedStudyYear(current.id);
          await fetchClassesByStudyYear(current.id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch study years');
    } finally {
      setLoading(false);
    }
  };

  const fetchClassesByStudyYear = async (studyYearId: string) => {
    setLoadingClasses(true);
    setSelectedStudentClass(null);
    try {
      const classRes = await apiFetch(`/api/classes?studyYearId=${studyYearId}`);
      if (!classRes.ok) { setClasses([]); return; }
      const classList: ClassItem[] = await classRes.json();

      const classesWithStudents: ClassWithStudents[] = await Promise.all(
        classList.map(async (cls) => {
          try {
            const studRes = await apiFetch(`/api/classes/${cls.id}/students`);
            const students = studRes.ok ? await studRes.json() : [];
            return { ...cls, students };
          } catch {
            return { ...cls, students: [] };
          }
        })
      );

      setClasses(classesWithStudents);

      const allStudents = classesWithStudents.flatMap((c) => c.students);
      await generateQRCodes(allStudents.map((s) => ({ id: s.id, name: s.name })));
    } catch (err) {
      console.error('Failed to fetch classes');
    } finally {
      setLoadingClasses(false);
    }
  };

  const handleStudyYearChange = (id: string) => {
    setSelectedStudyYear(id);
    if (id) fetchClassesByStudyYear(id);
    else setClasses([]);
  };

  const generateQRCodes = async (list: { id: string; name: string }[]) => {
    const codes: { [key: string]: string } = {};
    for (const item of list) {
      try {
        const qrData = JSON.stringify({ studentId: item.id });
        codes[item.id] = await QRCode.toDataURL(qrData, { width: 400, margin: 1 });
      } catch (err) {
        console.error('Failed to generate QR for', item.name);
      }
    }
    setQrCodes((prev) => ({ ...prev, ...codes }));
  };

  const handleEditorClose = () => { reloadDesign(); setShowEditor(false); };

  const buildFieldValues = (
    name: string, subtitle: string, displayId: string,
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string; email?: string | null },
  ): Record<string, string> => ({
    // Legacy human-readable keys (older templates)
    'Student Name': name,
    'Student ID': displayId,
    'Class Name': subtitle,
    'Study Year': extra?.studyYear || '',
    'Date of Birth': formatDOB(extra?.dateOfBirth, lang),
    'Address': extra?.address || '',
    'Phone': extra?.phone || '',
    'Sex': extra?.sex === 'MALE' ? 'ប្រុស' : extra?.sex === 'FEMALE' ? 'ស្រី' : '',
    'Emp ID': '', 'Position': '', 'Staff Name': '',
    // New {{placeholder}} keys used by current card-designer templates
    '{{name}}': name,
    '{{studentNumber}}': displayId,
    '{{class}}': subtitle,
    '{{studyYear}}': extra?.studyYear || '',
    '{{dateOfBirth}}': formatDOB(extra?.dateOfBirth, lang),
    '{{address}}': extra?.address || '',
    '{{phone}}': extra?.phone || '',
    '{{email}}': extra?.email || '',
    '{{sex}}': extra?.sex === 'MALE' ? 'ប្រុស' : extra?.sex === 'FEMALE' ? 'ស្រី' : '',
    '{{qrCode}}': displayId,
  });

  const downloadCard = async (
    name: string, subtitle: string, qrDataUrl: string, displayId: string,
    photoUrl?: string | null,
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string },
  ) => {
    if (exporting) return;
    setExporting(true);
    try {
      const fieldValues = buildFieldValues(name, subtitle, displayId, extra);
      const canvas = await renderDesignToCanvas(liveDesign, { fieldValues, qrDataUrl, photoUrl });
      const link = document.createElement('a');
      link.download = `${name.replace(/[^a-zA-Z0-9]/g, '-')}-id-card.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('Export failed. Please try again.');
    } finally { setExporting(false); }
  };

  const downloadCardPDF = async (
    name: string, subtitle: string, qrDataUrl: string, displayId: string,
    photoUrl?: string | null,
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string },
  ) => {
    if (exporting) return;
    setExporting(true);
    try {
      const fieldValues = buildFieldValues(name, subtitle, displayId, extra);
      await downloadSingleCardPDF(liveDesign, { name, fieldValues, qrDataUrl, photoUrl });
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Export failed. Please try again.');
    } finally { setExporting(false); }
  };

  const downloadAllCardsPDFA4 = async (
    title: string,
    people: { name: string; subtitle: string; id: string; displayId: string; photo?: string | null; extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string } }[]
  ) => {
    const validPeople = people.filter((p) => qrCodes[p.id]);
    if (validPeople.length === 0 || exporting) return;
    setExporting(true);
    try {
      const entries = validPeople.map((p) => ({
        name: p.name,
        fieldValues: buildFieldValues(p.name, p.subtitle, p.displayId, p.extra),
        qrDataUrl: qrCodes[p.id],
        photoUrl: p.photo,
      }));
      await downloadA4CardsPDF(liveDesign, entries, title);
    } catch (err) {
      console.error('A4 PDF export failed:', err);
      alert('Export failed. Please try again.');
    } finally { setExporting(false); }
  };

  const downloadQROnly = (name: string, id: string) => {
    if (!qrCodes[id]) return;
    const link = document.createElement('a');
    link.download = `${name.replace(/[^a-zA-Z0-9]/g, '-')}-qr.png`;
    link.href = qrCodes[id];
    link.click();
  };

  const downloadAllQRCodes = (title: string, people: { name: string; id: string }[]) => {
    const validPeople = people.filter((p) => qrCodes[p.id]);
    if (validPeople.length === 0) return;
    const qrSize = 200; const labelH = 30; const gap = 20;
    const cols = Math.min(validPeople.length, 5);
    const rows = Math.ceil(validPeople.length / cols);
    const headerH = 50;
    const canvas = document.createElement('canvas');
    canvas.width = cols * (qrSize + gap) + gap;
    canvas.height = headerH + rows * (qrSize + labelH + gap) + gap;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 20px Arial, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(title, gap, 35);
    let loaded = 0;
    validPeople.forEach((p, i) => {
      const img = new Image();
      img.onload = () => {
        const col = i % cols; const row = Math.floor(i / cols);
        const x = gap + col * (qrSize + gap); const y = headerH + gap + row * (qrSize + labelH + gap);
        ctx.drawImage(img, x, y, qrSize, qrSize);
        ctx.fillStyle = '#334155'; ctx.font = '12px Arial, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.name, x + qrSize / 2, y + qrSize + 18);
        loaded++;
        if (loaded === validPeople.length) {
          const link = document.createElement('a');
          link.download = `${title.replace(/[^a-zA-Z0-9]/g, '-')}-qr-codes.png`;
          link.href = canvas.toDataURL(); link.click();
        }
      };
      img.src = qrCodes[p.id];
    });
  };

  const selectedYearObj = studyYears.find((y) => y.id === selectedStudyYear);
  const studyYearLabel = selectedYearObj?.label || selectedYearObj?.year?.toString() || '';
  const totalStudents = classes.reduce((sum, c) => sum + c.students.length, 0);

  if (loading) {
    return (
      <div className="page-shell">
        <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <div className="page-content">
          <div className="flex min-h-screen items-center justify-center">
            <div className="text-center">
              <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-sm text-slate-500 mt-3">Loading…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      {exporting && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-lg px-4 sm:px-8 py-4 sm:py-6 flex flex-col items-center gap-3">
            <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
            <p className="text-sm font-medium text-slate-700">Exporting, please wait…</p>
          </div>
        </div>
      )}
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">🎓 Student ID Cards</h1>
            <p className="text-sm text-slate-500 mt-1">
              {selectedYearObj ? `${studyYearLabel} · ${classes.length} class${classes.length !== 1 ? 'es' : ''} · ${totalStudents} student${totalStudents !== 1 ? 's' : ''}` : 'Select a study year'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedStudyYear}
              onChange={(e) => handleStudyYearChange(e.target.value)}
              className="!w-auto"
            >
              <option value="">Select Study Year...</option>
              {studyYears.map((sy) => (
                <option key={sy.id} value={sy.id}>
                  {sy.label || sy.year}{sy.isCurrent ? ' (Current)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="page-body space-y-6">
          {/* Edit Design */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="ml-auto flex items-center gap-2">
              {/* Design sync status */}
              {designLoading ? (
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
                  Loading template…
                </span>
              ) : (
                <button
                  onClick={reloadDesign}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
                  title="Re-fetch the active template from the server"
                >
                  🔄 Refresh Template
                </button>
              )}
              <button
                onClick={() => (showEditor ? handleEditorClose() : setShowEditor(true))}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${showEditor ? 'bg-amber-500 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {showEditor ? '✕ Close Editor' : '✏️ Edit Card Design'}
              </button>
              <Link href="/admin/card-designer" className="px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors" title="Open full Card Designer page">
                🎨 Full Designer
              </Link>
            </div>
          </div>

          {/* Inline Card Editor */}
          {showEditor && (
            <div className="card overflow-hidden border-2 border-amber-200">
              <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border-b border-amber-200">
                <div>
                  <h3 className="font-semibold text-slate-800">✏️ Editing Student Card Design</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Save design here to apply changes to all student ID cards below</p>
                </div>
                <button onClick={handleEditorClose} className="btn-ghost btn-sm">✕ Close</button>
              </div>
              <div className="p-2">
                <CardEditor initialCardType="student" onSave={reloadDesign} />
              </div>
            </div>
          )}

          {/* No study year selected */}
          {!selectedStudyYear && (
            <div className="card p-12">
              <div className="empty-state">
                <p className="text-4xl mb-3">📅</p>
                <p className="font-semibold text-slate-600">Select a Study Year</p>
                <p className="text-sm text-slate-400 mt-1">Choose a study year to view student ID cards for all classes.</p>
              </div>
            </div>
          )}

          {/* Loading classes */}
          {selectedStudyYear && loadingClasses && (
            <div className="card p-12 text-center">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-sm text-slate-500 mt-3">Loading classes…</p>
            </div>
          )}

          {/* Classes loaded */}
          {selectedStudyYear && !loadingClasses && (
            <>
              {classes.length === 0 ? (
                <div className="card p-12">
                  <div className="empty-state">
                    <p className="text-4xl mb-3">🪪</p>
                    <p className="font-semibold text-slate-600">No classes in this study year</p>
                    <p className="text-sm text-slate-400 mt-1">Create classes and add students first.</p>
                  </div>
                </div>
              ) : !selectedStudentClass ? (
                /* ── Class Cards Grid ── */
                <div>
                  {/* Bulk download all classes */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-700">
                      📖 All Classes in {studyYearLabel}
                    </h3>
                    {totalStudents > 0 && (
                      <button
                        onClick={() =>
                          downloadAllCardsPDFA4(
                            `${studyYearLabel} - All Student ID Cards`,
                            classes.flatMap((cls) =>
                              cls.students.map((s, idx) => ({
                                name: s.name,
                                subtitle: cls.name,
                                id: s.id,
                                displayId: s.studentNumber || String(idx + 1).padStart(4, '0'),
                                photo: s.photo,
                                extra: { dateOfBirth: s.dateOfBirth, address: s.address, phone: s.phone, sex: s.sex, studyYear: studyYearLabel },
                              }))
                            )
                          )
                        }
                        className="btn-primary btn-sm"
                      >
                        📄 Download All Cards ({totalStudents})
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {classes.map((cls) => (
                      <button
                        key={cls.id}
                        onClick={() => { setSelectedStudentClass(cls.id); setStudentSearch(''); setStudentPage(1); }}
                        className="card p-0 overflow-hidden text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group cursor-pointer"
                      >
                        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-5 py-4">
                          <div className="flex items-center justify-between">
                            <span className="text-2xl">📖</span>
                            <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                              {cls.students.length} student{cls.students.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <h3 className="text-white font-bold text-lg mt-3 leading-tight">{cls.name}</h3>
                        </div>
                        <div className="px-5 py-3 flex items-center justify-between bg-white">
                          <div className="text-xs text-slate-500 truncate">
                            {cls.teacher ? `👤 ${cls.teacher.name}` : 'No teacher'}
                          </div>
                          <span className="text-indigo-400 group-hover:text-indigo-600 text-sm transition-colors">View →</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (() => {
                const cls = classes.find((c) => c.id === selectedStudentClass);
                if (!cls) return (
                  <div className="card p-8 text-center">
                    <p className="text-slate-500">Class not found.</p>
                    <button onClick={() => setSelectedStudentClass(null)} className="btn-primary btn-sm mt-3">← Back to Classes</button>
                  </div>
                );
                const filtered = studentSearch
                  ? cls.students.filter((s) => s.name.toLowerCase().includes(studentSearch.toLowerCase()) || (s.studentNumber && s.studentNumber.toLowerCase().includes(studentSearch.toLowerCase())))
                  : cls.students;
                const totalStudentPages = Math.max(1, Math.ceil(filtered.length / studentPageSize));
                const safePage = Math.min(studentPage, totalStudentPages);
                const paged = filtered.slice((safePage - 1) * studentPageSize, safePage * studentPageSize);
                return (
                  <div className="space-y-4">
                    <div className="card p-4">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <button onClick={() => setSelectedStudentClass(null)} className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium text-sm transition-colors shrink-0">← Back to Classes</button>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-lg">📖</span>
                          <div>
                            <h3 className="font-bold text-slate-800 text-lg leading-tight">{cls.name}</h3>
                            <p className="text-xs text-slate-500">
                              {cls.teacher && <span>{cls.teacher.name} · </span>}
                              {studyYearLabel && <span>{studyYearLabel} · </span>}
                              {filtered.length} student{filtered.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
                          <div className="relative flex-1 min-w-0 sm:min-w-[180px]">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                            <input type="text" placeholder="Search students..." value={studentSearch} onChange={(e) => { setStudentSearch(e.target.value); setStudentPage(1); }} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none transition-all" />
                          </div>
                          {cls.students.length > 0 && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => downloadAllCardsPDFA4(`${cls.name} - Student ID Cards`, cls.students.map((s, idx) => ({ name: s.name, subtitle: cls.name, id: s.id, displayId: s.studentNumber || String(idx + 1).padStart(4, '0'), photo: s.photo, extra: { dateOfBirth: s.dateOfBirth, address: s.address, phone: s.phone, sex: s.sex, studyYear: studyYearLabel } })))}
                                className="btn-primary btn-sm text-xs"
                              >📄 Download Card</button>
                              <button
                                onClick={() => downloadAllQRCodes(`${cls.name} - QR Codes`, cls.students.map((s) => ({ name: s.name, id: s.id })))}
                                className="btn-sm border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg font-medium text-xs transition-colors"
                              >📱 All QR</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {paged.length === 0 ? (
                      <div className="card p-8 text-center">
                        <p className="text-slate-400 text-sm">{studentSearch ? `No students matching "${studentSearch}"` : 'No students in this class'}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                        {paged.map((student, idx) => {
                          const globalIdx = (safePage - 1) * studentPageSize + idx;
                          const displayId = student.studentNumber || String(globalIdx + 1).padStart(4, '0');
                          const extra = { dateOfBirth: student.dateOfBirth, address: student.address, phone: student.phone, sex: student.sex, studyYear: studyYearLabel };
                          return (
                            <IDCardPreview
                              key={student.id}
                              name={student.name}
                              subtitle={cls.name}
                              personId={displayId}
                              qrDataUrl={qrCodes[student.id]}
                              photo={student.photo}
                              design={liveDesign}
                              fieldValues={buildFieldValues(student.name, cls.name, displayId, extra)}
                              onDownload={() => downloadCard(student.name, cls.name, qrCodes[student.id], displayId, student.photo, extra)}
                              onDownloadPDF={() => downloadCardPDF(student.name, cls.name, qrCodes[student.id], displayId, student.photo, extra)}
                              onDownloadQR={() => downloadQROnly(student.name, student.id)}
                            />
                          );
                        })}
                      </div>
                    )}

                    {totalStudentPages > 1 && (
                      <div className="card px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-500">Showing {(safePage - 1) * studentPageSize + 1}–{Math.min(safePage * studentPageSize, filtered.length)} of {filtered.length}</p>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setStudentPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">← Prev</button>
                            {Array.from({ length: totalStudentPages }, (_, i) => i + 1)
                              .filter((p) => p === 1 || p === totalStudentPages || Math.abs(p - safePage) <= 1)
                              .reduce<(number | string)[]>((acc, p, i, arr) => { if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...'); acc.push(p); return acc; }, [])
                              .map((p, i) => typeof p === 'string' ? <span key={`dot-${i}`} className="px-1 text-xs text-slate-400">…</span> : <button key={p} onClick={() => setStudentPage(p)} className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${p === safePage ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 hover:bg-slate-50'}`}>{p}</button>)}
                            <button onClick={() => setStudentPage((p) => Math.min(totalStudentPages, p + 1))} disabled={safePage >= totalStudentPages} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next →</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function IDCardPreview({
  name, subtitle, personId, qrDataUrl, photo, design, fieldValues: fieldValuesProp, onDownload, onDownloadPDF, onDownloadQR,
}: {
  name: string; subtitle: string; personId: string; qrDataUrl?: string; photo?: string | null; design: CardDesign;
  fieldValues?: Record<string, string>;
  onDownload: () => void; onDownloadPDF?: () => void; onDownloadQR?: () => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fieldValues: Record<string, string> = fieldValuesProp ?? {
      'Student Name': name, 'Student ID': personId, 'Class Name': subtitle,
      'Study Year': '', 'Date of Birth': '', 'Address': '', 'Phone': '', 'Sex': '',
      'Emp ID': '', 'Position': '', 'Staff Name': '',
    };
    renderDesignToCanvas(design, { fieldValues, qrDataUrl, photoUrl: photo }).then((canvas) => {
      if (!cancelled) setImgSrc(canvas.toDataURL());
    });
    return () => { cancelled = true; };
  }, [design, name, subtitle, personId, qrDataUrl, photo, fieldValuesProp]);

  return (
    <div className="group relative">
      <div className="rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white" style={{ aspectRatio: `${design.width} / ${design.height}` }}>
        {imgSrc ? <img src={imgSrc} alt={`${name} ID Card`} className="w-full h-full object-contain" /> : <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">Rendering…</div>}
      </div>
      <div className="mt-1.5 flex gap-0.5">
        <button onClick={onDownload} disabled={!qrDataUrl} className="flex-1 text-[10px] py-1 rounded font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-tight" title="Download as PNG">📥 PNG</button>
        {onDownloadPDF && <button onClick={onDownloadPDF} disabled={!qrDataUrl} className="flex-1 text-[10px] py-1 rounded font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-tight" title="Download as PDF">📄 PDF</button>}
        {onDownloadQR && <button onClick={onDownloadQR} disabled={!qrDataUrl} className="text-[10px] py-1 px-1.5 rounded font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-tight" title="Download QR only">📱</button>}
      </div>
    </div>
  );
}
