'use client';

import { useCallback, useEffect, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../../lib/i18n';
import { formatDOB } from '../../../lib/dateUtils';
import { CardDesign, CardType, ShapeElement, STUDENT_TEMPLATE, STAFF_TEMPLATE, BLANK_TEMPLATE, DESIGN_STORAGE_KEY, loadSavedDesign, saveDesign, SavedTemplate, loadSavedTemplates, saveTemplate, deleteTemplate, apiGetActiveDesign } from '../../../components/card-designer/types';
import { renderDesignToCanvas } from '../../../components/card-designer/renderDesignToCanvas';
import CardCanvas from '../../../components/card-designer/CardCanvas';
import Toolbar from '../../../components/card-designer/Toolbar';
import { downloadSingleCardPDF, downloadA4CardsPDF } from '../../../components/card-designer/generateCardPDF';

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

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  photo: string | null;
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

/** Convert Google Drive sharing URLs to direct image URLs */
function normalizePhotoUrl(url: string): string {
  if (!url) return url;
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
  const m3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
  if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`;
  return url;
}

export default function GenerateQRCodes() {
  const { t, lang } = useLanguage();
  const [classes, setClasses] = useState<ClassWithStudents[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [qrCodes, setQrCodes] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [cardType, setCardType] = useState<'students' | 'staff'>('students');
  const [cardClassFilter, setCardClassFilter] = useState<string>('ALL');
  const [cardRoleFilter, setCardRoleFilter] = useState<string>('ALL');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(20);
  const [staffViewMode, setStaffViewMode] = useState<'grid' | 'list'>('grid');
  const [staffDownloadMenuOpen, setStaffDownloadMenuOpen] = useState<string | null>(null);
  const [selectedStudentClass, setSelectedStudentClass] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(20);
  const [showEditor, setShowEditor] = useState(false);
  const [editorDesign, setEditorDesign] = useState<CardDesign>(STUDENT_TEMPLATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorSaved, setEditorSaved] = useState(false);
  const [editorSidebarWidth, setEditorSidebarWidth] = useState(320);
  const isEditorResizing = useRef(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templatePreviews, setTemplatePreviews] = useState<Record<string, string>>({});
  const [liveDesigns, setLiveDesigns] = useState<Record<string, CardDesign>>({
    student: STUDENT_TEMPLATE,
    staff: STAFF_TEMPLATE,
  });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  // Reload designs from API (used on mount + whenever we need a refresh)
  const reloadDesigns = useCallback(() => {
    Promise.all([
      apiGetActiveDesign('student'),
      apiGetActiveDesign('staff'),
    ]).then(([studentDesign, staffDesign]) => {
      const student = studentDesign ?? loadSavedDesign('student') ?? STUDENT_TEMPLATE;
      const staff = staffDesign ?? loadSavedDesign('staff') ?? STAFF_TEMPLATE;
      if (studentDesign) saveDesign(studentDesign);
      if (staffDesign) saveDesign(staffDesign);
      setLiveDesigns({ student, staff });
    });
  }, []);

  // Load designs on mount
  useEffect(() => {
    reloadDesigns();
  }, [reloadDesigns]);

  // Reload designs when editor is closed (picks up external saves)
  useEffect(() => {
    if (!showEditor) {
      reloadDesigns();
    }
  }, [reloadDesigns, showEditor]);

  // Listen for localStorage changes from other tabs / the full Card Designer page
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DESIGN_STORAGE_KEY) {
        reloadDesigns();
      }
    };
    window.addEventListener('storage', onStorage);
    // Re-fetch when the tab becomes visible again
    const onVisibility = () => { if (document.visibilityState === 'visible') reloadDesigns(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reloadDesigns]);

  const fetchAll = async () => {
    await Promise.all([fetchClassesWithStudents(), fetchStaff()]);
    setLoading(false);
  };

  const fetchClassesWithStudents = async () => {
    try {
      const classRes = await apiFetch('/api/classes');
      if (!classRes.ok) return;
      const classList: ClassItem[] = await classRes.json();

      // Single batch call instead of N+1
      let studentsByClass: Record<string, Student[]> = {};
      if (classList.length > 0) {
        try {
          const ids = classList.map(c => c.id).join(',');
          const batchRes = await apiFetch(`/api/classes/students/batch?ids=${encodeURIComponent(ids)}`);
          if (batchRes.ok) {
            studentsByClass = await batchRes.json();
          }
        } catch {
          studentsByClass = {};
        }
      }

      const classesWithStudents: ClassWithStudents[] = classList.map((cls) => ({
        ...cls,
        students: studentsByClass[cls.id] || [],
      }));

      setClasses(classesWithStudents);

      const allStudents = classesWithStudents.flatMap((c) => c.students);
      await generateQRCodesForList(allStudents.map((s) => ({ id: s.id, name: s.name, type: 'student' })));
    } catch (err) {
      console.error('Failed to fetch classes');
    }
  };

  const fetchStaff = async () => {
    const NON_STAFF_ROLES = ['STUDENT', 'PARENT'];
    try {
      const res = await apiFetch('/api/auth/users');
      const all: StaffUser[] = res.ok ? await res.json() : [];
      const staff = all.filter((u) => !NON_STAFF_ROLES.includes(u.role));
      setStaffUsers(staff);
      await generateQRCodesForList(staff.map((s) => ({ id: s.id, name: s.name, type: 'staff' })));
    } catch (err) {
      console.error('Failed to fetch staff');
    }
  };

  const generateQRCodesForList = async (list: { id: string; name: string; type: string }[]) => {
    const codes: { [key: string]: string } = {};
    for (const item of list) {
      try {
        const qrData = JSON.stringify({ [`${item.type}Id`]: item.id });
        codes[item.id] = await QRCode.toDataURL(qrData, { width: 400, margin: 1 });
      } catch (err) {
        console.error('Failed to generate QR for', item.name);
      }
    }
    setQrCodes((prev) => ({ ...prev, ...codes }));
  };

  // Sync editor design when card type or editor visibility changes
  useEffect(() => {
    if (showEditor) {
      const type: CardType = cardType === 'students' ? 'student' : 'staff';
      const saved = loadSavedDesign(type);
      const design = saved ?? (type === 'student' ? STUDENT_TEMPLATE : STAFF_TEMPLATE);
      setEditorDesign(design);
      setSelectedId(null);
    }
  }, [cardType, showEditor]);

  // Push editor changes to live designs for real-time preview
  useEffect(() => {
    if (showEditor) {
      setLiveDesigns((prev) => ({ ...prev, [editorDesign.cardType]: editorDesign }));
    }
  }, [editorDesign, showEditor]);

  const handleEditorMoveText = useCallback(
    (id: string, x: number, y: number) => {
      setEditorDesign((prev) => ({
        ...prev,
        texts: prev.texts.map((t) => (t.id === id ? { ...t, x, y } : t)),
      }));
    },
    []
  );

  const handleEditorMoveLogo = useCallback(
    (id: string, x: number, y: number) => {
      setEditorDesign((prev) => ({
        ...prev,
        logos: prev.logos.map((l) => (l.id === id ? { ...l, x, y } : l)),
      }));
    },
    []
  );

  const handleEditorMoveShape = useCallback(
    (id: string, x: number, y: number) => {
      setEditorDesign((prev) => ({
        ...prev,
        shapes: (prev.shapes ?? []).map((s) => (s.id === id ? { ...s, x, y } : s)),
      }));
    },
    []
  );

  const handleEditorResizeShape = useCallback(
    (id: string, changes: Partial<ShapeElement>) => {
      setEditorDesign((prev) => ({
        ...prev,
        shapes: (prev.shapes ?? []).map((s) => (s.id === id ? { ...s, ...changes } : s)),
      }));
    },
    []
  );

  const handleEditorSave = () => {
    saveDesign(editorDesign);
    // Explicitly update liveDesigns so previews stay current after close
    setLiveDesigns((prev) => ({ ...prev, [editorDesign.cardType]: editorDesign }));
    setEditorSaved(true);
    setTimeout(() => setEditorSaved(false), 2000);
  };

  const handleEditorReset = () => {
    const type: CardType = cardType === 'students' ? 'student' : 'staff';
    setEditorDesign(type === 'student' ? STUDENT_TEMPLATE : STAFF_TEMPLATE);
  };

  const handleEditorClose = () => {
    // Reload from localStorage so previews reflect the last-saved version
    reloadDesigns();
    setShowEditor(false);
  };

  // Template management for inline editor
  useEffect(() => {
    if (!showTemplatePicker) return;
    const templates = loadSavedTemplates();
    setSavedTemplates(templates);
    const allDesigns: { key: string; design: CardDesign }[] = [
      { key: '__builtin_blank', design: BLANK_TEMPLATE },
      { key: '__builtin_student', design: STUDENT_TEMPLATE },
      { key: '__builtin_staff', design: STAFF_TEMPLATE },
      ...templates.flatMap((t) => t.design ? [{ key: t.id, design: t.design }] : []),
    ];
    let cancelled = false;
    (async () => {
      const previews: Record<string, string> = {};
      for (const item of allDesigns) {
        if (cancelled) break;
        try {
          const canvas = await renderDesignToCanvas(item.design, { scale: 1 });
          previews[item.key] = canvas.toDataURL('image/png');
        } catch { /* skip */ }
      }
      if (!cancelled) setTemplatePreviews(previews);
    })();
    return () => { cancelled = true; };
  }, [showTemplatePicker]);

  const handleEditorSaveAsTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    saveTemplate(name, editorDesign);
    setTemplateName('');
    setShowSaveTemplate(false);
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 2000);
  };

  const handleEditorLoadTemplate = (tpl: SavedTemplate) => {
    setEditorDesign(JSON.parse(JSON.stringify(tpl.design)) as CardDesign);
    setSelectedId(null);
    setShowTemplatePicker(false);
  };

  const handleEditorDeleteTemplate = (id: string) => {
    deleteTemplate(id);
    setSavedTemplates(loadSavedTemplates());
  };

  const handleEditorResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isEditorResizing.current = true;
    const startX = e.clientX;
    const startWidth = editorSidebarWidth;

    const onMouseMove = (ev: globalThis.MouseEvent) => {
      if (!isEditorResizing.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.min(600, Math.max(200, startWidth + delta));
      setEditorSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isEditorResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [editorSidebarWidth]);

  const getDesign = (type: CardType): CardDesign => {
    return liveDesigns[type];
  };

  const buildFieldValues = (
    name: string,
    subtitle: string,
    displayId: string,
    role: 'student' | 'staff',
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string },
  ): Record<string, string> => {
    const sexLabel = extra?.sex === 'MALE' ? 'ប្រុស' : extra?.sex === 'FEMALE' ? 'ស្រី' : '';
    if (role === 'student') {
      return {
        // New-style keys (match CARD_TYPE_FIELDS)
        '{{name}}': name, '{{studentNumber}}': displayId, '{{class}}': subtitle,
        '{{studyYear}}': extra?.studyYear || '', '{{dateOfBirth}}': formatDOB(extra?.dateOfBirth, lang),
        '{{address}}': extra?.address || '', '{{phone}}': extra?.phone || '',
        '{{sex}}': sexLabel, '{{email}}': '', '{{qrCode}}': displayId,
        // Old-style keys (backward compat with saved templates)
        'Student Name': name, 'Student ID': displayId, 'Class Name': subtitle,
        'Study Year': extra?.studyYear || '', 'Date of Birth': formatDOB(extra?.dateOfBirth, lang),
        'Address': extra?.address || '', 'Phone': extra?.phone || '', 'Sex': sexLabel,
        'Emp ID': '', 'Position': '', 'Staff Name': '',
      };
    }
    return {
      // New-style keys (match CARD_TYPE_FIELDS)
      '{{name}}': name, '{{role}}': subtitle, '{{department}}': '',
      '{{email}}': '', '{{phone}}': '', '{{qrCode}}': displayId,
      // Old-style keys (backward compat with saved templates)
      'Staff Name': name, 'Emp ID': displayId, 'Position': subtitle,
      'Student Name': '', 'Student ID': '', 'Class Name': '',
      'Study Year': '', 'Date of Birth': '', 'Address': '', 'Phone': '', 'Sex': '',
    };
  };

  const drawIDCard = async (
    name: string,
    subtitle: string,
    qrDataUrl: string,
    role: 'student' | 'staff',
    displayId: string,
    photoUrl?: string | null,
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string },
  ): Promise<HTMLCanvasElement> => {
    const design = getDesign(role);
    const fieldValues = buildFieldValues(name, subtitle, displayId, role, extra);
    return renderDesignToCanvas(design, {
      fieldValues,
      qrDataUrl,
      photoUrl,
    });
  };

  const downloadCard = async (
    name: string,
    subtitle: string,
    qrDataUrl: string,
    role: 'student' | 'staff',
    displayId: string,
    photoUrl?: string | null,
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string },
  ) => {
    if (exporting) return;
    setExporting(true);
    try {
      const canvas = await drawIDCard(name, subtitle, qrDataUrl, role, displayId, photoUrl, extra);
      const link = document.createElement('a');
      link.download = `${name.replace(/[^a-zA-Z0-9]/g, '-')}-id-card.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const downloadCardPDF = async (
    name: string,
    subtitle: string,
    qrDataUrl: string,
    role: 'student' | 'staff',
    displayId: string,
    photoUrl?: string | null,
    extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string },
  ) => {
    if (exporting) return;
    setExporting(true);
    try {
      const design = getDesign(role);
      const fieldValues = buildFieldValues(name, subtitle, displayId, role, extra);
      await downloadSingleCardPDF(design, { name, fieldValues, qrDataUrl, photoUrl });
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const downloadAllCardsPDFA4 = async (
    title: string,
    people: { name: string; subtitle: string; id: string; displayId: string; role: 'student' | 'staff'; photo?: string | null; extra?: { dateOfBirth?: string | null; address?: string; phone?: string; sex?: string | null; studyYear?: string } }[]
  ) => {
    const validPeople = people.filter((p) => qrCodes[p.id]);
    if (validPeople.length === 0) return;
    if (exporting) return;
    setExporting(true);
    try {
      const design = getDesign(validPeople[0].role);
      const entries = validPeople.map((p) => ({
        name: p.name,
        fieldValues: buildFieldValues(p.name, p.subtitle, p.displayId, p.role, p.extra),
        qrDataUrl: qrCodes[p.id],
        photoUrl: p.photo,
      }));
      await downloadA4CardsPDF(design, entries, title);
    } catch (err) {
      console.error('A4 PDF export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
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

    const qrSize = 200;
    const labelH = 30;
    const gap = 20;
    const cols = Math.min(validPeople.length, 5);
    const rows = Math.ceil(validPeople.length / cols);
    const headerH = 50;

    const canvas = document.createElement('canvas');
    canvas.width = cols * (qrSize + gap) + gap;
    canvas.height = headerH + rows * (qrSize + labelH + gap) + gap;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, gap, 35);

    let loaded = 0;
    validPeople.forEach((p, i) => {
      const img = new Image();
      img.onload = () => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gap + col * (qrSize + gap);
        const y = headerH + gap + row * (qrSize + labelH + gap);
        ctx.drawImage(img, x, y, qrSize, qrSize);
        ctx.fillStyle = '#334155';
        ctx.font = '12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, x + qrSize / 2, y + qrSize + 18);
        loaded++;
        if (loaded === validPeople.length) {
          const link = document.createElement('a');
          link.download = `${title.replace(/[^a-zA-Z0-9]/g, '-')}-qr-codes.png`;
          link.href = canvas.toDataURL();
          link.click();
        }
      };
      img.src = qrCodes[p.id];
    });
  };

  const downloadOfficerAttendanceQR = async () => {
    const scanUrl = `${window.location.origin}/employee/scan`;
    let qrDataUrl: string;
    try {
      qrDataUrl = await QRCode.toDataURL(scanUrl, { width: 400, margin: 1 });
    } catch { return; }

    const W = 600, H = 780;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Top accent bar
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#7c3aed');
    grad.addColorStop(1, '#6366f1');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 8);

    // Header
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Officer Attendance QR Code', W / 2, 55);

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 75);
    ctx.lineTo(W - 40, 75);
    ctx.stroke();

    // QR frame
    const qrSize = 360;
    const qrX = (W - qrSize) / 2;
    const qrY = 100;
    const pad = 20;

    // Frame shadow
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2, 16);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Frame border
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2, 16);
    ctx.stroke();

    // Corner accents
    const cornerLen = 30;
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const fx = qrX - pad + 8, fy = qrY - pad + 8;
    const fw = qrSize + pad * 2 - 16, fh = qrSize + pad * 2 - 16;
    ctx.beginPath(); ctx.moveTo(fx, fy + cornerLen); ctx.lineTo(fx, fy); ctx.lineTo(fx + cornerLen, fy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx + fw - cornerLen, fy); ctx.lineTo(fx + fw, fy); ctx.lineTo(fx + fw, fy + cornerLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx, fy + fh - cornerLen); ctx.lineTo(fx, fy + fh); ctx.lineTo(fx + cornerLen, fy + fh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx + fw - cornerLen, fy + fh); ctx.lineTo(fx + fw, fy + fh); ctx.lineTo(fx + fw, fy + fh - cornerLen); ctx.stroke();

    // Draw QR
    const qrImg = new Image();
    qrImg.onload = () => {
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // "Scan Me" label
      const labelY = qrY + qrSize + pad + 35;
      ctx.fillStyle = '#7c3aed';
      ctx.font = 'bold 22px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('📷  Scan to Mark Attendance', W / 2, labelY);

      // Instructions box
      const boxY = labelY + 20;
      const boxH = 200;
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.roundRect(40, boxY, W - 80, boxH, 12);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(40, boxY, W - 80, boxH, 12);
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 16px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('How to use:', 65, boxY + 30);

      ctx.fillStyle = '#475569';
      ctx.font = '14px Arial, sans-serif';
      const instructions = [
        '1. Open your phone camera or QR scanner app',
        '2. Point at this QR code to open attendance page',
        '3. Login with your account if not logged in',
        '4. Attendance is recorded automatically (check-in/out)',
        '5. The system detects the current session time',
      ];
      instructions.forEach((line, i) => {
        ctx.fillText(line, 65, boxY + 55 + i * 24);
      });

      // Footer
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Wattanman Attendance System · Print and place at scan station', W / 2, H - 20);

      // Bottom accent bar
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 8, W, 8);

      const link = document.createElement('a');
      link.download = 'officer-attendance-qr.png';
      link.href = canvas.toDataURL();
      link.click();
    };
    qrImg.src = qrDataUrl;
  };

  const cardFilteredClasses =
    cardClassFilter === 'ALL' ? classes : classes.filter((c) => c.id === cardClassFilter);
  const cardFilteredStaff = (() => {
    let list = cardRoleFilter === 'ALL' ? staffUsers : staffUsers.filter((s) => s.role === cardRoleFilter);
    if (staffSearch.trim()) {
      const q = staffSearch.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
    }
    return list;
  })();

  const staffTotalPages = Math.max(1, Math.ceil(cardFilteredStaff.length / staffPageSize));
  const staffPageClamped = Math.min(staffPage, staffTotalPages);
  const staffPaginated = cardFilteredStaff.slice((staffPageClamped - 1) * staffPageSize, staffPageClamped * staffPageSize);

  const staffByRole: Record<string, StaffUser[]> = {};
  for (const s of staffUsers) {
    if (!staffByRole[s.role]) staffByRole[s.role] = [];
    staffByRole[s.role].push(s);
  }
  const roleLabels: Record<string, { icon: string; label: string }> = {
    ADMIN: { icon: '🛡️', label: t('role.admin') || 'Admin' },
    TEACHER: { icon: '📚', label: t('role.teacher') || 'Teacher' },
    PRIMARY_SCHOOL_PRINCIPAL: { icon: '🏫', label: t('role.primary_school_principal') || 'Primary School Principal' },
    SECONDARY_SCHOOL_PRINCIPAL: { icon: '🏫', label: t('role.secondary_school_principal') || 'Secondary School Principal' },
    HIGH_SCHOOL_PRINCIPAL: { icon: '🏫', label: t('role.high_school_principal') || 'High School Principal' },
    UNIVERSITY_RECTOR: { icon: '🎓', label: t('role.university_rector') || 'University Rector' },
    OFFICER: { icon: '👔', label: t('role.officer') || 'Officer' },
    STAFF: { icon: '👤', label: t('role.staff') || 'Staff' },
    OFFICE_HEAD: { icon: '🏢', label: t('role.office_head') || 'Office Head' },
    DEPUTY_OFFICE_HEAD: { icon: '🏢', label: t('role.deputy_office_head') || 'Deputy Office Head' },
    DEPARTMENT_HEAD: { icon: '📋', label: t('role.department_head') || 'Department Head' },
    DEPUTY_DEPARTMENT_HEAD: { icon: '📋', label: t('role.deputy_department_head') || 'Deputy Department Head' },
    GENERAL_DEPARTMENT_DIRECTOR: { icon: '🏛️', label: t('role.general_department_director') || 'General Department Director' },
    DEPUTY_GENERAL_DEPARTMENT_DIRECTOR: { icon: '🏛️', label: t('role.deputy_general_department_director') || 'Deputy General Department Director' },
    COMPANY_CEO: { icon: '💼', label: t('role.company_ceo') || 'Company CEO' },
    CREDIT_OFFICER: { icon: '💳', label: t('role.credit_officer') || 'Credit Officer' },
    SECURITY_GUARD: { icon: '🔒', label: t('role.security_guard') || 'Security Guard' },
    JANITOR: { icon: '🧹', label: t('role.janitor') || 'Janitor' },
    PROJECT_MANAGER: { icon: '📊', label: t('role.project_manager') || 'Project Manager' },
    BRANCH_MANAGER: { icon: '🏬', label: t('role.branch_manager') || 'Branch Manager' },
    EXECUTIVE_DIRECTOR: { icon: '👨‍💼', label: t('role.executive_director') || 'Executive Director' },
    HR_MANAGER: { icon: '🤝', label: t('role.hr_manager') || 'HR Manager' },
    ATHLETE_MALE: { icon: '🏃', label: t('role.athlete_male') || 'Athlete (Male)' },
    ATHLETE_FEMALE: { icon: '🏃‍♀️', label: t('role.athlete_female') || 'Athlete (Female)' },
    TRAINER: { icon: '🏋️', label: t('role.trainer') || 'Trainer' },
    BARISTA: { icon: '☕', label: t('role.barista') || 'Barista' },
    CASHIER: { icon: '💰', label: t('role.cashier') || 'Cashier' },
    RECEPTIONIST: { icon: '🛎️', label: t('role.receptionist') || 'Receptionist' },
    GENERAL_MANAGER: { icon: '📈', label: t('role.general_manager') || 'General Manager' },
  };

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
            <h1 className="text-2xl font-bold text-slate-800">{t('qrCodes.title')}</h1>
            <p className="text-sm text-slate-500 mt-1">
              ID Cards · {cardType === 'students' ? 'Students' : 'Staff'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {cardType === 'students' && (
              <select
                value={cardClassFilter}
                onChange={(e) => setCardClassFilter(e.target.value)}
                className="!w-auto"
              >
                <option value="ALL">All Classes</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} ({cls.students.length})
                  </option>
                ))}
              </select>
            )}
            {cardType === 'staff' && (
              <select
                value={cardRoleFilter}
                onChange={(e) => { setCardRoleFilter(e.target.value); setStaffPage(1); }}
                className="!w-auto"
              >
                <option value="ALL">All Roles</option>
                {Object.keys(staffByRole).map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]?.label || role} ({staffByRole[role].length})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="page-body space-y-6">
              {/* Student / Staff toggle + Edit */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setCardType('students')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    cardType === 'students'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  🎓 Student Cards
                </button>
                <button
                  onClick={() => setCardType('staff')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    cardType === 'staff'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  👥 Officer Cards
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => (showEditor ? handleEditorClose() : setShowEditor(true))}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      showEditor
                        ? 'bg-amber-500 text-white'
                        : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {showEditor ? '✕ Close Editor' : '✏️ Edit Card Design'}
                  </button>
                  <Link
                    href="/admin/card-designer"
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                    title="Open full Card Designer page"
                  >
                    🎨 Full Designer
                  </Link>
                </div>
              </div>

              {/* Inline Card Editor */}
              {showEditor && (
                <div className="card overflow-hidden border-2 border-amber-200">
                  <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border-b border-amber-200">
                    <div>
                      <h3 className="font-semibold text-slate-800">
                        ✏️ Editing {cardType === 'students' ? 'Student' : 'Staff'} Card Design
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Changes preview in real-time below · Click Save to persist
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setShowTemplatePicker(true)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors">
                        📂 Template
                      </button>
                      <button onClick={() => setShowSaveTemplate(true)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors">
                        {templateSaved ? '✅ Saved!' : '📋 Save as Template'}
                      </button>
                      <button onClick={handleEditorSave} className="btn-success btn-sm">
                        {editorSaved ? '✅ Saved!' : '💾 Save Design'}
                      </button>
                      <button
                        onClick={handleEditorReset}
                        className="btn-ghost btn-sm text-xs text-slate-400 hover:text-red-500"
                      >
                        🗑️ Reset
                      </button>
                      <button onClick={handleEditorClose} className="btn-ghost btn-sm">
                        ✕
                      </button>
                    </div>
                  </div>
                  {/* Save Template Modal */}
                  {showSaveTemplate && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSaveTemplate(false)}>
                      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-slate-800 mb-4">💾 Save as Template</h3>
                        <p className="text-sm text-slate-500 mb-3">Save the current card design as a reusable template.</p>
                        <input
                          type="text"
                          value={templateName}
                          onChange={(e) => setTemplateName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleEditorSaveAsTemplate()}
                          placeholder="Template name"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setShowSaveTemplate(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
                          <button onClick={handleEditorSaveAsTemplate} disabled={!templateName.trim()} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">Save Template</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Template Picker Modal */}
                  {showTemplatePicker && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowTemplatePicker(false)}>
                      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-slate-800">📂 Choose Template</h3>
                          <button onClick={() => setShowTemplatePicker(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
                        </div>

                        {/* Built-in Templates */}
                        <div className="mb-6">
                          <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Built-in Templates</h4>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { key: '__builtin_blank', design: BLANK_TEMPLATE, label: 'Blank Card', icon: '📄', desc: 'Start from scratch', color: 'slate' },
                              { key: '__builtin_student', design: STUDENT_TEMPLATE, label: 'Student Card', icon: '🎓', desc: 'Default student ID card', color: 'indigo' },
                              { key: '__builtin_staff', design: STAFF_TEMPLATE, label: 'Officer Card', icon: '👨‍🏫', desc: 'Default officer ID card', color: 'emerald' },
                            ].map((tpl) => (
                              <button
                                key={tpl.key}
                                onClick={() => { setEditorDesign({ ...tpl.design }); setSelectedId(null); setShowTemplatePicker(false); }}
                                className={`rounded-xl border-2 border-${tpl.color}-200 bg-${tpl.color}-50/50 hover:border-${tpl.color}-400 hover:bg-${tpl.color}-50 transition-all text-left group overflow-hidden`}
                              >
                                <div className="bg-slate-50 flex items-center justify-center p-3 border-b border-slate-100">
                                  {templatePreviews[tpl.key] ? (
                                    <img src={templatePreviews[tpl.key]} alt={tpl.label} className="rounded-lg shadow-sm max-h-36 object-contain" />
                                  ) : (
                                    <div className="h-28 w-full flex items-center justify-center text-slate-400 text-sm">Loading...</div>
                                  )}
                                </div>
                                <div className="p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-lg">{tpl.icon}</span>
                                    <span className="font-semibold text-slate-800">{tpl.label}</span>
                                  </div>
                                  <div className="text-xs text-slate-500">{tpl.desc}</div>
                                  <div className={`mt-2 inline-block px-2 py-0.5 text-[10px] rounded-full bg-${tpl.color}-100 text-${tpl.color}-600 font-medium`}>Built-in</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Saved Templates */}
                        <div>
                          <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Your Saved Templates</h4>
                          {savedTemplates.length === 0 ? (
                            <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                              <span className="text-3xl block mb-2">📭</span>
                              <p className="text-sm text-slate-400">No saved templates yet.</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3">
                              {savedTemplates.map((tpl) => (
                                <div key={tpl.id} className="rounded-xl border-2 border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 transition-all text-left relative group overflow-hidden">
                                  <button onClick={() => handleEditorLoadTemplate(tpl)} className="w-full text-left">
                                    <div className="bg-slate-50 flex items-center justify-center p-3 border-b border-slate-100">
                                      {templatePreviews[tpl.id] ? (
                                        <img src={templatePreviews[tpl.id]} alt={tpl.name} className="rounded-lg shadow-sm max-h-36 object-contain" />
                                      ) : (
                                        <div className="h-28 w-full flex items-center justify-center text-slate-300 text-xs">Preview</div>
                                      )}
                                    </div>
                                    <div className="p-3">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-lg">{tpl.cardType === 'student' ? '🎓' : '👨‍🏫'}</span>
                                        <span className="font-semibold text-slate-800 truncate">{tpl.name}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className={`inline-block px-2 py-0.5 text-[10px] rounded-full font-medium ${
                                          tpl.cardType === 'student' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'
                                        }`}>{tpl.cardType}</span>
                                        <span className="text-[10px] text-slate-400">{new Date(tpl.createdAt).toLocaleDateString()}</span>
                                      </div>
                                    </div>
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleEditorDeleteTemplate(tpl.id); }}
                                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Delete template"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-5">
                    <div className="flex gap-4 items-start">
                      <div className="flex-1 min-w-0">
                        <CardCanvas
                          design={editorDesign}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                          onMoveText={handleEditorMoveText}
                          onMoveLogo={handleEditorMoveLogo}
                          onMoveShape={handleEditorMoveShape}
                          onResizeShape={handleEditorResizeShape}
                        />
                      </div>
                      {/* Resize handle */}
                      <div
                        onMouseDown={handleEditorResizeStart}
                        className="w-1.5 shrink-0 cursor-col-resize rounded-full hover:bg-indigo-400 bg-slate-300 transition-colors self-stretch"
                        title="Drag to resize sidebar"
                      />
                      <Toolbar
                        design={editorDesign}
                        selectedId={selectedId}
                        onDesignChange={setEditorDesign}
                        onSelect={setSelectedId}
                        width={editorSidebarWidth}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Student Cards */}
              {cardType === 'students' && (
                <>
                  {cardFilteredClasses.length === 0 ? (
                    <div className="card p-12">
                      <div className="empty-state">
                        <p className="text-4xl mb-3">🪪</p>
                        <p className="font-semibold text-slate-600">No classes found</p>
                        <p className="text-sm text-slate-400 mt-1">Create classes and add students first.</p>
                      </div>
                    </div>
                  ) : !selectedStudentClass ? (
                    /* ── Class Cards Grid ── */
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {cardFilteredClasses.map((cls) => (
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
                            {cls.subject && (
                              <p className="text-white/70 text-sm mt-0.5">{cls.subject}</p>
                            )}
                          </div>
                          <div className="px-5 py-3 flex items-center justify-between bg-white">
                            <div className="text-xs text-slate-500 truncate">
                              {cls.teacher ? `👤 ${cls.teacher.name}` : 'No teacher'}
                            </div>
                            <span className="text-indigo-400 group-hover:text-indigo-600 text-sm transition-colors">
                              View →
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (() => {
                    const cls = cardFilteredClasses.find((c) => c.id === selectedStudentClass);
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
                        {/* Header with back button */}
                        <div className="card p-4">
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                            <button
                              onClick={() => setSelectedStudentClass(null)}
                              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium text-sm transition-colors shrink-0"
                            >
                              ← Back to Classes
                            </button>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-lg">📖</span>
                              <div>
                                <h3 className="font-bold text-slate-800 text-lg leading-tight">{cls.name}</h3>
                                <p className="text-xs text-slate-500">
                                  {cls.subject && <span>{cls.subject} · </span>}
                                  {cls.teacher && <span>{cls.teacher.name} · </span>}
                                  {filtered.length} student{filtered.length !== 1 ? 's' : ''}
                                </p>
                              </div>
                            </div>
                            <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
                              {/* Student search */}
                              <div className="relative flex-1 min-w-0 sm:min-w-[180px]">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                                <input
                                  type="text"
                                  placeholder="Search students..."
                                  value={studentSearch}
                                  onChange={(e) => { setStudentSearch(e.target.value); setStudentPage(1); }}
                                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                                />
                              </div>
                              {/* Download actions */}
                              {cls.students.length > 0 && (
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() =>
                                      downloadAllCardsPDFA4(
                                        `${cls.name} - Student ID Cards`,
                                        cls.students.map((s, idx) => ({
                                          name: s.name,
                                          subtitle: `${cls.name}${cls.subject ? ' · ' + cls.subject : ''}`,
                                          id: s.id,
                                          displayId: s.studentNumber || String(idx + 1).padStart(4, '0'),
                                          role: 'student' as const,
                                          photo: s.photo,
                                          extra: { dateOfBirth: s.dateOfBirth, address: s.address, phone: s.phone, sex: s.sex, studyYear: cls.studyYear?.label || cls.studyYear?.year?.toString() || '' },
                                        }))
                                      )
                                    }
                                    className="btn-primary btn-sm text-xs"
                                    title="Download All Cards"
                                  >
                                    📄 Download Card
                                  </button>
                                  <button
                                    onClick={() =>
                                      downloadAllQRCodes(
                                        `${cls.name} - QR Codes`,
                                        cls.students.map((s) => ({ name: s.name, id: s.id }))
                                      )
                                    }
                                    className="btn-sm border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg font-medium text-xs transition-colors"
                                    title="Download All QR Only"
                                  >
                                    📱 All QR
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Student cards grid */}
                        {paged.length === 0 ? (
                          <div className="card p-8 text-center">
                            <p className="text-slate-400 text-sm">
                              {studentSearch ? `No students matching "${studentSearch}"` : 'No students in this class'}
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                            {paged.map((student, idx) => {
                              const globalIdx = (safePage - 1) * studentPageSize + idx;
                              return (
                                <IDCardPreview
                                  key={student.id}
                                  name={student.name}
                                  subtitle={`${cls.name}${cls.subject ? ' · ' + cls.subject : ''}`}
                                  personId={student.studentNumber || String(globalIdx + 1).padStart(4, '0')}
                                  qrDataUrl={qrCodes[student.id]}
                                  role="student"
                                  photo={student.photo}
                                  design={liveDesigns.student}
                                  onDownload={() =>
                                    downloadCard(
                                      student.name,
                                      `${cls.name}${cls.subject ? ' · ' + cls.subject : ''}`,
                                      qrCodes[student.id],
                                      'student',
                                      student.studentNumber || String(globalIdx + 1).padStart(4, '0'),
                                      student.photo,
                                      { dateOfBirth: student.dateOfBirth, address: student.address, phone: student.phone, sex: student.sex, studyYear: cls.studyYear?.label || cls.studyYear?.year?.toString() || '' },
                                    )
                                  }
                                  onDownloadPDF={() =>
                                    downloadCardPDF(
                                      student.name,
                                      `${cls.name}${cls.subject ? ' · ' + cls.subject : ''}`,
                                      qrCodes[student.id],
                                      'student',
                                      student.studentNumber || String(globalIdx + 1).padStart(4, '0'),
                                      student.photo,
                                      { dateOfBirth: student.dateOfBirth, address: student.address, phone: student.phone, sex: student.sex, studyYear: cls.studyYear?.label || cls.studyYear?.year?.toString() || '' },
                                    )
                                  }
                                  onDownloadQR={() => downloadQROnly(student.name, student.id)}
                                />
                              );
                            })}
                          </div>
                        )}

                        {/* Pagination */}
                        {totalStudentPages > 1 && (
                          <div className="card px-4 py-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-slate-500">
                                Showing {(safePage - 1) * studentPageSize + 1}–{Math.min(safePage * studentPageSize, filtered.length)} of {filtered.length}
                              </p>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
                                  disabled={safePage <= 1}
                                  className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  ← Prev
                                </button>
                                {Array.from({ length: totalStudentPages }, (_, i) => i + 1)
                                  .filter((p) => p === 1 || p === totalStudentPages || Math.abs(p - safePage) <= 1)
                                  .reduce<(number | string)[]>((acc, p, i, arr) => {
                                    if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                                    acc.push(p);
                                    return acc;
                                  }, [])
                                  .map((p, i) =>
                                    typeof p === 'string' ? (
                                      <span key={`dot-${i}`} className="px-1 text-xs text-slate-400">…</span>
                                    ) : (
                                      <button
                                        key={p}
                                        onClick={() => setStudentPage(p)}
                                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                                          p === safePage
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'border-slate-200 hover:bg-slate-50'
                                        }`}
                                      >
                                        {p}
                                      </button>
                                    )
                                  )}
                                <button
                                  onClick={() => setStudentPage((p) => Math.min(totalStudentPages, p + 1))}
                                  disabled={safePage >= totalStudentPages}
                                  className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  Next →
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Officer Cards */}
              {cardType === 'staff' && (
                <>
                  {/* Search, view toggle, bulk actions toolbar */}
                  <div className="card p-4">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      {/* Search */}
                      <div className="relative flex-1 min-w-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                        <input
                          type="text"
                          value={staffSearch}
                          onChange={(e) => { setStaffSearch(e.target.value); setStaffPage(1); }}
                          placeholder="Search staff by name or email..."
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        />
                        {staffSearch && (
                          <button onClick={() => { setStaffSearch(''); setStaffPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>
                        )}
                      </div>

                      {/* View toggle */}
                      <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                        <button
                          onClick={() => setStaffViewMode('grid')}
                          className={`px-3 py-2 text-xs font-medium transition-colors ${staffViewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          ▦ Grid
                        </button>
                        <button
                          onClick={() => setStaffViewMode('list')}
                          className={`px-3 py-2 text-xs font-medium transition-colors ${staffViewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          ☰ List
                        </button>
                      </div>

                      {/* Page size */}
                      <select
                        value={staffPageSize}
                        onChange={(e) => { setStaffPageSize(Number(e.target.value)); setStaffPage(1); }}
                        className="!w-auto text-sm shrink-0"
                      >
                        <option value={12}>12 / page</option>
                        <option value={20}>20 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                      </select>

                      {/* Bulk download dropdown */}
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setStaffDownloadMenuOpen(staffDownloadMenuOpen === 'bulk' ? null : 'bulk')}
                          className="btn-primary btn-sm whitespace-nowrap"
                        >
                          📥 Download All ▾
                        </button>
                        {staffDownloadMenuOpen === 'bulk' && (
                          <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-slate-200 py-1 w-56 animate-[fadeIn_0.15s_ease-out]">
                            <button
                              onClick={() => {
                                downloadAllCardsPDFA4(
                                  'All Staff - ID Cards',
                                  cardFilteredStaff.map((m) => ({
                                    name: m.name, subtitle: roleLabels[m.role]?.label || m.role, id: m.id,
                                    displayId: m.id, role: 'staff' as const, photo: m.photo,
                                  }))
                                );
                                setStaffDownloadMenuOpen(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              📄 Download Card ({cardFilteredStaff.length})
                            </button>
                            <button
                              onClick={() => {
                                downloadAllQRCodes(
                                  'All Staff - QR Codes',
                                  cardFilteredStaff.map((m) => ({ name: m.name, id: m.id }))
                                );
                                setStaffDownloadMenuOpen(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              📱 All QR Codes ({cardFilteredStaff.length})
                            </button>
                            <div className="border-t border-slate-100 my-1" />
                            <button
                              onClick={() => {
                                downloadOfficerAttendanceQR();
                                setStaffDownloadMenuOpen(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-sm text-purple-700 hover:bg-purple-50 transition-colors font-medium"
                            >
                              🎫 Officer Attendance QR
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Result count */}
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Showing {cardFilteredStaff.length === 0 ? 0 : (staffPageClamped - 1) * staffPageSize + 1}–{Math.min(staffPageClamped * staffPageSize, cardFilteredStaff.length)} of {cardFilteredStaff.length} staff
                        {staffSearch && ` matching "${staffSearch}"`}
                      </span>
                      <span>{staffTotalPages} page{staffTotalPages !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Click-outside handler for dropdown */}
                  {staffDownloadMenuOpen && (
                    <div className="fixed inset-0 z-10" onClick={() => setStaffDownloadMenuOpen(null)} />
                  )}

                  {cardFilteredStaff.length === 0 ? (
                    <div className="card p-12">
                      <div className="empty-state">
                        <p className="text-4xl mb-3">🪪</p>
                        <p className="font-semibold text-slate-600">{staffSearch ? 'No staff match your search' : 'No staff found'}</p>
                        <p className="text-sm text-slate-400 mt-1">{staffSearch ? 'Try a different search term.' : 'Add teachers or admins first.'}</p>
                      </div>
                    </div>
                  ) : staffViewMode === 'grid' ? (
                    /* === GRID VIEW === */
                    <div className="card overflow-hidden">
                      <div className="p-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                          {staffPaginated.map((staff) => (
                            <IDCardPreview
                              key={staff.id}
                              name={staff.name}
                              subtitle={roleLabels[staff.role]?.label || staff.role}
                              personId={staff.id}
                              qrDataUrl={qrCodes[staff.id]}
                              role="staff"
                              photo={staff.photo}
                              design={liveDesigns.staff}
                              onDownload={() =>
                                downloadCard(
                                  staff.name, roleLabels[staff.role]?.label || staff.role,
                                  qrCodes[staff.id], 'staff', staff.id, staff.photo,
                                )
                              }
                              onDownloadPDF={() =>
                                downloadCardPDF(
                                  staff.name, roleLabels[staff.role]?.label || staff.role,
                                  qrCodes[staff.id], 'staff', staff.id, staff.photo,
                                )
                              }
                              onDownloadQR={() => downloadQROnly(staff.name, staff.id)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* === LIST VIEW (compact for 100-200 staff) === */
                    <div className="card overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wider">
                            <th className="px-4 py-3 font-semibold">#</th>
                            <th className="px-4 py-3 font-semibold">Staff</th>
                            <th className="px-4 py-3 font-semibold hidden sm:table-cell">Role</th>
                            <th className="px-4 py-3 font-semibold hidden md:table-cell">Email</th>
                            <th className="px-4 py-3 font-semibold text-center">QR</th>
                            <th className="px-4 py-3 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {staffPaginated.map((staff, idx) => (
                            <tr key={staff.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 text-slate-400 text-xs">{(staffPageClamped - 1) * staffPageSize + idx + 1}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 overflow-hidden shrink-0">
                                    {staff.photo ? (
                                      <img src={normalizePhotoUrl(staff.photo)} alt={staff.name} className="w-full h-full object-cover" />
                                    ) : (
                                      staff.name.charAt(0).toUpperCase()
                                    )}
                                  </div>
                                  <span className="font-medium text-slate-800 truncate">{staff.name}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 hidden sm:table-cell">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                  staff.role === 'ADMIN' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
                                }`}>
                                  {roleLabels[staff.role]?.icon} {staff.role}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-500 truncate hidden md:table-cell max-w-[180px]">{staff.email}</td>
                              <td className="px-4 py-3 text-center">
                                {qrCodes[staff.id] ? (
                                  <img src={qrCodes[staff.id]} alt="QR" className="w-10 h-10 mx-auto rounded" />
                                ) : (
                                  <span className="text-slate-300 text-xs">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => downloadCard(staff.name, roleLabels[staff.role]?.label || staff.role, qrCodes[staff.id], 'staff', staff.id, staff.photo)}
                                    disabled={!qrCodes[staff.id]}
                                    className="text-[11px] py-1 px-2 rounded-md font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
                                    title="Download ID Card PNG"
                                  >
                                    📥 PNG
                                  </button>
                                  <button
                                    onClick={() => downloadCardPDF(staff.name, roleLabels[staff.role]?.label || staff.role, qrCodes[staff.id], 'staff', staff.id, staff.photo)}
                                    disabled={!qrCodes[staff.id]}
                                    className="text-[11px] py-1 px-2 rounded-md font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                                    title="Download ID Card PDF"
                                  >
                                    📄 PDF
                                  </button>
                                  <button
                                    onClick={() => downloadQROnly(staff.name, staff.id)}
                                    disabled={!qrCodes[staff.id]}
                                    className="text-[11px] py-1 px-2 rounded-md font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
                                    title="Download QR only"
                                  >
                                    📱
                                  </button>

                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Pagination */}
                  {staffTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-1 pt-2">
                      <button
                        onClick={() => setStaffPage(1)}
                        disabled={staffPageClamped <= 1}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        «
                      </button>
                      <button
                        onClick={() => setStaffPage(Math.max(1, staffPageClamped - 1))}
                        disabled={staffPageClamped <= 1}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ‹ Prev
                      </button>
                      {Array.from({ length: staffTotalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === staffTotalPages || Math.abs(p - staffPageClamped) <= 2)
                        .reduce<(number | string)[]>((acc, p, i, arr) => {
                          if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((p, i) =>
                          typeof p === 'string' ? (
                            <span key={`dots-${i}`} className="px-1 text-xs text-slate-400">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => setStaffPage(p)}
                              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                                p === staffPageClamped
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {p}
                            </button>
                          )
                        )
                      }
                      <button
                        onClick={() => setStaffPage(Math.min(staffTotalPages, staffPageClamped + 1))}
                        disabled={staffPageClamped >= staffTotalPages}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Next ›
                      </button>
                      <button
                        onClick={() => setStaffPage(staffTotalPages)}
                        disabled={staffPageClamped >= staffTotalPages}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        »
                      </button>
                    </div>
                  )}
                </>
              )}
        </div>
      </div>
    </div>
  );
}

function QRGrid({ people, qrCodes }: { people: { id: string; name: string }[]; qrCodes: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {people.map((person) => (
        <div key={person.id} className="text-center group">
          <div className="card-hover p-3">
            {qrCodes[person.id] ? (
              <img
                src={qrCodes[person.id]}
                alt={`QR Code for ${person.name}`}
                className="mx-auto w-full max-w-[160px]"
              />
            ) : (
              <div className="w-full aspect-square bg-slate-100 rounded flex items-center justify-center text-slate-400 text-sm">
                No QR
              </div>
            )}
            <p className="text-xs font-medium text-slate-700 mt-2 truncate">{person.name}</p>
            <button
              onClick={() => {
                if (!qrCodes[person.id]) return;
                const link = document.createElement('a');
                link.download = `${person.name}-qr.png`;
                link.href = qrCodes[person.id];
                link.click();
              }}
              className="btn-ghost btn-sm text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Download
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function IDCardPreview({
  name,
  subtitle,
  personId,
  qrDataUrl,
  role,
  photo,
  design,
  onDownload,
  onDownloadPDF,
  onDownloadQR,
}: {
  name: string;
  subtitle: string;
  personId: string;
  qrDataUrl?: string;
  role: 'student' | 'staff';
  photo?: string | null;
  design: CardDesign;
  onDownload: () => void;
  onDownloadPDF?: () => void;
  onDownloadQR?: () => void;
}) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const buildFieldValues = (r: 'student' | 'staff'): Record<string, string> => {
      if (r === 'student') {
        return {
          'Student Name': name,
          'Student ID': personId,
          'Class Name': subtitle,
          'Study Year': '',
          'Date of Birth': '',
          'Address': '',
          'Phone': '',
          'Sex': '',
          'Emp ID': '',
          'Position': '',
          'Staff Name': '',
        };
      }
      return {
        'Staff Name': name,
        'Emp ID': personId,
        'Position': subtitle,
        'Student Name': '',
        'Student ID': '',
        'Class Name': '',
        'Study Year': '',
        'Date of Birth': '',
        'Address': '',
        'Phone': '',
        'Sex': '',
      };
    };

    renderDesignToCanvas(design, {
      fieldValues: buildFieldValues(role),
      qrDataUrl,
      photoUrl: photo,
    }).then((canvas) => {
      if (!cancelled) {
        setImgSrc(canvas.toDataURL());
      }
    });

    return () => { cancelled = true; };
  }, [design, name, subtitle, personId, qrDataUrl, role, photo]);

  return (
    <div className="group relative">
      <div
        ref={canvasContainerRef}
        className="rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white"
        style={{ aspectRatio: `${design.width} / ${design.height}` }}
      >
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={`${name} ID Card`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
            Rendering…
          </div>
        )}
      </div>

      {/* Download buttons */}
      <div className="mt-1.5 flex gap-0.5">
        <button
          onClick={onDownload}
          disabled={!qrDataUrl}
          className="flex-1 text-[10px] py-1 rounded font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-tight"
          title="Download as PNG"
        >
          📥 PNG
        </button>
        {onDownloadPDF && (
          <button
            onClick={onDownloadPDF}
            disabled={!qrDataUrl}
            className="flex-1 text-[10px] py-1 rounded font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-tight"
            title="Download as PDF"
          >
            📄 PDF
          </button>
        )}
        {onDownloadQR && (
          <button
            onClick={onDownloadQR}
            disabled={!qrDataUrl}
            className="text-[10px] py-1 px-1.5 rounded font-medium border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-tight"
            title="Download QR code only"
          >
            📱
          </button>
        )}
      </div>
    </div>
  );
}