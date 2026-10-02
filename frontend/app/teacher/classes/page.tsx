'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '../../../components/Sidebar';
import { teacherNav } from '../../../lib/teacher-nav';
import { apiFetch, getCurrentUser } from '../../../lib/api';
import { useLanguage } from '../../../lib/i18n';

interface Class {
  id: string;
  name: string;
  subject: string;
  teacherId: string;
  teacher?: { name: string };
}

interface Student {
  id: string;
  name: string;
  email: string;
  phone: string;
  photo: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  address: string;
  customFieldValues?: Record<string, string>;
}
interface CustomFieldDef { id: string; key: string; label: string; required: boolean }

export default function MyClasses() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState<Class[]>([]);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [classStudents, setClassStudents] = useState<Student[]>([]);
  const [availableStudents, setAvailableStudents] = useState<Student[]>([]);
  const [editingStudent, setEditingStudent] = useState<string | null>(null);
  const [editStudentData, setEditStudentData] = useState({ sex: '', photo: '', phone: '', dateOfBirth: '', address: '' });
  const [editStudentCustomFields, setEditStudentCustomFields] = useState<Record<string, string>>({});
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);

  useEffect(() => { fetchMyClasses(); }, []);

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

  const fetchMyClasses = async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;
      const res = await apiFetch(`/api/classes?teacherId=${user.userId}`);
      if (res.ok) setClasses(await res.json());
    } catch (err) { console.error('Failed to fetch classes'); }
  };

  const handleManageStudents = async (cls: Class) => {
    setSelectedClass(cls);
    await fetchClassStudents(cls.id);
    await fetchAvailableStudents(cls.id);
    setShowStudentModal(true);
  };

  const fetchClassStudents = async (classId: string) => {
    try {
      const res = await apiFetch(`/api/classes/${classId}/students`);
      if (res.ok) setClassStudents(await res.json());
    } catch (err) { console.error('Failed to fetch class students'); }
  };

  const fetchAvailableStudents = async (classId: string) => {
    try {
      const res = await apiFetch(`/api/classes/${classId}/available-students`);
      if (res.ok) setAvailableStudents(await res.json());
    } catch (err) { console.error('Failed to fetch available students'); }
  };

  const handleAddStudent = async (studentId: string) => {
    if (!selectedClass) return;
    try {
      const res = await apiFetch(`/api/classes/${selectedClass.id}/students`, {
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

  const handleRemoveStudent = async (studentId: string) => {
    if (!selectedClass) return;
    try {
      const res = await apiFetch(`/api/classes/${selectedClass.id}/students/${studentId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchClassStudents(selectedClass.id);
        await fetchAvailableStudents(selectedClass.id);
      }
    } catch (err) { console.error('Failed to remove student'); }
  };

  const handleEditStudent = (student: Student) => {
    setEditingStudent(student.id);
    setEditStudentData({ sex: student.sex || '', photo: student.photo || '', phone: student.phone || '', dateOfBirth: student.dateOfBirth ? student.dateOfBirth.slice(0, 10) : '', address: student.address || '' });
    setEditStudentCustomFields(student.customFieldValues || {});
  };

  const handleSaveStudent = async (studentId: string) => {
    if (!selectedClass) return;
    try {
      const res = await apiFetch(`/api/classes/${selectedClass.id}/students/${studentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editStudentData, customFieldValues: editStudentCustomFields }),
      });
      if (res.ok) {
        setEditingStudent(null);
        await fetchClassStudents(selectedClass.id);
      }
    } catch (err) { console.error('Failed to update student'); }
  };

  return (
    <div className="page-shell">
      <Sidebar title="Teacher Portal" subtitle="Wattanman" navItems={teacherNav} accentColor="emerald" />
      <div className="page-content">
        <div className="h-14 lg:hidden" />
        <div className="page-header">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">{t('teacherClasses.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{classes.length} class{classes.length !== 1 ? 'es' : ''} assigned</p>
        </div>

        <div className="page-body space-y-6">
          {/* Student Modal */}
          {showStudentModal && selectedClass && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-start justify-center sm:p-4 sm:pt-16 overflow-y-auto">
              <div className="card w-full sm:max-w-4xl sm:rounded-2xl rounded-t-3xl shadow-xl max-h-[90vh] sm:max-h-none overflow-y-auto">
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Manage Students</h3>
                    <p className="text-sm text-slate-500">{selectedClass.name} &middot; {classStudents.length} student{classStudents.length !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => { setShowStudentModal(false); setEditingStudent(null); }} className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="p-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Available */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">Available Students</h4>
                      <div className="card max-h-72 overflow-y-auto divide-y divide-slate-100">
                        {availableStudents.length === 0 ? (
                          <div className="empty-state py-8"><p className="text-sm">No available students</p></div>
                        ) : (
                          availableStudents.map((s) => (
                            <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                              <div className="avatar avatar-sm">
                                {s.photo ? <img src={s.photo} alt={s.name} className="w-full h-full object-cover" /> : s.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                                <p className="text-xs text-slate-500 truncate">{s.email}</p>
                              </div>
                              <button onClick={() => handleAddStudent(s.id)} className="btn-primary btn-sm">Add</button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    {/* Class Students */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">
                        Class Students ({classStudents.length})
                      </h4>
                      <div className="card max-h-96 overflow-y-auto divide-y divide-slate-100">
                        {classStudents.length === 0 ? (
                          <div className="empty-state py-8"><p className="text-sm">No students yet</p></div>
                        ) : (
                          classStudents.map((s) => (
                            <div key={s.id} className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="avatar avatar-md">
                                  {s.photo ? <img src={s.photo} alt={s.name} className="w-full h-full object-cover" /> : s.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-800">{s.name}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {s.sex && <span className="badge-blue">{s.sex === 'MALE' ? '♂ Male' : '♀ Female'}</span>}
                                    <span className="text-xs text-slate-400 truncate">{s.email}</span>
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={() => handleEditStudent(s)} className="btn-warning btn-sm">Edit</button>
                                  <button onClick={() => handleRemoveStudent(s.id)} className="btn-danger btn-sm">Remove</button>
                                </div>
                              </div>
                              {editingStudent === s.id && (
                                <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-3">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="form-label text-xs">Sex</label>
                                      <select value={editStudentData.sex} onChange={(e) => setEditStudentData({ ...editStudentData, sex: e.target.value })}>
                                        <option value="">Select...</option>
                                        <option value="MALE">Male</option>
                                        <option value="FEMALE">Female</option>
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
                                    <div>
                                      <label className="form-label text-xs">Address</label>
                                      <input type="text" value={editStudentData.address} onChange={(e) => setEditStudentData({ ...editStudentData, address: e.target.value })} placeholder="Street, City, Province" />
                                    </div>
                                    <div className="col-span-2">
                                      <label className="form-label text-xs">Photo URL</label>
                                      <input type="text" value={editStudentData.photo} onChange={(e) => setEditStudentData({ ...editStudentData, photo: e.target.value })} placeholder="https://..." />
                                    </div>
                                    {customFieldDefs.map(f => (
                                      <div key={f.id} className="col-span-2">
                                        <label className="form-label text-xs">{f.label}{f.required && ' *'}</label>
                                        <input
                                          type="text"
                                          value={editStudentCustomFields[f.key] || ''}
                                          onChange={(e) => setEditStudentCustomFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={() => handleSaveStudent(s.id)} className="btn-success btn-sm">Save</button>
                                    <button onClick={() => setEditingStudent(null)} className="btn-ghost btn-sm">Cancel</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Classes Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {classes.map((cls) => (
              <div key={cls.id} className="card-hover p-4 sm:p-5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white text-lg shadow-sm mb-3">
                  📖
                </div>
                <h3 className="font-semibold text-slate-800 text-base sm:text-lg">{cls.name}</h3>
                <p className="text-sm text-slate-500 mt-0.5">{cls.subject}</p>
                <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                  <button onClick={() => handleManageStudents(cls)} className="btn-outline btn-sm flex-1 py-2.5 sm:py-1.5">Students</button>
                  <Link href={`/teacher/attendance?classId=${cls.id}`} className="flex-1">
                    <button className="btn-success btn-sm w-full py-2.5 sm:py-1.5">Attendance</button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
          {classes.length === 0 && (
            <div className="card p-12">
              <div className="empty-state">
                <p className="text-4xl mb-3">📖</p>
                <p className="font-semibold text-slate-600">No classes assigned</p>
                <p className="text-sm text-slate-400 mt-1">Contact your admin to get classes assigned.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
