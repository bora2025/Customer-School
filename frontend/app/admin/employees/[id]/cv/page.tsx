"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import AuthGuard from '../../../../../components/AuthGuard'
import Sidebar from '../../../../../components/Sidebar'
import { adminNav } from '../../../../../lib/admin-nav'
import { apiFetch } from '../../../../../lib/api'

interface CvUser {
  id: string
  name: string
  email: string | null
  phone: string | null
  photo: string | null
  role: string
  department: { name: string } | null
}

interface EducationRow { institution: string; degree: string; fieldOfStudy: string; startYear: string; endYear: string }
interface ExperienceRow { title: string; employer: string; startDate: string; endDate: string; description: string }
interface CertificationRow { name: string; issuer: string; issueDate: string }

const emptyEducation = (): EducationRow => ({ institution: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '' })
const emptyExperience = (): ExperienceRow => ({ title: '', employer: '', startDate: '', endDate: '', description: '' })
const emptyCertification = (): CertificationRow => ({ name: '', issuer: '', issueDate: '' })

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

export default function StaffCvEditorPage() {
  const params = useParams<{ id: string }>()
  const userId = params?.id as string

  const [user, setUser] = useState<CvUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [skillInput, setSkillInput] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [education, setEducation] = useState<EducationRow[]>([])
  const [experience, setExperience] = useState<ExperienceRow[]>([])
  const [certifications, setCertifications] = useState<CertificationRow[]>([])

  useEffect(() => {
    if (!userId) return
    (async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const r = await apiFetch(`/api/staff-cv/${userId}`)
        if (!r.ok) throw new Error('Failed to load CV')
        const d = await r.json()
        setUser(d.user)
        setTitle(d.title || '')
        setSummary(d.summary || '')
        setSkills(Array.isArray(d.skills) ? d.skills : [])
        setEducation(
          (d.education || []).map((e: any) => ({
            institution: e.institution || '', degree: e.degree || '', fieldOfStudy: e.fieldOfStudy || '',
            startYear: e.startYear != null ? String(e.startYear) : '', endYear: e.endYear != null ? String(e.endYear) : '',
          })),
        )
        setExperience(
          (d.workExperience || []).map((e: any) => ({
            title: e.title || '', employer: e.employer || '', startDate: toDateInput(e.startDate), endDate: toDateInput(e.endDate), description: e.description || '',
          })),
        )
        setCertifications(
          (d.certifications || []).map((c: any) => ({ name: c.name || '', issuer: c.issuer || '', issueDate: toDateInput(c.issueDate) })),
        )
      } catch {
        setLoadError('Failed to load this employee\'s CV.')
      } finally {
        setLoading(false)
      }
    })()
  }, [userId])

  const addSkill = () => {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) setSkills((prev) => [...prev, s])
    setSkillInput('')
  }
  const removeSkill = (s: string) => setSkills((prev) => prev.filter((x) => x !== s))

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const body = {
        title: title.trim(),
        summary: summary.trim(),
        skills,
        education: education
          .filter((e) => e.institution.trim())
          .map((e) => ({
            institution: e.institution.trim(),
            degree: e.degree.trim() || undefined,
            fieldOfStudy: e.fieldOfStudy.trim() || undefined,
            startYear: e.startYear ? Number(e.startYear) : undefined,
            endYear: e.endYear ? Number(e.endYear) : undefined,
          })),
        workExperience: experience
          .filter((e) => e.title.trim() && e.employer.trim())
          .map((e) => ({
            title: e.title.trim(),
            employer: e.employer.trim(),
            startDate: e.startDate || undefined,
            endDate: e.endDate || undefined,
            description: e.description.trim() || undefined,
          })),
        certifications: certifications
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name.trim(), issuer: c.issuer.trim() || undefined, issueDate: c.issueDate || undefined })),
      }
      const r = await apiFetch(`/api/staff-cv/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed to save')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Failed to save CV. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthGuard requiredRole="ADMIN">
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar title="Admin" subtitle="Wattanman" navItems={adminNav} accentColor="indigo" />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <Link href="/admin/employees" className="text-sm text-indigo-600 hover:underline">← Employees</Link>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-800 mt-1">📄 Curriculum Vitae</h1>
                {user && <p className="text-sm text-slate-500 mt-0.5">{user.name} {user.department ? `· ${user.department.name}` : ''}</p>}
              </div>
              {user && (
                <a
                  href={`/admin/employees/${userId}/cv/print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm inline-flex items-center gap-2"
                >
                  🖨️ Print CV
                </a>
              )}
            </div>

            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 text-sm">Loading…</div>
            ) : loadError ? (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-600 text-sm">{loadError}</div>
            ) : user ? (
              <>
                {/* Header card */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center gap-4">
                  {user.photo ? (
                    <img src={user.photo} alt={user.name} className="w-16 h-16 rounded-full object-cover border border-slate-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl font-bold">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email || user.phone || '—'}</p>
                  </div>
                </div>

                {/* Title & Summary */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-800">Profile</h2>
                  <div>
                    <label className="form-label text-xs">Job Title</label>
                    <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior English Teacher" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Professional Summary</label>
                    <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="A short paragraph summarizing experience and strengths…"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  <div>
                    <label className="form-label text-xs">Skills</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {skills.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full">
                          {s}
                          <button type="button" onClick={() => removeSkill(s)} className="text-indigo-400 hover:text-indigo-700">✕</button>
                        </span>
                      ))}
                      {skills.length === 0 && <span className="text-xs text-slate-400">No skills added yet.</span>}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={skillInput}
                        onChange={(e) => setSkillInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill() } }}
                        placeholder="Type a skill and press Enter"
                        className="flex-1"
                      />
                      <button type="button" onClick={addSkill} className="btn-outline btn-sm shrink-0">+ Add</button>
                    </div>
                  </div>
                </div>

                {/* Education */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-800">🎓 Education</h2>
                    <button type="button" onClick={() => setEducation((prev) => [...prev, emptyEducation()])} className="text-xs text-indigo-600 hover:underline font-medium">+ Add entry</button>
                  </div>
                  {education.length === 0 && <p className="text-xs text-slate-400">No education entries yet.</p>}
                  {education.map((row, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3 grid sm:grid-cols-2 gap-2 relative">
                      <button type="button" onClick={() => setEducation((prev) => prev.filter((_, idx) => idx !== i))} className="absolute top-2 right-2 text-xs text-red-500 hover:underline">Remove</button>
                      <div className="sm:col-span-2">
                        <label className="form-label text-xs">Institution</label>
                        <input type="text" value={row.institution} onChange={(e) => setEducation((prev) => prev.map((r, idx) => idx === i ? { ...r, institution: e.target.value } : r))} placeholder="University / School name" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Degree</label>
                        <input type="text" value={row.degree} onChange={(e) => setEducation((prev) => prev.map((r, idx) => idx === i ? { ...r, degree: e.target.value } : r))} placeholder="e.g. Bachelor of Education" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Field of Study</label>
                        <input type="text" value={row.fieldOfStudy} onChange={(e) => setEducation((prev) => prev.map((r, idx) => idx === i ? { ...r, fieldOfStudy: e.target.value } : r))} placeholder="e.g. English Literature" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Start Year</label>
                        <input type="number" value={row.startYear} onChange={(e) => setEducation((prev) => prev.map((r, idx) => idx === i ? { ...r, startYear: e.target.value } : r))} placeholder="2015" />
                      </div>
                      <div>
                        <label className="form-label text-xs">End Year <span className="text-slate-400">(blank = ongoing)</span></label>
                        <input type="number" value={row.endYear} onChange={(e) => setEducation((prev) => prev.map((r, idx) => idx === i ? { ...r, endYear: e.target.value } : r))} placeholder="2019" />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Work Experience */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-800">💼 Work Experience</h2>
                    <button type="button" onClick={() => setExperience((prev) => [...prev, emptyExperience()])} className="text-xs text-indigo-600 hover:underline font-medium">+ Add entry</button>
                  </div>
                  {experience.length === 0 && <p className="text-xs text-slate-400">No work experience entries yet.</p>}
                  {experience.map((row, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3 grid sm:grid-cols-2 gap-2 relative">
                      <button type="button" onClick={() => setExperience((prev) => prev.filter((_, idx) => idx !== i))} className="absolute top-2 right-2 text-xs text-red-500 hover:underline">Remove</button>
                      <div>
                        <label className="form-label text-xs">Job Title</label>
                        <input type="text" value={row.title} onChange={(e) => setExperience((prev) => prev.map((r, idx) => idx === i ? { ...r, title: e.target.value } : r))} placeholder="e.g. English Teacher" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Employer</label>
                        <input type="text" value={row.employer} onChange={(e) => setExperience((prev) => prev.map((r, idx) => idx === i ? { ...r, employer: e.target.value } : r))} placeholder="School / Company name" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Start Date</label>
                        <input type="date" value={row.startDate} onChange={(e) => setExperience((prev) => prev.map((r, idx) => idx === i ? { ...r, startDate: e.target.value } : r))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">End Date <span className="text-slate-400">(blank = current)</span></label>
                        <input type="date" value={row.endDate} onChange={(e) => setExperience((prev) => prev.map((r, idx) => idx === i ? { ...r, endDate: e.target.value } : r))} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="form-label text-xs">Description</label>
                        <textarea value={row.description} onChange={(e) => setExperience((prev) => prev.map((r, idx) => idx === i ? { ...r, description: e.target.value } : r))} rows={2}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Key responsibilities / achievements…" />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Certifications */}
                <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-800">🏅 Certifications</h2>
                    <button type="button" onClick={() => setCertifications((prev) => [...prev, emptyCertification()])} className="text-xs text-indigo-600 hover:underline font-medium">+ Add entry</button>
                  </div>
                  {certifications.length === 0 && <p className="text-xs text-slate-400">No certifications yet.</p>}
                  {certifications.map((row, i) => (
                    <div key={i} className="border border-slate-200 rounded-xl p-3 grid sm:grid-cols-3 gap-2 relative">
                      <button type="button" onClick={() => setCertifications((prev) => prev.filter((_, idx) => idx !== i))} className="absolute top-2 right-2 text-xs text-red-500 hover:underline">Remove</button>
                      <div>
                        <label className="form-label text-xs">Name</label>
                        <input type="text" value={row.name} onChange={(e) => setCertifications((prev) => prev.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))} placeholder="e.g. TESOL Certificate" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Issuer</label>
                        <input type="text" value={row.issuer} onChange={(e) => setCertifications((prev) => prev.map((r, idx) => idx === i ? { ...r, issuer: e.target.value } : r))} placeholder="Issuing organization" />
                      </div>
                      <div>
                        <label className="form-label text-xs">Issue Date</label>
                        <input type="date" value={row.issueDate} onChange={(e) => setCertifications((prev) => prev.map((r, idx) => idx === i ? { ...r, issueDate: e.target.value } : r))} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 pb-8">
                  <button type="button" onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-sm disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save CV'}
                  </button>
                  {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
                  {saveError && <span className="text-sm text-red-600">{saveError}</span>}
                </div>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
