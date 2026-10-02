'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../../../lib/api'
import QRCode from 'qrcode'

interface PrintTeacher {
  id: string
  timetableId: string
  timetableName: string
  name: string
  short: string
  sex: string | null
  color: string | null
  qrCode: string | null
  khmerName?: string | null
  weeklyLessons: number
  lessons: { subjectName: string; className: string; perWeek: number }[]
}

function TeacherIdCard({ teacher, orgName, schoolLogoUrl }: { teacher: PrintTeacher; orgName: string; schoolLogoUrl: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  useEffect(() => {
    if (teacher.qrCode) {
      QRCode.toDataURL(teacher.qrCode, {
        width: 200,
        margin: 1,
        color: { dark: '#1e293b', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).then(setQrDataUrl).catch(() => {})
    }
  }, [teacher.qrCode])

  const color = teacher.color || '#00C9A7'
  const uniqueSubjects = [...new Set(teacher.lessons.map(l => l.subjectName))]

  return (
    <div
      style={{
        width: '85.6mm',
        height: '54mm',
        display: 'flex',
        flexDirection: 'row',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#fff',
        boxSizing: 'border-box',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      {/* Left color strip */}
      <div
        style={{
          width: '12mm',
          background: color,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: '#fff',
            fontWeight: 700,
            fontSize: '10pt',
            letterSpacing: '0.05em',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            transform: 'rotate(180deg)',
            textAlign: 'center',
          }}
        >
          TEACHER
        </span>
      </div>

      {/* Center info */}
      <div
        style={{
          flex: 1,
          padding: '3mm 3mm',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
        }}
      >
        {/* School header: logo + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', marginBottom: '1mm' }}>
          {schoolLogoUrl && (
            <img
              src={schoolLogoUrl}
              alt="School Logo"
              style={{ width: '6mm', height: '6mm', objectFit: 'contain', flexShrink: 0 }}
            />
          )}
          {orgName && (
            <div style={{ fontSize: '6pt', color: '#64748b', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>
              {orgName}
            </div>
          )}
        </div>

        {/* Teacher name */}
        <div>
          <div style={{ fontSize: '10pt', fontWeight: 700, color: '#1e293b', lineHeight: 1.2, wordBreak: 'break-word', fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>
            {teacher.name}
          </div>
          {teacher.khmerName && (
            <div className="khmer-regular" style={{ fontSize: '9pt', fontWeight: 400, color: '#374151', lineHeight: 1.3, marginTop: '0.5mm', wordBreak: 'break-word' }}>
              {teacher.khmerName}
            </div>
          )}
          {teacher.short && (
            <div
              style={{
                display: 'inline-block',
                marginTop: '1mm',
                background: color + '22',
                color: color,
                fontWeight: 700,
                fontSize: '7pt',
                padding: '0.5mm 2mm',
                borderRadius: '3px',
                letterSpacing: '0.02em',
                fontFamily: '"Khmer", Inter, Arial, sans-serif',
              }}
            >
              {teacher.short}
            </div>
          )}
        </div>

        {/* Subjects */}
        <div style={{ marginTop: '1.5mm' }}>
          {uniqueSubjects.slice(0, 3).map((s, i) => (
            <div key={i} style={{ fontSize: '6.5pt', color: '#475569', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Khmer", Inter, Arial, sans-serif' }}>
              • {s}
            </div>
          ))}
          {uniqueSubjects.length > 3 && (
            <div style={{ fontSize: '6pt', color: '#94a3b8' }}>+{uniqueSubjects.length - 3} more</div>
          )}
        </div>

        {/* Timetable */}
        <div style={{ fontSize: '5.5pt', color: '#94a3b8', marginTop: '1mm' }}>
          {teacher.timetableName} · {teacher.weeklyLessons} lessons/wk
        </div>
      </div>

      {/* Right QR section */}
      <div
        style={{
          width: '22mm',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderLeft: '1px solid #f1f5f9',
          background: '#fafafa',
          padding: '2mm',
          flexShrink: 0,
        }}
      >
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="QR" style={{ width: '18mm', height: '18mm', display: 'block' }} />
        ) : (
          <div style={{ width: '18mm', height: '18mm', background: '#e2e8f0', borderRadius: '2px' }} />
        )}
        <div style={{ fontSize: '5pt', color: '#94a3b8', marginTop: '1.5mm', textAlign: 'center', lineHeight: 1.3 }}>
          SCAN TO<br />CHECK IN
        </div>
      </div>
    </div>
  )
}

function PrintContent() {
  const searchParams = useSearchParams()
  const timetableId = searchParams.get('timetableId') ?? ''
  const teacherIds = searchParams.get('teacherIds') ?? ''
  const orgNameParam = searchParams.get('orgName') ?? ''

  const [teachers, setTeachers] = useState<PrintTeacher[]>([])
  const [orgName, setOrgName] = useState('')
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [qrReady, setQrReady] = useState(false)
  const printedRef = useRef(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch teachers and current study year in parallel
        const [teachersRes, studyYearRes] = await Promise.all([
          apiFetch('/api/timetable/scheduled-teachers/all'),
          apiFetch('/api/study-years/current'),
        ])

        if (teachersRes.ok) {
          const data: PrintTeacher[] = await teachersRes.json()
          let filtered = data
          if (timetableId) filtered = filtered.filter(t => t.timetableId === timetableId)
          if (teacherIds) {
            const ids = new Set(teacherIds.split(','))
            filtered = filtered.filter(t => ids.has(t.id))
          }
          setTeachers(filtered)
        }

        if (studyYearRes.ok) {
          const sy = await studyYearRes.json()
          if (sy?.schoolName) setOrgName(sy.schoolName)
          if (sy?.logoUrl) setSchoolLogoUrl(sy.logoUrl)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [timetableId, teacherIds, orgNameParam])

  // Wait for QR codes + Khmer font to render, then auto-print
  useEffect(() => {
    if (!loading && teachers.length > 0 && !qrReady) {
      setTimeout(() => {
        setQrReady(true)
        setTimeout(async () => {
          if (!printedRef.current) {
            printedRef.current = true
            // Wait for Khmer font to load before printing
            try {
              await document.fonts.load('400 12px "Khmer"')
            } catch {}
            window.print()
          }
        }, 800)
      }, 1500)
    }
  }, [loading, teachers, qrReady])

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Khmer&display=swap" />
      <style>{`
        .khmer-regular {
          font-family: 'Khmer', sans-serif;
          font-weight: 400;
          font-style: normal;
        }
        @page { size: A4; margin: 10mm; }
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
        }
        body { background: #f1f5f9; font-family: 'Khmer', Inter, Arial, sans-serif; }
        .card-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6mm;
          padding: 10mm;
          background: white;
          min-height: 100vh;
        }
        @media screen {
          .card-grid {
            max-width: 240mm;
            margin: 0 auto;
          }
        }
      `}</style>

      {/* Print controls */}
      <div className="no-print" style={{ background: '#1e293b', color: '#fff', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ fontSize: '14px', fontWeight: 600 }}>
          Teacher ID Cards — {teachers.length} card{teachers.length !== 1 ? 's' : ''}
          {orgName !== 'School' && ` · ${orgName}`}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => window.history.back()}
            style={{ background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '6px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
          >
            ← Back
          </button>
          <button
            onClick={() => window.print()}
            style={{ background: '#00C9A7', border: 'none', color: '#fff', padding: '6px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            🖨 Print
          </button>
        </div>
      </div>

      {/* Hidden element to force browser to load Khmer font immediately */}
      <div className="khmer-regular" aria-hidden="true" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', fontSize: '1px' }}>ក</div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <div style={{ fontSize: '14px', color: '#64748b' }}>Loading teacher cards…</div>
        </div>
      ) : (
        <div className="card-grid">
          {teachers.map(t => (
            <TeacherIdCard key={t.id} teacher={t} orgName={orgName} schoolLogoUrl={schoolLogoUrl} />
          ))}
        </div>
      )}
    </>
  )
}

export default function ScheduledTeacherPrintPage() {
  return (
    <Suspense>
      <PrintContent />
    </Suspense>
  )
}
