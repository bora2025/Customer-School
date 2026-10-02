'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { apiFetch } from '../../../../../../lib/api'

interface CvData {
  user: { id: string; name: string; email: string | null; phone: string | null; photo: string | null; role: string; department: { name: string } | null }
  title: string
  summary: string
  skills: string[]
  education: { id: string; institution: string; degree: string | null; fieldOfStudy: string | null; startYear: number | null; endYear: number | null }[]
  workExperience: { id: string; title: string; employer: string; startDate: string | null; endDate: string | null; description: string | null }[]
  certifications: { id: string; name: string; issuer: string | null; issueDate: string | null }[]
}

function fmtMonthYear(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function StaffCvPrintPage() {
  const params = useParams<{ id: string }>()
  const userId = params?.id as string

  const [data, setData] = useState<CvData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return
    apiFetch(`/api/staff-cv/${userId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject('Failed to load')))
      .then((d: CvData) => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load CV data.'); setLoading(false) })
  }, [userId])

  useEffect(() => {
    if (!loading && !error && data) {
      const timer = setTimeout(() => window.print(), 400)
      return () => clearTimeout(timer)
    }
  }, [loading, error, data])

  const printedAt = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-red-600 font-medium">{error || 'CV not found.'}</p>
      </div>
    )
  }

  const { user } = data
  const contactLine = [user.email, user.phone, user.department?.name].filter(Boolean).join('  ·  ')

  return (
    <>
      <style>{`
        @media print {
          @page { size: 210mm 297mm; margin: 16mm 18mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; }
        .cv-section-title {
          font-size: 11pt; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
          color: #312e81; border-bottom: 2px solid #4f46e5; padding-bottom: 4px; margin: 18px 0 10px;
        }
        .cv-entry-title { font-size: 10.5pt; font-weight: 700; color: #0f172a; }
        .cv-entry-sub { font-size: 9.5pt; color: #475569; }
        .cv-entry-date { font-size: 9pt; color: #64748b; white-space: nowrap; }
        .cv-entry-desc { font-size: 9.5pt; color: #334155; margin-top: 3px; line-height: 1.45; white-space: pre-wrap; }
      `}</style>

      {/* No-print toolbar */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
        <button onClick={() => window.print()} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          🖨️ Print
        </button>
        <button onClick={() => window.close()} className="text-slate-600 hover:text-slate-800 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
          ✕ Close
        </button>
        <span className="text-xs text-slate-400 ml-2">Curriculum Vitae — {user.name}</span>
      </div>
      <div className="no-print h-14" />

      {/* CV body */}
      <div style={{ maxWidth: '210mm', margin: '0 auto', padding: '0 6mm 12mm' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '3px solid #4f46e5', paddingBottom: '14px', marginBottom: '4px' }}>
          {user.photo ? (
            <img src={user.photo} alt={user.name} style={{ width: '72px', height: '72px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #e2e8f0' }} />
          ) : (
            <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#eef2ff', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22pt', fontWeight: 800 }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 style={{ fontSize: '20pt', fontWeight: 800, margin: 0, color: '#0f172a' }}>{user.name}</h1>
            {data.title && <p style={{ fontSize: '12pt', fontWeight: 600, color: '#4f46e5', margin: '2px 0' }}>{data.title}</p>}
            {contactLine && <p style={{ fontSize: '9pt', color: '#64748b', margin: 0 }}>{contactLine}</p>}
          </div>
        </div>

        {data.summary && (
          <div>
            <div className="cv-section-title">Professional Summary</div>
            <p style={{ fontSize: '9.5pt', lineHeight: 1.5, color: '#334155', margin: 0 }}>{data.summary}</p>
          </div>
        )}

        {data.workExperience.length > 0 && (
          <div>
            <div className="cv-section-title">Work Experience</div>
            {data.workExperience.map((e) => (
              <div key={e.id} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                  <div>
                    <span className="cv-entry-title">{e.title}</span>
                    <span className="cv-entry-sub"> — {e.employer}</span>
                  </div>
                  <span className="cv-entry-date">{fmtMonthYear(e.startDate)} – {e.endDate ? fmtMonthYear(e.endDate) : 'Present'}</span>
                </div>
                {e.description && <p className="cv-entry-desc">{e.description}</p>}
              </div>
            ))}
          </div>
        )}

        {data.education.length > 0 && (
          <div>
            <div className="cv-section-title">Education</div>
            {data.education.map((e) => (
              <div key={e.id} style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                <div>
                  <span className="cv-entry-title">{e.institution}</span>
                  {(e.degree || e.fieldOfStudy) && (
                    <span className="cv-entry-sub"> — {[e.degree, e.fieldOfStudy].filter(Boolean).join(', ')}</span>
                  )}
                </div>
                {(e.startYear || e.endYear) && (
                  <span className="cv-entry-date">{e.startYear ?? ''}{e.startYear || e.endYear ? ' – ' : ''}{e.endYear ?? 'Present'}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {data.certifications.length > 0 && (
          <div>
            <div className="cv-section-title">Certifications</div>
            {data.certifications.map((c) => (
              <div key={c.id} style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                <div>
                  <span className="cv-entry-title">{c.name}</span>
                  {c.issuer && <span className="cv-entry-sub"> — {c.issuer}</span>}
                </div>
                {c.issueDate && <span className="cv-entry-date">{fmtMonthYear(c.issueDate)}</span>}
              </div>
            ))}
          </div>
        )}

        {data.skills.length > 0 && (
          <div>
            <div className="cv-section-title">Skills</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {data.skills.map((s) => (
                <span key={s} style={{ fontSize: '9pt', background: '#eef2ff', color: '#4338ca', padding: '3px 10px', borderRadius: '999px', fontWeight: 600 }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '8px', fontSize: '7.5pt', color: '#94a3b8', textAlign: 'right' }}>
          Printed: {printedAt}
        </div>
      </div>
    </>
  )
}
