export interface TextElement {
  id: string;
  content: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  fontFamily?: string;
  zIndex?: number;
  visible?: boolean;
  locked?: boolean;
}

export const FONT_OPTIONS = [
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Noto Sans Khmer', value: '"Noto Sans Khmer", sans-serif' },
  { label: 'Battambang', value: 'Battambang, sans-serif' },
  { label: 'Moul', value: 'Moul, serif' },
  { label: 'Siemreap', value: 'Siemreap, sans-serif' },
  { label: 'Hanuman', value: 'Hanuman, serif' },
  { label: 'Bokor', value: 'Bokor, serif' },
  { label: 'Koulen', value: 'Koulen, sans-serif' },
  { label: 'Chenla', value: 'Chenla, sans-serif' },
  { label: 'Content', value: 'Content, sans-serif' },
  { label: 'Khmer', value: 'Khmer, sans-serif' },
];

export interface LogoElement {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  opacity?: number;        // 0–1, default 1
  blur?: number;           // px, default 0
  borderRadius?: number;   // px, default 0
  /** Crop as fraction of original image: 0–1 */
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  removeBg?: boolean;      // CSS mix-blend-mode trick for white bg removal
  /** Original src saved before AI background removal — set when AI removal is applied */
  originalSrc?: string;
  visible?: boolean;
  locked?: boolean;
}

export type ShapeType = 'rectangle' | 'circle' | 'line';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface ShapeElement {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  opacity: number;
  zIndex?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  gradient: {
    enabled: boolean;
    type: 'linear' | 'radial';
    angle: number;
    stops: GradientStop[];
  };
  visible?: boolean;
  locked?: boolean;
}

export interface PhotoPlaceholder {
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  zIndex?: number;
  visible?: boolean;
  locked?: boolean;
}

export interface QrPlaceholder {
  x: number;
  y: number;
  size: number;
  width: number;
  height: number;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  zIndex?: number;
  visible?: boolean;
  locked?: boolean;
}

export type CardSize = 'credit' | 'id-1' | 'a7' | 'custom';
export type CardType = 'student' | 'staff' | 'certificate-student' | 'certificate-staff' | 'general' | 'teacher-part-time';

// Placeholder fields available for each card type (from the App DB)
export const CARD_TYPE_FIELDS: Record<CardType, { key: string; label: string; example: string }[]> = {
  student: [
    { key: '{{name}}', label: 'Full Name', example: 'Sokha Chan' },
    { key: '{{studentNumber}}', label: 'Student ID', example: '0001' },
    { key: '{{class}}', label: 'Class', example: 'Grade 10A' },
    { key: '{{email}}', label: 'Email', example: 'sokha@school.edu' },
    { key: '{{phone}}', label: 'Phone', example: '012 345 678' },
    { key: '{{sex}}', label: 'Gender', example: 'MALE' },
    { key: '{{dateOfBirth}}', label: 'Date of Birth', example: '01/01/2010' },
    { key: '{{address}}', label: 'Address', example: 'Phnom Penh' },
    { key: '{{qrCode}}', label: 'QR Code Data', example: 'STU-0001' },
    { key: '{{studyYear}}', label: 'Study Year', example: '2025–2026' },
  ],
  staff: [
    { key: '{{name}}', label: 'Full Name', example: 'Dara Sothea' },
    { key: '{{email}}', label: 'Email', example: 'dara@school.edu' },
    { key: '{{phone}}', label: 'Phone', example: '012 987 654' },
    { key: '{{role}}', label: 'Role', example: 'Teacher' },
    { key: '{{department}}', label: 'Department', example: 'Science' },
  ],
  'certificate-student': [
    { key: '{{name}}', label: 'Full Name', example: 'Sokha Chan' },
    { key: '{{studentNumber}}', label: 'Student ID', example: '0001' },
    { key: '{{class}}', label: 'Class', example: 'Grade 10A' },
    { key: '{{studyYear}}', label: 'Study Year', example: '2025–2026' },
    { key: '{{dateOfBirth}}', label: 'Date of Birth', example: '01/01/2010' },
    { key: '{{sex}}', label: 'Gender', example: 'MALE' },
    { key: '{{certificateDate}}', label: 'Issue Date', example: '13/05/2026' },
    { key: '{{schoolName}}', label: 'School Name', example: 'Wattaman School' },
    { key: '{{total}}', label: 'Total Score', example: '450' },
    { key: '{{average}}', label: 'Average %', example: '85.0%' },
    { key: '{{gpa}}', label: 'GPA', example: '3.00' },
    { key: '{{grade}}', label: 'Letter Grade', example: 'A' },
    { key: '{{ranking}}', label: 'Class Ranking', example: '1' },
  ],
  'certificate-staff': [
    { key: '{{name}}', label: 'Full Name', example: 'Dara Sothea' },
    { key: '{{role}}', label: 'Role', example: 'Teacher' },
    { key: '{{department}}', label: 'Department', example: 'Science' },
    { key: '{{email}}', label: 'Email', example: 'dara@school.edu' },
    { key: '{{certificateDate}}', label: 'Issue Date', example: '13/05/2026' },
    { key: '{{schoolName}}', label: 'School Name', example: 'Wattaman School' },
  ],
  'teacher-part-time': [
    { key: '{{name}}', label: 'Full Name', example: 'Dara Sothea' },
    { key: '{{khmerName}}', label: 'Khmer Name', example: 'ដារ៉ា សុទ្ធា' },
    { key: '{{short}}', label: 'Short Code', example: 'DRS' },
    { key: '{{timetableName}}', label: 'Timetable', example: 'Main 2026' },
    { key: '{{subjects}}', label: 'Subjects Taught', example: 'Math, Science' },
    { key: '{{sex}}', label: 'Gender', example: 'Male' },
    { key: '{{weeklyLessons}}', label: 'Weekly Lessons', example: '12' },
    { key: '{{qrCode}}', label: 'QR Code', example: 'TPT-0001' },
  ],
  general: [],
};

