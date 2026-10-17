'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { apiFetch } from '../../lib/api';

type Source = { id: string; method: string; path: string };
type Person = { id: string; name?: string; nameKh?: string; studentNumber?: string; employeeNumber?: string; position?: string; photo?: string; phone?: string; email?: string; qrCode?: string; dateOfBirth?: string; address?: string; department?: { id?: string; name?: string; nameKh?: string }; user?: { name?: string; email?: string; phone?: string; photo?: string } };
type ClassRow = { id: string; name: string; subject?: string; studentCount?: number; teacher?: { name?: string }; studyYearId?: string; studyYear?: { id: string; label?: string; isCurrent?: boolean } };
type CardTemplate = { schoolName: string; cardTitle: string; logoUrl: string; cardSize: 'cr80-portrait' | 'cr80-landscape'; designPreset: string; primaryColor: string; accentColor: string; footerText: string; extraInfo: string; showPhone: boolean; showEmail: boolean; showAddress: boolean; showDateOfBirth: boolean };
const STUDENT_PRESETS = [
  { id: 'classic-orange', name: 'Orange Scholar', primaryColor: '#ea580c', accentColor: '#f97316', cardSize: 'cr80-portrait' },
  { id: 'green-academy', name: 'Green Academy', primaryColor: '#047857', accentColor: '#16a34a', cardSize: 'cr80-portrait' },
  { id: 'heritage-red', name: 'Heritage Red', primaryColor: '#991b1b', accentColor: '#dc2626', cardSize: 'cr80-landscape' },
  { id: 'public-green', name: 'Public Green', primaryColor: '#166534', accentColor: '#22c55e', cardSize: 'cr80-landscape' },
  { id: 'royal-blue', name: 'Royal Blue', primaryColor: '#1e3a8a', accentColor: '#2563eb', cardSize: 'cr80-portrait' },
  { id: 'modern-violet', name: 'Modern Violet', primaryColor: '#5b21b6', accentColor: '#db2777', cardSize: 'cr80-portrait' },
  { id: 'teal-wave', name: 'Teal Wave', primaryColor: '#0f766e', accentColor: '#06b6d4', cardSize: 'cr80-landscape' },
  { id: 'gold-prestige', name: 'Gold Prestige', primaryColor: '#78350f', accentColor: '#d97706', cardSize: 'cr80-landscape' },
  { id: 'sky-minimal', name: 'Sky Minimal', primaryColor: '#0369a1', accentColor: '#38bdf8', cardSize: 'cr80-portrait' },
  { id: 'charcoal-pro', name: 'Charcoal Pro', primaryColor: '#111827', accentColor: '#f59e0b', cardSize: 'cr80-landscape' },
] as const;
const STAFF_PRESETS = [
  { id: 'staff-geometric-mint', name: 'Geometric Mint', description: 'Bold office employee portrait', primaryColor: '#164e3f', accentColor: '#3b9478', cardSize: 'cr80-portrait' },
  { id: 'staff-olive-modern', name: 'Olive Modern', description: 'Rounded professional identity card', primaryColor: '#52683c', accentColor: '#a6c46a', cardSize: 'cr80-portrait' },
  { id: 'staff-dual-cream', name: 'Cream Front & Back', description: 'Two-sided member card with QR back', primaryColor: '#292524', accentColor: '#d6b56f', cardSize: 'cr80-portrait' },
] as const;
const DEFAULT_TEMPLATES: Record<'student' | 'staff', CardTemplate> = {
  student: { schoolName: 'Wattanam School', cardTitle: 'Student Identification Card', logoUrl: '', cardSize: 'cr80-portrait', designPreset: 'classic-orange', primaryColor: '#ea580c', accentColor: '#f97316', footerText: 'Scan QR code for attendance', extraInfo: '', showPhone: true, showEmail: false, showAddress: true, showDateOfBirth: true },
  staff: { schoolName: 'Wattanam School', cardTitle: 'Office Employee ID Card', logoUrl: '', cardSize: 'cr80-portrait', designPreset: 'staff-geometric-mint', primaryColor: '#164e3f', accentColor: '#3b9478', footerText: 'Official staff attendance card', extraInfo: '', showPhone: true, showEmail: true, showAddress: false, showDateOfBirth: false },
};
function rows<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : value && typeof value === 'object' && Array.isArray((value as any).items) ? (value as any).items : []; }
function pathOf(source: Source, params: Record<string, string>) { return source.path.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, (_, key) => encodeURIComponent(params[key] || '')); }
function personName(person: Person) { return person.nameKh || person.name || person.user?.name || 'Unnamed'; }

