'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import QRCode from 'qrcode';
import Sidebar from '../../../components/Sidebar';
import { adminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../../lib/i18n';
import { CardDesign, STAFF_TEMPLATE, DESIGN_STORAGE_KEY, loadSavedDesign, apiGetActiveDesign, saveDesign } from '../../../components/card-designer/types';
import { renderDesignToCanvas } from '../../../components/card-designer/renderDesignToCanvas';
import { downloadSingleCardPDF, downloadA4CardsPDF } from '../../../components/card-designer/generateCardPDF';

// Lazy-load the heavy card editor (QRCode + jsPDF + canvas + ~50KB) so the
// staff-cards page itself loads instantly. The editor only mounts when the
// admin actually opens it.
const CardEditor = dynamic(() => import('../../../components/card-designer/CardEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full">
      <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

interface StaffUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  photo: string | null;
}

function normalizePhotoUrl(url: string): string {
  if (!url) return url;
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  return url;
}

const STAFF_ROLES = [
  'ADMIN','TEACHER','OFFICER','STAFF','OFFICE_HEAD','DEPUTY_OFFICE_HEAD',
  'DEPARTMENT_HEAD','DEPUTY_DEPARTMENT_HEAD','GENERAL_DEPARTMENT_DIRECTOR',
  'DEPUTY_GENERAL_DEPARTMENT_DIRECTOR','COMPANY_CEO','CREDIT_OFFICER',
  'SECURITY_GUARD','JANITOR','PROJECT_MANAGER','BRANCH_MANAGER',
  'EXECUTIVE_DIRECTOR','HR_MANAGER','ATHLETE_MALE','ATHLETE_FEMALE',
  'TRAINER','BARISTA','CASHIER','RECEPTIONIST','GENERAL_MANAGER',
  'PRIMARY_SCHOOL_PRINCIPAL','SECONDARY_SCHOOL_PRINCIPAL',
  'HIGH_SCHOOL_PRINCIPAL','UNIVERSITY_RECTOR',
];

const ROLE_ICONS: Record<string, string> = {
  ADMIN: '🛡️', TEACHER: '📚', PRIMARY_SCHOOL_PRINCIPAL: '🏫',
  SECONDARY_SCHOOL_PRINCIPAL: '🏫', HIGH_SCHOOL_PRINCIPAL: '🏫',
  UNIVERSITY_RECTOR: '🎓', OFFICER: '👔', STAFF: '👤',
  OFFICE_HEAD: '🏢', DEPUTY_OFFICE_HEAD: '🏢', DEPARTMENT_HEAD: '📋',
  DEPUTY_DEPARTMENT_HEAD: '📋', GENERAL_DEPARTMENT_DIRECTOR: '🏛️',
  DEPUTY_GENERAL_DEPARTMENT_DIRECTOR: '🏛️', COMPANY_CEO: '💼',
  CREDIT_OFFICER: '💳', SECURITY_GUARD: '🔒', JANITOR: '🧹',
  PROJECT_MANAGER: '📊', BRANCH_MANAGER: '🏬', EXECUTIVE_DIRECTOR: '👨‍💼',
  HR_MANAGER: '🤝', ATHLETE_MALE: '🏃', ATHLETE_FEMALE: '🏃‍♀️',
  TRAINER: '🏋️', BARISTA: '☕', CASHIER: '💰', RECEPTIONIST: '🛎️',
  GENERAL_MANAGER: '📈',
};

export default function StaffCardsPage() {
  const { t } = useLanguage();
  const getRoleLabel = (role: string) => t('role.' + role.toLowerCase()) || role;
  const getRoleIcon = (role: string) => ROLE_ICONS[role] ?? '👤';
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [qrCodes, setQrCodes] = useState<{ [key: string]: string }>({});
  const [loading, setLoading] = useState(true);
  const [cardRoleFilter, setCardRoleFilter] = useState<string>('ALL');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(20);
  const [staffViewMode, setStaffViewMode] = useState<'grid' | 'list'>('grid');
  const [staffDownloadMenuOpen, setStaffDownloadMenuOpen] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [liveDesign, setLiveDesign] = useState<CardDesign>(STAFF_TEMPLATE);
  const [designLoading, setDesignLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { fetchStaff(); }, []);

  const reloadDesign = useCallback(() => {
    setDesignLoading(true);
    // Try API first so all users see the shared active design
    apiGetActiveDesign('staff').then((apiDesign) => {
      if (apiDesign) {
        saveDesign(apiDesign);
        setLiveDesign(apiDesign);
      } else {
        setLiveDesign(loadSavedDesign('staff') ?? STAFF_TEMPLATE);
      }
    }).finally(() => setDesignLoading(false));
  }, []);

  useEffect(() => { reloadDesign(); }, [reloadDesign]);
  useEffect(() => { if (!showEditor) reloadDesign(); }, [reloadDesign, showEditor]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DESIGN_STORAGE_KEY) reloadDesign();
    };
    window.addEventListener('storage', onStorage);
    // Re-fetch when the tab becomes visible again (e.g. user switches back)
    const onVisibility = () => { if (document.visibilityState === 'visible') reloadDesign(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reloadDesign]);

  const NON_STAFF_ROLES = ['STUDENT', 'PARENT'];

  const fetchStaff = async () => {
    try {
      const res = await apiFetch('/api/auth/users');
      const all: StaffUser[] = res.ok ? await res.json() : [];
      const staff = all.filter((u) => !NON_STAFF_ROLES.includes(u.role));
      setStaffUsers(staff);
      const codes: { [key: string]: string } = {};
      for (const s of staff) {
        try {
          codes[s.id] = await QRCode.toDataURL(JSON.stringify({ staffId: s.id }), { width: 400, margin: 1 });
        } catch { /* skip */ }
      }
      setQrCodes(codes);
    } catch (err) {
      console.error('Failed to fetch staff');
    } finally {
      setLoading(false);
    }
  };

  const handleEditorClose = () => { reloadDesign(); setShowEditor(false); };

  const buildFieldValues = (name: string, displayId: string, subtitle: string, phone?: string | null, email?: string | null): Record<string, string> => ({
    // Legacy human-readable keys (older templates)
    'Staff Name': name, 'Emp ID': displayId, 'Position': subtitle,
    'Phone': phone || '',
    'Student Name': '', 'Student ID': '', 'Class Name': '', 'Study Year': '',
    'Date of Birth': '', 'Address': '', 'Sex': '',
    // New {{placeholder}} keys used by current card-designer templates
    '{{name}}': name,
    '{{email}}': email || '',
    '{{phone}}': phone || '',
    '{{role}}': subtitle,
    '{{department}}': '',
    '{{employeeId}}': displayId,
    '{{qrCode}}': displayId,
  });

  const downloadCard = async (name: string, subtitle: string, qrDataUrl: string, displayId: string, photoUrl?: string | null, phone?: string | null, email?: string | null) => {
    if (exporting) return;
    setExporting(true);
    try {
      const canvas = await renderDesignToCanvas(liveDesign, { fieldValues: buildFieldValues(name, displayId, subtitle, phone, email), qrDataUrl, photoUrl });
      const link = document.createElement('a');
      link.download = `${name.replace(/[^a-zA-Z0-9]/g, '-')}-id-card.png`;
      link.href = canvas.toDataURL(); link.click();
    } catch (err) { console.error('PNG export failed:', err); alert('Export failed.'); }
    finally { setExporting(false); }
  };

  const downloadCardPDF = async (name: string, subtitle: string, qrDataUrl: string, displayId: string, photoUrl?: string | null, phone?: string | null, email?: string | null) => {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadSingleCardPDF(liveDesign, { name, fieldValues: buildFieldValues(name, displayId, subtitle, phone, email), qrDataUrl, photoUrl });
    } catch (err) { console.error('PDF export failed:', err); alert('Export failed.'); }
    finally { setExporting(false); }
  };

  const downloadAllCardsPDFA4 = async (title: string, people: { name: string; subtitle: string; id: string; displayId: string; photo?: string | null; phone?: string | null; email?: string | null }[]) => {
    const valid = people.filter((p) => qrCodes[p.id]);
    if (valid.length === 0 || exporting) return;
    setExporting(true);
    try {
      const entries = valid.map((p) => ({ name: p.name, fieldValues: buildFieldValues(p.name, p.displayId, p.subtitle, p.phone, p.email), qrDataUrl: qrCodes[p.id], photoUrl: p.photo }));
      await downloadA4CardsPDF(liveDesign, entries, title);
    } catch (err) { console.error('A4 PDF export failed:', err); alert('Export failed.'); }
    finally { setExporting(false); }
  };

  const downloadQROnly = (name: string, id: string) => {
    if (!qrCodes[id]) return;
    const link = document.createElement('a');
    link.download = `${name.replace(/[^a-zA-Z0-9]/g, '-')}-qr.png`;
    link.href = qrCodes[id]; link.click();
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

  const downloadOfficerAttendanceQR = async () => {
    const scanUrl = `${window.location.origin}/employee/scan`;
    let qrDataUrl: string;
    try { qrDataUrl = await QRCode.toDataURL(scanUrl, { width: 400, margin: 1 }); } catch { return; }
    const W = 600, H = 780;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#7c3aed'); grad.addColorStop(1, '#6366f1');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 28px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Officer Attendance QR Code', W / 2, 55);
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(40, 75); ctx.lineTo(W - 40, 75); ctx.stroke();
    const qrSize = 360; const qrX = (W - qrSize) / 2; const qrY = 100; const pad = 20;
    ctx.shadowColor = 'rgba(0,0,0,0.08)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2, 16); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2, 16); ctx.stroke();
    const cornerLen = 30; ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    const fx = qrX - pad + 8, fy = qrY - pad + 8, fw = qrSize + pad * 2 - 16, fh = qrSize + pad * 2 - 16;
    ctx.beginPath(); ctx.moveTo(fx, fy + cornerLen); ctx.lineTo(fx, fy); ctx.lineTo(fx + cornerLen, fy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx + fw - cornerLen, fy); ctx.lineTo(fx + fw, fy); ctx.lineTo(fx + fw, fy + cornerLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx, fy + fh - cornerLen); ctx.lineTo(fx, fy + fh); ctx.lineTo(fx + cornerLen, fy + fh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx + fw - cornerLen, fy + fh); ctx.lineTo(fx + fw, fy + fh); ctx.lineTo(fx + fw, fy + fh - cornerLen); ctx.stroke();
    const qrImg = new Image();
    qrImg.onload = () => {
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      const labelY = qrY + qrSize + pad + 35;
      ctx.fillStyle = '#7c3aed'; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('📷  Scan to Mark Attendance', W / 2, labelY);
      const boxY = labelY + 20; const boxH = 200;
      ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.roundRect(40, boxY, W - 80, boxH, 12); ctx.fill();
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(40, boxY, W - 80, boxH, 12); ctx.stroke();
      ctx.fillStyle = '#334155'; ctx.font = 'bold 16px Arial, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('How to use:', 65, boxY + 30);
      ctx.fillStyle = '#475569'; ctx.font = '14px Arial, sans-serif';
      ['1. Open your phone camera or QR scanner app', '2. Point at this QR code to open attendance page', '3. Login with your account if not logged in', '4. Attendance is recorded automatically (check-in/out)', '5. The system detects the current session time'].forEach((line, i) => {
        ctx.fillText(line, 65, boxY + 55 + i * 24);
      });
      ctx.fillStyle = '#94a3b8'; ctx.font = '12px Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Wattanman Attendance System · Print and place at scan station', W / 2, H - 20);
      ctx.fillStyle = grad; ctx.fillRect(0, H - 8, W, 8);
      const link = document.createElement('a'); link.download = 'officer-attendance-qr.png'; link.href = canvas.toDataURL(); link.click();
    };
    qrImg.src = qrDataUrl;
  };

  const staffByRole: Record<string, StaffUser[]> = {};
  for (const s of staffUsers) { if (!staffByRole[s.role]) staffByRole[s.role] = []; staffByRole[s.role].push(s); }

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
            <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
            <p className="text-sm font-medium text-slate-700">Exporting, please wait…</p>
          </div>
        </div>
      )}
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">👥 Staff ID Cards</h1>
            <p className="text-sm text-slate-500 mt-1">
              {staffUsers.length} staff member{staffUsers.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={cardRoleFilter}
              onChange={(e) => { setCardRoleFilter(e.target.value); setStaffPage(1); }}
              className="!w-auto"
            >
              <option value="ALL">All Roles</option>
              {Object.keys(staffByRole).map((role) => (
                <option key={role} value={role}>
                  {getRoleLabel(role)} ({staffByRole[role].length})
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
                  <h3 className="font-semibold text-slate-800">✏️ Editing Staff Card Design</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Save design here to apply changes to all staff ID cards below</p>
                </div>
                <button onClick={handleEditorClose} className="btn-ghost btn-sm">✕ Close</button>
              </div>
              <div className="p-2">
                <CardEditor initialCardType="staff" onSave={reloadDesign} />
              </div>
            </div>
          )}

          {/* Search, view toggle, bulk actions toolbar */}
          <div className="card p-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 min-w-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
                <input type="text" value={staffSearch} onChange={(e) => { setStaffSearch(e.target.value); setStaffPage(1); }} placeholder="Search staff by name or email..." className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                {staffSearch && <button onClick={() => { setStaffSearch(''); setStaffPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>}
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                <button onClick={() => setStaffViewMode('grid')} className={`px-3 py-2 text-xs font-medium transition-colors ${staffViewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>▦ Grid</button>
                <button onClick={() => setStaffViewMode('list')} className={`px-3 py-2 text-xs font-medium transition-colors ${staffViewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>☰ List</button>
              </div>
              <select value={staffPageSize} onChange={(e) => { setStaffPageSize(Number(e.target.value)); setStaffPage(1); }} className="!w-auto text-sm shrink-0">
                <option value={12}>12 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
              <div className="relative shrink-0">
                <button onClick={() => setStaffDownloadMenuOpen(staffDownloadMenuOpen === 'bulk' ? null : 'bulk')} className="btn-primary btn-sm whitespace-nowrap">📥 Download All ▾</button>
                {staffDownloadMenuOpen === 'bulk' && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-slate-200 py-1 w-56 animate-[fadeIn_0.15s_ease-out]">
                    <button onClick={() => { downloadAllCardsPDFA4('All Staff - ID Cards', cardFilteredStaff.map((m) => ({ name: m.name, subtitle: getRoleLabel(m.role), id: m.id, displayId: m.id, photo: m.photo, phone: m.phone, email: m.email }))); setStaffDownloadMenuOpen(null); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">📄 Download Card ({cardFilteredStaff.length})</button>
                    <button onClick={() => { downloadAllQRCodes('All Staff - QR Codes', cardFilteredStaff.map((m) => ({ name: m.name, id: m.id }))); setStaffDownloadMenuOpen(null); }} className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">📱 All QR Codes ({cardFilteredStaff.length})</button>
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={() => { downloadOfficerAttendanceQR(); setStaffDownloadMenuOpen(null); }} className="w-full text-left px-4 py-2.5 text-sm text-purple-700 hover:bg-purple-50 transition-colors font-medium">🎫 Officer Attendance QR</button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>Showing {cardFilteredStaff.length === 0 ? 0 : (staffPageClamped - 1) * staffPageSize + 1}–{Math.min(staffPageClamped * staffPageSize, cardFilteredStaff.length)} of {cardFilteredStaff.length} staff{staffSearch && ` matching "${staffSearch}"`}</span>
              <span>{staffTotalPages} page{staffTotalPages !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {staffDownloadMenuOpen && <div className="fixed inset-0 z-10" onClick={() => setStaffDownloadMenuOpen(null)} />}

          {cardFilteredStaff.length === 0 ? (
            <div className="card p-12">
              <div className="empty-state">
                <p className="text-4xl mb-3">🪪</p>
                <p className="font-semibold text-slate-600">{staffSearch ? 'No staff match your search' : 'No staff found'}</p>
                <p className="text-sm text-slate-400 mt-1">{staffSearch ? 'Try a different search term.' : 'Add teachers or admins first.'}</p>
              </div>
            </div>
          ) : staffViewMode === 'grid' ? (
            <div className="card overflow-hidden">
              <div className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {staffPaginated.map((staff) => (
                    <IDCardPreview
                      key={staff.id}
                      name={staff.name}
                      subtitle={getRoleLabel(staff.role)}
                      personId={staff.id}
                      qrDataUrl={qrCodes[staff.id]}
                      photo={staff.photo}
                      design={liveDesign}
                      fieldValues={buildFieldValues(staff.name, staff.id, getRoleLabel(staff.role), staff.phone, staff.email)}
                      onDownload={() => downloadCard(staff.name, getRoleLabel(staff.role), qrCodes[staff.id], staff.id, staff.photo, staff.phone, staff.email)}
                      onDownloadPDF={() => downloadCardPDF(staff.name, getRoleLabel(staff.role), qrCodes[staff.id], staff.id, staff.photo, staff.phone, staff.email)}
                      onDownloadQR={() => downloadQROnly(staff.name, staff.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
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
                            {staff.photo ? <img src={normalizePhotoUrl(staff.photo)} alt={staff.name} className="w-full h-full object-cover" /> : staff.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-slate-800 truncate">{staff.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${staff.role === 'ADMIN' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                          {getRoleIcon(staff.role)} {getRoleLabel(staff.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 truncate hidden md:table-cell max-w-[180px]">{staff.email}</td>
                      <td className="px-4 py-3 text-center">
                        {qrCodes[staff.id] ? <img src={qrCodes[staff.id]} alt="QR" className="w-10 h-10 mx-auto rounded" /> : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => downloadCard(staff.name, getRoleLabel(staff.role), qrCodes[staff.id], staff.id, staff.photo, staff.phone, staff.email)} disabled={!qrCodes[staff.id]} className="text-[11px] py-1 px-2 rounded-md font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40" title="Download ID Card PNG">📥 PNG</button>
                          <button onClick={() => downloadCardPDF(staff.name, getRoleLabel(staff.role), qrCodes[staff.id], staff.id, staff.photo, staff.phone, staff.email)} disabled={!qrCodes[staff.id]} className="text-[11px] py-1 px-2 rounded-md font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40" title="Download ID Card PDF">📄 PDF</button>
                          <button onClick={() => downloadQROnly(staff.name, staff.id)} disabled={!qrCodes[staff.id]} className="text-[11px] py-1 px-2 rounded-md font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40" title="Download QR only">📱</button>
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
              <button onClick={() => setStaffPage(1)} disabled={staffPageClamped <= 1} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">«</button>
              <button onClick={() => setStaffPage(Math.max(1, staffPageClamped - 1))} disabled={staffPageClamped <= 1} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
              {Array.from({ length: staffTotalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === staffTotalPages || Math.abs(p - staffPageClamped) <= 2)
                .reduce<(number | string)[]>((acc, p, i, arr) => { if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...'); acc.push(p); return acc; }, [])
                .map((p, i) => typeof p === 'string' ? <span key={`dots-${i}`} className="px-1 text-xs text-slate-400">…</span> : <button key={p} onClick={() => setStaffPage(p)} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${p === staffPageClamped ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{p}</button>)}
              <button onClick={() => setStaffPage(Math.min(staffTotalPages, staffPageClamped + 1))} disabled={staffPageClamped >= staffTotalPages} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
              <button onClick={() => setStaffPage(staffTotalPages)} disabled={staffPageClamped >= staffTotalPages} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">»</button>
            </div>
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
      'Staff Name': name, 'Emp ID': personId, 'Position': subtitle,
      'Student Name': '', 'Student ID': '', 'Class Name': '', 'Study Year': '',
      'Date of Birth': '', 'Address': '', 'Phone': '', 'Sex': '',
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