export interface CardDesign {
  cardType: CardType;
  size: CardSize;
  width: number;
  height: number;
  backgroundColor: string;
  frameColor: string;
  frameWidth: number;
  texts: TextElement[];
  logos: LogoElement[];
  shapes: ShapeElement[];
  photo: PhotoPlaceholder | null;
  qr: QrPlaceholder | null;
  /** Provenance for the currently-applied template — visible to every admin so they all see the same source. */
  _appliedFrom?: { id?: string; name: string; appliedAt: string } | null;
}

export const CARD_SIZE_PRESETS: Record<Exclude<CardSize, 'custom'>, { width: number; height: number; label: string }> = {
  'credit': { width: 340, height: 215, label: 'Credit Card (85.6 × 53.98 mm)' },
  'id-1': { width: 340, height: 215, label: 'ID-1 Standard' },
  'a7': { width: 298, height: 420, label: 'A7 (74 × 105 mm)' },
};

export const DESIGN_STORAGE_KEY = 'Wattanman-card-designs';
export const TEMPLATES_STORAGE_KEY = 'Wattanman-card-templates';

export interface SavedTemplate {
  id: string;
  name: string;
  cardType: CardType;
  /** Full design payload. Optional because the API list endpoint omits it for speed —
   *  fetch on demand via apiLoadTemplate(id). Local-storage helpers still set it. */
  design?: CardDesign;
  createdAt: string;
}

export function loadSavedTemplates(): SavedTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTemplate(name: string, design: CardDesign): SavedTemplate {
  const templates = loadSavedTemplates();
  const newTemplate: SavedTemplate = {
    id: Math.random().toString(36).slice(2, 10),
    name,
    cardType: design.cardType,
    design: JSON.parse(JSON.stringify(design)),
    createdAt: new Date().toISOString(),
  };
  templates.push(newTemplate);
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  return newTemplate;
}

export function deleteTemplate(id: string): void {
  const templates = loadSavedTemplates().filter((t) => t.id !== id);
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

export function loadSavedDesign(type: CardType): CardDesign | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DESIGN_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, CardDesign>;
    const design = saved[type] ?? null;
    if (design) {
      const template = type === 'student' ? STUDENT_TEMPLATE : STAFF_TEMPLATE;

      // Ensure top-level fields have defaults
      design.backgroundColor = design.backgroundColor ?? template.backgroundColor;
      design.frameColor = design.frameColor ?? template.frameColor;
      design.frameWidth = design.frameWidth ?? template.frameWidth;
      design.shapes = design.shapes ?? [];
      design.logos = design.logos ?? [];
      design.texts = design.texts ?? [];

      // Migrate texts
      for (const t of design.texts) {
        if (t.content === 'Class: {{Class Name}}') {
          t.content = '{{Class Name}}';
        }
        t.fontFamily = t.fontFamily ?? 'Inter, sans-serif';
        t.textAlign = t.textAlign ?? 'left';
        t.fontWeight = t.fontWeight ?? 'normal';
        t.fontStyle = t.fontStyle ?? 'normal';
      }

      // Migrate shapes
      for (const s of design.shapes) {
        s.rotation = s.rotation ?? 0;
        s.opacity = s.opacity ?? 1;
        s.borderColor = s.borderColor ?? '#1e293b';
        s.borderWidth = s.borderWidth ?? 0;
        s.borderRadius = s.borderRadius ?? 0;
        s.gradient = s.gradient ?? {
          enabled: false,
          type: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: '#4f46e5' },
            { offset: 1, color: '#06b6d4' },
          ],
        };
      }

      // Migrate photo placeholder
      if (design.photo) {
        design.photo.borderRadius = design.photo.borderRadius ?? 6;
        design.photo.borderColor = design.photo.borderColor ?? template.frameColor;
        design.photo.borderWidth = design.photo.borderWidth ?? 2;
      }

      // Migrate QR placeholder
      if (design.qr && !('width' in design.qr)) {
        const qr = design.qr as any;
        design.qr = { ...qr, width: qr.size, height: qr.size, borderRadius: 0, borderColor: '#cbd5e1', borderWidth: 1 };
      }
      if (design.qr) {
        design.qr.borderRadius = design.qr.borderRadius ?? 0;
        design.qr.borderColor = design.qr.borderColor ?? '#cbd5e1';
        design.qr.borderWidth = design.qr.borderWidth ?? 1;
      }

      // TPT migration: restore photo/qr defaults if both are null on a blank/stale design
      if (type === 'teacher-part-time' && !design.photo && !design.qr && design.texts.length === 0) {
        design.photo = { x: 15, y: 55, width: 70, height: 85, borderRadius: 6, borderColor: '#059669', borderWidth: 2, zIndex: 5 };
        design.qr = { x: 250, y: 55, size: 80, width: 80, height: 80, borderRadius: 0, borderColor: '#cbd5e1', borderWidth: 1, zIndex: 5 };
      }
    }
    return design;
  } catch {
    return null;
  }
}

export function saveDesign(design: CardDesign): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(DESIGN_STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    saved[design.cardType] = design;
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // ignore storage errors
  }
}

export function clearAllCache(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DESIGN_STORAGE_KEY);
  localStorage.removeItem(TEMPLATES_STORAGE_KEY);
  localStorage.removeItem('wattaman_tpl_list_v1');
}

// --- API-backed template functions (server-side, shared across all admins) ---

import { apiFetch } from '../../lib/api';

export async function apiLoadTemplates(): Promise<SavedTemplate[]> {
  try {
    const res = await apiFetch('/api/card-templates');
    if (!res.ok) return [];
    const data = await res.json();
    return data as SavedTemplate[];
  } catch {
    return [];
  }
}