function displayDate(value?: string) {
  if (!value) return '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : value;
}

function IdentityCard({ person, subtitle, year, template }: { person: Person; subtitle: string; year?: string; template: CardTemplate }) {
  const [qr, setQr] = useState(''); const code = person.qrCode || '';
  useEffect(() => { let alive = true; if (!code) { setQr(''); return; } QRCode.toDataURL(code, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then((value) => { if (alive) setQr(value); }); return () => { alive = false; }; }, [code]);
  const photo = person.photo || person.user?.photo; const number = person.studentNumber || person.employeeNumber || person.id.slice(0, 8);
  function downloadQr() { if (!qr) return; const anchor = document.createElement('a'); anchor.href = qr; anchor.download = `${number}-attendance-qr.png`; anchor.click(); }
  const phone = person.user?.phone || person.phone; const email = person.user?.email || person.email;
  const landscape = template.cardSize === 'cr80-landscape';
  const hasBack = template.designPreset === 'staff-dual-cream'; const department = person.department?.nameKh || person.department?.name;
  const front = <article className={`id-card-face preset-${template.designPreset}`} style={{ borderColor: template.primaryColor }}>
      <header className="id-card-header" style={{ background: `linear-gradient(110deg, ${template.primaryColor}, ${template.accentColor})` }}>
        {template.logoUrl && <img src={template.logoUrl} alt={`${template.schoolName} logo`} className="id-card-logo" />}
        <span className="min-w-0"><strong>{template.schoolName}</strong><small>{template.cardTitle}</small></span>
      </header>
      <div className="id-card-body">
        <div className="id-card-photo" style={{ borderColor: template.primaryColor, color: template.primaryColor }}>{photo ? <img src={photo} alt="" /> : personName(person)[0]}</div>
        <div className="id-card-details">
          <h2>{personName(person)}</h2>
          <p className="id-card-number" style={{ color: template.primaryColor }}>ID: {number}</p>
          <p className="id-card-role" style={{ color: template.accentColor }}>{subtitle}</p>
          {department && <p><b>Department:</b> {department}</p>}
          {year && <p><b>Study year:</b> {year}</p>}
          {template.showDateOfBirth && person.dateOfBirth && <p><b>Date of birth:</b> {displayDate(person.dateOfBirth)}</p>}
          {template.showPhone && phone && <p><b>Phone:</b> {phone}</p>}
          {template.showEmail && email && <p className="id-card-ellipsis"><b>Email:</b> {email}</p>}
          {template.showAddress && person.address && <p className="id-card-ellipsis"><b>Address:</b> {person.address}</p>}
          {template.extraInfo && <p className="id-card-extra">{template.extraInfo}</p>}
        </div>
        <div className="id-card-qr-wrap">{qr ? <img src={qr} alt={`Attendance QR for ${personName(person)}`} className="id-card-qr" /> : <div className="id-card-qr-missing">QR<br />missing</div>}<span>SCAN TO ATTEND</span></div>
        <p className="id-card-footer" style={{ color: template.primaryColor }}>{template.footerText}</p>
      </div>
    </article>;
  const back = hasBack && <article className="id-card-face id-card-back preset-staff-dual-cream" style={{ borderColor: template.primaryColor }}>
    <header className="id-card-back-header">{template.logoUrl && <img src={template.logoUrl} alt="" className="id-card-logo" />}<strong>{template.schoolName}</strong></header>
    <div className="id-card-back-body"><h3>{personName(person)}</h3><p>{subtitle}</p><div className="id-card-back-qr">{qr ? <img src={qr} alt={`Attendance QR for ${personName(person)}`} /> : <span>QR identifier missing</span>}</div><strong>SCAN FOR ATTENDANCE</strong>{phone && <p>{phone}</p>}{email && <p>{email}</p>}{template.extraInfo && <p>{template.extraInfo}</p>}<small>ID No. {number}</small></div>
  </article>;
  return <div className={`id-card-item ${landscape ? 'is-landscape' : 'is-portrait'} ${hasBack ? 'has-back' : ''}`}>
    <div className="id-card-sides">{front}{back}</div>
    <div className="id-card-actions print:hidden"><button onClick={downloadQr} disabled={!qr}>↓ QR PNG</button><button onClick={() => window.print()} style={{ color: template.primaryColor }}>Print / PDF</button></div>
  </div>;
}

function samplePeople(mode: 'student' | 'staff'): Person[] { return Array.from({ length: 10 }, (_, index) => ({ id: `sample-${mode}-${index + 1}`, name: `${mode === 'staff' ? 'Staff' : 'Student'} Sample ${index + 1}`, nameKh: index < 5 ? `គំរូ ${index + 1}` : undefined, studentNumber: mode === 'student' ? `STU-${String(index + 1).padStart(4, '0')}` : undefined, employeeNumber: mode === 'staff' ? `EMP-${String(index + 1).padStart(3, '0')}` : undefined, position: mode === 'staff' ? ['Teacher','Administrator','Accountant','Librarian'][index % 4] : undefined, phone: `012 345 ${String(670 + index)}`, email: `sample${index + 1}@school.edu`, dateOfBirth: mode === 'student' ? `201${index % 6}-0${(index % 9) + 1}-15` : undefined, address: 'Phnom Penh, Cambodia', qrCode: `wattanam:${mode}:sample-${index + 1}` })); }

export default function PluginIdCardManager({ pluginId, value, data, sources, options, loading, error }: any) {
  const mode = options.mode === 'staff' ? 'staff' : 'student'; const classes = useMemo(() => rows<ClassRow>(value), [value]); const years = rows<any>(data[options.studyYearsSource]);
  const organizationMode = pluginId === 'wattanam.organizing-management';
  const defaultTemplate = useMemo(() => organizationMode && mode === 'staff' ? { ...DEFAULT_TEMPLATES.staff, schoolName: 'Organization', cardTitle: 'Workforce Identification Card', footerText: 'Official workforce attendance card' } : DEFAULT_TEMPLATES[mode], [organizationMode, mode]);
  const staff = rows<Person>(value); const [classId, setClassId] = useState(''); const [yearId, setYearId] = useState(''); const [students, setStudents] = useState<Person[]>([]); const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false); const [loadError, setLoadError] = useState(''); const [showSamples, setShowSamples] = useState(false); const [message, setMessage] = useState('');
  const savedTemplate = data[options.templateSource] as Partial<CardTemplate> | undefined; const [template, setTemplate] = useState<CardTemplate>(defaultTemplate);
  useEffect(() => { setTemplate(savedTemplate && !Array.isArray(savedTemplate) ? { ...defaultTemplate, ...savedTemplate } : defaultTemplate); }, [savedTemplate, defaultTemplate]);
  const currentYear = years.find((item) => item.isCurrent)?.id || years[0]?.id || '';
  useEffect(() => { if (!yearId && currentYear) setYearId(currentYear); }, [currentYear, yearId]);
  const visibleClasses = classes.filter((item) => !yearId || item.studyYearId === yearId); const selectedClass = classes.find((item) => item.id === classId); const selectedYear = years.find((item) => item.id === (selectedClass?.studyYearId || yearId));
  async function openClass(id: string) { const source = sources.find((item: Source) => item.id === options.studentsSource) as Source | undefined; if (!source) return; setBusy(true); setLoadError(''); try { const ensure = sources.find((item: Source) => item.id === options.ensureSource) as Source | undefined; if (ensure) { const ensured = await apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/${pathOf(ensure, { classId: id })}`, { method: ensure.method, headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!ensured.ok) { const detail = await ensured.json().catch(() => ({})); throw new Error(detail.message || 'Student card identifiers could not be prepared.'); } } const response = await apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/${pathOf(source, { classId: id })}`); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Students could not be loaded.'); setStudents(rows<Person>(result)); setClassId(id); } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Students could not be loaded.'); } finally { setBusy(false); } }
  async function saveTemplate() { const source = sources.find((item: Source) => item.id === options.saveTemplateSource) as Source | undefined; if (!source) return setLoadError('Template save route is unavailable.'); setBusy(true); setLoadError(''); setMessage(''); try { const response = await apiFetch(`/api/plugin-api/${encodeURIComponent(pluginId)}/${pathOf(source, { type: mode })}`, { method: source.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || 'Template could not be saved.'); setTemplate({ ...DEFAULT_TEMPLATES[mode], ...result }); setMessage(`${mode === 'staff' ? 'Staff' : 'Student'} card template saved.`); } catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Template could not be saved.'); } finally { setBusy(false); } }
  function selectLogo(file?: File) { if (!file) return; if (!file.type.startsWith('image/')) return setLoadError('School logo must be an image.'); if (file.size > 750_000) return setLoadError('School logo must be smaller than 750 KB.'); const reader = new FileReader(); reader.onload = () => { setTemplate({ ...template, logoUrl: String(reader.result || '') }); setLoadError(''); }; reader.onerror = () => setLoadError('School logo could not be read.'); reader.readAsDataURL(file); }
  const livePeople = mode === 'staff' ? staff : students; const people = (showSamples ? samplePeople(mode) : livePeople).filter((item) => `${personName(item)} ${item.studentNumber || ''} ${item.employeeNumber || ''} ${item.position || ''}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-6"><style jsx global>{`
    .id-card-print-grid { align-items: start; justify-items: center; }
    .id-card-item { break-inside: avoid; display: flex; flex-direction: column; width: max-content; }
    .id-card-sides { display: flex; flex-wrap: wrap; gap: 12px; }
    .id-card-face { background: #fff; border-style: solid; border-width: 2px; box-sizing: border-box; color: #0f172a; flex: none; overflow: hidden; position: relative; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .id-card-item.is-portrait .id-card-face { border-radius: 4mm; height: 86mm; width: 54mm; }
    .id-card-item.is-landscape .id-card-face { border-radius: 4mm; height: 54mm; width: 86mm; }
    .id-card-header { align-items: center; box-sizing: border-box; color: #fff; display: flex; gap: 8px; height: 58px; justify-content: center; overflow: hidden; padding: 7px 10px; text-align: center; }
    .id-card-header strong { display: block; font-size: 13px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .id-card-header small { display: block; font-size: 9px; line-height: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .id-card-logo { background: #fff; border-radius: 999px; flex: none; height: 38px; object-fit: contain; padding: 3px; width: 38px; }
    .id-card-body { box-sizing: border-box; height: calc(100% - 58px); min-height: 0; padding: 10px; position: relative; }
    .id-card-photo { align-items: center; background: #f1f5f9; border-style: solid; border-width: 3px; display: flex; flex: none; font-size: 28px; font-weight: 800; justify-content: center; overflow: hidden; }
    .id-card-photo img { height: 100%; object-fit: cover; width: 100%; }
    .id-card-details { min-height: 0; min-width: 0; overflow: hidden; }
    .id-card-details h2 { font-size: 16px; font-weight: 800; line-height: 19px; margin: 0 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .id-card-details p { color: #475569; font-size: 9px; line-height: 12px; margin: 0; }
    .id-card-details b { color: #334155; font-weight: 700; }
    .id-card-details .id-card-number { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
    .id-card-details .id-card-role { font-size: 11px; font-weight: 800; margin: 4px 0 2px; }
    .id-card-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .id-card-extra { margin-top: 2px !important; white-space: pre-line; }
    .id-card-qr-wrap { align-items: center; display: flex; flex-direction: column; justify-content: center; }
    .id-card-qr { background: #fff; border: 1px solid #cbd5e1; box-sizing: border-box; display: block; height: 100%; object-fit: contain; padding: 2px; width: 100%; }
    .id-card-qr-missing { align-items: center; background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; display: flex; font-size: 8px; height: 100%; justify-content: center; text-align: center; width: 100%; }
    .id-card-qr-wrap span { color: #64748b; font-size: 6px; font-weight: 800; letter-spacing: .04em; line-height: 9px; }
    .id-card-footer { bottom: 5px; font-size: 7px; font-weight: 700; left: 10px; line-height: 9px; margin: 0; max-width: calc(100% - 20px); overflow: hidden; position: absolute; text-overflow: ellipsis; white-space: nowrap; }
    .is-portrait .id-card-body { display: grid; gap: 4px; grid-template-rows: 74px minmax(0, 1fr) 76px 10px; justify-items: center; padding: 9px 12px 6px; }
    .is-portrait .id-card-photo { border-radius: 999px; height: 72px; width: 72px; }
    .is-portrait .id-card-details { text-align: center; width: 100%; }
    .is-portrait .id-card-qr-wrap { height: 76px; width: 68px; }
    .is-portrait .id-card-qr { height: 68px; width: 68px; }
    .is-portrait .id-card-footer { bottom: 5px; text-align: center; width: calc(100% - 20px); }
    .is-landscape .id-card-header { height: 52px; justify-content: flex-start; padding-left: 14px; text-align: left; }
    .is-landscape .id-card-body { display: grid; gap: 10px; grid-template-columns: 76px minmax(0, 1fr) 70px; height: calc(100% - 52px); padding: 12px 12px 18px; }
    .is-landscape .id-card-photo { border-radius: 10px; height: 88px; width: 76px; }
    .is-landscape .id-card-details h2 { font-size: 17px; line-height: 20px; }
    .is-landscape .id-card-qr-wrap { align-self: end; height: 76px; width: 70px; }
    .is-landscape .id-card-qr { height: 70px; width: 70px; }
    .id-card-actions { display: flex; gap: 6px; padding-top: 6px; }
    .id-card-actions button { border: 1px solid #cbd5e1; border-radius: 8px; flex: 1; font-size: 11px; font-weight: 700; padding: 7px; }
    .id-card-actions button:disabled { opacity: .4; }
    .preset-staff-geometric-mint { background: #a7ddcc; }
    .preset-staff-geometric-mint::before, .preset-staff-geometric-mint::after { background: var(--staff-accent, #3b9478); content: ''; height: 78px; opacity: .9; position: absolute; top: 45px; transform: skewY(28deg); width: 78px; z-index: 0; }
    .preset-staff-geometric-mint::before { left: -35px; }
    .preset-staff-geometric-mint::after { right: -35px; transform: skewY(-28deg); }
    .preset-staff-geometric-mint .id-card-header { background: transparent !important; color: #0f172a; height: 68px; position: relative; z-index: 1; }
    .preset-staff-geometric-mint .id-card-header strong { font-size: 16px; text-transform: uppercase; }
    .preset-staff-geometric-mint .id-card-photo { border-radius: 0; clip-path: polygon(50% 0, 100% 24%, 100% 76%, 50% 100%, 0 76%, 0 24%); height: 88px; width: 88px; }
    .preset-staff-geometric-mint .id-card-body { height: calc(100% - 68px); }
    .preset-staff-olive-modern { background: #eaffb9; }
    .preset-staff-olive-modern .id-card-header { background: #52683c !important; border-radius: 0 0 36px 0; height: 72px; }
    .preset-staff-olive-modern .id-card-body { height: calc(100% - 72px); }
    .preset-staff-olive-modern .id-card-photo { border-color: #8aaa58 !important; box-shadow: 0 0 0 4px #dff7a7; }
    .preset-staff-olive-modern .id-card-role { background: #6b814c; color: #fff !important; display: inline-block; padding: 2px 7px; }
    .preset-staff-dual-cream { background: radial-gradient(circle at 15% 10%, #f0dfbf 0 2px, transparent 3px), linear-gradient(145deg, #fffdf7, #f3e7cf); }
    .preset-staff-dual-cream .id-card-header { background: transparent !important; color: #292524; }
    .preset-staff-dual-cream .id-card-photo { border-color: #d6b56f !important; }
    .preset-staff-dual-cream:not(.id-card-back) .id-card-body { grid-template-rows: 74px minmax(0, 1fr) 0 10px; }
    .preset-staff-dual-cream:not(.id-card-back) .id-card-qr-wrap { display: none; }
    .id-card-back-header { align-items: center; display: flex; gap: 8px; justify-content: center; padding: 15px 10px 5px; }
    .id-card-back-header strong { font-size: 13px; }
    .id-card-back-body { align-items: center; display: flex; flex-direction: column; height: calc(100% - 58px); overflow: hidden; padding: 6px 14px 10px; text-align: center; }
    .id-card-back-body h3 { font-size: 14px; font-weight: 800; margin: 0; }
    .id-card-back-body p { font-size: 8px; line-height: 11px; margin: 1px 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .id-card-back-body > strong { font-size: 7px; letter-spacing: .05em; margin: 2px 0; }
    .id-card-back-body small { bottom: 9px; font-size: 7px; position: absolute; }
    .id-card-back-qr { align-items: center; background: #fff; border: 1px solid #d6b56f; display: flex; height: 82px; justify-content: center; margin: 5px 0 2px; padding: 3px; width: 82px; }
    .id-card-back-qr img { height: 100%; width: 100%; }
    .id-card-back-qr span { color: #dc2626; font-size: 8px; }
    @media print {
      @page { margin: 8mm; size: A4 portrait; }
      body * { visibility: hidden !important; }
      .id-card-print-grid { display: grid !important; gap: 4mm !important; grid-template-columns: repeat(2, max-content) !important; left: 0; margin: 0 !important; padding: 0 !important; position: absolute; top: 0; }
      .id-card-print-grid, .id-card-print-grid * { visibility: visible !important; }
      .id-card-item.is-portrait .id-card-face { border-radius: 4mm; height: 86mm; width: 54mm; }
      .id-card-item.is-landscape .id-card-face { border-radius: 4mm; height: 54mm; width: 86mm; }
      .id-card-item.has-back, .id-card-item.has-back .id-card-sides { display: contents; }
      .id-card-actions { display: none !important; }
    }
  `}</style><header className="flex flex-wrap items-start justify-between gap-4 print:hidden"><div><h1 className="text-3xl font-extrabold text-slate-900">{mode === 'staff' ? '👥 Staff ID Cards' : '🎓 Student ID Cards'}</h1><p className="mt-1 text-sm text-slate-500">{mode === 'staff' ? `${staff.length} staff members` : `${selectedYear?.label || 'Current study year'} · ${visibleClasses.length} classes · ${visibleClasses.reduce((sum, item) => sum + Number(item.studentCount || 0), 0)} students`}</p></div>{mode === 'student' && <select value={yearId} onChange={(event) => { setYearId(event.target.value); setClassId(''); setStudents([]); }} className="rounded-xl border px-4 py-3">{years.map((item) => <option key={item.id} value={item.id}>{item.label || item.year}{item.isCurrent ? ' (Current)' : ''}</option>)}</select>}</header>
    {(error || loadError) && <p className="rounded-xl bg-red-50 p-4 text-red-700">{error || loadError}</p>}
    {message && <p className="rounded-xl bg-emerald-50 p-4 text-emerald-700">{message}</p>}
    {mode === 'student' && <section className="rounded-2xl border bg-white p-5 shadow-sm print:hidden"><h2 className="text-lg font-bold">10 Student ID Card Templates</h2><p className="mt-1 text-sm text-slate-500">Choose an original professional design inspired by the uploaded examples, then customize its logo, information, colors, and size.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{STUDENT_PRESETS.map((preset, index) => <button key={preset.id} type="button" onClick={() => setTemplate({ ...template, designPreset: preset.id, primaryColor: preset.primaryColor, accentColor: preset.accentColor, cardSize: preset.cardSize })} className={`overflow-hidden rounded-xl border-2 text-left transition ${template.designPreset === preset.id ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-400'}`}><span className="block h-20 p-3 text-white" style={{ background: `linear-gradient(135deg, ${preset.primaryColor}, ${preset.accentColor})` }}><span className="text-lg font-black">{String(index + 1).padStart(2, '0')}</span><span className="mt-2 block text-[10px] font-bold uppercase tracking-wider">Student ID Card</span></span><span className="block bg-white px-3 py-2 text-xs font-semibold text-slate-700">{preset.name}<small className="block font-normal text-slate-400">{preset.cardSize === 'cr80-portrait' ? 'Portrait' : 'Landscape'}</small></span></button>)}</div></section>}
    {mode === 'staff' && <section className="rounded-2xl border bg-white p-5 shadow-sm print:hidden"><h2 className="text-lg font-bold">Staff ID Card Templates</h2><p className="mt-1 text-sm text-slate-500">Choose a professional portrait design. The Cream template includes printable front and back sides with the attendance QR on the back.</p><div className="mt-4 grid gap-3 md:grid-cols-3">{STAFF_PRESETS.map((preset, index) => <button key={preset.id} type="button" onClick={() => setTemplate({ ...template, designPreset: preset.id, primaryColor: preset.primaryColor, accentColor: preset.accentColor, cardSize: preset.cardSize })} className={`overflow-hidden rounded-xl border-2 text-left transition ${template.designPreset === preset.id ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-400'}`}><span className="flex h-24 items-end p-3 text-white" style={{ background: `linear-gradient(145deg, ${preset.primaryColor}, ${preset.accentColor})` }}><span><b className="block text-xl">0{index + 1}</b><small className="font-bold uppercase tracking-wider">{index === 2 ? 'Front + Back' : 'Staff ID Card'}</small></span></span><span className="block bg-white px-3 py-2 text-sm font-semibold text-slate-700">{preset.name}<small className="block font-normal text-slate-400">{preset.description}</small></span></button>)}</div></section>}
    <details className="rounded-2xl border bg-white p-5 shadow-sm print:hidden" open><summary className="cursor-pointer text-lg font-bold">Design & card information</summary><p className="mt-1 text-sm text-slate-500">Edit the shared {mode} card template. Attendance QR identifiers are protected and remain unchanged.</p><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-semibold">School name<input className="mt-1 w-full rounded-xl border px-3 py-2" value={template.schoolName} onChange={(e) => setTemplate({ ...template, schoolName: e.target.value })} /></label><label className="text-xs font-semibold">Card title<input className="mt-1 w-full rounded-xl border px-3 py-2" value={template.cardTitle} onChange={(e) => setTemplate({ ...template, cardTitle: e.target.value })} /></label><label className="text-xs font-semibold">Card size<select className="mt-1 w-full rounded-xl border px-3 py-2" value={template.cardSize} onChange={(e) => setTemplate({ ...template, cardSize: e.target.value as CardTemplate['cardSize'] })}><option value="cr80-portrait">CR80 Portrait · 54 × 86 mm</option><option value="cr80-landscape">CR80 Landscape · 86 × 54 mm</option></select></label><label className="text-xs font-semibold">School logo URL<input type="url" className="mt-1 w-full rounded-xl border px-3 py-2" value={template.logoUrl.startsWith('data:') ? '' : template.logoUrl} onChange={(e) => setTemplate({ ...template, logoUrl: e.target.value })} placeholder="https://school.example/logo.png" /></label><label className="text-xs font-semibold">Upload school logo<input type="file" accept="image/*" className="mt-1 block w-full text-xs" onChange={(e) => selectLogo(e.target.files?.[0])} /></label><label className="text-xs font-semibold">Primary color<input type="color" className="mt-1 h-10 w-full rounded-xl border p-1" value={template.primaryColor} onChange={(e) => setTemplate({ ...template, primaryColor: e.target.value })} /></label><label className="text-xs font-semibold">Accent color<input type="color" className="mt-1 h-10 w-full rounded-xl border p-1" value={template.accentColor} onChange={(e) => setTemplate({ ...template, accentColor: e.target.value })} /></label><div className="flex items-end">{template.logoUrl ? <span className="flex items-center gap-2"><img src={template.logoUrl} alt="Logo preview" className="h-12 w-12 rounded-full border object-contain" /><button className="text-xs text-red-600" onClick={() => setTemplate({ ...template, logoUrl: '' })}>Remove logo</button></span> : <span className="text-xs text-slate-400">No logo selected</span>}</div><label className="text-xs font-semibold md:col-span-2">Footer text<input className="mt-1 w-full rounded-xl border px-3 py-2" value={template.footerText} onChange={(e) => setTemplate({ ...template, footerText: e.target.value })} /></label><label className="text-xs font-semibold md:col-span-2">Additional card information<textarea rows={2} className="mt-1 w-full rounded-xl border px-3 py-2" value={template.extraInfo} onChange={(e) => setTemplate({ ...template, extraInfo: e.target.value })} placeholder="School address, validity, emergency contact…" /></label></div><div className="mt-4 flex flex-wrap gap-4 text-sm">{([['showPhone','Phone'],['showEmail','Email'],['showAddress','Address'],['showDateOfBirth','Date of birth']] as const).map(([key,label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={template[key]} onChange={(e) => setTemplate({ ...template, [key]: e.target.checked })} />{label}</label>)}</div><div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void saveTemplate()} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save Template'}</button><button onClick={() => setShowSamples(!showSamples)} className="rounded-xl border px-5 py-2.5 text-sm font-bold">{showSamples ? 'Show live cards' : 'Preview 10 sample cards'}</button><button onClick={() => setTemplate(DEFAULT_TEMPLATES[mode])} className="rounded-xl border px-5 py-2.5 text-sm">Reset design</button></div></details>
    {mode === 'student' && !classId && <><div className="flex items-center justify-between print:hidden"><h2 className="text-lg font-bold">📖 All Classes in {selectedYear?.label || 'Study Year'}</h2><button onClick={() => window.print()} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white">▣ Download All Cards</button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{visibleClasses.map((item) => <button key={item.id} onClick={() => void openClass(item.id)} className="overflow-hidden rounded-2xl border text-left shadow-sm"><div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-5 text-white"><span className="float-right rounded-full bg-white/20 px-3 py-1 text-xs font-bold">{item.studentCount || 0} students</span><span className="text-2xl">📖</span><h3 className="mt-4 text-lg font-bold">{item.name}</h3></div><div className="flex justify-between p-4 text-sm"><span>♟ {item.teacher?.name || 'No teacher'}</span><span className="text-indigo-600">View →</span></div></button>)}</div></>}
    {(showSamples || mode === 'staff' || classId) && <><div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm print:hidden">{mode === 'student' && classId && !showSamples && <button onClick={() => { setClassId(''); setStudents([]); }} className="text-indigo-600">← Back to Classes</button>}<div className="min-w-52 flex-1"><strong>{showSamples ? `10 ${mode} sample cards` : mode === 'staff' ? 'All Staff' : selectedClass?.name}</strong><p className="text-xs text-slate-500">{people.length} cards ready</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${mode === 'staff' ? 'staff' : 'students'}…`} className="rounded-xl border px-4 py-2.5" /><button onClick={() => window.print()} disabled={!people.length} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">▣ Download / Print Cards ({people.length})</button></div>{busy || loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((item) => <div key={item} className="h-96 animate-pulse rounded-2xl bg-slate-100" />)}</div> : <div className="id-card-print-grid grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{people.map((person) => <IdentityCard key={person.id} person={person} template={template} subtitle={mode === 'staff' ? person.position || 'Staff' : showSamples ? 'Sample Class' : selectedClass?.name || 'Student'} year={mode === 'student' ? selectedYear?.label : undefined} />)}</div>}</>}
  </section>;
}
