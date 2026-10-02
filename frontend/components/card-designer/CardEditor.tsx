'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  CardDesign, CardType, FONT_OPTIONS,
  LogoElement, PhotoPlaceholder, QrPlaceholder, ShapeElement, TextElement,
  STUDENT_TEMPLATE, STAFF_TEMPLATE, BLANK_TEMPLATE,
  BLANK_CERTIFICATE_STUDENT, BLANK_CERTIFICATE_STAFF,
  STUDENT_CLASSIC_BLUE, STUDENT_DARK_NAVY, STUDENT_SKY_WAVE, STUDENT_GEOMETRIC, STUDENT_MINIMAL,
  STAFF_CORPORATE_TEAL, STAFF_DEEP_OCEAN, STAFF_ROSE, STAFF_FOREST, STAFF_SLATE_EXECUTIVE,
  loadSavedDesign, saveDesign, clearAllCache, SavedTemplate,
  apiLoadTemplates, apiLoadTemplate, apiSaveTemplate, apiDeleteTemplate, apiGetActiveDesign, apiSetActiveDesign,
} from './types';
import { renderDesignToCanvas } from './renderDesignToCanvas';
import { downloadSingleCardPDF } from './generateCardPDF';
import CardCanvas from './CardCanvas';
import Toolbar from './Toolbar';
import LayersPanel from './LayersPanel';
import NewProjectDialog from './NewProjectDialog';
import { apiFetch } from '../../lib/api';

// Module-level cache: avoids duplicate API calls within the same page session
let _templateListCache: SavedTemplate[] | null = null;
let _templateListInflight: Promise<SavedTemplate[]> | null = null; // deduplicates concurrent callers
const TEMPLATE_LIST_LS_KEY = 'wattaman_tpl_list_v1'; // localStorage — persists across tabs & restarts
const TEMPLATE_LIST_TTL_MS = 30 * 60 * 1000; // 30-minute expiry — prevents stale data

/** Read from localStorage. Returns null if: key missing, expired, empty array, or corrupt format.
 *  An empty result is NEVER trusted — it could be a transient API error artifact. */
function readLSTemplateCache(): SavedTemplate[] | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_LIST_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const data = obj.d;
    const ts = obj.t;
    if (!Array.isArray(data) || data.length === 0) return null;           // reject empty / bad format
    if (typeof ts !== 'number' || Date.now() - ts > TEMPLATE_LIST_TTL_MS) { // reject expired
      localStorage.removeItem(TEMPLATE_LIST_LS_KEY);
      return null;
    }
    return data as SavedTemplate[];
  } catch { return null; }
}

function invalidateTemplateListCache() {
  _templateListCache = null;
  _templateListInflight = null;
  try { localStorage.removeItem(TEMPLATE_LIST_LS_KEY); } catch {}
}
async function loadTemplatesCached(): Promise<SavedTemplate[]> {
  // 1. Memory cache — instant within same JS session
  if (_templateListCache !== null) return _templateListCache;
  // 2. Deduplicate concurrent calls — return the same in-flight promise instead of hitting API twice
  if (_templateListInflight !== null) return _templateListInflight;
  // 3. localStorage cache — non-empty, non-expired only (empty result could be a transient error)
  const lsHit = readLSTemplateCache();
  if (lsHit) { _templateListCache = lsHit; return lsHit; }
  // 4. API call — only when cache is genuinely absent or expired
  _templateListInflight = apiLoadTemplates().then((templates) => {
    _templateListCache = templates;
    _templateListInflight = null;
    // CRITICAL: never persist an empty array — could be a cold-start / auth error artifact
    if (templates.length > 0) {
      try { localStorage.setItem(TEMPLATE_LIST_LS_KEY, JSON.stringify({ d: templates, t: Date.now() })); } catch {}
    }
    return templates;
  });
  return _templateListInflight;
}

// Module-level in-memory preview URL cache — survives picker open/close & component remounts
const _previewUrlMemCache: Record<string, string> = {};

// Per-template design cache (id → CardDesign). Designs are fetched on demand because
// the list API call returns only metadata for speed. Concurrent calls for the same id
// are deduplicated via _designInflight.
const _designMemCache: Record<string, CardDesign> = {};
const _designInflight: Record<string, Promise<CardDesign | null>> = {};

async function loadTemplateDesignCached(tpl: SavedTemplate): Promise<CardDesign | null> {
  if (tpl.design) { _designMemCache[tpl.id] = tpl.design; return tpl.design; }
  const cached = _designMemCache[tpl.id];
  if (cached) return cached;
  const inflight = _designInflight[tpl.id];
  if (inflight) return inflight;
  const promise = apiLoadTemplate(tpl.id).then((full) => {
    delete _designInflight[tpl.id];
    if (full?.design) { _designMemCache[tpl.id] = full.design; return full.design; }
    return null;
  });
  _designInflight[tpl.id] = promise;
  return promise;
}

const TPT_TEMPLATE: CardDesign = { ...STAFF_TEMPLATE, cardType: 'teacher-part-time' as const };

const TEMPLATES: Partial<Record<CardType, CardDesign>> = {
  student: STUDENT_TEMPLATE,
  staff: STAFF_TEMPLATE,
  'teacher-part-time': TPT_TEMPLATE,
  'certificate-student': BLANK_CERTIFICATE_STUDENT,
  'certificate-staff': BLANK_CERTIFICATE_STAFF,
};

const PREVIEW_DATA: Record<string, string> = {
  // New-style keys (match CARD_TYPE_FIELDS — lowercase camelCase)
  'name': 'Sophea Chann', 'studentNumber': '0001', 'class': 'Grade 10A',
  'email': 'sophea@school.edu', 'phone': '012 345 678', 'sex': 'Female',
  'dateOfBirth': '12 Mar 2008', 'address': '123 Norodom Blvd, Phnom Penh',
  'qrCode': 'STU-2024-001', 'studyYear': '2025–2026',
  'role': 'Senior Teacher', 'department': 'Mathematics',
  'schoolName': 'Wattaman School', 'certificateDate': '18/05/2026',
  // TPT fields
  'khmerName': 'ដារ៉ា សុទ្ធា', 'short': 'DRS', 'timetableName': 'Main 2026',
  'subjects': 'Math, Science', 'weeklyLessons': '12',
  // Old-style keys (backward compat with saved templates using capitalized placeholder names)
  'Student Name': 'Sophea Chann', 'Name': 'Sophea Chann', 'ID': 'STU-2024-001',
  'Student ID': 'STU-2024-001', 'Class': 'Grade 10A', 'Class Name': 'Grade 10A',
  'Gender': 'Female', 'Date of Birth': '12 Mar 2008', 'DOB': '12 Mar 2008',
  'Address': '123 Norodom Blvd, Phnom Penh', 'Phone': '012 345 678',
  'Ranking': '#3 / Monthly', 'Monthly Rank': '#3', 'Yearly Rank': '#5',
  'Department': 'Mathematics', 'Role': 'Senior Teacher',
  'Staff Name': 'Dara Sok', 'Staff ID': 'STAFF-2024-042',
  'School': 'Wattaman School', 'Year': '2024-2025',
};

function applyPreviewData(text: string): string {
  const lowerMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(PREVIEW_DATA)) lowerMap[k.toLowerCase()] = v;
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    return PREVIEW_DATA[trimmed] ?? lowerMap[trimmed.toLowerCase()] ?? `[${trimmed}]`;
  });
}

// ── Compact top-bar icon button ──────────────────────────────────────────────
/* ── SVG icon library for the top bar ──────────────────────────────────── */
const Icons = {
  New: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 8h4M8 6v4"/></svg>,
  Save: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3a1 1 0 0 1-1-1V4l3-3h7a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1z"/><rect x="5" y="9" width="6" height="4" rx="0.5"/><rect x="5.5" y="2" width="5" height="3" rx="0.5"/></svg>,
  Undo: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V3M3 7l3-3M3 7l3 3"/><path d="M3 7a6 6 0 1 0 6-6"/></svg>,
  Redo: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M13 7V3M13 7l-3-3M13 7l-3 3"/><path d="M13 7a6 6 0 1 1-6-6"/></svg>,
  Templates: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>,
  Export: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/></svg>,
  Grid: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12"/></svg>,
  Preview: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M1.5 8C1.5 8 4 3.5 8 3.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>,
  AsTemplate: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 6h6M5 9h4"/></svg>,
  Reset: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M3 8a5 5 0 1 0 1.5-3.5L3 6V3"/><path d="M3 3v3h3"/></svg>,
  Trash: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8"/></svg>,
  Student: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c0-2.76 2.24-5 5-5s5 2.24 5 5"/><path d="M5 3l3-1.5L11 3"/></svg>,
  Staff: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c0-2.76 2.24-5 5-5s5 2.24 5 5"/><rect x="5.5" y="1.5" width="5" height="2" rx="0.5" fill="currentColor" stroke="none" opacity="0.5"/></svg>,
  ExportPng: () => <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="7" r="1.5"/><path d="M2 11l3-3 2.5 2.5 2-2 4.5 4.5"/></svg>,
  ExportPdf: () => <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6L9 2z"/><path d="M9 2v4h4"/><path d="M5 9h2.5a1.5 1.5 0 0 1 0 3H5V9z" fill="currentColor" stroke="none" opacity="0.4"/></svg>,
  Spinner: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="8" cy="8" r="5" strokeOpacity={0.3}/><path d="M8 3a5 5 0 0 1 5 5"/></svg>,
  Sync: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M3 5V2l-2 2M3 2a7 7 0 0 1 10 0M13 11v3l2-2M13 14a7 7 0 0 1-10 0"/></svg>,
  Print: () => <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 6V2h8v4"/><path d="M4 11H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2"/><path d="M4 9h8v5H4z"/></svg>,
};

