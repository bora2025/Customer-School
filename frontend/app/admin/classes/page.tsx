'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Sidebar from '../../../components/Sidebar';
import { adminNav, classAdminNav } from '../../../lib/admin-nav';
import { apiFetch } from '../../../lib/api';
import { useLanguage } from '../../../lib/i18n';
import { downloadStudentsCsv } from '../../../lib/exportCsv';

interface StudyYear {
  id: string;
  year: number;
  label: string | null;
  isCurrent: boolean;
}

interface Class {
  id: string;
  name: string;
  subject: string;
  teacherId: string;
  teacher?: { name: string };
  classAdminId?: string | null;
  classAdmin?: { name: string } | null;
  studyYearId?: string;
  studyYear?: StudyYear | null;
  schedule?: string;
  registrationStatus?: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN';
  thumbnail?: string | null;
  description?: string | null;
  price?: number | null;
  showPrice?: boolean;
}

interface TimetableListItem { id: string; name: string; academicYear: string }
interface TTClass { id: string; name: string }

interface Teacher {
  id: string;
  name: string;
  email: string;
}

interface Student {
  id: string;
  studentNumber: string;
  name: string;
  nameKh?: string;
  email: string;
  phone: string;
  photo: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  address: string;
  generation?: string;
  parentId?: string | null;
  parent?: { id: string; name: string; email: string; phone: string | null } | null;
  customFieldValues?: Record<string, string | string[]>;
}
interface CustomFieldDef { id: string; key: string; label: string; required: boolean; fieldType: 'TEXT' | 'SELECT' | 'MULTI_SELECT'; options: string[] | null }

interface ParentOption {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

interface SessionConfigItem {
  session: number;
  type: string;
  startTime: string;
  endTime: string;
}

const ATTENDANCE_PRESETS = [
  {
    id: 'global-default',
    name: 'Global Default',
    icon: '🌐',
    description: 'Inherits from Session Settings',
    color: 'slate',
    configs: [] as SessionConfigItem[],
  },
  {
    id: 'full-day',
    name: 'Full Day',
    icon: '☀️',
    description: '7:00 AM – 5:00 PM',
    color: 'indigo',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:15' },
      { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:15' },
    ],
  },
  {
    id: 'morning-only',
    name: 'Morning Only',
    icon: '🌅',
    description: '7:00 AM – 12:00 PM',
    color: 'amber',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '11:45', endTime: '12:00' },
      { session: 3, type: 'CHECK_IN', startTime: '12:00', endTime: '12:00' },
      { session: 4, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:00' },
    ],
  },
  {
    id: 'afternoon-only',
    name: 'Afternoon Only',
    icon: '🌤️',
    description: '1:00 PM – 5:30 PM',
    color: 'orange',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '13:00', endTime: '13:00' },
      { session: 2, type: 'CHECK_OUT', startTime: '13:00', endTime: '13:00' },
      { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:15', endTime: '17:30' },
    ],
  },
  {
    id: 'evening',
    name: 'Evening',
    icon: '🌆',
    description: '6:00 PM – 9:00 PM',
    color: 'purple',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '18:00', endTime: '18:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '20:45', endTime: '21:00' },
      { session: 3, type: 'CHECK_IN', startTime: '21:00', endTime: '21:00' },
      { session: 4, type: 'CHECK_OUT', startTime: '21:00', endTime: '21:00' },
    ],
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    icon: '🌙',
    description: '6:00 PM – 6:00 AM',
    color: 'slate',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '18:00', endTime: '18:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '23:45', endTime: '23:59' },
      { session: 3, type: 'CHECK_IN', startTime: '00:00', endTime: '00:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '05:45', endTime: '06:00' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '🔧',
    description: 'Set your own times',
    color: 'amber',
    configs: [
      { session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '07:15' },
      { session: 2, type: 'CHECK_OUT', startTime: '12:00', endTime: '12:15' },
      { session: 3, type: 'CHECK_IN', startTime: '13:00', endTime: '13:15' },
      { session: 4, type: 'CHECK_OUT', startTime: '17:00', endTime: '17:15' },
    ],
  },
];

const SESSION_LABELS: Record<number, string> = {
  1: 'Session 1 (Check-In)',
  2: 'Session 2 (Check-Out)',
  3: 'Session 3 (Check-In)',
  4: 'Session 4 (Check-Out)',
};

const DAYS_OF_WEEK = [
  { key: 'MON', label: 'Mon', full: 'Monday' },
  { key: 'TUE', label: 'Tue', full: 'Tuesday' },
  { key: 'WED', label: 'Wed', full: 'Wednesday' },
  { key: 'THU', label: 'Thu', full: 'Thursday' },
  { key: 'FRI', label: 'Fri', full: 'Friday' },
  { key: 'SAT', label: 'Sat', full: 'Saturday' },
  { key: 'SUN', label: 'Sun', full: 'Sunday' },
];

const DEFAULT_SCHEDULE: Record<string, string> = {
  MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'same', SUN: 'same',
};

const DAY_PRESETS = [
  { value: 'same', label: 'Same', icon: '📋', color: 'slate' },
  { value: 'day-off', label: 'Day Off', icon: '🚫', color: 'red' },
  { value: 'full-day', label: 'Full Day', icon: '☀️', color: 'indigo' },
  { value: 'morning-only', label: 'Morning', icon: '🌅', color: 'amber' },
  { value: 'afternoon-only', label: 'Afternoon', icon: '🌤️', color: 'orange' },
  { value: 'evening', label: 'Evening', icon: '🌆', color: 'purple' },
  { value: 'night-shift', label: 'Night', icon: '🌙', color: 'slate' },
];

const DAY_COLORS: Record<string, string> = {
  same: 'bg-slate-100 text-slate-600 border-slate-200',
  'day-off': 'bg-red-50 text-red-600 border-red-200',
  'full-day': 'bg-indigo-50 text-indigo-600 border-indigo-200',
  'morning-only': 'bg-amber-50 text-amber-600 border-amber-200',
  'afternoon-only': 'bg-orange-50 text-orange-600 border-orange-200',
  evening: 'bg-purple-50 text-purple-600 border-purple-200',
  'night-shift': 'bg-slate-100 text-slate-600 border-slate-300',
};

const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024; // 3MB source file cap

const REGISTRATION_STATUS_META: Record<string, { label: string; className: string }> = {
  AVAILABLE: { label: '🟢 Open for Registration', className: 'bg-emerald-100 text-emerald-700' },
  UNAVAILABLE: { label: '🟡 Registration Closed', className: 'bg-amber-100 text-amber-700' },
  HIDDEN: { label: '⚪ Hidden', className: 'bg-slate-100 text-slate-500' },
};

export default function ManageClassesPage() {
  return (
    <Suspense>
      <ManageClasses />
    </Suspense>
  );
}