/** Fetch a single template (including the heavy `design` JSON) on demand. */
export async function apiLoadTemplate(id: string): Promise<SavedTemplate | null> {
  try {
    const res = await apiFetch(`/api/card-templates/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.design) return data ?? null;
    // Prisma Json field may occasionally come back as a string with some drivers
    if (typeof data.design === 'string') {
      try { data.design = JSON.parse(data.design); } catch {}
    }
    return data as SavedTemplate;
  } catch {
    return null;
  }
}

export async function apiSaveTemplate(name: string, design: CardDesign): Promise<SavedTemplate | null> {
  try {
    const res = await apiFetch('/api/card-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cardType: design.cardType, design }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function apiDeleteTemplate(id: string): Promise<void> {
  try {
    await apiFetch(`/api/card-templates/${id}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

export async function apiGetActiveDesign(cardType: CardType): Promise<CardDesign | null> {
  try {
    const res = await apiFetch(`/api/card-templates/active/${cardType}`);
    if (!res.ok) {
      console.error(`[apiGetActiveDesign] HTTP ${res.status} for cardType=${cardType}`);
      return null;
    }
    const record = await res.json();
    if (!record || !record.design) return null;
    // Prisma Json field may occasionally come back as a string in some DB drivers
    const design = typeof record.design === 'string' ? JSON.parse(record.design) : record.design;
    return design as CardDesign;
  } catch (err) {
    console.error('[apiGetActiveDesign] Network/parse error:', err);
    return null;
  }
}

export async function apiSetActiveDesign(design: CardDesign): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/card-templates/active/${design.cardType}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design }),
    });
    if (!res.ok) {
      console.error(`[apiSetActiveDesign] HTTP ${res.status} for cardType=${design.cardType}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[apiSetActiveDesign] Network error:', err);
    return false;
  }
}

export const BLANK_TEMPLATE: CardDesign = {
  cardType: 'student',
  size: 'credit',
  width: 340,
  height: 215,
  backgroundColor: '#ffffff',
  frameColor: '#cbd5e1',
  frameWidth: 0,
  photo: null,
  qr: null,
  texts: [],
  logos: [],
  shapes: [],
};

export const BLANK_CERTIFICATE_STUDENT: CardDesign = {
  cardType: 'certificate-student',
  size: 'certificate' as CardSize,
  width: 794,
  height: 562,
  backgroundColor: '#ffffff',
  frameColor: '#4f46e5',
  frameWidth: 0,
  photo: null,
  qr: null,
  texts: [
    { id: 'cs-school', content: 'Wattanman Academy', x: 397, y: 60, fontSize: 22, color: '#1e293b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'cs-title', content: 'CERTIFICATE OF ACHIEVEMENT', x: 397, y: 120, fontSize: 28, color: '#4f46e5', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'cs-presented', content: 'This is proudly presented to', x: 397, y: 200, fontSize: 14, color: '#64748b', fontWeight: 'normal', fontStyle: 'italic', textAlign: 'center' },
    { id: 'cs-name', content: '{{name}}', x: 397, y: 260, fontSize: 32, color: '#1e293b', fontWeight: 'bold', fontStyle: 'italic', textAlign: 'center' },
    { id: 'cs-class', content: '{{class}}  ·  {{studyYear}}', x: 397, y: 305, fontSize: 13, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'cs-date', content: 'Issued: {{certificateDate}}', x: 397, y: 460, fontSize: 12, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
  ],
  logos: [],
  shapes: [
    { id: 'cs-border', type: 'rectangle', x: 16, y: 16, width: 762, height: 530, color: 'transparent', borderColor: '#4f46e5', borderWidth: 3, borderRadius: 12, opacity: 1, rotation: 0, zIndex: 0, gradient: { enabled: false, type: 'linear' as const, angle: 90, stops: [{ offset: 0, color: '#4f46e5' }, { offset: 1, color: '#818cf8' }] } },
    { id: 'cs-line', type: 'line', x: 130, y: 310, width: 534, height: 2, color: '#e2e8f0', borderColor: '#e2e8f0', borderWidth: 2, borderRadius: 0, opacity: 1, rotation: 0, zIndex: 0, gradient: { enabled: false, type: 'linear' as const, angle: 90, stops: [{ offset: 0, color: '#e2e8f0' }, { offset: 1, color: '#e2e8f0' }] } },
    { id: 'cs-sig-line', type: 'line', x: 230, y: 440, width: 334, height: 2, color: '#94a3b8', borderColor: '#94a3b8', borderWidth: 1, borderRadius: 0, opacity: 1, rotation: 0, zIndex: 0, gradient: { enabled: false, type: 'linear' as const, angle: 90, stops: [{ offset: 0, color: '#94a3b8' }, { offset: 1, color: '#94a3b8' }] } },
  ],
};

export const BLANK_CERTIFICATE_STAFF: CardDesign = {
  cardType: 'certificate-staff',
  size: 'certificate' as CardSize,
  width: 794,
  height: 562,
  backgroundColor: '#ffffff',
  frameColor: '#059669',
  frameWidth: 0,
  photo: null,
  qr: null,
  texts: [
    { id: 'cf-school', content: 'Wattanman Academy', x: 397, y: 60, fontSize: 22, color: '#1e293b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'cf-title', content: 'CERTIFICATE OF RECOGNITION', x: 397, y: 120, fontSize: 28, color: '#059669', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'cf-presented', content: 'This is proudly presented to', x: 397, y: 200, fontSize: 14, color: '#64748b', fontWeight: 'normal', fontStyle: 'italic', textAlign: 'center' },
    { id: 'cf-name', content: '{{name}}', x: 397, y: 260, fontSize: 32, color: '#1e293b', fontWeight: 'bold', fontStyle: 'italic', textAlign: 'center' },
    { id: 'cf-role', content: '{{role}}  ·  {{department}}', x: 397, y: 305, fontSize: 13, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'cf-date', content: 'Issued: {{certificateDate}}', x: 397, y: 460, fontSize: 12, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
  ],
  logos: [],
  shapes: [
    { id: 'cf-border', type: 'rectangle', x: 16, y: 16, width: 762, height: 530, color: 'transparent', borderColor: '#059669', borderWidth: 3, borderRadius: 12, opacity: 1, rotation: 0, zIndex: 0, gradient: { enabled: false, type: 'linear' as const, angle: 90, stops: [{ offset: 0, color: '#059669' }, { offset: 1, color: '#34d399' }] } },
    { id: 'cf-line', type: 'line', x: 130, y: 310, width: 534, height: 2, color: '#e2e8f0', borderColor: '#e2e8f0', borderWidth: 2, borderRadius: 0, opacity: 1, rotation: 0, zIndex: 0, gradient: { enabled: false, type: 'linear' as const, angle: 90, stops: [{ offset: 0, color: '#e2e8f0' }, { offset: 1, color: '#e2e8f0' }] } },
    { id: 'cf-sig-line', type: 'line', x: 230, y: 440, width: 334, height: 2, color: '#94a3b8', borderColor: '#94a3b8', borderWidth: 1, borderRadius: 0, opacity: 1, rotation: 0, zIndex: 0, gradient: { enabled: false, type: 'linear' as const, angle: 90, stops: [{ offset: 0, color: '#94a3b8' }, { offset: 1, color: '#94a3b8' }] } },
  ],
};

export const STUDENT_TEMPLATE: CardDesign = {
  cardType: 'student',
  size: 'credit',
  width: 340,
  height: 215,
  backgroundColor: '#eef2ff',
  frameColor: '#4f46e5',
  frameWidth: 3,
  photo: { x: 15, y: 55, width: 70, height: 85, borderRadius: 6, borderColor: '#4f46e5', borderWidth: 2, zIndex: 5 },
  qr: { x: 250, y: 55, size: 80, width: 80, height: 80, borderRadius: 0, borderColor: '#cbd5e1', borderWidth: 1, zIndex: 5 },
  texts: [
    { id: 'st-school', content: 'Wattanman Academy', x: 90, y: 12, fontSize: 14, color: '#312e81', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-title', content: 'STUDENT ID CARD', x: 90, y: 32, fontSize: 11, color: '#4f46e5', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-name', content: '{{Student Name}}', x: 100, y: 60, fontSize: 14, color: '#1e293b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-id', content: 'ID: {{Student ID}}', x: 100, y: 78, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-class', content: '{{Class Name}}', x: 100, y: 93, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-year', content: '{{Study Year}}', x: 100, y: 106, fontSize: 9, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-dob', content: 'DOB: {{Date of Birth}}', x: 100, y: 119, fontSize: 9, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-phone', content: 'Tel: {{Phone}}', x: 100, y: 132, fontSize: 9, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-addr', content: '{{Address}}', x: 15, y: 155, fontSize: 8, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'st-valid', content: 'Valid Until: June 2026', x: 15, y: 185, fontSize: 9, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
  shapes: [],
};

export const STAFF_TEMPLATE: CardDesign = {
  cardType: 'staff',
  size: 'credit',
  width: 340,
  height: 215,
  backgroundColor: '#ecfdf5',
  frameColor: '#059669',
  frameWidth: 3,
  photo: { x: 15, y: 55, width: 70, height: 85, borderRadius: 6, borderColor: '#059669', borderWidth: 2, zIndex: 5 },
  qr: { x: 250, y: 55, size: 80, width: 80, height: 80, borderRadius: 0, borderColor: '#cbd5e1', borderWidth: 1, zIndex: 5 },
  texts: [
    { id: 'sf-school', content: 'Wattanman Academy', x: 90, y: 12, fontSize: 14, color: '#064e3b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sf-title', content: 'OFFICER ID CARD', x: 90, y: 32, fontSize: 11, color: '#059669', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sf-name', content: '{{Staff Name}}', x: 100, y: 65, fontSize: 15, color: '#1e293b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sf-id', content: 'Employee ID: {{Emp ID}}', x: 100, y: 88, fontSize: 11, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sf-dept', content: 'Position: {{Position}}', x: 100, y: 106, fontSize: 11, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sf-valid', content: 'Valid Until: June 2026', x: 15, y: 185, fontSize: 9, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
  shapes: [],
};

// ─── Helper for gradient shapes ──────────────────────────────────────────────
function gs(id: string, type: ShapeType, x: number, y: number, w: number, h: number, color: string, opts: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id, type, x, y, width: w, height: h, color,
    borderColor: opts.borderColor ?? '#00000000', borderWidth: opts.borderWidth ?? 0,
    borderRadius: opts.borderRadius ?? 0, rotation: opts.rotation ?? 0, opacity: opts.opacity ?? 1,
    zIndex: opts.zIndex ?? 0, lineStyle: opts.lineStyle,
    gradient: opts.gradient ?? { enabled: false, type: 'linear', angle: 90, stops: [{ offset: 0, color }, { offset: 1, color }] },
  };
}

// ─── STUDENT PRESET TEMPLATES ─────────────────────────────────────────────────

// 1. Classic Blue (portrait A7) — header bar + round photo + QR bottom-right
export const STUDENT_CLASSIC_BLUE: CardDesign = {
  cardType: 'student', size: 'a7', width: 298, height: 420,
  backgroundColor: '#f0f4ff', frameColor: '#1d4ed8', frameWidth: 3,
  photo: { x: 99, y: 70, width: 100, height: 100, borderRadius: 50, borderColor: '#1d4ed8', borderWidth: 3, zIndex: 5 },
  qr: { x: 189, y: 305, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#93c5fd', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('scb-top', 'rectangle', 0, 0, 298, 60, '#1d4ed8', { zIndex: 1, gradient: { enabled: true, type: 'linear', angle: 135, stops: [{ offset: 0, color: '#1e40af' }, { offset: 1, color: '#3b82f6' }] } }),
    gs('scb-bot', 'rectangle', 0, 390, 298, 30, '#1d4ed8', { zIndex: 1 }),
    gs('scb-sep', 'line', 20, 185, 258, 2, '#93c5fd', { borderColor: '#93c5fd', borderWidth: 2, lineStyle: 'solid', zIndex: 2 }),
    gs('scb-qrbox', 'rectangle', 185, 301, 98, 98, '#dbeafe', { borderColor: '#93c5fd', borderWidth: 1, borderRadius: 6, zIndex: 2 }),
  ],
  texts: [
    { id: 'scb-school', content: 'Wattanman Academy', x: 149, y: 16, fontSize: 15, color: '#ffffff', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'scb-title', content: 'STUDENT ID CARD', x: 149, y: 38, fontSize: 10, color: '#bfdbfe', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'scb-name', content: '{{Student Name}}', x: 149, y: 195, fontSize: 18, color: '#1e3a8a', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'scb-id', content: 'ID: {{Student ID}}', x: 149, y: 220, fontSize: 11, color: '#3b82f6', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'scb-class', content: 'Class: {{Class Name}}', x: 30, y: 245, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'scb-year', content: 'Year: {{Study Year}}', x: 30, y: 260, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'scb-dob', content: 'DOB: {{Date of Birth}}', x: 30, y: 275, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'scb-phone', content: 'Tel: {{Phone}}', x: 30, y: 290, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'scb-qrlbl', content: 'SCAN FOR ATTENDANCE', x: 234, y: 400, fontSize: 7, color: '#93c5fd', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'scb-valid', content: 'Valid Until: June 2026', x: 20, y: 398, fontSize: 8, color: '#bfdbfe', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};

// 2. Dark Navy Tech — dark card, diagonal accent, circle photo
export const STUDENT_DARK_NAVY: CardDesign = {
  cardType: 'student', size: 'a7', width: 298, height: 420,
  backgroundColor: '#0f172a', frameColor: '#38bdf8', frameWidth: 0,
  photo: { x: 99, y: 60, width: 100, height: 100, borderRadius: 50, borderColor: '#38bdf8', borderWidth: 3, zIndex: 5 },
  qr: { x: 104, y: 305, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#334155', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('sdn-accent1', 'rectangle', 200, 0, 98, 140, '#0ea5e9', { zIndex: 1, rotation: 0, opacity: 0.15 }),
    gs('sdn-accent2', 'rectangle', 0, 330, 298, 90, '#0ea5e9', { zIndex: 1, opacity: 0.12 }),
    gs('sdn-sep', 'line', 20, 180, 258, 2, '#0ea5e9', { borderColor: '#0ea5e9', borderWidth: 1, lineStyle: 'dashed', zIndex: 2 }),
    gs('sdn-qrbg', 'rectangle', 99, 300, 100, 100, '#1e293b', { borderRadius: 8, borderColor: '#334155', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'sdn-school', content: 'Wattanman Academy', x: 149, y: 12, fontSize: 13, color: '#38bdf8', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-title', content: 'STUDENT ID CARD', x: 149, y: 30, fontSize: 9, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-name', content: '{{Student Name}}', x: 149, y: 188, fontSize: 18, color: '#f8fafc', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-role', content: 'STUDENT', x: 149, y: 210, fontSize: 9, color: '#38bdf8', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-id', content: 'ID: {{Student ID}}', x: 149, y: 228, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-class', content: 'Class: {{Class Name}}', x: 149, y: 245, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-year', content: '{{Study Year}}', x: 149, y: 262, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdn-qrlbl', content: 'Scan QR \u2022 Attendance', x: 149, y: 408, fontSize: 8, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
  ],
  logos: [],
};

// 3. Sky Wave — light blue with wave-like top shape
export const STUDENT_SKY_WAVE: CardDesign = {
  cardType: 'student', size: 'a7', width: 298, height: 420,
  backgroundColor: '#e0f2fe', frameColor: '#0284c7', frameWidth: 0,
  photo: { x: 99, y: 65, width: 100, height: 100, borderRadius: 50, borderColor: '#ffffff', borderWidth: 4, zIndex: 6 },
  qr: { x: 179, y: 300, size: 90, width: 90, height: 90, borderRadius: 6, borderColor: '#bae6fd', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('ssw-wave', 'rectangle', 0, 0, 298, 120, '#0284c7', { zIndex: 1, gradient: { enabled: true, type: 'linear', angle: 160, stops: [{ offset: 0, color: '#0369a1' }, { offset: 1, color: '#38bdf8' }] } }),
    gs('ssw-circle', 'circle', 84, 50, 130, 130, '#7dd3fc', { opacity: 0.25, zIndex: 2 }),
    gs('ssw-dot1', 'circle', 20, 20, 12, 12, '#ffffff', { opacity: 0.3, zIndex: 2 }),
    gs('ssw-dot2', 'circle', 260, 30, 18, 18, '#ffffff', { opacity: 0.2, zIndex: 2 }),
    gs('ssw-sep', 'line', 20, 185, 258, 1, '#0284c7', { borderColor: '#0284c7', borderWidth: 1, lineStyle: 'dotted', zIndex: 2 }),
    gs('ssw-qrbg', 'rectangle', 174, 295, 100, 100, '#bae6fd', { borderRadius: 8, opacity: 0.5, zIndex: 2 }),
  ],
  texts: [
    { id: 'ssw-school', content: 'Wattanman Academy', x: 149, y: 14, fontSize: 14, color: '#ffffff', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'ssw-title', content: 'STUDENT ID CARD', x: 149, y: 33, fontSize: 9, color: '#bae6fd', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'ssw-name', content: '{{Student Name}}', x: 149, y: 192, fontSize: 17, color: '#0c4a6e', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'ssw-id', content: 'ID: {{Student ID}}', x: 149, y: 214, fontSize: 11, color: '#0284c7', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'ssw-class', content: 'Class: {{Class Name}}', x: 30, y: 237, fontSize: 10, color: '#075985', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'ssw-year', content: 'Year: {{Study Year}}', x: 30, y: 253, fontSize: 10, color: '#075985', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'ssw-dob', content: 'DOB: {{Date of Birth}}', x: 30, y: 269, fontSize: 10, color: '#075985', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'ssw-phone', content: 'Tel: {{Phone}}', x: 30, y: 285, fontSize: 10, color: '#075985', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'ssw-qrlbl', content: 'Attendance QR', x: 224, y: 400, fontSize: 8, color: '#0284c7', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'ssw-valid', content: 'Valid: June 2026', x: 20, y: 407, fontSize: 8, color: '#7dd3fc', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};

// 4. Geometric Modern — white with bold color blocks, portrait
export const STUDENT_GEOMETRIC: CardDesign = {
  cardType: 'student', size: 'a7', width: 298, height: 420,
  backgroundColor: '#ffffff', frameColor: '#7c3aed', frameWidth: 0,
  photo: { x: 29, y: 65, width: 100, height: 100, borderRadius: 50, borderColor: '#7c3aed', borderWidth: 3, zIndex: 6 },
  qr: { x: 179, y: 300, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#ddd6fe', borderWidth: 1, zIndex: 5 },
  shapes: [
    gs('sgm-hdr', 'rectangle', 0, 0, 298, 55, '#7c3aed', { zIndex: 1 }),
    gs('sgm-stripe1', 'rectangle', 0, 340, 298, 80, '#7c3aed', { zIndex: 1, opacity: 0.08 }),
    gs('sgm-stripe2', 'rectangle', 0, 360, 298, 60, '#7c3aed', { zIndex: 1, opacity: 0.15 }),
    gs('sgm-rect1', 'rectangle', 230, 0, 68, 68, '#a78bfa', { zIndex: 2, opacity: 0.4, borderRadius: 0 }),
    gs('sgm-rect2', 'rectangle', 248, 0, 50, 50, '#c4b5fd', { zIndex: 3, opacity: 0.4 }),
    gs('sgm-namebar', 'rectangle', 0, 178, 298, 32, '#7c3aed', { zIndex: 1, opacity: 0.07 }),
    gs('sgm-sep', 'line', 138, 220, 140, 1, '#7c3aed', { borderColor: '#7c3aed', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sgm-qrbg', 'rectangle', 175, 296, 98, 98, '#f5f3ff', { borderRadius: 6, borderColor: '#ddd6fe', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'sgm-school', content: 'Wattanman Academy', x: 20, y: 16, fontSize: 14, color: '#ffffff', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sgm-title', content: 'STUDENT ID', x: 20, y: 36, fontSize: 10, color: '#ddd6fe', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sgm-name', content: '{{Student Name}}', x: 144, y: 182, fontSize: 16, color: '#3b0764', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-id', content: 'ID: {{Student ID}}', x: 144, y: 205, fontSize: 11, color: '#7c3aed', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-class', content: 'Class: {{Class Name}}', x: 144, y: 228, fontSize: 10, color: '#6b7280', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-year', content: '{{Study Year}}', x: 144, y: 244, fontSize: 10, color: '#6b7280', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-dob', content: 'DOB: {{Date of Birth}}', x: 144, y: 260, fontSize: 9, color: '#9ca3af', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-phone', content: 'Tel: {{Phone}}', x: 144, y: 275, fontSize: 9, color: '#9ca3af', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-qrlbl', content: 'QR Attendance', x: 224, y: 400, fontSize: 8, color: '#7c3aed', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sgm-valid', content: 'Valid: June 2026', x: 20, y: 408, fontSize: 8, color: '#9ca3af', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};

// 5. Minimal Clean — white card, thin accent line, elegant typography
export const STUDENT_MINIMAL: CardDesign = {
  cardType: 'student', size: 'a7', width: 298, height: 420,
  backgroundColor: '#ffffff', frameColor: '#e2e8f0', frameWidth: 1,
  photo: { x: 99, y: 55, width: 100, height: 100, borderRadius: 50, borderColor: '#e2e8f0', borderWidth: 2, zIndex: 5 },
  qr: { x: 99, y: 295, size: 100, width: 100, height: 100, borderRadius: 0, borderColor: '#e2e8f0', borderWidth: 1, zIndex: 5 },
  shapes: [
    gs('sml-topbar', 'rectangle', 0, 0, 298, 8, '#f59e0b', { zIndex: 1 }),
    gs('sml-botbar', 'rectangle', 0, 412, 298, 8, '#f59e0b', { zIndex: 1 }),
    gs('sml-sep1', 'line', 40, 172, 218, 1, '#e2e8f0', { borderColor: '#e2e8f0', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sml-sep2', 'line', 40, 290, 218, 1, '#e2e8f0', { borderColor: '#e2e8f0', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sml-accent', 'rectangle', 130, 18, 4, 30, '#f59e0b', { zIndex: 2, borderRadius: 2 }),
  ],
  texts: [
    { id: 'sml-school', content: 'Wattanman Academy', x: 149, y: 22, fontSize: 15, color: '#1e293b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-title', content: 'STUDENT ID CARD', x: 149, y: 42, fontSize: 8, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-name', content: '{{Student Name}}', x: 149, y: 180, fontSize: 18, color: '#0f172a', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-id', content: '{{Student ID}}', x: 149, y: 202, fontSize: 11, color: '#f59e0b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-class', content: '{{Class Name}}', x: 149, y: 220, fontSize: 10, color: '#64748b', fontWeight: 'normal', fontStyle: 'italic', textAlign: 'center' },
    { id: 'sml-year', content: '{{Study Year}}', x: 149, y: 236, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-dob', content: 'DOB: {{Date of Birth}}', x: 149, y: 253, fontSize: 9, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-phone', content: 'Tel: {{Phone}}', x: 149, y: 268, fontSize: 9, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sml-qrlbl', content: 'SCAN FOR ATTENDANCE', x: 149, y: 402, fontSize: 7, color: '#cbd5e1', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
  ],
  logos: [],
};

// ─── STAFF PRESET TEMPLATES ───────────────────────────────────────────────────

// 6. Corporate Teal — professional teal gradient header, portrait
export const STAFF_CORPORATE_TEAL: CardDesign = {
  cardType: 'staff', size: 'a7', width: 298, height: 420,
  backgroundColor: '#f0fdfa', frameColor: '#0d9488', frameWidth: 3,
  photo: { x: 99, y: 70, width: 100, height: 100, borderRadius: 50, borderColor: '#0d9488', borderWidth: 3, zIndex: 5 },
  qr: { x: 179, y: 305, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#99f6e4', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('sct-hdr', 'rectangle', 0, 0, 298, 60, '#0d9488', { zIndex: 1, gradient: { enabled: true, type: 'linear', angle: 135, stops: [{ offset: 0, color: '#0f766e' }, { offset: 1, color: '#2dd4bf' }] } }),
    gs('sct-bot', 'rectangle', 0, 400, 298, 20, '#0d9488', { zIndex: 1 }),
    gs('sct-sep', 'line', 20, 185, 258, 1, '#0d9488', { borderColor: '#0d9488', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sct-qrbg', 'rectangle', 175, 300, 98, 98, '#ccfbf1', { borderRadius: 6, borderColor: '#99f6e4', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'sct-school', content: 'Wattanman Academy', x: 149, y: 16, fontSize: 14, color: '#ffffff', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-title', content: 'STAFF ID CARD', x: 149, y: 36, fontSize: 10, color: '#99f6e4', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-name', content: '{{Staff Name}}', x: 149, y: 195, fontSize: 18, color: '#134e4a', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-pos', content: '{{Position}}', x: 149, y: 218, fontSize: 11, color: '#0d9488', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-id', content: 'ID: {{Emp ID}}', x: 149, y: 238, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-dept', content: 'Dept: {{Department}}', x: 149, y: 255, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-phone', content: 'Tel: {{Phone}}', x: 149, y: 272, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-qrlbl', content: 'SCAN FOR ATTENDANCE', x: 224, y: 403, fontSize: 7, color: '#0d9488', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sct-valid', content: 'Valid: June 2026', x: 20, y: 408, fontSize: 8, color: '#99f6e4', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};

// 7. Deep Ocean — dark navy with gold accents
export const STAFF_DEEP_OCEAN: CardDesign = {
  cardType: 'staff', size: 'a7', width: 298, height: 420,
  backgroundColor: '#0c1a2e', frameColor: '#f59e0b', frameWidth: 0,
  photo: { x: 99, y: 65, width: 100, height: 100, borderRadius: 50, borderColor: '#f59e0b', borderWidth: 3, zIndex: 6 },
  qr: { x: 99, y: 298, size: 100, width: 100, height: 100, borderRadius: 4, borderColor: '#1e3a5f', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('sdo-topbar', 'rectangle', 0, 0, 298, 6, '#f59e0b', { zIndex: 3 }),
    gs('sdo-botbar', 'rectangle', 0, 414, 298, 6, '#f59e0b', { zIndex: 3 }),
    gs('sdo-bg2', 'rectangle', 0, 0, 298, 55, '#0f2744', { zIndex: 1 }),
    gs('sdo-accent', 'rectangle', 220, 0, 78, 420, '#f59e0b', { zIndex: 1, opacity: 0.05 }),
    gs('sdo-sep', 'line', 20, 182, 258, 1, '#f59e0b', { borderColor: '#f59e0b', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sdo-sep2', 'line', 20, 292, 258, 1, '#1e3a5f', { borderColor: '#1e3a5f', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sdo-qrbg', 'rectangle', 94, 293, 110, 110, '#0f2744', { borderRadius: 6, borderColor: '#1e3a5f', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'sdo-school', content: 'Wattanman Academy', x: 149, y: 17, fontSize: 13, color: '#f59e0b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-title', content: 'STAFF ID CARD', x: 149, y: 36, fontSize: 9, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-name', content: '{{Staff Name}}', x: 149, y: 190, fontSize: 18, color: '#f8fafc', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-pos', content: '{{Position}}', x: 149, y: 213, fontSize: 10, color: '#f59e0b', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-id', content: 'ID: {{Emp ID}}', x: 149, y: 232, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-dept', content: '{{Department}}', x: 149, y: 250, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-phone', content: 'Tel: {{Phone}}', x: 149, y: 267, fontSize: 10, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sdo-qrlbl', content: 'Attendance QR', x: 149, y: 410, fontSize: 8, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
  ],
  logos: [],
};

// 8. Rose Professional — warm rose/pink professional style
export const STAFF_ROSE: CardDesign = {
  cardType: 'staff', size: 'a7', width: 298, height: 420,
  backgroundColor: '#fff1f2', frameColor: '#e11d48', frameWidth: 0,
  photo: { x: 29, y: 60, width: 100, height: 100, borderRadius: 50, borderColor: '#fecdd3', borderWidth: 3, zIndex: 6 },
  qr: { x: 179, y: 298, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#fecdd3', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('srs-hdr', 'rectangle', 0, 0, 298, 55, '#e11d48', { zIndex: 1, gradient: { enabled: true, type: 'linear', angle: 135, stops: [{ offset: 0, color: '#9f1239' }, { offset: 1, color: '#fb7185' }] } }),
    gs('srs-bot', 'rectangle', 0, 400, 298, 20, '#e11d48', { zIndex: 1, opacity: 0.15 }),
    gs('srs-nameband', 'rectangle', 0, 172, 298, 28, '#ffe4e6', { zIndex: 1 }),
    gs('srs-sep', 'line', 20, 220, 258, 1, '#fecdd3', { borderColor: '#fecdd3', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('srs-qrbg', 'rectangle', 175, 293, 98, 98, '#ffe4e6', { borderRadius: 6, borderColor: '#fecdd3', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'srs-school', content: 'Wattanman Academy', x: 149, y: 16, fontSize: 14, color: '#ffffff', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-title', content: 'STAFF ID CARD', x: 149, y: 36, fontSize: 9, color: '#fecdd3', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-name', content: '{{Staff Name}}', x: 144, y: 178, fontSize: 16, color: '#9f1239', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-pos', content: '{{Position}}', x: 144, y: 204, fontSize: 11, color: '#e11d48', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-id', content: 'ID: {{Emp ID}}', x: 144, y: 225, fontSize: 10, color: '#4c0519', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-dept', content: '{{Department}}', x: 144, y: 243, fontSize: 10, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-phone', content: 'Tel: {{Phone}}', x: 144, y: 260, fontSize: 10, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-qrlbl', content: 'Attendance QR', x: 224, y: 395, fontSize: 8, color: '#e11d48', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'srs-valid', content: 'Valid: June 2026', x: 20, y: 408, fontSize: 8, color: '#fda4af', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};

// 9. Forest Green — earthy green with nature tones
export const STAFF_FOREST: CardDesign = {
  cardType: 'staff', size: 'a7', width: 298, height: 420,
  backgroundColor: '#f0fdf4', frameColor: '#16a34a', frameWidth: 2,
  photo: { x: 99, y: 65, width: 100, height: 100, borderRadius: 50, borderColor: '#16a34a', borderWidth: 3, zIndex: 6 },
  qr: { x: 179, y: 300, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#bbf7d0', borderWidth: 2, zIndex: 5 },
  shapes: [
    gs('sfr-hdr', 'rectangle', 0, 0, 298, 55, '#166534', { zIndex: 1 }),
    gs('sfr-hdrstrip', 'rectangle', 0, 55, 298, 8, '#4ade80', { zIndex: 2, opacity: 0.6 }),
    gs('sfr-bot', 'rectangle', 0, 407, 298, 13, '#166534', { zIndex: 1 }),
    gs('sfr-sep', 'line', 20, 185, 258, 1, '#86efac', { borderColor: '#86efac', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sfr-sep2', 'line', 20, 290, 258, 1, '#d1fae5', { borderColor: '#d1fae5', borderWidth: 1, lineStyle: 'dashed', zIndex: 2 }),
    gs('sfr-qrbg', 'rectangle', 175, 295, 98, 98, '#dcfce7', { borderRadius: 6, borderColor: '#bbf7d0', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'sfr-school', content: 'Wattanman Academy', x: 149, y: 16, fontSize: 14, color: '#ffffff', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-title', content: 'STAFF ID CARD', x: 149, y: 36, fontSize: 9, color: '#86efac', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-name', content: '{{Staff Name}}', x: 149, y: 194, fontSize: 17, color: '#14532d', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-pos', content: '{{Position}}', x: 149, y: 216, fontSize: 11, color: '#16a34a', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-id', content: 'ID: {{Emp ID}}', x: 149, y: 236, fontSize: 10, color: '#374151', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-dept', content: '{{Department}}', x: 149, y: 254, fontSize: 10, color: '#374151', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-phone', content: 'Tel: {{Phone}}', x: 149, y: 272, fontSize: 10, color: '#374151', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-qrlbl', content: 'Attendance QR', x: 224, y: 398, fontSize: 8, color: '#16a34a', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sfr-valid', content: 'Valid: June 2026', x: 20, y: 408, fontSize: 8, color: '#86efac', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};

// 10. Slate Executive — sophisticated dark slate, clean lines
export const STAFF_SLATE_EXECUTIVE: CardDesign = {
  cardType: 'staff', size: 'a7', width: 298, height: 420,
  backgroundColor: '#f8fafc', frameColor: '#334155', frameWidth: 0,
  photo: { x: 29, y: 62, width: 100, height: 100, borderRadius: 50, borderColor: '#334155', borderWidth: 2, zIndex: 6 },
  qr: { x: 179, y: 298, size: 90, width: 90, height: 90, borderRadius: 4, borderColor: '#e2e8f0', borderWidth: 1, zIndex: 5 },
  shapes: [
    gs('sse-hdr', 'rectangle', 0, 0, 298, 55, '#1e293b', { zIndex: 1 }),
    gs('sse-accent', 'rectangle', 0, 55, 298, 5, '#f97316', { zIndex: 2 }),
    gs('sse-bot', 'rectangle', 0, 408, 298, 12, '#1e293b', { zIndex: 1 }),
    gs('sse-sidebar', 'rectangle', 0, 60, 6, 348, '#f97316', { zIndex: 2, opacity: 0.5 }),
    gs('sse-nameband', 'rectangle', 0, 175, 298, 1, '#e2e8f0', { zIndex: 2 }),
    gs('sse-nameband2', 'rectangle', 0, 218, 298, 1, '#e2e8f0', { zIndex: 2 }),
    gs('sse-sep', 'line', 140, 290, 130, 1, '#e2e8f0', { borderColor: '#e2e8f0', borderWidth: 1, lineStyle: 'solid', zIndex: 2 }),
    gs('sse-qrbg', 'rectangle', 175, 293, 98, 98, '#f1f5f9', { borderRadius: 4, borderColor: '#e2e8f0', borderWidth: 1, zIndex: 2 }),
  ],
  texts: [
    { id: 'sse-school', content: 'Wattanman Academy', x: 149, y: 16, fontSize: 14, color: '#f8fafc', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sse-title', content: 'STAFF ID CARD', x: 149, y: 36, fontSize: 9, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sse-name', content: '{{Staff Name}}', x: 149, y: 185, fontSize: 17, color: '#0f172a', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sse-pos', content: '{{Position}}', x: 149, y: 206, fontSize: 10, color: '#f97316', fontWeight: 'bold', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sse-id', content: 'ID: {{Emp ID}}', x: 30, y: 230, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sse-dept', content: 'Dept: {{Department}}', x: 30, y: 247, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sse-phone', content: 'Tel: {{Phone}}', x: 30, y: 264, fontSize: 10, color: '#475569', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
    { id: 'sse-qrlbl', content: 'Attendance QR', x: 224, y: 397, fontSize: 8, color: '#64748b', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'center' },
    { id: 'sse-valid', content: 'Valid: June 2026', x: 30, y: 408, fontSize: 8, color: '#94a3b8', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left' },
  ],
  logos: [],
};