interface TopBtnProps {
  icon: React.ReactNode; label: string; title?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  active?: boolean;
  variant?: 'default' | 'emerald' | 'indigo' | 'violet' | 'amber' | 'danger';
  hideLabel?: boolean;
}
function TopBtn({ icon, label, title, onClick, disabled, active, variant = 'default', hideLabel }: TopBtnProps) {
  const base = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium transition-all disabled:opacity-25 disabled:cursor-not-allowed select-none whitespace-nowrap';
  const variants: Record<string, string> = {
    default: active ? 'bg-[#3a3a3a] text-white' : 'text-[#aaa] hover:bg-[#333] hover:text-white',
    emerald: active ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-400 hover:bg-emerald-950/60 hover:text-emerald-300',
    indigo: active ? 'bg-indigo-600 text-white shadow-sm' : 'text-indigo-400 hover:bg-indigo-950/60 hover:text-indigo-300',
    violet: active ? 'bg-violet-600 text-white shadow-sm' : 'text-violet-400 hover:bg-violet-950/60 hover:text-violet-300',
    amber: active ? 'bg-amber-500 text-white shadow-sm' : 'text-amber-400 hover:bg-amber-950/60 hover:text-amber-300',
    danger: 'text-red-400 hover:bg-red-950/40 hover:text-red-300',
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title ?? label} className={`${base} ${variants[variant]}`}>
      <span className="shrink-0">{icon}</span>
      {!hideLabel && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-[#404040] mx-1 shrink-0" />;
}

export default function CardEditor({ initialCardType, openNewProject, onSave }: { initialCardType?: CardType; openNewProject?: boolean; onSave?: () => void } = {}) {
  const router = useRouter();
  // Synchronously seed from localStorage so returning admins see the LAST APPLIED design
  // on first paint — no flicker from the built-in default template before the server fetch.
  const [design, setDesign] = useState<CardDesign>(() => {
    if (typeof window !== 'undefined' && initialCardType) {
      const cached = loadSavedDesign(initialCardType);
      if (cached) return cached;
    }
    return initialCardType === 'staff' ? STAFF_TEMPLATE :
           initialCardType === 'student' ? STUDENT_TEMPLATE :
           initialCardType === 'teacher-part-time' ? TPT_TEMPLATE :
           BLANK_TEMPLATE;
  });
  // Only true once the server-side active design has been resolved (or we know there is none).
  // Used to show a subtle overlay on first-time opens when there is no localStorage cache.
  const [designReady, setDesignReady] = useState<boolean>(() => {
    if (!initialCardType) return true;
    if (typeof window === 'undefined') return false;
    return loadSavedDesign(initialCardType) !== null;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const lastDesignRef = useRef<CardDesign | null>(null);
  const isFirstRenderRef = useRef(true);
  const isLoadingRef = useRef(true);

  // ── Canvas view state ────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(100); // percent
  const [showGrid, setShowGrid] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewQrUrl, setPreviewQrUrl] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showNewProject, setShowNewProject] = useState(openNewProject ?? false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'pdf' | null>(null);

  // ── History ──────────────────────────────────────────────────────────────
  const historyStackRef = useRef<CardDesign[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const canUndo = historyTick >= 0 && historyIndexRef.current > 0;
  const canRedo = historyTick >= 0 && historyIndexRef.current < historyStackRef.current.length - 1;

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current--;
    setDesign(historyStackRef.current[historyIndexRef.current]);
    setHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyStackRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current++;
    setDesign(historyStackRef.current[historyIndexRef.current]);
    setHistoryTick((t) => t + 1);
  }, []);

  // ── Context menu ─────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ── Template modals ──────────────────────────────────────────────────────
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>(() => {
    // Read synchronously from localStorage — valid, non-empty, non-expired only
    const hit = readLSTemplateCache();
    if (hit) { _templateListCache = hit; return hit; } // warms module-level cache too
    return [];
  });
  const [savedTemplatesLoaded, setSavedTemplatesLoaded] = useState<boolean>(() => {
    return readLSTemplateCache() !== null; // true only if cache is valid & non-empty
  });
  const savedTemplatesLoadedRef = useRef(savedTemplatesLoaded); // mirrors initial state (from localStorage)
  // Pre-populate previews synchronously on first render:
  // — memory cache (survives hot-reload / same-session remounts)
  // — sessionStorage (survives browser refresh within the same tab)
  // This ensures thumbnails appear on the FIRST PAINT, not after effects run.
  const [templatePreviews, setTemplatePreviews] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = { ..._previewUrlMemCache };
    const CACHE_KEY = 'wattaman_thumb_v2';
    // All known keys: saved templates (from LS cache) + built-in preset keys
    const knownKeys: string[] = [
      '__builtin_blank', '__builtin_student', '__builtin_staff',
      '__preset_st1', '__preset_st2', '__preset_st3', '__preset_st4', '__preset_st5',
      '__preset_sf1', '__preset_sf2', '__preset_sf3', '__preset_sf4', '__preset_sf5',
      '__cert_student', '__cert_staff',
      ...(_templateListCache ?? []).map((t) => t.id),
    ];
    for (const key of knownKeys) {
      if (!initial[key]) {
        try {
          const hit = sessionStorage.getItem(`${CACHE_KEY}:${key}`);
          if (hit) { initial[key] = hit; _previewUrlMemCache[key] = hit; }
        } catch {}
      }
    }
    return initial;
  });
  const [showClearCache, setShowClearCache] = useState(false);

  // ── Start screen ─────────────────────────────────────────────────────────
  const [isStartScreen, setIsStartScreen] = useState(!initialCardType && !openNewProject);
  const [startPreviews, setStartPreviews] = useState<Record<string, string>>({});
  const [startTemplates, setStartTemplates] = useState<SavedTemplate[]>([]);

  // ── Server sync ──────────────────────────────────────────────────────────
  const syncToServer = useCallback(async (d: CardDesign) => {
    setSyncStatus('syncing');
    const ok = await apiSetActiveDesign(d);
    if (ok) { lastDesignRef.current = d; setSyncStatus('synced'); setTimeout(() => setSyncStatus('idle'), 3000); }
    else setSyncStatus('error');
  }, []);

  // ── Load on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialCardType) { isLoadingRef.current = false; setDesignReady(true); return; }
    isLoadingRef.current = true;
    const cardType = initialCardType;
    const localDesign = loadSavedDesign(cardType);
    if (localDesign) setDesign(localDesign);
    apiGetActiveDesign(cardType).then((apiDesign) => {
      if (apiDesign) {
        // Migration: if a TPT design was saved before photo/qr defaults were set, restore them.
        // Only applies when both are null AND the design has no texts (i.e. it's a blank/stale save).
        if (cardType === 'teacher-part-time' && !apiDesign.photo && !apiDesign.qr && (apiDesign.texts?.length ?? 0) === 0) {
          if (TPT_TEMPLATE.photo) apiDesign.photo = { ...TPT_TEMPLATE.photo };
          if (TPT_TEMPLATE.qr) apiDesign.qr = { ...TPT_TEMPLATE.qr };
        }
        // Server design always wins so every admin sees the same active template
        saveDesign(apiDesign);
        setDesign(apiDesign);
        lastDesignRef.current = apiDesign;
      }
      // Note: we deliberately do NOT auto-push localDesign when the server has no active design.
      // That used to clobber peer admins' state — only an explicit Apply or user edit may push.
    }).finally(() => {
      setDesignReady(true);
      setTimeout(() => { isLoadingRef.current = false; }, 2000);
    });
  }, [initialCardType, syncToServer]);

  // ── Refresh active design when the tab regains focus ─────────────────────
  // Ensures admins see template changes applied by other admins without a full page reload.
  useEffect(() => {
    if (!initialCardType) return;
    const cardType = initialCardType;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      apiGetActiveDesign(cardType).then((apiDesign) => {
        if (!apiDesign) return;
        // Skip if identical to what we already have to avoid churn
        try {
          if (JSON.stringify(apiDesign) === JSON.stringify(lastDesignRef.current)) return;
        } catch { /* fall through */ }
        isLoadingRef.current = true;
        saveDesign(apiDesign);
        setDesign(apiDesign);
        lastDesignRef.current = apiDesign;
        setTimeout(() => { isLoadingRef.current = false; }, 1500);
      }).catch(() => { /* keep current state on failure */ });
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [initialCardType]);

  // ── Eager-preload saved template list on mount (warm cache before picker opens) ──
  useEffect(() => {
    const CACHE_KEY = 'wattaman_thumb_v2';
    const thumbScale = (d: CardDesign) => d.width > 500 ? 0.28 : 0.5;
    let cancelled = false;
    loadTemplatesCached().then((templates) => {
      if (cancelled) return;
      setSavedTemplates(templates);
      setSavedTemplatesLoaded(true);
      savedTemplatesLoadedRef.current = true;
      // Pre-render saved template thumbnails into memory + sessionStorage so the picker is instant
      if (templates.length === 0) return;
      (async () => {
        for (const tpl of templates) {
          if (cancelled) break;
          if (_previewUrlMemCache[tpl.id]) continue; // already in memory cache
          const ssHit = sessionStorage.getItem(`${CACHE_KEY}:${tpl.id}`);
          if (ssHit) { _previewUrlMemCache[tpl.id] = ssHit; continue; } // warm from sessionStorage
          await new Promise<void>((r) => setTimeout(r, 0));
          if (cancelled) break;
          try {
            const design = await loadTemplateDesignCached(tpl);
            if (!design || cancelled) continue;
            const c = await renderDesignToCanvas(design, { scale: thumbScale(design) });
            const url = c.toDataURL('image/jpeg', 0.5);
            _previewUrlMemCache[tpl.id] = url;
            try { sessionStorage.setItem(`${CACHE_KEY}:${tpl.id}`, url); } catch {}
          } catch {}
        }
      })();
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start screen: preload template previews (parallel + sessionStorage cache) ──
  useEffect(() => {
    if (!isStartScreen) return;
    let cancelled = false;
    const CACHE_KEY = 'wattaman_thumb_v2';
    const thumbScale = (d: CardDesign) => d.width > 500 ? 0.28 : 0.5; // certs smaller

    // Render at most N canvases concurrently; yield to browser between each.
    // Items may carry an inline `design` (built-ins) OR a `tpl` reference that
    // gets its design lazy-fetched from the API on first use.
    const runConcurrent = async (
      items: { key: string; design?: CardDesign; tpl?: SavedTemplate }[],
      setFn: (k: string, url: string) => void,
      limit = 3,
    ) => {
      const queue = [...items];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const item = queue.shift()!;
          // Memory cache first, then sessionStorage, then render
          const memHit = _previewUrlMemCache[item.key];
          if (memHit) { if (!cancelled) setFn(item.key, memHit); continue; }
          const ssHit = sessionStorage.getItem(`${CACHE_KEY}:${item.key}`);
          if (ssHit) { _previewUrlMemCache[item.key] = ssHit; if (!cancelled) setFn(item.key, ssHit); continue; }
          // Only yield before expensive canvas renders
          await new Promise<void>((r) => setTimeout(r, 0));
          if (cancelled) break;
          try {
            const design = item.design ?? (item.tpl ? await loadTemplateDesignCached(item.tpl) : null);
            if (!design || cancelled) continue;
            const c = await renderDesignToCanvas(design, { scale: thumbScale(design) });
            const url = c.toDataURL('image/jpeg', 0.5);
            _previewUrlMemCache[item.key] = url;
            try { sessionStorage.setItem(`${CACHE_KEY}:${item.key}`, url); } catch {}
            if (!cancelled) setFn(item.key, url);
          } catch {}
        }
      };
      await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
    };

    (async () => {
      const setFn = (k: string, url: string) => { if (!cancelled) setStartPreviews((prev) => ({ ...prev, [k]: url })); };
      // Start built-in renders immediately — don't wait for API call
      const builtinRender = runConcurrent(BUILTIN_START_ITEMS.map((i) => ({ key: i.key, design: i.design })), setFn);
      // Fetch saved templates list (module-level cache: instant on second+ call)
      const templates = await loadTemplatesCached();
      if (cancelled) return;
      setStartTemplates(templates);
      // Render saved template previews concurrently with built-in — not after
      await Promise.all([
        builtinRender,
        templates.length > 0 ? runConcurrent(templates.map((t) => ({ key: t.id, tpl: t })), setFn) : Promise.resolve(),
      ]);
    })();
    return () => { cancelled = true; };
  }, [isStartScreen]);

  // ── History tracking ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isUndoRedoRef.current) { isUndoRedoRef.current = false; return; }
    const timer = setTimeout(() => {
      historyStackRef.current = [...historyStackRef.current.slice(0, historyIndexRef.current + 1), design].slice(-50);
      historyIndexRef.current = historyStackRef.current.length - 1;
      setHistoryTick((t) => t + 1);
    }, 400);
    return () => clearTimeout(timer);
  }, [design]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      // Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSaveRef.current(); return; }

      if (isEditing) return;

      // Escape: deselect
      if (e.key === 'Escape') { setSelectedId(null); return; }

      // Delete / Backspace: remove selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        setDesign((prev) => ({
          ...prev,
          texts: prev.texts.filter((t) => t.id !== selectedId),
          logos: prev.logos.filter((l) => l.id !== selectedId),
          shapes: (prev.shapes ?? []).filter((s) => s.id !== selectedId),
          photo: selectedId === '__photo__' ? null : prev.photo,
          qr: selectedId === '__qr__' ? null : prev.qr,
        }));
        setSelectedId(null);
        return;
      }

      // Arrow keys: nudge selected element by 1px (10px with Shift)
      const delta = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0;
      const dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0;
      if ((dx !== 0 || dy !== 0) && selectedId) {
        e.preventDefault();
        setDesign((prev) => {
          const sid = selectedId;
          const text = prev.texts.find((t) => t.id === sid);
          if (text) return { ...prev, texts: prev.texts.map((t) => t.id === sid ? { ...t, x: Math.max(0, t.x + dx), y: Math.max(0, t.y + dy) } : t) };
          const logo = prev.logos.find((l) => l.id === sid);
          if (logo) return { ...prev, logos: prev.logos.map((l) => l.id === sid ? { ...l, x: Math.max(0, l.x + dx), y: Math.max(0, l.y + dy) } : l) };
          const shape = (prev.shapes ?? []).find((s) => s.id === sid);
          if (shape) return { ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === sid ? { ...s, x: Math.max(0, s.x + dx), y: Math.max(0, s.y + dy) } : s) };
          if (sid === '__photo__' && prev.photo) return { ...prev, photo: { ...prev.photo, x: Math.max(0, prev.photo.x + dx), y: Math.max(0, prev.photo.y + dy) } };
          if (sid === '__qr__' && prev.qr) return { ...prev, qr: { ...prev.qr, x: Math.max(0, prev.qr.x + dx), y: Math.max(0, prev.qr.y + dy) } };
          return prev;
        });
      }

      // Ctrl+D: duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedId) {
        e.preventDefault();
        ctxDuplicateRef.current(selectedId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedId]);

  // ── Auto-save ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFirstRenderRef.current) { isFirstRenderRef.current = false; return; }
    setAutoSaveStatus('saving');
    const timer = setTimeout(() => {
      saveDesign(design);
      if (!isLoadingRef.current) syncToServer(design);
      setAutoSaveStatus('saved');
      const reset = setTimeout(() => setAutoSaveStatus('idle'), 2500);
      return () => clearTimeout(reset);
    }, 1500);
    return () => { clearTimeout(timer); };
  }, [design, syncToServer]);

  // ── Close menus on outside click ─────────────────────────────────────────
  useEffect(() => {
    if (!contextMenu) return;
    const h = () => closeContextMenu();
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [contextMenu, closeContextMenu]);

  useEffect(() => {
    if (!showExportMenu) return;
    const h = () => setShowExportMenu(false);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [showExportMenu]);

  // ── Template picker: generate previews ───────────────────────────────────
  useEffect(() => {
    if (!showTemplatePicker) return;
    let cancelled = false;
    const CACHE_KEY = 'wattaman_thumb_v2';
    const thumbScale = (d: CardDesign) => d.width > 500 ? 0.28 : 0.5;

    // Pre-populate from start screen previews so built-in + saved thumbs appear instantly
    if (Object.keys(startPreviews).length > 0) {
      setTemplatePreviews((prev) => ({ ...startPreviews, ...prev }));
    }

    // Batch-populate ALL known preview hits in one synchronous pass (memory cache first, then sessionStorage)
    {
      const batchHits: Record<string, string> = {};
      for (const i of BUILTIN_START_ITEMS) {
        const url = _previewUrlMemCache[i.key] ?? sessionStorage.getItem(`${CACHE_KEY}:${i.key}`);
        if (url) { batchHits[i.key] = url; _previewUrlMemCache[i.key] = url; }
      }
      const knownSaved = savedTemplates.length > 0 ? savedTemplates : startTemplates;
      for (const t of knownSaved) {
        const url = _previewUrlMemCache[t.id] ?? sessionStorage.getItem(`${CACHE_KEY}:${t.id}`);
        if (url) { batchHits[t.id] = url; _previewUrlMemCache[t.id] = url; }
      }
      if (Object.keys(batchHits).length > 0) {
        setTemplatePreviews((prev) => ({ ...batchHits, ...prev }));
      }
    }

    const runConcurrent = async (
      items: { key: string; design?: CardDesign; tpl?: SavedTemplate }[],
      limit = 3,
    ) => {
      const queue = [...items];
      const worker = async () => {
        while (queue.length && !cancelled) {
          const item = queue.shift()!;
          // Check memory cache first (fastest), then sessionStorage, then render
          const memHit = _previewUrlMemCache[item.key];
          if (memHit) { if (!cancelled) setTemplatePreviews((p) => ({ ...p, [item.key]: memHit })); continue; }
          const ssHit = sessionStorage.getItem(`${CACHE_KEY}:${item.key}`);
          if (ssHit) { _previewUrlMemCache[item.key] = ssHit; if (!cancelled) setTemplatePreviews((p) => ({ ...p, [item.key]: ssHit })); continue; }
          // Only yield before expensive canvas renders
          await new Promise<void>((r) => setTimeout(r, 0));
          if (cancelled) break;
          try {
            const design = item.design ?? (item.tpl ? await loadTemplateDesignCached(item.tpl) : null);
            if (!design || cancelled) continue;
            const c = await renderDesignToCanvas(design, { scale: thumbScale(design) });
            const url = c.toDataURL('image/jpeg', 0.5);
            _previewUrlMemCache[item.key] = url;
            try { sessionStorage.setItem(`${CACHE_KEY}:${item.key}`, url); } catch {}
            if (!cancelled) setTemplatePreviews((p) => ({ ...p, [item.key]: url }));
          } catch {}
        }
      };
      await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    (async () => {
      // Reuse already-loaded template list to skip duplicate API call
      const alreadyLoaded = savedTemplates.length > 0 ? savedTemplates : startTemplates.length > 0 ? startTemplates : null;
      // Start built-in renders immediately — don't block on API or saved renders
      const builtinRender = runConcurrent(BUILTIN_START_ITEMS.map((i) => ({ key: i.key, design: i.design })));
      // Module-level cache makes this instant on second+ call; only hits API on first ever open
      const templates = alreadyLoaded ?? await loadTemplatesCached();
      if (cancelled) return;
      // Ensure loaded flag is set (fallback if eager preload hasn't resolved yet)
      if (!savedTemplatesLoadedRef.current) {
        if (templates.length > 0) setSavedTemplates(templates);
        setSavedTemplatesLoaded(true);
        savedTemplatesLoadedRef.current = true;
      }
      // Render saved template previews concurrently with built-in — not after
      await Promise.all([
        builtinRender,
        templates.length > 0 ? runConcurrent(templates.map((t) => ({ key: t.id, tpl: t }))) : Promise.resolve(),
      ]);
    })();
    return () => { cancelled = true; };
  }, [showTemplatePicker]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable refs for use inside event listeners ────────────────────────────
  const handleSaveRef = useRef<() => void>(() => {});
  const ctxDuplicateRef = useRef<(id: string) => void>(() => {});

  // ── Core helpers ──────────────────────────────────────────────────────────
  const genId = () => Math.random().toString(36).slice(2, 10);
  const getMaxZ = (d: CardDesign) => {
    const all = [...d.texts.map((t) => t.zIndex ?? 0), ...d.logos.map((l) => l.zIndex ?? 0),
      ...(d.shapes ?? []).map((s) => s.zIndex ?? 0), ...(d.photo ? [d.photo.zIndex ?? 0] : []), ...(d.qr ? [d.qr.zIndex ?? 0] : [])];
    return all.length > 0 ? Math.max(...all) : 0;
  };

  // ── Arrange (z-index) ────────────────────────────────────────────────────
  const handleArrange = useCallback((id: string, mode: 'front' | 'forward' | 'backward' | 'back') => {
    setDesign((prev) => {
      const ordered = [
        ...(prev.photo ? [{ id: '__photo__', z: prev.photo.zIndex ?? 0 }] : []),
        ...(prev.qr ? [{ id: '__qr__', z: prev.qr.zIndex ?? 0 }] : []),
        ...(prev.shapes ?? []).map((s) => ({ id: s.id, z: s.zIndex ?? 0 })),
        ...prev.logos.map((l) => ({ id: l.id, z: l.zIndex ?? 0 })),
        ...prev.texts.map((t) => ({ id: t.id, z: t.zIndex ?? 0 })),
      ].sort((a, b) => a.z - b.z);

      const idx = ordered.findIndex((item) => item.id === id);
      if (idx < 0) return prev;
      const [item] = ordered.splice(idx, 1);

      if (mode === 'front') ordered.push(item);
      else if (mode === 'back') ordered.unshift(item);
      else if (mode === 'forward') ordered.splice(Math.min(idx + 1, ordered.length), 0, item);
      else ordered.splice(Math.max(idx - 1, 0), 0, item);

      const zMap: Record<string, number> = {};
      ordered.forEach((el, i) => { zMap[el.id] = i; });
      return {
        ...prev,
        texts: prev.texts.map((t) => ({ ...t, zIndex: zMap[t.id] ?? t.zIndex ?? 0 })),
        logos: prev.logos.map((l) => ({ ...l, zIndex: zMap[l.id] ?? l.zIndex ?? 0 })),
        shapes: (prev.shapes ?? []).map((s) => ({ ...s, zIndex: zMap[s.id] ?? s.zIndex ?? 0 })),
        photo: prev.photo ? { ...prev.photo, zIndex: zMap['__photo__'] ?? prev.photo.zIndex ?? 0 } : null,
        qr: prev.qr ? { ...prev.qr, zIndex: zMap['__qr__'] ?? prev.qr.zIndex ?? 0 } : null,
      };
    });
  }, []);

  // ── Duplicate ─────────────────────────────────────────────────────────────
  const handleDuplicate = useCallback((id: string) => {
    const offset = 12;
    setDesign((prev) => {
      const mz = getMaxZ(prev) + 1;
      const text = prev.texts.find((t) => t.id === id);
      if (text) { const dup = { ...text, id: genId(), x: text.x + offset, y: text.y + offset, zIndex: mz }; setSelectedId(dup.id); return { ...prev, texts: [...prev.texts, dup] }; }
      const logo = prev.logos.find((l) => l.id === id);
      if (logo) { const dup = { ...logo, id: genId(), x: logo.x + offset, y: logo.y + offset, zIndex: mz }; setSelectedId(dup.id); return { ...prev, logos: [...prev.logos, dup] }; }
      const shape = (prev.shapes ?? []).find((s) => s.id === id);
      if (shape) { const dup = { ...shape, id: genId(), x: shape.x + offset, y: shape.y + offset, zIndex: mz }; setSelectedId(dup.id); return { ...prev, shapes: [...(prev.shapes ?? []), dup] }; }
      return prev;
    });
  }, []);

  // ── Delete selected ───────────────────────────────────────────────────────
  const handleDeleteSelected = useCallback((id: string) => {
    setDesign((prev) => ({
      ...prev,
      texts: prev.texts.filter((t) => t.id !== id),
      logos: prev.logos.filter((l) => l.id !== id),
      shapes: (prev.shapes ?? []).filter((s) => s.id !== id),
      photo: id === '__photo__' ? null : prev.photo,
      qr: id === '__qr__' ? null : prev.qr,
    }));
    setSelectedId(null);
  }, []);

  // Keep stable refs up to date
  useEffect(() => { ctxDuplicateRef.current = handleDuplicate; }, [handleDuplicate]);

  // ── Canvas element move/resize handlers ────────────────────────────────────
  const handleMoveText = useCallback((id: string, x: number, y: number) =>
    setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === id ? { ...t, x, y } : t) })), []);
  const handleMoveLogo = useCallback((id: string, x: number, y: number) =>
    setDesign((prev) => ({ ...prev, logos: prev.logos.map((l) => l.id === id ? { ...l, x, y } : l) })), []);
  const handleResizeLogo = useCallback((id: string, changes: Partial<LogoElement>) =>
    setDesign((prev) => ({ ...prev, logos: prev.logos.map((l) => l.id === id ? { ...l, ...changes } : l) })), []);
  const handleMoveShape = useCallback((id: string, x: number, y: number) =>
    setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === id ? { ...s, x, y } : s) })), []);
  const handleResizeShape = useCallback((id: string, changes: Partial<ShapeElement>) =>
    setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === id ? { ...s, ...changes } : s) })), []);
  const handleMovePhoto = useCallback((x: number, y: number) =>
    setDesign((prev) => prev.photo ? { ...prev, photo: { ...prev.photo, x, y } } : prev), []);
  const handleResizePhoto = useCallback((changes: Partial<PhotoPlaceholder>) =>
    setDesign((prev) => prev.photo ? { ...prev, photo: { ...prev.photo, ...changes } } : prev), []);
  const handleMoveQr = useCallback((x: number, y: number) =>
    setDesign((prev) => prev.qr ? { ...prev, qr: { ...prev.qr, x, y } } : prev), []);
  const handleResizeQr = useCallback((changes: Partial<QrPlaceholder>) =>
    setDesign((prev) => prev.qr ? { ...prev, qr: { ...prev.qr, ...changes } } : prev), []);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExportPNG = async () => {
    setExporting('png'); setShowExportMenu(false);
    try {
      const canvas = await renderDesignToCanvas(design);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
      if (!blob) { alert('Failed to generate image.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${design.cardType}-card-design.png`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Export failed. Please try again.'); }
    finally { setExporting(null); }
  };

  const handleExportPDF = async () => {
    setExporting('pdf'); setShowExportMenu(false);
    try { await downloadSingleCardPDF(design, { name: `${design.cardType}-card-design`, fieldValues: {} }); }
    catch { alert('Export failed. Please try again.'); }
    finally { setExporting(null); }
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    saveDesign(design); syncToServer(design);
    setSaved(true); setAutoSaveStatus('saved');
    setTimeout(() => { setSaved(false); setAutoSaveStatus('idle'); }, 2000);
    onSave?.();
  }, [design, syncToServer, onSave]);

  // Update stable ref
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // ── Save as template ──────────────────────────────────────────────────────
  const handleSaveAsTemplate = async () => {
    const name = templateName.trim();
    if (!name) return;
    const newTemplate = await apiSaveTemplate(name, design);
    // Invalidate module cache so next open fetches fresh list
    invalidateTemplateListCache();
    if (newTemplate) {
      // Prime the design cache so opening the new template is instant
      if (newTemplate.design) _designMemCache[newTemplate.id] = newTemplate.design;
      // Immediately append to both state lists so picker shows it without re-fetch
      setSavedTemplates((prev) => [...prev, newTemplate]);
      setStartTemplates((prev) => [...prev, newTemplate]);
    }
    setTemplateName(''); setShowSaveTemplate(false);
  };

  // ── Apply template ────────────────────────────────────────────────────────
  const handleApplyTemplate = useCallback((d: CardDesign, source?: { id?: string; name: string }) => {
    const copy = JSON.parse(JSON.stringify(d)) as CardDesign;
    // Stamp provenance so every admin sees which template is currently in use
    copy._appliedFrom = source
      ? { id: source.id, name: source.name, appliedAt: new Date().toISOString() }
      : null;
    isLoadingRef.current = false;
    setDesign(copy); setSelectedId(null); setShowTemplatePicker(false);
    setIsStartScreen(false);
    saveDesign(copy); syncToServer(copy);
  }, [syncToServer]);

  const handleLoadTemplate = async (tpl: SavedTemplate) => {
    // Design is fetched on demand because the list API call omits it for speed.
    const design = await loadTemplateDesignCached(tpl);
    if (!design) return;
    handleApplyTemplate(design, { id: tpl.id, name: tpl.name });
  };
  const handleDeleteTemplate = async (id: string) => {
    await apiDeleteTemplate(id);
    invalidateTemplateListCache();
    setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
    setStartTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  // Open the picker but first refresh the template list so admins always see templates saved by their peers.
  const openTemplatePicker = useCallback(() => {
    invalidateTemplateListCache();
    setShowTemplatePicker(true);
    apiLoadTemplates().then((templates) => {
      setSavedTemplates(templates);
      setSavedTemplatesLoaded(true);
    }).catch(() => { /* picker still renders cached results */ });
  }, []);

  // ── Card type switch ──────────────────────────────────────────────────────
  const handleCardTypeChange = (type: CardType) => {
    // Workspace lock: ignore switches that would leave the locked type.
    if (initialCardType && type !== initialCardType) return;
    isLoadingRef.current = true;
    setIsStartScreen(false);
    const sd = loadSavedDesign(type);
    setDesign(sd ?? TEMPLATES[type] ?? BLANK_TEMPLATE); setSelectedId(null);
    apiGetActiveDesign(type).then((d) => { if (d) { saveDesign(d); setDesign(d); } })
      .finally(() => { setTimeout(() => { isLoadingRef.current = false; }, 2000); });
  };

  // ── Reset / Clear ─────────────────────────────────────────────────────────
  const handleReset = () => {
    const base = TEMPLATES[design.cardType] ?? TEMPLATES[initialCardType as CardType] ?? BLANK_TEMPLATE;
    // For locked workspaces, ensure the reset design keeps the locked cardType
    const resetDesign = initialCardType && base.cardType !== initialCardType
      ? { ...base, cardType: initialCardType as CardType }
      : base;
    setDesign(resetDesign); setSelectedId(null);
  };
  const handleClearCache = () => {
    clearAllCache();
    setDesign(STUDENT_TEMPLATE); setSelectedId(null); setSavedTemplates([]);
    isFirstRenderRef.current = true; // ensure next change gets auto-saved properly
    setAutoSaveStatus('idle'); setShowClearCache(false);
  };

  // ── Context menu (right-click canvas) ────────────────────────────────────
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent, id: string | null) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 228);
    const y = Math.min(e.clientY, window.innerHeight - (id ? 348 : 228));
    setContextMenu({ x, y, targetId: id });
    if (id) setSelectedId(id);
  }, []);

  const ctxArrange = (id: string, mode: 'front' | 'forward' | 'backward' | 'back') => { handleArrange(id, mode); closeContextMenu(); };

  // Context menu: add text
  const ctxAddText = () => {
    const n: TextElement = {
      id: genId(), content: 'New Text', x: 20, y: 20 + design.texts.length * 30,
      fontSize: 16, color: '#1e293b', fontWeight: 'normal', fontStyle: 'normal',
      textAlign: 'left', fontFamily: 'Inter, sans-serif', zIndex: getMaxZ(design) + 1,
    };
    setDesign((prev) => ({ ...prev, texts: [...prev.texts, n] }));
    setSelectedId(n.id); closeContextMenu();
  };

  /** Drop handler invoked from <CardCanvas> when a Field is dragged from the Toolbar.
   *  (x, y) arrive in design (unscaled) pixels and represent the cursor position;
   *  we offset slightly so the inserted text is centered near the drop point. */
  const handleDropField = useCallback((fieldKey: string, x: number, y: number) => {
    const fontSize = 13;
    const approxWidth = fieldKey.length * fontSize * 0.55; // rough text width estimate
    const offsetX = Math.max(0, x - approxWidth / 2);
    const offsetY = Math.max(0, y - fontSize / 2);
    setDesign((prev) => {
      const n: TextElement = {
        id: genId(), content: fieldKey, x: offsetX, y: offsetY,
        fontSize, color: prev.frameColor || '#1e293b', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'left', fontFamily: 'Inter, sans-serif', zIndex: getMaxZ(prev) + 1,
      };
      setSelectedId(n.id);
      return { ...prev, texts: [...prev.texts, n] };
    });
  }, []);

  // Context menu: add shape
  const ctxAddShape = (type: 'rectangle' | 'circle' | 'line') => {
    const n: ShapeElement = {
      id: genId(), type, x: 20, y: 20 + (design.shapes ?? []).length * 20,
      width: type === 'line' ? 120 : 80, height: type === 'line' ? 4 : 60,
      color: '#4f46e5', borderColor: '#1e293b', borderWidth: type === 'line' ? 2 : 0,
      borderRadius: type === 'circle' ? 9999 : 8, opacity: 1, rotation: 0,
      zIndex: getMaxZ(design) + 1, lineStyle: type === 'line' ? 'solid' : undefined,
      gradient: { enabled: false, type: 'linear', angle: 90, stops: [{ offset: 0, color: '#4f46e5' }, { offset: 1, color: '#06b6d4' }] },
    };
    setDesign((prev) => ({ ...prev, shapes: [...(prev.shapes ?? []), n] }));
    setSelectedId(n.id); closeContextMenu();
  };

  // ── Computed preview design ────────────────────────────────────────────────
  const previewDesign: CardDesign = isPreviewMode
    ? { ...design, texts: design.texts.map((t) => ({ ...t, content: applyPreviewData(t.content) })) }
    : design;

  // Generate a real sample QR code when entering preview mode so the QR placeholder
  // shows scannable imagery instead of an empty box.
  useEffect(() => {
    if (!isPreviewMode) return;
    let cancelled = false;
    const sampleValue = PREVIEW_DATA.qrCode || PREVIEW_DATA['Student ID'] || 'WATTAMAN-PREVIEW';
    QRCode.toDataURL(sampleValue, { width: 256, margin: 1 })
      .then((url) => { if (!cancelled) setPreviewQrUrl(url); })
      .catch(() => { /* fall back to placeholder rendering */ });
    return () => { cancelled = true; };
  }, [isPreviewMode]);

  // ── Real-data preview render ─────────────────────────────────────────────
  // When preview mode is enabled, fetch a real staff/student record and render
  // the card via the SAME renderer used for printing — so what you see in the
  // editor matches the printed/exported card pixel-for-pixel.
  useEffect(() => {
    if (!isPreviewMode) {
      setPreviewImageUrl(null);
      setPreviewSubject(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);

    const buildSampleFieldValues = (subject: { name: string; id: string; subtitle: string; phone?: string; email?: string; khmerName?: string; short?: string; subjects?: string; sex?: string; weeklyLessons?: number }): Record<string, string> => ({
      'Staff Name': subject.name, 'Student Name': subject.name,
      'Emp ID': subject.id, 'Student ID': subject.id, 'ID': subject.id,
      'Position': subject.subtitle, 'Class Name': subject.subtitle, 'Class': subject.subtitle,
      'Phone': subject.phone || '', 'Email': subject.email || '',
      '{{name}}': subject.name,
      '{{email}}': subject.email || '',
      '{{phone}}': subject.phone || '',
      '{{role}}': subject.subtitle,
      '{{class}}': subject.subtitle,
      '{{department}}': subject.subtitle,
      '{{employeeId}}': subject.id,
      '{{studentNumber}}': subject.id,
      '{{qrCode}}': subject.id,
      // TPT fields — populated from timetable teacher data
      '{{khmerName}}': subject.khmerName || '',
      '{{short}}': subject.short || subject.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 3),
      '{{timetableName}}': subject.subtitle,
      '{{subjects}}': subject.subjects || '',
      '{{sex}}': subject.sex || '',
      '{{weeklyLessons}}': subject.weeklyLessons !== undefined ? String(subject.weeklyLessons) : '',
    });

    const fetchSubject = async (): Promise<{ name: string; id: string; subtitle: string; phone?: string; email?: string; photo?: string | null; khmerName?: string; short?: string; subjects?: string; sex?: string; weeklyLessons?: number } | null> => {
      try {
        const isStudent = design.cardType === 'student' || design.cardType === 'certificate-student';
        if (isStudent) {
          // First class with students wins. The student-cards page uses the same pattern.
          const yrRes = await apiFetch('/api/study-years');
          const yrs = yrRes.ok ? await yrRes.json() : [];
          const currentYr = yrs.find((y: { isCurrent: boolean }) => y.isCurrent) || yrs[0];
          if (!currentYr) return null;
          const clsRes = await apiFetch(`/api/classes?studyYearId=${currentYr.id}`);
          const classes = clsRes.ok ? await clsRes.json() : [];
          for (const cls of classes) {
            const studRes = await apiFetch(`/api/classes/${cls.id}/students`);
            const studs = studRes.ok ? await studRes.json() : [];
            if (studs.length > 0) {
              const s = studs[0];
              return {
                name: s.name, id: s.studentNumber || s.qrCode || s.id,
                subtitle: cls.name, phone: s.phone, email: s.email, photo: s.photo,
              };
            }
          }
          return null;
        }
        // Part-time teacher (timetable teacher)
        if (design.cardType === 'teacher-part-time') {
          const res = await apiFetch('/api/timetable/scheduled-teachers/all');
          const all = res.ok ? await res.json() : [];
          const tpt = all[0];
          if (!tpt) return null;
          const subjects = [...new Set((tpt.lessons ?? []).map((l: { subjectName: string }) => l.subjectName).filter(Boolean))].join(', ');
          return {
            name: tpt.name,
            id: tpt.qrCode || tpt.id,
            subtitle: tpt.timetableName || 'Part-Time Teacher',
            photo: tpt.photo ?? null,
            khmerName: tpt.khmerName || '',
            short: tpt.short || '',
            subjects,
            sex: tpt.sex || '',
            weeklyLessons: tpt.weeklyLessons ?? 0,
          };
        }
        // Staff
        const res = await apiFetch('/api/auth/users');
        const all = res.ok ? await res.json() : [];
        const staff = all.find((u: { role: string }) => u.role !== 'STUDENT' && u.role !== 'PARENT');
        if (!staff) return null;
        return {
          name: staff.name, id: staff.employeeId || staff.id,
          subtitle: staff.role || 'Staff',
          phone: staff.phone, email: staff.email, photo: staff.photo,
        };
      } catch { return null; }
    };

    (async () => {
      const real = await fetchSubject();
      if (cancelled) return;
      const subject = real ?? {
        name: PREVIEW_DATA.name, id: PREVIEW_DATA.studentNumber,
        subtitle: PREVIEW_DATA.class, phone: PREVIEW_DATA.phone, email: PREVIEW_DATA.email,
        photo: null as string | null,
      };
      setPreviewSubject(real ? `${real.name} · ${real.subtitle}` : 'Sample data');
      try {
        const qrDataUrl = await QRCode.toDataURL(subject.id || 'WATTAMAN-PREVIEW', { width: 400, margin: 1 });
        const canvas = await renderDesignToCanvas(design, {
          fieldValues: buildSampleFieldValues(subject),
          qrDataUrl,
          photoUrl: subject.photo ?? null,
          scale: 2,
        });
        if (!cancelled) setPreviewImageUrl(canvas.toDataURL('image/png'));
      } catch (err) {
        console.error('Preview render failed:', err);
        if (!cancelled) setPreviewImageUrl(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // Re-render preview whenever the design changes while in preview mode
  }, [isPreviewMode, design]);

  // ── Selected element info (for floating property bar) ─────────────────────
  const selText = design.texts.find((t) => t.id === selectedId);
  const selLogo = design.logos.find((l) => l.id === selectedId);
  const selShape = (design.shapes ?? []).find((s) => s.id === selectedId);
  const selPhoto = selectedId === '__photo__' ? design.photo : null;
  const selQr = selectedId === '__qr__' ? design.qr : null;

  const selLabel = selText ? `Text: "${selText.content.slice(0, 20)}"` :
    selLogo ? `Image: ${selLogo.name}` :
    selShape ? `${selShape.type.charAt(0).toUpperCase() + selShape.type.slice(1)}` :
    selPhoto ? 'Photo Placeholder' :
    selQr ? 'QR Code' : null;

  const selPos = selText ? `${Math.round(selText.x)}, ${Math.round(selText.y)}` :
    selLogo ? `${Math.round(selLogo.x)}, ${Math.round(selLogo.y)}` :
    selShape ? `${Math.round(selShape.x)}, ${Math.round(selShape.y)}` :
    selPhoto ? `${Math.round(selPhoto.x)}, ${Math.round(selPhoto.y)}` :
    selQr ? `${Math.round(selQr.x)}, ${Math.round(selQr.y)}` : null;

  const isCertMode = design.cardType === 'certificate-student' || design.cardType === 'certificate-staff';
  // When CardEditor is mounted from a dedicated workspace page (staff-only or
  // student-only), `initialCardType` is supplied and we lock the editor to that
  // type — no type switcher, template picker filtered to the locked type only.
  const lockedType: CardType | null = initialCardType ?? null;
  const lockedTypeLabel = lockedType === 'student' ? 'Student ID Card'
    : lockedType === 'staff' ? 'Staff ID Card'
    : lockedType === 'teacher-part-time' ? 'TPT ID Card'
    : lockedType === 'certificate-student' ? 'Student Certificate'
    : lockedType === 'certificate-staff' ? 'Staff Certificate'
    : null;
  const lockedTypeIcon = lockedType === 'student' ? '🎓'
    : lockedType === 'staff' ? '👨‍🏫'
    : lockedType === 'teacher-part-time' ? '⏰'
    : lockedType === 'certificate-student' ? '📜'
    : lockedType === 'certificate-staff' ? '🏅'
    : null;

  return (
    <div className="flex flex-col bg-[#1a1a1a] h-full">

      {isStartScreen ? (
        <StartScreen
          previews={startPreviews}
          savedTemplates={startTemplates}
          onNewStudent={() => router.push('/admin/card-designer/student')}
          onNewStaff={() => router.push('/admin/card-designer/staff')}
          onNewTPT={() => router.push('/admin/card-designer/teacher-part-time')}
          onNewStudentCert={() => handleCardTypeChange('certificate-student')}
          onNewStaffCert={() => handleCardTypeChange('certificate-staff')}
          onOpen={(d) => handleApplyTemplate(d)}
          onOpenTemplate={handleLoadTemplate}
        />
      ) : (<>

      {/* ── TOP TOOLBAR ──────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center flex-wrap gap-0 bg-[#1e1e1e] border-b border-[#383838] px-2 py-1 min-h-[42px] z-10">

        {/* File group */}
        <TopBtn icon={<Icons.New />} label="New" onClick={() => setShowNewProject(true)} />
        <TopBtn icon={<Icons.Save />} label="Save" title="Save (Ctrl+S)" onClick={handleSave} active={saved} variant={saved ? 'emerald' : 'default'} />
        <Divider />

        {/* History */}
        <TopBtn icon={<Icons.Undo />} label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <TopBtn icon={<Icons.Redo />} label="Redo" title="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo} />
        <Divider />

        {/* Card type switcher (mode-aware) — hidden when workspace is locked to one type */}
        {lockedType ? (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#444] bg-[#1f1f1f] text-[11px] font-medium text-white shrink-0"
            title={`Locked workspace · ${lockedTypeLabel}`}
          >
            <span className="text-[13px] leading-none">{lockedTypeIcon}</span>
            <span className="hidden sm:inline">{lockedTypeLabel}</span>
            <span className="text-[9px] text-[#777] ml-1">🔒</span>
          </div>
        ) : isCertMode ? (
          <div className="flex rounded border border-[#444] overflow-hidden shrink-0 text-[11px] font-medium">
            <button onClick={() => handleCardTypeChange('certificate-student')} title="Student Certificate"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${design.cardType === 'certificate-student' ? 'bg-violet-600 text-white' : 'text-[#999] hover:bg-[#333] hover:text-white'}`}>
              <span className="text-[13px] leading-none">📜</span> <span className="hidden sm:inline">Stu. Cert</span>
            </button>
            <button onClick={() => handleCardTypeChange('certificate-staff')} title="Staff Certificate"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors border-l border-[#444] ${design.cardType === 'certificate-staff' ? 'bg-amber-600 text-white' : 'text-[#999] hover:bg-[#333] hover:text-white'}`}>
              <span className="text-[13px] leading-none">🏅</span> <span className="hidden sm:inline">Stf. Cert</span>
            </button>
          </div>
        ) : (
          <div className="flex rounded border border-[#444] overflow-hidden shrink-0 text-[11px] font-medium">
            <button onClick={() => handleCardTypeChange('student')} title="Student ID Card"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${design.cardType === 'student' ? 'bg-indigo-600 text-white' : 'text-[#999] hover:bg-[#333] hover:text-white'}`}>
              <Icons.Student /> <span className="hidden sm:inline">Student</span>
            </button>
            <button onClick={() => handleCardTypeChange('staff')} title="Staff ID Card"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors border-l border-[#444] ${design.cardType === 'staff' ? 'bg-emerald-600 text-white' : 'text-[#999] hover:bg-[#333] hover:text-white'}`}>
              <Icons.Staff /> <span className="hidden sm:inline">Staff</span>
            </button>
          </div>
        )}
        <Divider />

        {/* Design */}
        <TopBtn icon={<Icons.Templates />} label="Templates" onClick={openTemplatePicker} variant="amber" />
        {design._appliedFrom?.name && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-emerald-700/60 bg-emerald-600/15 text-[11px] font-medium text-emerald-300 shrink-0 max-w-[180px]"
            title={`Currently applied template: ${design._appliedFrom.name}${design._appliedFrom.appliedAt ? ` (applied ${new Date(design._appliedFrom.appliedAt).toLocaleString()})` : ''}`}
          >
            <span className="text-[10px] leading-none">✓</span>
            <span className="hidden sm:inline truncate">{design._appliedFrom.name}</span>
          </div>
        )}

        {/* Export */}
        <div className="relative">
          <TopBtn icon={exporting ? <Icons.Spinner /> : <Icons.Export />} label={exporting ? 'Exporting…' : 'Export'} onClick={(e) => { e.stopPropagation(); setShowExportMenu((v) => !v); }} disabled={!!exporting} variant="indigo" active={showExportMenu} />
          {showExportMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#2a2a2a] rounded-lg shadow-2xl border border-[#444] py-1 z-50 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
              <button onClick={handleExportPNG} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#ccc] hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors text-left"><Icons.ExportPng /> Export PNG</button>
              <button onClick={handleExportPDF} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#ccc] hover:bg-red-600/20 hover:text-red-300 transition-colors text-left"><Icons.ExportPdf /> Export PDF</button>
            </div>
          )}
        </div>
        <TopBtn icon={<Icons.Print />} label="Print" title="Print cards with real data" onClick={() => router.push(initialCardType === 'teacher-part-time' ? '/admin/card-designer/print?mode=teacher-part-time' : '/admin/card-designer/print')} variant="violet" />
        <Divider />

        {/* View */}
        <TopBtn icon={<Icons.Grid />} label={showGrid ? 'Grid On' : 'Grid'} title="Toggle Grid" onClick={() => setShowGrid((v) => !v)} active={showGrid} variant={showGrid ? 'indigo' : 'default'} />
        <TopBtn icon={<Icons.Preview />} label={isPreviewMode ? 'Exit Preview' : 'Preview'} title="Toggle preview mode" onClick={() => { setIsPreviewMode((v) => !v); setSelectedId(null); }} active={isPreviewMode} variant={isPreviewMode ? 'violet' : 'default'} />
        <Divider />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right-side utility */}
        <TopBtn icon={<Icons.AsTemplate />} label="As Template" title="Save as template" onClick={() => setShowSaveTemplate(true)} />
        <TopBtn icon={<Icons.Reset />} label="Reset" title="Reset to default template" onClick={handleReset} />
        <TopBtn icon={<Icons.Trash />} label="Clear All" title="Clear all saved designs" onClick={() => setShowClearCache(true)} variant="danger" />
      </div>

      {/* Preview mode banner */}
      {isPreviewMode && (
        <div className="shrink-0 flex items-center justify-between bg-violet-600 text-white px-4 py-1 text-sm z-10">
          <span className="flex items-center gap-2 text-xs">
              <Icons.Preview />
              <span className="font-semibold">Preview Mode</span>
              {previewLoading ? (
                <span className="text-violet-300 flex items-center gap-1"><Icons.Spinner /> Loading real data…</span>
              ) : previewSubject && previewSubject !== 'Sample data' ? (
                <span className="text-violet-200">— Showing: <span className="text-white font-medium">{previewSubject}</span>. Canvas is read-only.</span>
              ) : (
                <span className="text-violet-200">— {`{{placeholders}}`} replaced with sample data. Canvas is read-only.</span>
              )}
            </span>
          <button onClick={() => setIsPreviewMode(false)} className="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium transition-colors">Exit</button>
        </div>
      )}

      {/* ── CONTEXTUAL PROPERTY BAR (Canva-style) ───────────────────────── */}
      {selectedId && !isPreviewMode && selLabel && (
        <div className="shrink-0 flex items-center gap-1.5 bg-[#252525] border-b border-[#383838] px-3 py-1.5 z-10 overflow-x-auto">

          {/* Element badge */}
          <span className="text-[9px] font-bold uppercase tracking-widest text-white bg-indigo-600 rounded px-1.5 py-0.5 shrink-0 font-mono">
            {selText ? 'T' : selShape ? selShape.type[0].toUpperCase() : selLogo ? 'Img' : selPhoto ? 'Ph' : selQr ? 'QR' : '?'}
          </span>

          {/* ── TEXT PROPERTIES ── */}
          {selText && (
            <>
              {/* Font family */}
              <select
                value={selText.fontFamily ?? 'Inter, sans-serif'}
                onChange={(e) => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, fontFamily: e.target.value } : t) }))}
                className="text-xs border border-[#444] rounded px-1.5 py-1 bg-[#333] text-[#ddd] shrink-0 max-w-[110px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                title="Font Family"
              >
                {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>

              {/* Font size */}
              <div className="flex items-center border border-[#444] rounded overflow-hidden shrink-0">
                <button
                  onClick={() => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, fontSize: Math.max(6, t.fontSize - 1) } : t) }))}
                  className="px-1.5 py-1 text-[#888] hover:bg-[#3a3a3a] hover:text-white text-xs font-bold transition-colors"
                  title="Decrease font size"
                >−</button>
                <input
                  type="number"
                  min={6} max={200}
                  value={selText.fontSize}
                  onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 6) setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, fontSize: v } : t) })); }}
                  className="w-9 text-center text-xs py-1 border-0 outline-none text-[#ddd] bg-[#333]"
                  title="Font Size"
                />
                <button
                  onClick={() => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, fontSize: Math.min(200, t.fontSize + 1) } : t) }))}
                  className="px-1.5 py-1 text-[#888] hover:bg-[#3a3a3a] hover:text-white text-xs font-bold transition-colors"
                  title="Increase font size"
                >+</button>
              </div>

              {/* Bold */}
              <button
                onClick={() => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, fontWeight: t.fontWeight === 'bold' ? 'normal' : 'bold' } : t) }))}
                title="Bold (B)"
                className={`text-xs font-bold w-7 h-7 rounded border transition-colors shrink-0 ${
                  selText.fontWeight === 'bold' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-[#444] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                }`}
              >B</button>

              {/* Italic */}
              <button
                onClick={() => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, fontStyle: t.fontStyle === 'italic' ? 'normal' : 'italic' } : t) }))}
                title="Italic (I)"
                className={`text-xs italic font-semibold w-7 h-7 rounded border transition-colors shrink-0 ${
                  selText.fontStyle === 'italic' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-[#444] text-[#999] hover:bg-[#3a3a3a] hover:text-white'
                }`}
              >I</button>

              {/* Text Align */}
              <div className="flex border border-[#444] rounded overflow-hidden shrink-0">
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button
                    key={align}
                    onClick={() => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, textAlign: align } : t) }))}
                    title={`Align ${align}`}
                    className={`w-7 h-7 flex items-center justify-center transition-colors ${
                      selText.textAlign === align ? 'bg-indigo-600 text-white' : 'text-[#888] hover:bg-[#3a3a3a] hover:text-white'
                    }`}
                  >
                    {align === 'left' && (
                      <svg viewBox="0 0 12 10" className="w-3.5 h-3.5" fill="currentColor">
                        <rect x="0" y="0" width="12" height="2"/><rect x="0" y="4" width="8" height="2"/><rect x="0" y="8" width="10" height="2"/>
                      </svg>
                    )}
                    {align === 'center' && (
                      <svg viewBox="0 0 12 10" className="w-3.5 h-3.5" fill="currentColor">
                        <rect x="0" y="0" width="12" height="2"/><rect x="2" y="4" width="8" height="2"/><rect x="1" y="8" width="10" height="2"/>
                      </svg>
                    )}
                    {align === 'right' && (
                      <svg viewBox="0 0 12 10" className="w-3.5 h-3.5" fill="currentColor">
                        <rect x="0" y="0" width="12" height="2"/><rect x="4" y="4" width="8" height="2"/><rect x="2" y="8" width="10" height="2"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              {/* Text color */}
              <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Text Color">
                <span className="text-xs text-[#888]">A</span>
                <div className="relative">
                  <div className="w-6 h-6 rounded border border-[#555] overflow-hidden" style={{ backgroundColor: selText.color }}>
                    <input
                      type="color"
                      value={selText.color}
                      onChange={(e) => setDesign((prev) => ({ ...prev, texts: prev.texts.map((t) => t.id === selectedId ? { ...t, color: e.target.value } : t) }))}
                      className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                    />
                  </div>
                </div>
              </label>
            </>
          )}

          {/* ── SHAPE PROPERTIES ── */}
          {selShape && (
            <>
              {/* Fill color */}
              <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Fill Color">
                <span className="text-xs text-[#888]">Fill</span>
                <div className="relative">
                  <div className="w-6 h-6 rounded border border-[#555] overflow-hidden" style={{ backgroundColor: selShape.color }}>
                    <input
                      type="color"
                      value={selShape.color}
                      onChange={(e) => setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === selectedId ? { ...s, color: e.target.value } : s) }))}
                      className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                    />
                  </div>
                </div>
              </label>

              {/* Opacity */}
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-[#888]">Opacity</span>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={selShape.opacity ?? 1}
                  onChange={(e) => setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === selectedId ? { ...s, opacity: parseFloat(e.target.value) } : s) }))}
                  className="w-16 accent-indigo-500"
                  title={`Opacity: ${Math.round((selShape.opacity ?? 1) * 100)}%`}
                />
                <span className="text-xs text-[#666] w-7">{Math.round((selShape.opacity ?? 1) * 100)}%</span>
              </div>

              {/* Border color */}
              <label className="flex items-center gap-1 shrink-0 cursor-pointer" title="Border Color">
                <span className="text-xs text-[#888]">Border</span>
                <div className="relative">
                  <div className="w-6 h-6 rounded border border-[#555] overflow-hidden" style={{ backgroundColor: selShape.borderColor ?? '#000' }}>
                    <input
                      type="color"
                      value={selShape.borderColor ?? '#000000'}
                      onChange={(e) => setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === selectedId ? { ...s, borderColor: e.target.value } : s) }))}
                      className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                    />
                  </div>
                </div>
              </label>

              {/* Border width */}
              <div className="flex items-center border border-[#444] rounded overflow-hidden shrink-0">
                <button onClick={() => setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === selectedId ? { ...s, borderWidth: Math.max(0, (s.borderWidth ?? 0) - 1) } : s) }))} className="px-1.5 py-1 text-[#888] hover:bg-[#3a3a3a] hover:text-white text-xs font-bold">−</button>
                <span className="w-6 text-center text-xs text-[#ddd]">{selShape.borderWidth ?? 0}</span>
                <button onClick={() => setDesign((prev) => ({ ...prev, shapes: (prev.shapes ?? []).map((s) => s.id === selectedId ? { ...s, borderWidth: Math.min(20, (s.borderWidth ?? 0) + 1) } : s) }))} className="px-1.5 py-1 text-[#888] hover:bg-[#3a3a3a] hover:text-white text-xs font-bold">+</button>
              </div>
            </>
          )}

          {/* ── PHOTO PROPERTIES ── */}
          {selPhoto && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-[#888]">Corner</span>
              <input
                type="range" min={0} max={50} step={1}
                value={selPhoto.borderRadius ?? 0}
                onChange={(e) => setDesign((prev) => prev.photo ? { ...prev, photo: { ...prev.photo, borderRadius: parseInt(e.target.value) } } : prev)}
                className="w-14 accent-indigo-500"
                title={`Border Radius: ${selPhoto.borderRadius ?? 0}px`}
              />
              <span className="text-xs text-[#666] w-5">{selPhoto.borderRadius ?? 0}</span>
            </div>
          )}

          <Divider />

          {/* ── ARRANGE (always) ── */}
          <span className="text-[10px] text-[#666] shrink-0 uppercase tracking-wider">Arrange</span>
          <button onClick={() => handleArrange(selectedId, 'front')} title="Bring to Front" className="text-[11px] px-2 py-0.5 rounded border border-[#444] text-[#999] hover:bg-indigo-600/20 hover:text-indigo-300 hover:border-indigo-600/40 transition-colors shrink-0">⤒ Front</button>
          <button onClick={() => handleArrange(selectedId, 'forward')} title="Move Forward" className="text-[11px] px-2 py-0.5 rounded border border-[#444] text-[#999] hover:bg-indigo-600/20 hover:text-indigo-300 hover:border-indigo-600/40 transition-colors shrink-0">↑ Fwd</button>
          <button onClick={() => handleArrange(selectedId, 'backward')} title="Move Backward" className="text-[11px] px-2 py-0.5 rounded border border-[#444] text-[#999] hover:bg-indigo-600/20 hover:text-indigo-300 hover:border-indigo-600/40 transition-colors shrink-0">↓ Bwd</button>
          <button onClick={() => handleArrange(selectedId, 'back')} title="Send to Back" className="text-[11px] px-2 py-0.5 rounded border border-[#444] text-[#999] hover:bg-indigo-600/20 hover:text-indigo-300 hover:border-indigo-600/40 transition-colors shrink-0">⤓ Back</button>
          <Divider />

          {/* Duplicate & Delete */}
          {selectedId !== '__photo__' && selectedId !== '__qr__' && (
            <button onClick={() => handleDuplicate(selectedId)} title="Duplicate (Ctrl+D)" className="text-[11px] px-2 py-0.5 rounded border border-[#444] text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-colors shrink-0">Dup</button>
          )}
          <button onClick={() => handleDeleteSelected(selectedId)} title="Delete (Del)" className="text-[11px] px-2 py-0.5 rounded border border-red-900/50 text-red-400 hover:bg-red-600/20 transition-colors shrink-0">Del</button>

          <div className="flex-1" />
          <span className="text-[9px] text-[#555] shrink-0 hidden xl:inline tracking-wide">↑↓←→ nudge · Del · Esc deselect</span>
        </div>
      )}

      {/* ── MAIN BODY (3-panel) ───────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT — Design Tools (Toolbar) */}
        <div
          className="shrink-0 bg-[#1a1a1a] border-r border-[#333] flex flex-col transition-all duration-200 overflow-hidden relative"
          style={{ width: isPreviewMode ? 0 : (leftOpen ? 320 : 0) }}
        >
          <div className="w-[320px] flex flex-col h-full">
            <div className="flex-1 min-h-0 overflow-hidden">
              <Toolbar
                design={isPreviewMode ? previewDesign : design}
                selectedId={isPreviewMode ? null : selectedId}
                onDesignChange={isPreviewMode ? () => {} : setDesign}
                onSelect={isPreviewMode ? () => {} : setSelectedId}
                lockedType={lockedType}
              />
            </div>
          </div>
        </div>
        {/* Left toggle button */}
        {!isPreviewMode && <button
          onClick={() => setLeftOpen((v) => !v)}
          title={leftOpen ? 'Collapse Properties' : 'Expand Properties'}
          className="shrink-0 w-4 flex flex-col items-center justify-center bg-[#252525] border-r border-[#333] hover:bg-[#2f2f2f] text-[#555] hover:text-white transition-colors z-10 group"
        >
          <svg viewBox="0 0 8 16" className="w-2.5 h-5 transition-transform" style={{ transform: leftOpen ? 'none' : 'rotate(180deg)' }} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L2 8l4 6" />
          </svg>
        </button>}

        {/* CENTER — Canvas + footer zoom bar */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Canvas scroll area */}
          <div
            className="flex-1 overflow-auto flex items-start justify-center"
            style={{
              padding: 48,
              background: showGrid && !isPreviewMode
                ? `linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px), #2a2a2a`
                : '#2a2a2a',
              backgroundSize: showGrid && !isPreviewMode ? '20px 20px, 20px 20px, auto' : 'auto',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
          >
            <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.15s', filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.6))', position: 'relative' }}>
              {!designReady && (
                <div
                  className="absolute inset-0 z-20 flex items-center justify-center bg-[#2a2a2a]/85 backdrop-blur-sm rounded-xl"
                  style={{ pointerEvents: 'auto' }}
                >
                  <div className="flex flex-col items-center gap-3 text-slate-200">
                    <Icons.Spinner />
                    <span className="text-xs tracking-wide">Loading applied template…</span>
                  </div>
                </div>
              )}
              {isPreviewMode ? (
                <div
                  className="relative flex items-center justify-center bg-white rounded-xl overflow-hidden"
                  style={{ width: design.width, height: design.height }}
                >
                  {previewImageUrl ? (
                    <img
                      src={previewImageUrl}
                      alt="Card preview"
                      draggable={false}
                      className="w-full h-full object-contain pointer-events-none select-none"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-400 text-xs">
                      <Icons.Spinner />
                      <span>{previewLoading ? 'Rendering preview…' : 'Preview unavailable'}</span>
                    </div>
                  )}
                  {previewSubject && (
                    <span className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/55 text-white text-[10px] font-medium tracking-wide pointer-events-none">
                      {previewSubject}
                    </span>
                  )}
                </div>
              ) : (
                <CardCanvas
                  design={design} selectedId={selectedId} onSelect={setSelectedId}
                  onMoveText={handleMoveText} onMoveLogo={handleMoveLogo} onResizeLogo={handleResizeLogo}
                  onMoveShape={handleMoveShape} onResizeShape={handleResizeShape}
                  onMovePhoto={handleMovePhoto} onResizePhoto={handleResizePhoto}
                  onMoveQr={handleMoveQr} onResizeQr={handleResizeQr}
                  onContextMenu={handleCanvasContextMenu}
                  onDropField={handleDropField}
                />
              )}
            </div>
          </div>

          {/* Zoom footer bar */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-[#1a1a1a] border-t border-[#333] select-none">
            <button onClick={() => setZoom((z) => Math.max(25, z - 10))} title="Zoom Out" className="w-6 h-6 flex items-center justify-center rounded text-[#777] hover:bg-[#333] hover:text-white text-sm font-bold transition-colors">−</button>
            <input type="range" min={25} max={200} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28 accent-indigo-500" title={`Zoom: ${zoom}%`} />
            <button onClick={() => setZoom((z) => Math.min(200, z + 10))} title="Zoom In" className="w-6 h-6 flex items-center justify-center rounded text-[#777] hover:bg-[#333] hover:text-white text-sm font-bold transition-colors">+</button>
            <button onClick={() => setZoom(100)} className="text-xs text-[#666] hover:text-white font-mono min-w-[3rem] transition-colors" title="Reset Zoom">{zoom}%</button>
            <div className="flex-1" />
            {/* Save / sync status */}
            {autoSaveStatus === 'saving' && <span className="flex items-center gap-1 text-[10px] text-[#777]"><Icons.Spinner />Saving…</span>}
            {autoSaveStatus === 'saved' && <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Saved</span>}
            {syncStatus === 'syncing' && <span className="flex items-center gap-1 text-[10px] text-indigo-400"><Icons.Sync />Syncing</span>}
            {syncStatus === 'synced' && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Synced</span>}
            {syncStatus === 'error' && <span className="flex items-center gap-1 text-[10px] text-red-400"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /><button onClick={() => syncToServer(design)} className="underline">Retry</button></span>}
            {(autoSaveStatus !== 'idle' || syncStatus !== 'idle') && <span className="text-[#444]">·</span>}
            <span className="text-[10px] text-[#555] hidden md:inline tracking-wide">{design.width}×{design.height}px · {design.cardType}</span>
            {showGrid && <span className="text-[10px] text-indigo-400">Grid on</span>}
          </div>
        </div>

        {/* RIGHT — Layers Panel */}
        {/* Right toggle button */}
        {!isPreviewMode && <button
          onClick={() => setRightOpen((v) => !v)}
          title={rightOpen ? 'Collapse Layers' : 'Expand Layers'}
          className="shrink-0 w-4 flex flex-col items-center justify-center bg-[#252525] border-l border-[#333] hover:bg-[#2f2f2f] text-[#555] hover:text-white transition-colors z-10 group"
        >
          <svg viewBox="0 0 8 16" className="w-2.5 h-5 transition-transform" style={{ transform: rightOpen ? 'none' : 'rotate(180deg)' }} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2l4 6-4 6" />
          </svg>
        </button>}
        <div
          className="shrink-0 transition-all duration-200 overflow-hidden"
          style={{ width: isPreviewMode ? 0 : (rightOpen ? 220 : 0) }}
        >
          <div style={{ width: 220 }}>
            <LayersPanel design={design} selectedId={selectedId} onSelect={setSelectedId} onDesignChange={setDesign} onArrange={handleArrange} />
          </div>
        </div>
      </div>

      </>)}

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* New Project */}
      {showNewProject && (
        <NewProjectDialog onClose={() => setShowNewProject(false)} onCreate={(d) => { handleApplyTemplate(d); setShowNewProject(false); }} />
      )}

      {/* Save as Template */}
      {showSaveTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSaveTemplate(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-4">📋 Save as Template</h3>
            <p className="text-sm text-slate-500 mb-3">Save the current <span className="font-medium text-slate-700">{design.cardType}</span> card design as a reusable template.</p>
            <input type="text" value={templateName} onChange={(e) => setTemplateName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveAsTemplate()} placeholder="Template name…" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4" autoFocus />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSaveTemplate(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleSaveAsTemplate} disabled={!templateName.trim()} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40">Save Template</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Cache Confirm */}
      {showClearCache && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowClearCache(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3"><span className="text-3xl">🧹</span><h3 className="text-lg font-bold text-slate-800">Clear Cache</h3></div>
            <p className="text-sm text-slate-600 mb-2">This will permanently delete:</p>
            <ul className="text-sm text-slate-600 mb-5 list-disc list-inside space-y-1"><li>All saved card designs</li><li>All saved custom templates</li></ul>
            <p className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2 mb-5">⚠️ This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowClearCache(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={handleClearCache} className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors font-medium">Clear Cache</button>
            </div>
          </div>
        </div>
      )}

      {/* Template Picker */}
      {showTemplatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowTemplatePicker(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">🎨 Choose Template</h3>
              <button onClick={() => setShowTemplatePicker(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
            </div>

            {isCertMode ? (
              <>
                {/* Certificate built-in */}
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">📜 Certificate Templates</h4>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {[
                    { key: '__cert_student', d: BLANK_CERTIFICATE_STUDENT, emoji: '📜', label: 'Student Certificate' },
                    { key: '__cert_staff', d: BLANK_CERTIFICATE_STAFF, emoji: '🏅', label: 'Staff Certificate' },
                  ].map(({ key, d: tpl, emoji, label }) => (
                    <TemplateCard key={key} preview={templatePreviews[key]} emoji={emoji} label={label} onClick={() => handleApplyTemplate(tpl)} />
                  ))}
                </div>

                {/* Saved certificate templates */}
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your Saved Certificate Templates</h4>
                {!savedTemplatesLoaded ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="rounded-xl border-2 border-slate-100 bg-white animate-pulse overflow-hidden">
                        <div className="h-28 bg-slate-100" />
                        <div className="p-3 space-y-2"><div className="h-3 bg-slate-100 rounded w-3/4" /><div className="h-2 bg-slate-100 rounded w-1/2" /></div>
                      </div>
                    ))}
                  </div>
                ) : savedTemplates.filter((t) => t.cardType === 'certificate-student' || t.cardType === 'certificate-staff').length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <span className="text-3xl block mb-2">📭</span>
                    <p className="text-sm text-slate-400">No saved certificate templates yet. Click &ldquo;As Template&rdquo; to save one.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {savedTemplates.filter((t) => t.cardType === 'certificate-student' || t.cardType === 'certificate-staff').map((tpl) => {
                      const isActive = design._appliedFrom?.id === tpl.id;
                      return (
                      <div key={tpl.id} className={`rounded-xl border-2 bg-white transition-all relative group overflow-hidden ${isActive ? 'border-emerald-500 ring-2 ring-emerald-300 shadow-md' : 'border-slate-200 hover:border-slate-400'}`}>
                        {isActive && (
                          <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow flex items-center gap-1">✓ Active</span>
                        )}
                        <button onClick={() => handleLoadTemplate(tpl)} className="w-full text-left">
                          <div className="bg-slate-50 flex items-center justify-center p-3 border-b border-slate-100 h-28">
                            {templatePreviews[tpl.id] ? <img src={templatePreviews[tpl.id]} alt={tpl.name} className="rounded-lg shadow-sm max-h-24 object-contain" /> : <span className="text-slate-300 text-xs">Preview</span>}
                          </div>
                          <div className="p-3">
                            <div className="flex items-center gap-2 mb-1"><span>{tpl.cardType === 'certificate-student' ? '📜' : '🏅'}</span><span className="font-semibold text-slate-800 truncate text-sm">{tpl.name}</span></div>
                            <span className="text-[10px] text-slate-400">{new Date(tpl.createdAt).toLocaleDateString()}</span>
                          </div>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* ID Card built-in — hide opposite type when workspace is locked */}
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Built-in</h4>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[{ key: '__builtin_blank', d: BLANK_TEMPLATE, emoji: '📄', label: 'Blank Card', type: null as CardType | null },
                    { key: '__builtin_student', d: STUDENT_TEMPLATE, emoji: '🎓', label: 'Student', type: 'student' as CardType },
                    { key: '__builtin_staff', d: STAFF_TEMPLATE, emoji: '👨‍🏫', label: 'Staff', type: 'staff' as CardType }
                  ].filter(({ type }) => !lockedType || type === null || type === lockedType)
                   .map(({ key, d: tpl, emoji, label, type }) => {
                    // When locked, force the blank template's cardType to match the workspace
                    const finalTpl = lockedType && type === null ? { ...tpl, cardType: lockedType } : tpl;
                    return <TemplateCard key={key} preview={templatePreviews[key]} emoji={emoji} label={label} onClick={() => handleApplyTemplate(finalTpl)} />;
                  })}
                </div>

                {/* Student presets — hidden in staff-locked workspace */}
                {lockedType !== 'staff' && (
                  <>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">🎓 Student Styles</h4>
                    <div className="grid grid-cols-5 gap-2 mb-5">
                      {([
                        { key: '__preset_st1', d: STUDENT_CLASSIC_BLUE, emoji: '🔵', label: 'Classic Blue' },
                        { key: '__preset_st2', d: STUDENT_DARK_NAVY, emoji: '🌌', label: 'Dark Navy' },
                        { key: '__preset_st3', d: STUDENT_SKY_WAVE, emoji: '🌊', label: 'Sky Wave' },
                        { key: '__preset_st4', d: STUDENT_GEOMETRIC, emoji: '🔷', label: 'Geometric' },
                        { key: '__preset_st5', d: STUDENT_MINIMAL, emoji: '⬜', label: 'Minimal' },
                      ] as const).map(({ key, d: tpl, emoji, label }) => (
                        <TemplateCard key={key} preview={templatePreviews[key]} emoji={emoji} label={label} onClick={() => handleApplyTemplate(tpl)} small />
                      ))}
                    </div>
                  </>
                )}

                {/* Staff presets — hidden in student-locked workspace */}
                {lockedType !== 'student' && (
                  <>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">👨‍🏫 Staff Styles</h4>
                    <div className="grid grid-cols-5 gap-2 mb-5">
                      {([
                        { key: '__preset_sf1', d: STAFF_CORPORATE_TEAL, emoji: '🟢', label: 'Corp Teal' },
                        { key: '__preset_sf2', d: STAFF_DEEP_OCEAN, emoji: '🌑', label: 'Deep Ocean' },
                        { key: '__preset_sf3', d: STAFF_ROSE, emoji: '🌸', label: 'Rose Pro' },
                        { key: '__preset_sf4', d: STAFF_FOREST, emoji: '🌿', label: 'Forest' },
                        { key: '__preset_sf5', d: STAFF_SLATE_EXECUTIVE, emoji: '🏛️', label: 'Executive' },
                      ] as const).map(({ key, d: tpl, emoji, label }) => (
                        <TemplateCard key={key} preview={templatePreviews[key]} emoji={emoji} label={label} onClick={() => handleApplyTemplate(tpl)} small />
                      ))}
                    </div>
                  </>
                )}

                {/* Saved ID card templates */}
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your Saved Templates</h4>
                {!savedTemplatesLoaded ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="rounded-xl border-2 border-slate-100 bg-white animate-pulse overflow-hidden">
                        <div className="h-28 bg-slate-100" />
                        <div className="p-3 space-y-2"><div className="h-3 bg-slate-100 rounded w-3/4" /><div className="h-2 bg-slate-100 rounded w-1/2" /></div>
                      </div>
                    ))}
                  </div>
                ) : savedTemplates.filter((t) => lockedType ? t.cardType === lockedType : (t.cardType === 'student' || t.cardType === 'staff')).length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <span className="text-3xl block mb-2">📭</span>
                    <p className="text-sm text-slate-400">No saved templates yet. Click &ldquo;As Template&rdquo; to save one.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {savedTemplates.filter((t) => lockedType ? t.cardType === lockedType : (t.cardType === 'student' || t.cardType === 'staff')).map((tpl) => {
                      const isActive = design._appliedFrom?.id === tpl.id;
                      return (
                      <div key={tpl.id} className={`rounded-xl border-2 bg-white transition-all relative group overflow-hidden ${isActive ? 'border-emerald-500 ring-2 ring-emerald-300 shadow-md' : 'border-slate-200 hover:border-slate-400'}`}>
                        {isActive && (
                          <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow flex items-center gap-1">✓ Active</span>
                        )}
                        <button onClick={() => handleLoadTemplate(tpl)} className="w-full text-left">
                          <div className="bg-slate-50 flex items-center justify-center p-3 border-b border-slate-100 h-28">
                            {templatePreviews[tpl.id] ? <img src={templatePreviews[tpl.id]} alt={tpl.name} className="rounded-lg shadow-sm max-h-24 object-contain" /> : <span className="text-slate-300 text-xs">Preview</span>}
                          </div>
                          <div className="p-3">
                            <div className="flex items-center gap-2 mb-1"><span>{tpl.cardType === 'student' ? '🎓' : '👨‍🏫'}</span><span className="font-semibold text-slate-800 truncate text-sm">{tpl.name}</span></div>
                            <span className="text-[10px] text-slate-400">{new Date(tpl.createdAt).toLocaleDateString()}</span>
                          </div>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU ───────────────────────────────────────────────────── */}
      {contextMenu && (
        <div className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 select-none min-w-[210px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          {contextMenu.targetId && (() => {
            const tid = contextMenu.targetId!;
            const label = tid === '__photo__' ? 'Photo Placeholder' : tid === '__qr__' ? 'QR Placeholder' :
              design.texts.find((t) => t.id === tid) ? 'Text Element' :
              design.logos.find((l) => l.id === tid) ? 'Image / Logo' : 'Shape';
            return (
              <>
                <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
                <div className="h-px bg-slate-100 mx-2 my-1" />
                <button onClick={() => ctxArrange(tid, 'front')} className="ctx-item">⬆️ Bring to Front</button>
                <button onClick={() => ctxArrange(tid, 'forward')} className="ctx-item">▲ Move Forward</button>
                <button onClick={() => ctxArrange(tid, 'backward')} className="ctx-item">▼ Move Backward</button>
                <button onClick={() => ctxArrange(tid, 'back')} className="ctx-item">⬇️ Send to Back</button>
                <div className="h-px bg-slate-100 mx-2 my-1" />
                {tid !== '__photo__' && tid !== '__qr__' && (
                  <button onClick={() => { handleDuplicate(tid); closeContextMenu(); }} className="ctx-item">📋 Duplicate <span className="ml-auto text-slate-300">Ctrl+D</span></button>
                )}
                <button onClick={() => { handleDeleteSelected(tid); closeContextMenu(); }} className="ctx-item text-red-600 hover:bg-red-50">🗑️ Delete <span className="ml-auto text-slate-300">Del</span></button>
                <div className="h-px bg-slate-100 mx-2 my-1" />
              </>
            );
          })()}
          <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Add Element</div>
          <button onClick={ctxAddText} className="ctx-item">✏️ Add Text</button>
          <button onClick={() => ctxAddShape('rectangle')} className="ctx-item">▭ Add Rectangle</button>
          <button onClick={() => ctxAddShape('circle')} className="ctx-item">◯ Add Circle</button>
          <button onClick={() => ctxAddShape('line')} className="ctx-item">─ Add Line</button>
          <div className="h-px bg-slate-100 mx-2 my-1" />
          <button onClick={() => { undo(); closeContextMenu(); }} disabled={!canUndo} className="ctx-item disabled:opacity-30 flex justify-between">
            <span>↩ Undo</span><span className="text-slate-300">Ctrl+Z</span>
          </button>
          <button onClick={() => { redo(); closeContextMenu(); }} disabled={!canRedo} className="ctx-item disabled:opacity-30 flex justify-between">
            <span>↪ Redo</span><span className="text-slate-300">Ctrl+Y</span>
          </button>
        </div>
      )}

    </div>
  );
}

// ── Helper: Template Card (for picker modal) ─────────────────────────────────
function TemplateCard({ preview, emoji, label, onClick, small }: { preview?: string; emoji: string; label: string; onClick: () => void; small?: boolean }) {
  return (
    <button onClick={onClick} className="rounded-xl border-2 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 bg-white transition-all text-left overflow-hidden w-full">
      <div className={`bg-slate-50 flex items-center justify-center border-b border-slate-100 ${small ? 'h-20 p-1.5' : 'h-28 p-3'}`}>
        {preview ? <img src={preview} alt={label} className="rounded shadow-sm max-h-full object-contain" /> : <span className="text-slate-300 text-xs">Loading…</span>}
      </div>
      <div className={small ? 'p-1.5' : 'p-3'}>
        <div className={`flex items-center gap-1.5 ${small ? 'text-[11px]' : 'text-sm'} font-semibold text-slate-700 truncate`}><span>{emoji}</span>{label}</div>
      </div>
    </button>
  );
}

// ── Start Screen (Photoshop-style home) ───────────────────────────────────────
const BUILTIN_START_ITEMS: { key: string; design: CardDesign; label: string; emoji: string; type: string }[] = [
  { key: '__builtin_blank', design: BLANK_TEMPLATE, label: 'Blank Card', emoji: '📄', type: 'student' },
  { key: '__builtin_student', design: STUDENT_TEMPLATE, label: 'Student ID', emoji: '🎓', type: 'student' },
  { key: '__builtin_staff', design: STAFF_TEMPLATE, label: 'Staff ID', emoji: '👨‍🏫', type: 'staff' },
  { key: '__builtin_tpt', design: TPT_TEMPLATE, label: 'TPT ID Card', emoji: '⏰', type: 'teacher-part-time' },
  { key: '__preset_st1', design: STUDENT_CLASSIC_BLUE, label: 'Classic Blue', emoji: '🔵', type: 'student' },
  { key: '__preset_st2', design: STUDENT_DARK_NAVY, label: 'Dark Navy', emoji: '🌌', type: 'student' },
  { key: '__preset_st3', design: STUDENT_SKY_WAVE, label: 'Sky Wave', emoji: '🌊', type: 'student' },
  { key: '__preset_st4', design: STUDENT_GEOMETRIC, label: 'Geometric', emoji: '🔷', type: 'student' },
  { key: '__preset_st5', design: STUDENT_MINIMAL, label: 'Minimal', emoji: '⬜', type: 'student' },
  { key: '__preset_sf1', design: STAFF_CORPORATE_TEAL, label: 'Corp Teal', emoji: '🟢', type: 'staff' },
  { key: '__preset_sf2', design: STAFF_DEEP_OCEAN, label: 'Deep Ocean', emoji: '🌑', type: 'staff' },
  { key: '__preset_sf3', design: STAFF_ROSE, label: 'Rose Pro', emoji: '🌸', type: 'staff' },
  { key: '__preset_sf4', design: STAFF_FOREST, label: 'Forest', emoji: '🌿', type: 'staff' },
  { key: '__preset_sf5', design: STAFF_SLATE_EXECUTIVE, label: 'Executive', emoji: '🏛️', type: 'staff' },
  { key: '__cert_student', design: BLANK_CERTIFICATE_STUDENT, label: 'Blank Stu. Cert', emoji: '📜', type: 'certificate-student' },
  { key: '__cert_staff', design: BLANK_CERTIFICATE_STAFF, label: 'Blank Stf. Cert', emoji: '🏅', type: 'certificate-staff' },
];

interface StartScreenProps {
  previews: Record<string, string>;
  savedTemplates: SavedTemplate[];
  onNewStudent: () => void;
  onNewStaff: () => void;
  onNewTPT: () => void;
  onNewStudentCert: () => void;
  onNewStaffCert: () => void;
  onOpen: (design: CardDesign) => void;
  /** Saved templates ship without `design` for speed — lazy-fetched on click. */
  onOpenTemplate: (tpl: SavedTemplate) => void;
}

function StartScreen({ previews, savedTemplates, onNewStudent, onNewStaff, onNewTPT, onNewStudentCert, onNewStaffCert, onOpen, onOpenTemplate }: StartScreenProps) {
  const allLoaded = BUILTIN_START_ITEMS.every((i) => previews[i.key]);
  return (
    <div className="flex h-full bg-[#1a1b22] text-white overflow-hidden select-none">

      {/* ── Left sidebar ── */}
      <div className="w-64 shrink-0 flex flex-col bg-[#13141a] border-r border-white/[0.06] p-6 overflow-y-auto">

        {/* Branding */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-lg font-black shadow-lg shadow-indigo-900/50 shrink-0">W</div>
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.15em] leading-none mb-0.5">System</p>
              <p className="text-lg font-black text-white leading-none tracking-tight">Wattaman</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 pl-0.5">Card Designer</p>
        </div>

        {/* New section */}
        <div className="mb-6">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">New</p>
          <div className="space-y-1.5">
            <button
              onClick={onNewStudent}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-indigo-600/25 border border-white/[0.06] hover:border-indigo-500/50 transition-all text-left group"
            >
              <span className="text-xl leading-none shrink-0">🎓</span>
              <div>
                <div className="text-[12px] font-semibold text-white group-hover:text-indigo-200 transition-colors">Student ID Card</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Photo card with student data</div>
              </div>
            </button>
            <button
              onClick={onNewStaff}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-emerald-600/25 border border-white/[0.06] hover:border-emerald-500/50 transition-all text-left group"
            >
              <span className="text-xl leading-none shrink-0">👨‍🏫</span>
              <div>
                <div className="text-[12px] font-semibold text-white group-hover:text-emerald-200 transition-colors">Staff ID Card</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Photo card with staff data</div>
              </div>
            </button>
            <button
              onClick={onNewTPT}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-orange-600/25 border border-white/[0.06] hover:border-orange-500/50 transition-all text-left group"
            >
              <span className="text-xl leading-none shrink-0">⏰</span>
              <div>
                <div className="text-[12px] font-semibold text-white group-hover:text-orange-200 transition-colors">TPT ID Card</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Part-time teacher from timetable</div>
              </div>
            </button>
            {/* Certificate sub-section */}
            <div className="mt-1 mb-0.5">
              <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 px-1">Certificates</p>
              <div className="space-y-1">
                <button
                  onClick={onNewStudentCert}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-amber-600/25 border border-white/[0.06] hover:border-amber-500/50 transition-all text-left group"
                >
                  <span className="text-base leading-none shrink-0">📜</span>
                  <div>
                    <div className="text-[11px] font-semibold text-white group-hover:text-amber-200 transition-colors">Student Certificate</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">Award for student records</div>
                  </div>
                </button>
                <button
                  onClick={onNewStaffCert}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-rose-600/25 border border-white/[0.06] hover:border-rose-500/50 transition-all text-left group"
                >
                  <span className="text-base leading-none shrink-0">🏅</span>
                  <div>
                    <div className="text-[11px] font-semibold text-white group-hover:text-rose-200 transition-colors">Staff Certificate</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">Award for staff records</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.06] mb-5" />

        {/* Open / Recent */}
        <div className="flex-1">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">Open Recent</p>
          {savedTemplates.length > 0 ? (
            <div className="space-y-0.5">
              {savedTemplates.map((tpl) => (
                <button key={tpl.id} onClick={() => onOpenTemplate(tpl)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left group"
                >
                  <div className="w-9 h-6 rounded bg-white/[0.07] flex items-center justify-center overflow-hidden shrink-0 border border-white/[0.05]">
                    {previews[tpl.id]
                      ? <img src={previews[tpl.id]} alt={tpl.name} className="w-full h-full object-contain" />
                      : <span className="text-[8px] text-slate-600">…</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-slate-300 group-hover:text-white transition-colors truncate">{tpl.name}</div>
                    <div className="text-[9px] text-slate-600 capitalize">{tpl.cardType?.replace('-', ' ')}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-center">
              <p className="text-[11px] text-slate-600 leading-relaxed">No saved templates yet.<br />Use &ldquo;As Template&rdquo; in the editor to save one.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: template gallery ── */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white">Templates</h2>
            <p className="text-xs text-slate-500 mt-0.5">Click a template to open it in the editor</p>
          </div>
          {!allLoaded && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx="8" cy="8" r="5" strokeOpacity={0.3}/><path d="M8 3a5 5 0 0 1 5 5"/>
              </svg>
              Generating previews…
            </div>
          )}
        </div>

        {/* ID Card templates */}
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">🪪 ID Card Templates</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-6">
          {BUILTIN_START_ITEMS.filter((i) => i.type === 'student' || i.type === 'staff' || i.type === 'teacher-part-time').map(({ key, design, label, emoji }) => (
            <button key={key} onClick={() => onOpen(design)}
              className="group rounded-xl overflow-hidden border border-white/[0.07] hover:border-indigo-400/60 bg-[#13141a] hover:bg-[#1e2035] transition-all text-left shadow-sm hover:shadow-indigo-900/30 hover:shadow-lg"
            >
              <div className="bg-[#0d0e12] h-28 flex items-center justify-center p-2 relative">
                {previews[key] ? (
                  <img src={previews[key]} alt={label} className="max-h-24 max-w-full object-contain rounded shadow-md group-hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="w-14 h-20 bg-white/[0.04] rounded-lg animate-pulse" />
                )}
              </div>
              <div className="px-2.5 py-2 border-t border-white/[0.05]">
                <div className="text-[11px] font-semibold text-slate-400 group-hover:text-slate-200 transition-colors truncate">{emoji} {label}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Certificate templates */}
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 mt-2">📜 Certificate Templates</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-8">
          {BUILTIN_START_ITEMS.filter((i) => i.type === 'certificate-student' || i.type === 'certificate-staff').map(({ key, design, label, emoji }) => (
            <button key={key} onClick={() => onOpen(design)}
              className="group rounded-xl overflow-hidden border border-white/[0.07] hover:border-amber-400/60 bg-[#13141a] hover:bg-[#1e1a10] transition-all text-left shadow-sm hover:shadow-amber-900/30 hover:shadow-lg"
            >
              <div className="bg-[#0d0e12] h-28 flex items-center justify-center p-2 relative">
                {previews[key] ? (
                  <img src={previews[key]} alt={label} className="max-h-24 max-w-full object-contain rounded shadow-md group-hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="w-14 h-20 bg-white/[0.04] rounded-lg animate-pulse" />
                )}
              </div>
              <div className="px-2.5 py-2 border-t border-white/[0.05]">
                <div className="text-[11px] font-semibold text-slate-400 group-hover:text-slate-200 transition-colors truncate">{emoji} {label}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Saved templates */}
        {savedTemplates.length > 0 && (
          <>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Your Saved Templates</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {savedTemplates.map((tpl) => (
                <button key={tpl.id} onClick={() => onOpenTemplate(tpl)}
                  className="group rounded-xl overflow-hidden border border-white/[0.07] hover:border-violet-400/60 bg-[#13141a] hover:bg-[#1e1a35] transition-all text-left"
                >
                  <div className="bg-[#0d0e12] h-28 flex items-center justify-center p-2">
                    {previews[tpl.id] ? (
                      <img src={previews[tpl.id]} alt={tpl.name} className="max-h-24 max-w-full object-contain rounded shadow-md group-hover:scale-105 transition-transform duration-200" />
                    ) : (
                      <div className="w-14 h-20 bg-white/[0.04] rounded-lg animate-pulse" />
                    )}
                  </div>
                  <div className="px-2.5 py-2 border-t border-white/[0.05]">
                    <div className="text-[11px] font-semibold text-slate-400 group-hover:text-slate-200 truncate">{tpl.name}</div>
                    <div className="text-[9px] text-slate-600 capitalize mt-0.5">{tpl.cardType?.replace('-', ' ')}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