function ManageClasses() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const urlStudyYearId = searchParams.get('studyYearId');
  const pluginMode = searchParams.get('source') === 'plugin';
  const academicApi = (path: string) => pluginMode
    ? `/api/plugin-api/wattanam.academic-management/${path}`
    : `/api/${path}`;
  const [classes, setClasses] = useState<Class[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classAdmins, setClassAdmins] = useState<Teacher[]>([]);
  const [studyYears, setStudyYears] = useState<StudyYear[]>([]);
  const [selectedStudyYearId, setSelectedStudyYearId] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingClass, setEditingClass] = useState<Class | null>(null);
  const [formData, setFormData] = useState({ name: '', subject: '', teacherId: '', classAdminId: '', studyYearId: '', registrationStatus: 'HIDDEN', thumbnail: '', description: '', price: '', showPrice: false });
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [classStudents, setClassStudents] = useState<Student[]>([]);
  const [availableStudents, setAvailableStudents] = useState<Student[]>([]);
  const [newStudentForm, setNewStudentForm] = useState({ name: '', nameKh: '', email: '', password: '', sex: '', photo: '', phone: '', dateOfBirth: '', address: '', generation: '', studentNumber: '' });
  const [showAddStudentForm, setShowAddStudentForm] = useState(false);
  const [editingStudent, setEditingStudent] = useState<string | null>(null);
  const [editStudentData, setEditStudentData] = useState({ name: '', nameKh: '', sex: '', phone: '', photo: '', dateOfBirth: '', address: '', generation: '', studentNumber: '', parentId: '' });
  const [editStudentCustomFields, setEditStudentCustomFields] = useState<Record<string, string | string[]>>({});
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [parents, setParents] = useState<ParentOption[]>([]);
  const [savingStudent, setSavingStudent] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoPreviewError, setPhotoPreviewError] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<{ total: number; success: number; errors: number; skipped: number; details: { row: number; id: string; name: string; email: string; status: string; error?: string }[] } | null>(null);
  // UI/UX upgrades
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'subject' | 'teacher' | 'students'>('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [classStudentCounts, setClassStudentCounts] = useState<Record<string, number>>({});
  const [selectedPreset, setSelectedPreset] = useState('global-default');
  const [classFormats, setClassFormats] = useState<Record<string, { preset: string; name: string; icon: string }>>({}); 
  const [customConfigs, setCustomConfigs] = useState<SessionConfigItem[]>([]);
  const [weeklySchedule, setWeeklySchedule] = useState<Record<string, string>>({ ...DEFAULT_SCHEDULE });
  const [showWeekly, setShowWeekly] = useState(false);

  // Add to Timetable modal
  const [timetables, setTimetables] = useState<TimetableListItem[]>([]);
  const [showAddToTT, setShowAddToTT] = useState(false);
  const [addToTTClass, setAddToTTClass] = useState<Class | null>(null);
  const [addToTTSelectedTT, setAddToTTSelectedTT] = useState('');
  const [addToTTShort, setAddToTTShort] = useState('');
  const [addToTTColor, setAddToTTColor] = useState('#3b82f6');
  const [addToTTSaving, setAddToTTSaving] = useState(false);
  const [addToTTExisting, setAddToTTExisting] = useState<TTClass[]>([]);

  useEffect(() => { fetchStudyYears(); fetchTeachers(); fetchClassAdmins(); fetchTimetableList(); }, []);

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

  // Load classes when study year changes
  useEffect(() => {
    fetchClasses();
  }, [selectedStudyYearId]);

  // Set initial study year from URL or current
  useEffect(() => {
    if (studyYears.length > 0 && !selectedStudyYearId) {
      if (urlStudyYearId) {
        setSelectedStudyYearId(urlStudyYearId);
      } else {
        const current = studyYears.find(sy => sy.isCurrent);
        if (current) setSelectedStudyYearId(current.id);
      }
    }
  }, [studyYears, urlStudyYearId]);

  useEffect(() => {
    if (!formData || typeof formData.name === 'undefined') {
      setFormData({ name: '', subject: '', teacherId: '', classAdminId: '', studyYearId: '', registrationStatus: 'HIDDEN', thumbnail: '', description: '', price: '', showPrice: false });
    }
  }, [formData]);

  // Restore view mode preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin.classes.viewMode');
      if (saved === 'grid' || saved === 'list') setViewMode(saved);
      const savedSort = localStorage.getItem('admin.classes.sortBy');
      if (savedSort === 'name' || savedSort === 'subject' || savedSort === 'teacher' || savedSort === 'students') setSortBy(savedSort);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem('admin.classes.viewMode', viewMode); } catch {} }, [viewMode]);
  useEffect(() => { try { localStorage.setItem('admin.classes.sortBy', sortBy); } catch {} }, [sortBy]);

  // Derived: filtered & sorted classes
  const filteredClasses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = classes;
    if (q) {
      list = list.filter(c =>
        c.name?.toLowerCase().includes(q) ||
        c.subject?.toLowerCase().includes(q) ||
        c.teacher?.name?.toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'subject') return (a.subject || '').localeCompare(b.subject || '');
      if (sortBy === 'teacher') return (a.teacher?.name || '').localeCompare(b.teacher?.name || '');
      if (sortBy === 'students') return (classStudentCounts[b.id] || 0) - (classStudentCounts[a.id] || 0);
      return 0;
    });
    return sorted;
  }, [classes, searchQuery, sortBy, classStudentCounts]);

  // Stats summary
  const totalStudents = useMemo(() => Object.values(classStudentCounts).reduce((a, b) => a + b, 0), [classStudentCounts]);
  const uniqueTeachers = useMemo(() => {
    const set = new Set<string>();
    classes.forEach(c => { if (c.teacherId) set.add(c.teacherId); });
    return set.size;
  }, [classes]);
  const avgStudentsPerClass = classes.length > 0 ? Math.round(totalStudents / classes.length) : 0;

  // Subject-based gradient palette
  const SUBJECT_THEMES: { from: string; to: string; ring: string; chip: string; emoji: string }[] = [
    { from: 'from-indigo-500', to: 'to-violet-600', ring: 'ring-indigo-200', chip: 'bg-indigo-100 text-indigo-700', emoji: '📘' },
    { from: 'from-emerald-500', to: 'to-teal-600', ring: 'ring-emerald-200', chip: 'bg-emerald-100 text-emerald-700', emoji: '📗' },
    { from: 'from-rose-500', to: 'to-pink-600', ring: 'ring-rose-200', chip: 'bg-rose-100 text-rose-700', emoji: '📕' },
    { from: 'from-amber-500', to: 'to-orange-600', ring: 'ring-amber-200', chip: 'bg-amber-100 text-amber-700', emoji: '📙' },
    { from: 'from-sky-500', to: 'to-cyan-600', ring: 'ring-sky-200', chip: 'bg-sky-100 text-sky-700', emoji: '📓' },
    { from: 'from-fuchsia-500', to: 'to-purple-600', ring: 'ring-fuchsia-200', chip: 'bg-fuchsia-100 text-fuchsia-700', emoji: '📔' },
  ];
  const themeFor = (cls: Class) => {
    const key = (cls.subject || cls.name || '').toLowerCase();
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return SUBJECT_THEMES[hash % SUBJECT_THEMES.length];
  };

  const detectPreset = (configs: any[]): string => {
    for (const preset of ATTENDANCE_PRESETS) {
      if (preset.id === 'global-default' || preset.id === 'custom' || preset.configs.length === 0) continue;
      const match = preset.configs.every((pc) => {
        const c = configs.find((x: any) => x.session === pc.session);
        return c && c.type === pc.type && c.startTime === pc.startTime && c.endTime === pc.endTime;
      });
      if (match) return preset.id;
    }
    return 'custom';
  };

  const updateCustomConfig = (session: number, field: 'type' | 'startTime' | 'endTime', value: string) => {
    setCustomConfigs(prev => prev.map(c => c.session === session ? { ...c, [field]: value } : c));
    setSelectedPreset('custom');
  };

  const fetchClassFormats = async (classList: Class[]) => {
    const formats: Record<string, { preset: string; name: string; icon: string }> = {};
    await Promise.all(classList.map(async (cls) => {
      try {
        const res = await apiFetch(`/api/session-config?classId=${encodeURIComponent(cls.id)}`);
        if (res.ok) {
          const configs = await res.json();
          if (configs.length > 0 && configs[0].classId === cls.id) {
            const detected = detectPreset(configs);
            const preset = ATTENDANCE_PRESETS.find(p => p.id === detected);
            formats[cls.id] = {
              preset: detected,
              name: preset?.name || 'Custom',
              icon: preset?.icon || '🔧',
            };
          }
        }
      } catch (err) { /* ignore */ }
    }));
    setClassFormats(formats);
  };

  const fetchClasses = async () => {
    try {
      setLoadingClasses(true);
      const params = selectedStudyYearId ? `?studyYearId=${selectedStudyYearId}` : '';
      const res = await apiFetch(academicApi(`classes${params}`));
      if (res.ok) {
        const data = await res.json();
        setClasses(data);
        fetchClassFormats(data);
        fetchClassCounts(data);
      }
    } catch (err) { console.error('Failed to fetch classes'); }
    finally { setLoadingClasses(false); }
  };

  const fetchClassCounts = async (classList: Class[]) => {
    const counts: Record<string, number> = {};
    await Promise.all(classList.map(async (cls) => {
      try {
        const res = await apiFetch(academicApi(`classes/${cls.id}/students`));
        if (res.ok) {
          const list = await res.json();
          counts[cls.id] = Array.isArray(list) ? list.length : 0;
        }
      } catch { counts[cls.id] = 0; }
    }));
    setClassStudentCounts(counts);
  };

  const fetchTeachers = async () => {
    try {
      const res = await apiFetch('/api/auth/users?roles=TEACHER,CLASS_ADMIN');
      if (res.ok) setTeachers(await res.json());
    } catch (err) { console.error('Failed to fetch teachers'); }
  };

  const fetchClassAdmins = async () => {
    try {
      const res = await apiFetch('/api/auth/users?role=CLASS_ADMIN');
      if (res.ok) setClassAdmins(await res.json());
    } catch (err) { console.error('Failed to fetch class admins'); }
  };

  const fetchStudyYears = async () => {
    try {
      const res = await apiFetch(academicApi('study-years'));
      if (res.ok) setStudyYears(await res.json());
    } catch (err) { console.error('Failed to fetch study years'); }
  };

  const fetchTimetableList = async () => {
    try {
      const res = await apiFetch('/api/timetable');
      if (res.ok) setTimetables(await res.json());
    } catch { }
  };

  function autoShort(name: string) {
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return name.slice(0, 5).toUpperCase();
    return words.map(w => w[0]).join('').slice(0, 6).toUpperCase();
  }

  async function openAddToTT(cls: Class) {
    setAddToTTClass(cls);
    setAddToTTShort(autoShort(cls.name));
    setAddToTTColor('#3b82f6');
    setAddToTTExisting([]);
    const ttId = timetables[0]?.id ?? '';
    setAddToTTSelectedTT(ttId);
    if (ttId) {
      const res = await apiFetch(`/api/timetable/${ttId}`);
      if (res.ok) { const tt = await res.json(); setAddToTTExisting(tt.classes ?? []); }
    }
    setShowAddToTT(true);
  }

  async function handleAddToTTSave() {
    if (!addToTTClass || !addToTTSelectedTT || !addToTTShort) return;
    setAddToTTSaving(true);
    await apiFetch(`/api/timetable/${addToTTSelectedTT}/classes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: addToTTClass.name, short: addToTTShort, color: addToTTColor, printSubjectPicture: false }),
    });
    setAddToTTSaving(false);
    setShowAddToTT(false);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const method = editingClass ? 'PUT' : 'POST';
      const url = editingClass ? `/api/classes/${editingClass.id}` : '/api/classes';
      const payload = {
        ...formData,
        price: formData.price.trim() === '' ? null : parseFloat(formData.price),
      };
      const res = await apiFetch(pluginMode ? url.replace('/api/classes', '/api/plugin-api/wattanam.academic-management/classes') : url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const savedClass = await res.json();
        // Save weekly schedule
        const scheduleJson = showWeekly ? JSON.stringify(weeklySchedule) : null;
        if (scheduleJson || editingClass) {
          await apiFetch(academicApi(`classes/${savedClass.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule: scheduleJson }),
          });
        }
        const preset = ATTENDANCE_PRESETS.find(p => p.id === selectedPreset);
        if (selectedPreset === 'global-default') {
          if (editingClass) {
            await apiFetch(`/api/session-config?classId=${encodeURIComponent(savedClass.id)}`, {
              method: 'DELETE',
            });
          }
        } else if (customConfigs.length > 0) {
          await apiFetch('/api/session-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classId: savedClass.id,
              scope: 'CLASS',
              configs: customConfigs,
            }),
          });
        }
        fetchClasses();
        setShowForm(false);
        setEditingClass(null);
        setFormData({ name: '', subject: '', teacherId: '', classAdminId: '', studyYearId: '', registrationStatus: 'HIDDEN', thumbnail: '', description: '', price: '', showPrice: false });
        setSelectedPreset('global-default');
        setCustomConfigs([]);
        setWeeklySchedule({ ...DEFAULT_SCHEDULE });
        setShowWeekly(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'Failed to save class');
      }
    } catch (err) { console.error('Failed to save class'); }
  };

  const handleEdit = async (cls: Class) => {
    setEditingClass(cls);
    setFormData({ name: cls.name || '', subject: cls.subject || '', teacherId: cls.teacherId || '', classAdminId: cls.classAdminId || '', studyYearId: cls.studyYearId || '', registrationStatus: cls.registrationStatus || 'HIDDEN', thumbnail: cls.thumbnail || '', description: cls.description || '', price: cls.price != null ? String(cls.price) : '', showPrice: cls.showPrice || false });
    setShowForm(true);
    // Load weekly schedule
    if (cls.schedule) {
      try {
        const parsed = JSON.parse(cls.schedule);
        setWeeklySchedule(parsed);
        setShowWeekly(Object.values(parsed).some((v: any) => v !== 'same'));
      } catch {
        setWeeklySchedule({ ...DEFAULT_SCHEDULE });
        setShowWeekly(false);
      }
    } else {
      setWeeklySchedule({ ...DEFAULT_SCHEDULE });
      setShowWeekly(false);
    }
    try {
      const res = await apiFetch(`/api/session-config?classId=${encodeURIComponent(cls.id)}`);
      if (res.ok) {
        const configs = await res.json();
        if (configs.length > 0 && configs[0].classId === cls.id) {
          const loaded = configs.map((c: any) => ({ session: c.session, type: c.type, startTime: c.startTime, endTime: c.endTime }));
          const detected = detectPreset(configs);
          setSelectedPreset(detected);
          setCustomConfigs(loaded);
        } else {
          setSelectedPreset('global-default');
          setCustomConfigs([]);
        }
      }
    } catch (err) {
      setSelectedPreset('global-default');
      setCustomConfigs([]);
    }
  };

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setThumbnailError(null);
    if (!file) return;
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setThumbnailError('Thumbnail must be smaller than 3MB');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFormData(prev => ({ ...prev, thumbnail: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this class?')) {
      try {
        const res = await apiFetch(academicApi(`classes/${id}`), { method: 'DELETE' });
        if (res.ok) fetchClasses();
      } catch (err) { console.error('Failed to delete class'); }
    }
  };

  const handleManageStudents = async (cls: Class) => {
    setSelectedClass(cls);
    setNewStudentForm({ name: '', nameKh: '', email: '', password: '', sex: '', photo: '', phone: '', dateOfBirth: '', address: '', generation: '', studentNumber: '' });
    setShowAddStudentForm(false);
    await fetchClassStudents(cls.id);
    await fetchAvailableStudents(cls.id);
    setShowStudentModal(true);
  };

  const fetchClassStudents = async (classId: string) => {
    try {
      const res = await apiFetch(academicApi(`classes/${classId}/students`));
      if (res.ok) setClassStudents(await res.json());
    } catch (err) { console.error('Failed to fetch class students'); }
  };

  const fetchAvailableStudents = async (classId: string) => {
    try {
      const res = await apiFetch(academicApi(`classes/${classId}/available-students`));
      if (res.ok) setAvailableStudents(await res.json());
    } catch (err) { console.error('Failed to fetch available students'); }
  };

  const handleAddStudent = async (studentId: string) => {
    if (!selectedClass) return;
    try {
      const res = await apiFetch(academicApi(`classes/${selectedClass.id}/students`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId }),
      });
      if (res.ok) {
        await fetchClassStudents(selectedClass.id);
        await fetchAvailableStudents(selectedClass.id);
      }
    } catch (err) { console.error('Failed to add student'); }
  };

  const handleRemoveStudent = async (studentId: string, studentName: string) => {
    if (!selectedClass) return;
    const confirmed = window.confirm(
      `Permanently delete "${studentName}" from the database?\n\nThis will remove all their attendance records, fee records, and user account. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const res = await apiFetch(academicApi(`classes/${selectedClass.id}/students/${studentId}`), { method: 'DELETE' });
      if (res.ok) {
        await fetchClassStudents(selectedClass.id);
        await fetchAvailableStudents(selectedClass.id);
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Failed to delete student: ${body?.message ?? res.statusText}`);
      }
    } catch (err) { console.error('Failed to delete student', err); }
  };

  const handleEditStudent = (student: Student) => {
    setEditingStudent(student.id);
    setSaveError(null);
    setPhotoPreviewError(false);
    setEditStudentData({ name: student.name || '', nameKh: student.nameKh || '', sex: student.sex || '', phone: student.phone || '', photo: student.photo || '', dateOfBirth: student.dateOfBirth ? student.dateOfBirth.slice(0, 10) : '', address: student.address || '', generation: student.generation || '', studentNumber: student.studentNumber || '', parentId: student.parentId || '' });
    setEditStudentCustomFields(student.customFieldValues || {});
    // Lazy-load parent list once
    if (parents.length === 0) {
      apiFetch(academicApi('classes/parents'))
        .then(r => r.ok ? r.json() : [])
        .then((list: ParentOption[]) => setParents(Array.isArray(list) ? list : []))
        .catch(() => {});
    }
  };

  const handleSaveStudent = async (studentId: string) => {
    if (!selectedClass) return;
    setSavingStudent(true);
    setSaveError(null);
    try {
      const res = await apiFetch(academicApi(`classes/${selectedClass.id}/students/${studentId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editStudentData, parentId: editStudentData.parentId || null, customFieldValues: editStudentCustomFields }),
      });
      if (res.ok) {
        await fetchClassStudents(selectedClass.id);
        setEditingStudent(null);
      } else {
        let msg = `Save failed (${res.status})`;
        try { const j = await res.json(); if (j?.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message; } catch {}
        setSaveError(msg);
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to update student');
    } finally {
      setSavingStudent(false);
    }
  };

  const handleAddNewStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClass) return;
    if (!newStudentForm.email.trim() && !newStudentForm.phone.trim()) {
      alert('Enter an email or a phone number');
      return;
    }
    try {
      const autoPassword = 'student' + (newStudentForm.email.split('@')[0] || newStudentForm.phone.replace(/\D/g, '') || 'default');
      const finalPassword = newStudentForm.password.trim() || autoPassword;
      const registerRes = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
                  },
        body: JSON.stringify({ ...newStudentForm, password: finalPassword, role: 'STUDENT' }),
      });
      if (registerRes.ok) {
        const newStudent = await registerRes.json();
        const addRes = await apiFetch(academicApi(`classes/${selectedClass.id}/students`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: newStudent.user.id }),
        });
        if (addRes.ok) {
          const addedStudent = await addRes.json();
          if (newStudentForm.nameKh || newStudentForm.sex || newStudentForm.photo || newStudentForm.dateOfBirth || newStudentForm.address || newStudentForm.generation || newStudentForm.studentNumber) {
            const studentId = addedStudent.id || addedStudent.student?.id;
            if (studentId) {
              await apiFetch(academicApi(`classes/${selectedClass.id}/students/${studentId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...(newStudentForm.nameKh ? { nameKh: newStudentForm.nameKh } : {}),
                  ...(newStudentForm.sex ? { sex: newStudentForm.sex } : {}),
                  ...(newStudentForm.photo ? { photo: newStudentForm.photo } : {}),
                  ...(newStudentForm.dateOfBirth ? { dateOfBirth: newStudentForm.dateOfBirth } : {}),
                  ...(newStudentForm.address ? { address: newStudentForm.address } : {}),
                  ...(newStudentForm.generation ? { generation: newStudentForm.generation } : {}),
                  ...(newStudentForm.studentNumber ? { studentNumber: newStudentForm.studentNumber.trim() } : {}),
                }),
              });
            }
          }
          setNewStudentForm({ name: '', nameKh: '', email: '', password: '', sex: '', photo: '', phone: '', dateOfBirth: '', address: '', generation: '', studentNumber: '' });
          setShowAddStudentForm(false);
          await fetchClassStudents(selectedClass.id);
          await fetchAvailableStudents(selectedClass.id);
        } else {
          const errorData = await addRes.json();
          alert(`Failed to add student to class: ${errorData.message || 'Unknown error'}`);
        }
      } else {
        const errorData = await registerRes.json();
        alert(`Failed to register student: ${errorData.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Failed to add new student. Please try again.');
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClass) return;

    setCsvUploading(true);
    setCsvResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch(academicApi(`classes/${selectedClass.id}/students/bulk-csv`), {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        setCsvResult(result);
        await fetchClassStudents(selectedClass.id);
        await fetchAvailableStudents(selectedClass.id);
      } else {
        const errorData = await res.json();
        alert(`CSV upload failed: ${errorData.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert('CSV upload failed. Please try again.');
    } finally {
      setCsvUploading(false);
      e.target.value = '';
    }
  };

  const isClassAdmin = typeof window !== 'undefined' && localStorage.getItem('role') === 'CLASS_ADMIN'

  return (
    <div className="page-shell">
      <Sidebar title="Admin Panel" subtitle="Wattanman" navItems={isClassAdmin ? classAdminNav : adminNav} accentColor="indigo" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🏫</span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-800">{t('classes.title')}</h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Organize classes, assign teachers, and manage student rosters</p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" /></svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by class name, subject, or teacher…"
                className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedStudyYearId}
                onChange={(e) => setSelectedStudyYearId(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
                title="Filter by study year"
              >
                <option value="">All Study Years</option>
                {studyYears.map(sy => (
                  <option key={sy.id} value={sy.id}>
                    {sy.label || sy.year}{sy.isCurrent ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
                title="Sort classes"
              >
                <option value="name">Sort: Name</option>
                <option value="subject">Sort: Subject</option>
                <option value="teacher">Sort: Teacher</option>
                <option value="students">Sort: Most Students</option>
              </select>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'grid' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  title="Grid view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h6v6H4V6zm10 0h6v6h-6V6zM4 16h6v4H4v-4zm10 0h6v4h-6v-4z" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'list' ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  title="List view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
              </div>
              <button onClick={() => { setShowForm(true); setEditingClass(null); setFormData({ name: '', subject: '', teacherId: '', classAdminId: '', studyYearId: selectedStudyYearId, registrationStatus: 'HIDDEN', thumbnail: '', description: '', price: '', showPrice: false }); setSelectedPreset('global-default'); setCustomConfigs([]); setWeeklySchedule({ ...DEFAULT_SCHEDULE }); setShowWeekly(false); }} className="btn-primary inline-flex items-center gap-1.5 shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                {t('classes.addClass')}
              </button>
            </div>
          </div>

          {searchQuery && (
            <div className="mt-2 text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-700">{filteredClasses.length}</span> of {classes.length} classes matching <span className="font-mono text-indigo-600">&quot;{searchQuery}&quot;</span>
            </div>
          )}
        </div>

        <div className="page-body space-y-6">
          {/* Class Form */}
          {showForm && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">
                {editingClass ? 'Edit Class' : 'New Class'}
              </h3>
              <form onSubmit={handleSubmit} className="grid sm:grid-cols-5 gap-4">
                <div>
                  <label className="form-label">Name</label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div>
                  <label className="form-label">Subject</label>
                  <input type="text" value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} required />
                </div>
                <div>
                  <label className="form-label">Teacher</label>
                  <select value={formData.teacherId} onChange={(e) => setFormData({ ...formData, teacherId: e.target.value })} required>
                    <option value="">Select teacher...</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Class Admin <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
                  <select value={formData.classAdminId} onChange={(e) => setFormData({ ...formData, classAdminId: e.target.value })}>
                    <option value="">— None —</option>
                    {classAdmins.map((ca) => <option key={ca.id} value={ca.id}>{ca.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Study Year</label>
                  <select value={formData.studyYearId} onChange={(e) => setFormData({ ...formData, studyYearId: e.target.value })}>
                    <option value="">No study year</option>
                    {studyYears.map(sy => (
                      <option key={sy.id} value={sy.id}>{sy.label || sy.year}{sy.isCurrent ? ' (Current)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Registration Status <span className="text-slate-400 font-normal text-xs">(student self-registration)</span></label>
                  <select value={formData.registrationStatus} onChange={(e) => setFormData({ ...formData, registrationStatus: e.target.value })}>
                    <option value="HIDDEN">Hidden — not shown publicly</option>
                    <option value="UNAVAILABLE">Unavailable — visible, closed</option>
                    <option value="AVAILABLE">Available — open for registration</option>
                  </select>
                </div>

                {/* Public Class Card */}
                <div className="sm:col-span-5 border-t border-slate-100 pt-4 mt-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Public Class Card <span className="text-slate-400 font-normal normal-case">(shown on the home page when open for registration)</span></p>
                  <div className="grid sm:grid-cols-5 gap-4">
                    <div className="sm:col-span-2">
                      <label className="form-label">Thumbnail <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
                      <input type="file" accept="image/*" onChange={handleThumbnailChange} className="text-sm" />
                      {thumbnailError && <p className="text-xs text-red-600 mt-1">{thumbnailError}</p>}
                      {formData.thumbnail && (
                        <div className="mt-2 relative w-full max-w-[220px] aspect-video rounded-lg overflow-hidden border border-slate-200">
                          <img src={formData.thumbnail} alt="Thumbnail preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, thumbnail: '' })}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/80"
                            title="Remove thumbnail"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="sm:col-span-3">
                      <label className="form-label">Description <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={3}
                        placeholder="A short blurb shown on the public registration card…"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="form-label">Price (USD) <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        placeholder="e.g. 39.99"
                      />
                    </div>
                    <div className="sm:col-span-3 flex items-end pb-2.5">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.showPrice}
                          onChange={(e) => setFormData({ ...formData, showPrice: e.target.checked })}
                          className="rounded border-slate-300"
                        />
                        <span className="text-sm text-slate-600">Show price publicly on the card</span>
                      </label>
                    </div>
                  </div>
                </div>
                {/* Attendance Format */}
                <div className="sm:col-span-4">
                  <label className="form-label">Attendance Format</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mt-1">
                    {ATTENDANCE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setSelectedPreset(preset.id);
                          if (preset.id === 'custom') {
                            // Start with full-day defaults for custom editing
                            const fullDay = ATTENDANCE_PRESETS.find(p => p.id === 'full-day')!;
                            setCustomConfigs(fullDay.configs.map(c => ({ ...c })));
                          } else if (preset.id !== 'global-default' && preset.configs.length > 0) {
                            setCustomConfigs(preset.configs.map(c => ({ ...c })));
                          } else {
                            setCustomConfigs([]);
                          }
                        }}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          selectedPreset === preset.id
                            ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-xl mb-1">{preset.icon}</div>
                        <div className="text-xs font-semibold text-slate-700">{preset.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{preset.description}</div>
                      </button>
                    ))}
                  </div>
                  {/* Editable session times — shown for any non-global selection */}
                  {selectedPreset !== 'global-default' && customConfigs.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedPreset === 'custom' && (
                        <p className="text-xs text-amber-600 font-medium">🔧 Custom — times have been modified from preset</p>
                      )}
                      {customConfigs.map(cfg => {
                        const enabled = cfg.startTime !== cfg.endTime;
                        return (
                          <div key={cfg.session} className={`flex flex-wrap items-center gap-3 p-3 rounded-lg border ${
                            !enabled ? 'bg-slate-50 border-slate-200 opacity-50' : 'bg-white border-slate-200'
                          }`}>
                            <div className="flex items-center gap-2 min-w-0 sm:min-w-[180px]">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => {
                                  if (!e.target.checked) {
                                    updateCustomConfig(cfg.session, 'endTime', cfg.startTime);
                                  } else {
                                    const defaults = ATTENDANCE_PRESETS.find(p => p.id === 'full-day')!.configs;
                                    const d = defaults.find(x => x.session === cfg.session)!;
                                    setCustomConfigs(prev => prev.map(c => c.session === cfg.session ? { ...c, startTime: d.startTime, endTime: d.endTime } : c));
                                    setSelectedPreset('custom');
                                  }
                                }}
                                className="rounded border-slate-300"
                              />
                              <span className="text-sm font-medium text-slate-700">{SESSION_LABELS[cfg.session]}</span>
                            </div>
                            <select
                              value={cfg.type}
                              onChange={(e) => updateCustomConfig(cfg.session, 'type', e.target.value)}
                              disabled={!enabled}
                              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white"
                            >
                              <option value="CHECK_IN">CHECK_IN</option>
                              <option value="CHECK_OUT">CHECK_OUT</option>
                            </select>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-slate-500">Start</label>
                              <input
                                type="time"
                                value={cfg.startTime}
                                onChange={(e) => updateCustomConfig(cfg.session, 'startTime', e.target.value)}
                                disabled={!enabled}
                                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="text-xs text-slate-500">End</label>
                              <input
                                type="time"
                                value={cfg.endTime}
                                onChange={(e) => updateCustomConfig(cfg.session, 'endTime', e.target.value)}
                                disabled={!enabled}
                                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Weekly Schedule Calendar */}
                <div className="sm:col-span-4">
                  <div className="flex items-center gap-3 mb-2">
                    <label className="form-label mb-0">Weekly Schedule</label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showWeekly}
                        onChange={(e) => {
                          setShowWeekly(e.target.checked);
                          if (!e.target.checked) setWeeklySchedule({ ...DEFAULT_SCHEDULE });
                        }}
                        className="rounded border-slate-300"
                      />
                      <span className="text-xs text-slate-500">Different format per day</span>
                    </label>
                  </div>
                  {!showWeekly ? (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400">Same attendance format every day. Enable checkbox above or pick a quick preset:</p>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-slate-400 self-center mr-1">Quick:</span>
                        <button type="button" onClick={() => { setShowWeekly(true); setWeeklySchedule({ MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'day-off', SUN: 'day-off' }); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          Mon–Fri / Sat–Sun Off
                        </button>
                        <button type="button" onClick={() => { setShowWeekly(true); setWeeklySchedule({ MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'same', SUN: 'day-off' }); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          Mon–Sat / Sun Off
                        </button>
                        <button type="button" onClick={() => { setShowWeekly(true); setWeeklySchedule({ MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'morning-only', SUN: 'day-off' }); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          Mon–Fri Full / Sat Morning
                        </button>
                        <button type="button" onClick={() => { setShowWeekly(true); setWeeklySchedule({ MON: 'day-off', TUE: 'day-off', WED: 'day-off', THU: 'day-off', FRI: 'day-off', SAT: 'same', SUN: 'same' }); }}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-indigo-100 text-indigo-600 hover:bg-indigo-200 transition-colors">
                          Weekend Only (Sat–Sun)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-7 gap-1.5">
                        {DAYS_OF_WEEK.map(day => {
                          const val = weeklySchedule[day.key] || 'same';
                          const opt = DAY_PRESETS.find(p => p.value === val);
                          return (
                            <div key={day.key} className="text-center">
                              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">{day.label}</div>
                              <button
                                type="button"
                                onClick={() => {
                                  const options = DAY_PRESETS.map(p => p.value);
                                  const idx = options.indexOf(val);
                                  const next = options[(idx + 1) % options.length];
                                  setWeeklySchedule(prev => ({ ...prev, [day.key]: next }));
                                }}
                                className={`w-full p-2 rounded-xl border-2 transition-all hover:scale-105 ${DAY_COLORS[val] || 'bg-slate-100 text-slate-600 border-slate-200'}`}
                              >
                                <div className="text-lg">{opt?.icon || '📋'}</div>
                                <div className="text-[9px] font-semibold mt-0.5 leading-tight">{opt?.label || 'Same'}</div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {/* Quick actions */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-slate-400 self-center mr-1">Quick:</span>
                        <button type="button" onClick={() => setWeeklySchedule({ MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'day-off', SUN: 'day-off' })}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          Mon–Fri / Sat–Sun Off
                        </button>
                        <button type="button" onClick={() => setWeeklySchedule({ MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'same', SUN: 'day-off' })}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          Mon–Sat / Sun Off
                        </button>
                        <button type="button" onClick={() => setWeeklySchedule({ MON: 'same', TUE: 'same', WED: 'same', THU: 'same', FRI: 'same', SAT: 'morning-only', SUN: 'day-off' })}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          Mon–Fri Full / Sat Morning
                        </button>
                        <button type="button" onClick={() => setWeeklySchedule({ MON: 'day-off', TUE: 'day-off', WED: 'day-off', THU: 'day-off', FRI: 'day-off', SAT: 'same', SUN: 'same' })}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-indigo-100 text-indigo-600 hover:bg-indigo-200 transition-colors">
                          Weekend Only (Sat–Sun)
                        </button>
                        <button type="button" onClick={() => {
                            const all: Record<string, string> = {};
                            DAYS_OF_WEEK.forEach(d => all[d.key] = 'same');
                            setWeeklySchedule(all);
                          }}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          All Same
                        </button>
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                        {DAY_PRESETS.map(p => (
                          <span key={p.value} className="inline-flex items-center gap-0.5">{p.icon} {p.label}</span>
                        ))}
                        <span className="text-slate-300 ml-1">Click day to cycle</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="sm:col-span-4 flex gap-2">
                  <button type="submit" className="btn-primary">{editingClass ? 'Update Class' : 'Create Class'}</button>
                  <button type="button" onClick={() => { setShowForm(false); setEditingClass(null); setSelectedPreset('global-default'); setCustomConfigs([]); setWeeklySchedule({ ...DEFAULT_SCHEDULE }); setShowWeekly(false); }} className="btn-ghost">Cancel</button>
                </div>
              </form>
            </div>
          )}

          {/* Student Modal */}
          {showStudentModal && selectedClass && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-16 overflow-y-auto">
              <div className="card w-full max-w-6xl shadow-xl">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Manage Students</h3>
                    <p className="text-sm text-slate-500">{selectedClass.name} &middot; {classStudents.length} student{classStudents.length !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => { setShowStudentModal(false); setShowAddStudentForm(false); setEditingStudent(null); setCsvResult(null); }} className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Add New Student */}
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setShowAddStudentForm(!showAddStudentForm)} className={showAddStudentForm ? 'btn-ghost' : 'btn-success btn-sm'}>
                        {showAddStudentForm ? 'Cancel' : '+ Register New Student'}
                      </button>
                      <label className={`btn-primary btn-sm cursor-pointer inline-flex items-center gap-1 ${csvUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        📄 {csvUploading ? 'Uploading...' : 'Bulk Upload CSV'}
                        <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" disabled={csvUploading} />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const csv = 'ID,Name,Sex,Date of Birth,Phone,Address,Photo,Generation\n1,John Doe,Male,2010-05-15,012345678,Phnom Penh,,1\n2,Jane Smith,Female,2011-03-22,098765432,,,2\n3,សុខ សាន,ប្រុស,2010-12-01,,ក្រុងភ្នំពេញ,https://drive.google.com/file/d/FILE_ID/view,1\n';
                          const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
                          const link = document.createElement('a');
                          link.href = URL.createObjectURL(blob);
                          link.download = 'student-template.csv';
                          link.click();
                          URL.revokeObjectURL(link.href);
                        }}
                        className="btn-outline btn-sm inline-flex items-center gap-1"
                      >
                        ⬇ Download Sample CSV
                      </button>
                      <button
                        type="button"
                        disabled={classStudents.length === 0}
                        onClick={() => downloadStudentsCsv(classStudents, customFieldDefs, `${selectedClass.name}.csv`)}
                        className="btn-outline btn-sm inline-flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        ⬇ Export Students CSV
                      </button>
                    </div>

                    {/* CSV Result */}
                    {csvResult && (
                      <div className="mt-3 card p-4 border-blue-200 bg-blue-50/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <h5 className="text-sm font-semibold text-slate-700">CSV Upload Results</h5>
                          <button onClick={() => setCsvResult(null)} className="text-slate-400 hover:text-slate-600 text-xs">Dismiss</button>
                        </div>
                        <div className="flex gap-3 text-sm">
                          <span className="text-emerald-600 font-medium">✓ {csvResult.success} added</span>
                          {csvResult.errors > 0 && <span className="text-red-600 font-medium">✗ {csvResult.errors} errors</span>}
                          {csvResult.skipped > 0 && <span className="text-amber-600 font-medium">⚠ {csvResult.skipped} skipped</span>}
                        </div>
                        {csvResult.details.some(d => d.status !== 'success') && (
                          <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                            {csvResult.details.filter(d => d.status !== 'success').map((d, i) => (
                              <div key={i} className={`px-2 py-1 rounded ${d.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                Row {d.row} (#{d.id}): {d.name || 'unknown'} — {d.error}
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-slate-500">CSV format: ID, Name, Sex, Date of Birth, Phone, Address, Photo, Generation (Google Drive links supported)</p>
                      </div>
                    )}
                    {showAddStudentForm && (
                      <form onSubmit={handleAddNewStudent} className="mt-4 card p-4 border-emerald-200 bg-emerald-50/50 space-y-3">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <label className="form-label">Student ID <span className="text-slate-400 text-xs">(optional — auto-generated if blank)</span></label>
                            <input type="text" value={newStudentForm.studentNumber} onChange={(e) => setNewStudentForm({ ...newStudentForm, studentNumber: e.target.value })} placeholder="e.g. 0001" className="font-mono" />
                          </div>
                          <div>
                            <label className="form-label">Name</label>
                            <input type="text" value={newStudentForm.name} onChange={(e) => setNewStudentForm({ ...newStudentForm, name: e.target.value })} required />
                          </div>
                          <div>
                            <label className="form-label">Khmer Name</label>
                            <input type="text" value={newStudentForm.nameKh} onChange={(e) => setNewStudentForm({ ...newStudentForm, nameKh: e.target.value })} placeholder="Khmer name" />
                          </div>
                          <div>
                            <label className="form-label">Email <span className="text-slate-400 font-normal text-xs">(or phone below)</span></label>
                            <input type="text" value={newStudentForm.email} onChange={(e) => setNewStudentForm({ ...newStudentForm, email: e.target.value })} placeholder="student@school.edu" />
                          </div>
                          <div>
                            <label className="form-label">Password <span className="text-slate-400 text-xs">(optional — auto-generated if blank)</span></label>
                            <input type="text" value={newStudentForm.password} onChange={(e) => setNewStudentForm({ ...newStudentForm, password: e.target.value })} placeholder="Leave blank to auto-generate" />
                          </div>
                          <div>
                            <label className="form-label">Sex</label>
                            <select value={newStudentForm.sex} onChange={(e) => setNewStudentForm({ ...newStudentForm, sex: e.target.value })}>
                              <option value="">Select...</option>
                              <option value="MALE">Male</option>
                              <option value="FEMALE">Female</option>
                            </select>
                          </div>
                          <div>
                            <label className="form-label">Date of Birth</label>
                            <input type="date" value={newStudentForm.dateOfBirth} onChange={(e) => setNewStudentForm({ ...newStudentForm, dateOfBirth: e.target.value })} />
                          </div>
                          <div>
                            <label className="form-label">Phone Number</label>
                            <input type="text" value={newStudentForm.phone} onChange={(e) => setNewStudentForm({ ...newStudentForm, phone: e.target.value })} placeholder="012 345 678" />
                          </div>
                          <div>
                            <label className="form-label">Photo URL</label>
                            <input type="text" value={newStudentForm.photo} onChange={(e) => setNewStudentForm({ ...newStudentForm, photo: e.target.value })} placeholder="https://example.com/photo.jpg" />
                          </div>
                        </div>
                        <div>
                          <label className="form-label">Address</label>
                          <input type="text" value={newStudentForm.address} onChange={(e) => setNewStudentForm({ ...newStudentForm, address: e.target.value })} placeholder="Street, City, Province" />
                        </div>
                        <div>
                          <label className="form-label">{t('student.generation') || 'Generation'} <span className="text-slate-400 text-xs">(ជំនាន់ទី)</span></label>
                          <input type="number" min="1" value={newStudentForm.generation} onChange={(e) => setNewStudentForm({ ...newStudentForm, generation: e.target.value })} placeholder="1" />
                        </div>
                        <p className="text-xs text-slate-400">If password is left blank, it will be auto-generated as: <span className="font-mono">student + email prefix</span> (e.g. <span className="font-mono">studentjohn</span>). Student ID auto-generates from class roster order if blank.</p>
                        <button type="submit" className="btn-success">Add Student</button>
                      </form>
                    )}
                  </div>

                  <div className="space-y-6">
                    {/* Available Students */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">{t('classes.availableStudents')}</h4>
                      <div className="card max-h-48 overflow-y-auto divide-y divide-slate-100">
                        {availableStudents.length === 0 ? (
                          <div className="empty-state py-8"><p className="text-sm">{t('classes.noAvailableStudents')}</p></div>
                        ) : (
                          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                            {availableStudents.map((s) => (
                              <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-r border-slate-100">
                                <div className="avatar avatar-sm">
                                  {s.photo ? <img src={s.photo} alt={s.name} className="w-full h-full object-cover" /> : s.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                                  <p className="text-xs text-slate-500 truncate">{s.email}</p>
                                </div>
                                <button onClick={() => handleAddStudent(s.id)} className="btn-primary btn-sm">Add</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Class Students Table */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">
                        {t('classes.classStudents')} ({classStudents.length})
                      </h4>
                      <div className="card overflow-hidden">
                        <div className="max-h-[28rem] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 sticky top-0 z-10">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">ID</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Photo</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Name</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Sex</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">DOB</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Phone</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Address</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {classStudents.length === 0 ? (
                                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No students yet</td></tr>
                              ) : (
                                classStudents.map((s, idx) => (
                                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">{s.studentNumber || String(idx + 1).padStart(4, '0')}</td>
                                    <td className="px-3 py-2">
                                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-400">
                                        {s.photo ? <img src={s.photo} alt={s.name} className="w-full h-full object-cover" /> : s.name.charAt(0).toUpperCase()}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 font-medium text-slate-800">{s.name}{s.nameKh && <span className="text-slate-400 font-normal"> · {s.nameKh}</span>}</td>
                                    <td className="px-3 py-2">
                                      {s.sex ? (
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.sex === 'MALE' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>
                                          {s.sex === 'MALE' ? '♂ ប្រុស' : '♀ ស្រី'}
                                        </span>
                                      ) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500 text-xs">{s.dateOfBirth ? new Date(s.dateOfBirth).toLocaleDateString() : <span className="text-slate-300">—</span>}</td>
                                    <td className="px-3 py-2 text-slate-500 text-xs">{s.phone || <span className="text-slate-300">—</span>}</td>
                                    <td className="px-3 py-2 text-slate-500 text-xs truncate max-w-[140px]">{s.address || <span className="text-slate-300">—</span>}</td>
                                    <td className="px-3 py-2 text-right">
                                      <div className="flex justify-end gap-1">
                                        <button onClick={() => handleEditStudent(s)} className="btn-warning btn-sm">Edit</button>
                                        <button onClick={() => handleRemoveStudent(s.id, s.name)} className="btn-danger btn-sm">Delete</button>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Edit Student Inline Panel */}
                  {editingStudent && (
                    <div className="relative mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200 space-y-3">
                      {/* Full-viewport loading overlay (guaranteed visible) */}
                      {savingStudent && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in" role="status" aria-live="polite">
                          <div className="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl bg-white border border-amber-200 shadow-2xl min-w-[280px]">
                            <div className="relative">
                              <svg className="w-14 h-14 text-amber-500 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/>
                                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-amber-600 text-lg">💾</span>
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-base font-semibold text-slate-800">Saving student…</div>
                              <div className="text-xs text-slate-500 mt-1">Please wait, applying your changes</div>
                            </div>
                            <div className="w-full h-1 bg-amber-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 animate-pulse" style={{ width: '70%' }} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Form content (dimmed/disabled while saving) */}
                      <fieldset disabled={savingStudent} className={`space-y-3 transition-opacity ${savingStudent ? 'opacity-50 pointer-events-none' : ''}`}>
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-semibold text-amber-800">Edit Student</h5>
                        <button onClick={() => setEditingStudent(null)} className="text-slate-400 hover:text-slate-600 text-xs">Cancel</button>
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <div>
                          <label className="form-label text-xs">Student ID <span className="text-slate-400">(លេខសម្គាល់)</span></label>
                          <input type="text" value={editStudentData.studentNumber} onChange={(e) => setEditStudentData({ ...editStudentData, studentNumber: e.target.value })} placeholder="e.g. 0001" className="font-mono" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Name</label>
                          <input type="text" value={editStudentData.name} onChange={(e) => setEditStudentData({ ...editStudentData, name: e.target.value })} placeholder="Student name" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Khmer Name</label>
                          <input type="text" value={editStudentData.nameKh} onChange={(e) => setEditStudentData({ ...editStudentData, nameKh: e.target.value })} placeholder="Khmer name" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Sex</label>
                          <select value={editStudentData.sex} onChange={(e) => setEditStudentData({ ...editStudentData, sex: e.target.value })}>
                            <option value="">Select...</option>
                            <option value="MALE">ប្រុស (Male)</option>
                            <option value="FEMALE">ស្រី (Female)</option>
                          </select>
                        </div>
                        <div>
                          <label className="form-label text-xs">Phone Number</label>
                          <input type="text" value={editStudentData.phone} onChange={(e) => setEditStudentData({ ...editStudentData, phone: e.target.value })} placeholder="012 345 678" />
                        </div>
                        <div>
                          <label className="form-label text-xs">Date of Birth</label>
                          <input type="date" value={editStudentData.dateOfBirth} onChange={(e) => setEditStudentData({ ...editStudentData, dateOfBirth: e.target.value })} />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="form-label text-xs">Address</label>
                          <input type="text" value={editStudentData.address} onChange={(e) => setEditStudentData({ ...editStudentData, address: e.target.value })} placeholder="Street, City, Province" />
                        </div>
                        <div>
                          <label className="form-label text-xs">{t('student.generation') || 'Generation'} <span className="text-slate-400">(ជំនាន់ទី)</span></label>
                          <input type="number" min="1" value={editStudentData.generation} onChange={(e) => setEditStudentData({ ...editStudentData, generation: e.target.value })} placeholder="1" />
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <label className="form-label text-xs">Parent <span className="text-slate-400">(ឪពុកម្តាយ)</span></label>
                          <select
                            value={editStudentData.parentId}
                            onChange={(e) => setEditStudentData({ ...editStudentData, parentId: e.target.value })}
                          >
                            <option value="">— None / Unlink —</option>
                            {parents.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.email}){p.phone ? ` · ${p.phone}` : ''}
                              </option>
                            ))}
                          </select>
                          {parents.length === 0 && (
                            <div className="text-xs text-slate-400 mt-1">No parent accounts found. Create one under Users → Parents first.</div>
                          )}
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <label className="form-label text-xs">Photo URL <span className="text-slate-400">(Google Drive share links auto-converted)</span></label>
                          <input type="text" value={editStudentData.photo} onChange={(e) => { setEditStudentData({ ...editStudentData, photo: e.target.value }); setPhotoPreviewError(false); }} placeholder="https://... or Google Drive share link" />
                        </div>
                        {customFieldDefs.map(f => (
                          <div key={f.id} className="sm:col-span-2 lg:col-span-3">
                            <label className="form-label text-xs">{f.label}{f.required && ' *'}</label>
                            {f.fieldType === 'MULTI_SELECT' ? (
                              <div className="flex flex-wrap gap-3 pt-1">
                                {(f.options || []).map(opt => {
                                  const selected = Array.isArray(editStudentCustomFields[f.key]) ? (editStudentCustomFields[f.key] as string[]) : []
                                  return (
                                    <label key={opt} className="flex items-center gap-1.5 text-sm text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={selected.includes(opt)}
                                        onChange={(e) => setEditStudentCustomFields(prev => {
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
                                value={(editStudentCustomFields[f.key] as string) || ''}
                                onChange={(e) => setEditStudentCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                              >
                                <option value="">-- Select --</option>
                                {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={(editStudentCustomFields[f.key] as string) || ''}
                                onChange={(e) => setEditStudentCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      {editStudentData.photo && (
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-500">Preview:</span>
                          {!photoPreviewError ? (
                            <img src={editStudentData.photo} alt="Preview" className="w-12 h-12 rounded-lg object-cover border border-slate-200" onError={() => setPhotoPreviewError(true)} onLoad={() => setPhotoPreviewError(false)} />
                          ) : (
                            <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1">⚠ Image failed to load. The URL may be invalid or restricted. Use a direct image link (.jpg/.png) or a public Google Drive share link.</span>
                          )}
                        </div>
                      )}
                      {saveError && (
                        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{saveError}</div>
                      )}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleSaveStudent(editingStudent)} disabled={savingStudent} className="btn-success btn-sm inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                          {savingStudent && (
                            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
                              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                            </svg>
                          )}
                          {savingStudent ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button type="button" onClick={() => setEditingStudent(null)} disabled={savingStudent} className="btn-ghost btn-sm disabled:opacity-60">Cancel</button>
                      </div>
                      </fieldset>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Classes Grid */}
          {loadingClasses && classes.length === 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card p-5 animate-pulse">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-200" />
                    <div className="w-10 h-6 rounded-full bg-slate-200" />
                  </div>
                  <div className="h-5 w-3/4 bg-slate-200 rounded mb-2" />
                  <div className="h-3 w-1/2 bg-slate-200 rounded mb-3" />
                  <div className="h-3 w-2/3 bg-slate-100 rounded mb-2" />
                  <div className="h-3 w-1/3 bg-slate-100 rounded" />
                  <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                    <div className="h-8 flex-1 bg-slate-200 rounded" />
                    <div className="h-8 flex-1 bg-slate-200 rounded" />
                    <div className="h-8 flex-1 bg-slate-200 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClasses.map((cls) => {
                const theme = themeFor(cls);
                const count = classStudentCounts[cls.id];
                return (
                  <div key={cls.id} className={`group relative overflow-hidden card-hover p-5 hover:ring-2 ${theme.ring} transition-all`}>
                    <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${theme.from} ${theme.to}`} />
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${theme.from} ${theme.to} flex items-center justify-center text-white text-2xl shadow-md group-hover:scale-110 group-hover:-rotate-3 transition-transform`}>
                        {theme.emoji}
                      </div>
                      {count !== undefined && (
                        <div className="flex flex-col items-end">
                          <div className="text-2xl font-bold text-slate-800 leading-none">{count}</div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">student{count !== 1 ? 's' : ''}</div>
                        </div>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-800 text-lg leading-tight">{cls.name}</h3>
                    <p className={`inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${theme.chip}`}>{cls.subject}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {cls.studyYear && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700">
                          📅 {cls.studyYear.label || cls.studyYear.year}
                        </span>
                      )}
                      {cls.registrationStatus && cls.registrationStatus !== 'HIDDEN' && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${REGISTRATION_STATUS_META[cls.registrationStatus].className}`}>
                          {REGISTRATION_STATUS_META[cls.registrationStatus].label}
                        </span>
                      )}
                      {classFormats[cls.id] ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-100 text-indigo-700">
                          {classFormats[cls.id].icon} {classFormats[cls.id].name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">
                          🌐 Global
                        </span>
                      )}
                    </div>
                    {cls.teacher && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">
                          {cls.teacher.name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <span className="truncate">{cls.teacher.name}</span>
                      </div>
                    )}
                    {cls.classAdmin && (
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-indigo-500">
                        <div className="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center text-[10px] font-bold text-indigo-600">
                          {cls.classAdmin.name?.charAt(0).toUpperCase() || 'A'}
                        </div>
                        <span className="truncate">{cls.classAdmin.name}</span>
                        <span className="text-[10px] text-indigo-300">Class Admin</span>
                      </div>
                    )}
                    {cls.schedule && (() => {
                      try {
                        const sched = JSON.parse(cls.schedule);
                        const hasDiff = Object.values(sched).some((v: any) => v !== 'same');
                        if (!hasDiff) return null;
                        return (
                          <div className="flex gap-0.5 mt-2.5">
                            {DAYS_OF_WEEK.map(day => {
                              const val = sched[day.key] || 'same';
                              const opt = DAY_PRESETS.find(p => p.value === val);
                              return (
                                <span key={day.key} title={`${day.full}: ${opt?.label || 'Same'}`}
                                  className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] border ${DAY_COLORS[val] || 'bg-slate-100 border-slate-200'}`}>
                                  {opt?.icon || '📋'}
                                </span>
                              );
                            })}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-slate-100">
                      <div className="flex gap-2">
                        <Link href={`/admin/classes/${cls.id}`} className={`btn-sm flex-1 text-center text-white bg-gradient-to-r ${theme.from} ${theme.to} shadow-sm hover:shadow-md transition-shadow`} title="Manage assignments, exams, courses">
                          📚 Manage
                        </Link>
                        <button onClick={() => handleManageStudents(cls)} className="btn-success btn-sm flex-1">🧑‍🎓 Students</button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Link href={`/admin/attendance?classId=${cls.id}`} className="btn-outline btn-sm flex-1 text-center">Attendance</Link>
                        <button onClick={() => handleEdit(cls)} className="btn-outline btn-sm flex-1">Edit</button>
                        <button onClick={() => openAddToTT(cls)} title="Add to Timetable" className="btn-outline btn-sm px-2.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50 flex-shrink-0">
                          🗓
                        </button>
                        <button onClick={() => handleDelete(cls.id)} title="Delete class" className="btn-outline btn-sm px-2.5 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600 flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Class</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Subject</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Teacher</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Class Admin</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Year</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Registration</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Format</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Students</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredClasses.map((cls) => {
                      const theme = themeFor(cls);
                      const count = classStudentCounts[cls.id];
                      return (
                        <tr key={cls.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${theme.from} ${theme.to} flex items-center justify-center text-white text-base shadow-sm flex-shrink-0`}>{theme.emoji}</div>
                              <span className="font-medium text-slate-800 truncate">{cls.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${theme.chip}`}>{cls.subject}</span></td>
                          <td className="px-4 py-2.5 text-slate-600">{cls.teacher?.name || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{cls.classAdmin?.name ? <span className="text-indigo-600">{cls.classAdmin.name}</span> : <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{cls.studyYear ? (cls.studyYear.label || cls.studyYear.year) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${REGISTRATION_STATUS_META[cls.registrationStatus || 'HIDDEN'].className}`}>
                              {REGISTRATION_STATUS_META[cls.registrationStatus || 'HIDDEN'].label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {classFormats[cls.id] ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-600">{classFormats[cls.id].icon} {classFormats[cls.id].name}</span>
                            ) : <span className="text-slate-400 text-xs">🌐 Global</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{count !== undefined ? count : '…'}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex gap-1">
                              <Link href={`/admin/classes/${cls.id}`} className="btn-primary btn-sm" title="Manage assignments, exams, courses">📚 Manage</Link>
                              <Link href={`/admin/attendance?classId=${cls.id}`} className="btn-outline btn-sm">Attendance</Link>
                              <button onClick={() => handleManageStudents(cls)} className="btn-success btn-sm">Students</button>
                              <button onClick={() => handleEdit(cls)} className="btn-outline btn-sm">Edit</button>
                              <button onClick={() => handleDelete(cls.id)} className="btn-danger btn-sm" title="Delete">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!loadingClasses && classes.length === 0 && (
            <div className="card p-12 text-center">
              <div className="text-6xl mb-3">📖</div>
              <p className="text-lg font-semibold text-slate-700">{t('classes.noClasses')}</p>
              <p className="text-sm text-slate-500 mt-1 mb-4">Get started by creating your first class.</p>
              <button onClick={() => { setShowForm(true); setEditingClass(null); setFormData({ name: '', subject: '', teacherId: '', classAdminId: '', studyYearId: selectedStudyYearId, registrationStatus: 'HIDDEN', thumbnail: '', description: '', price: '', showPrice: false }); setSelectedPreset('global-default'); setCustomConfigs([]); setWeeklySchedule({ ...DEFAULT_SCHEDULE }); setShowWeekly(false); }} className="btn-primary inline-flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Create First Class
              </button>
            </div>
          )}
          {!loadingClasses && classes.length > 0 && filteredClasses.length === 0 && (
            <div className="card p-10 text-center">
              <div className="text-5xl mb-2">🔍</div>
              <p className="text-base font-semibold text-slate-700">No classes match your search</p>
              <p className="text-sm text-slate-500 mt-1">Try a different keyword or clear the filters.</p>
              <button onClick={() => setSearchQuery('')} className="btn-outline btn-sm mt-3">Clear search</button>
            </div>
          )}
        </div>
      </div>

      {/* Add to Timetable Modal */}
      {showAddToTT && addToTTClass && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-800">Add to Timetable</h2>
                <p className="text-xs text-slate-500 mt-0.5">{addToTTClass.name}</p>
              </div>
              <button onClick={() => setShowAddToTT(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Timetable</label>
                <select
                  value={addToTTSelectedTT}
                  onChange={async e => {
                    setAddToTTSelectedTT(e.target.value);
                    setAddToTTExisting([]);
                    if (e.target.value) {
                      const res = await apiFetch(`/api/timetable/${e.target.value}`);
                      if (res.ok) { const tt = await res.json(); setAddToTTExisting(tt.classes ?? []); }
                    }
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select timetable…</option>
                  {timetables.map(tt => <option key={tt.id} value={tt.id}>{tt.name} · {tt.academicYear}</option>)}
                </select>
                {addToTTExisting.some(c => c.name.toLowerCase() === addToTTClass.name.toLowerCase()) && (
                  <p className="text-xs text-amber-600 mt-1">⚠ This class already exists in the selected timetable.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Short Name</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={addToTTShort} onChange={e => setAddToTTShort(e.target.value)} maxLength={8} placeholder="e.g. G1A"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {['#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#64748b'].map(c => (
                    <button key={c} type="button" onClick={() => setAddToTTColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${addToTTColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={addToTTColor} onChange={e => setAddToTTColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setShowAddToTT(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium">Cancel</button>
              <button
                onClick={handleAddToTTSave}
                disabled={addToTTSaving || !addToTTSelectedTT || !addToTTShort}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                {addToTTSaving ? 'Adding…' : 'Add to Timetable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
