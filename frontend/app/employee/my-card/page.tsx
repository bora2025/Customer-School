"use client"

import { useEffect, useRef, useState } from 'react'
import Sidebar from '../../../components/Sidebar'
import AuthGuard from '../../../components/AuthGuard'
import { employeeNav } from '../../../lib/employee-nav'
import { apiFetch } from '../../../lib/api'
import { useLanguage } from '../../../lib/i18n'
import QRCode from 'qrcode'
import { CardDesign, STAFF_TEMPLATE, loadSavedDesign, apiGetActiveDesign, saveDesign } from '../../../components/card-designer/types'
import { renderDesignToCanvas } from '../../../components/card-designer/renderDesignToCanvas'
import { downloadSingleCardPDF } from '../../../components/card-designer/generateCardPDF'

function normalizePhotoUrl(url: string): string {
  if (!url) return url
  const match1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
  if (match1) return `https://lh3.googleusercontent.com/d/${match1[1]}`
  const match2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/)
  if (match2) return `https://lh3.googleusercontent.com/d/${match2[1]}`
  const match3 = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/)
  if (match3) return `https://lh3.googleusercontent.com/d/${match3[1]}`
  return url
}

interface UserInfo {
  id: string
  name: string
  email: string
  role: string
  phone: string | null
  photo: string | null
}

export default function MyIDCard() {
  const { t } = useLanguage()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [cardImgSrc, setCardImgSrc] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [design, setDesign] = useState<CardDesign>(STAFF_TEMPLATE)

  // Fetch current user
  useEffect(() => {
    apiFetch('/api/auth/me').then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        setUser(data)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  // Load active staff card design (API-first so employees see the latest shared design)
  useEffect(() => {
    const loadDesign = () => {
      apiGetActiveDesign('staff').then((apiDesign) => {
        if (apiDesign) {
          saveDesign(apiDesign);
          setDesign(apiDesign);
        } else {
          const saved = loadSavedDesign('staff')
          if (saved) setDesign(saved)
        }
      });
    };
    loadDesign();
    // Re-fetch when the tab becomes visible again
    const onVisibility = () => { if (document.visibilityState === 'visible') loadDesign(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [])

  // Generate QR code
  useEffect(() => {
    if (!user) return
    const qrData = JSON.stringify({ staffId: user.id })
    QRCode.toDataURL(qrData, { width: 400, margin: 1 }).then((url) => {
      setQrDataUrl(url)
    }).catch(() => {})
  }, [user])

  // Render card preview
  useEffect(() => {
    if (!user || !qrDataUrl) return
    let cancelled = false

    const fieldValues: Record<string, string> = {
      'Staff Name': user.name,
      'Emp ID': empId,
      'Position': user.role,
      'Student Name': '',
      'Student ID': '',
      'Class Name': '',
    }

    renderDesignToCanvas(design, {
      fieldValues,
      qrDataUrl,
      photoUrl: user.photo ? normalizePhotoUrl(user.photo) : undefined,
    }).then((canvas) => {
      if (!cancelled) setCardImgSrc(canvas.toDataURL())
    }).catch(() => {})

    return () => { cancelled = true }
  }, [user, qrDataUrl, design])

  const downloadPNG = async () => {
    if (!user || !qrDataUrl || exporting) return
    setExporting(true)
    try {
      const fieldValues: Record<string, string> = {
        'Staff Name': user.name,
        'Emp ID': empId,
        'Position': user.role,
        'Student Name': '',
        'Student ID': '',
        'Class Name': '',
      }
      const canvas = await renderDesignToCanvas(design, {
        fieldValues,
        qrDataUrl,
        photoUrl: user.photo ? normalizePhotoUrl(user.photo) : undefined,
      })
      const link = document.createElement('a')
      link.download = `${user.name.replace(/[^a-zA-Z0-9]/g, '-')}-id-card.png`
      link.href = canvas.toDataURL()
      link.click()
    } catch {
      alert('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const downloadPDF = async () => {
    if (!user || !qrDataUrl || exporting) return
    setExporting(true)
    try {
      const fieldValues: Record<string, string> = {
        'Staff Name': user.name,
        'Emp ID': empId,
        'Position': user.role,
        'Student Name': '',
        'Student ID': '',
        'Class Name': '',
      }
      await downloadSingleCardPDF(design, {
        name: user.name,
        fieldValues,
        qrDataUrl,
        photoUrl: user.photo ? normalizePhotoUrl(user.photo) : undefined,
      })
    } catch {
      alert('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const downloadQR = async () => {
    if (!qrDataUrl || !user) return
    const link = document.createElement('a')
    link.download = `${user.name.replace(/[^a-zA-Z0-9]/g, '-')}-qr.png`
    link.href = qrDataUrl
    link.click()
  }

  const empId = user?.id?.slice(0, 8).toUpperCase() ?? ''

  return (
    <AuthGuard allowedRoles={['EMPLOYEE']}>
      <div className="min-h-screen flex bg-slate-50">
        <Sidebar title="Employee" navItems={employeeNav} accentColor="emerald" />
        <main className="flex-1 p-4 md:p-8">
          <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-slate-800 mb-1">{t('myCard.title')}</h1>
            <p className="text-slate-500 mb-6">{t('myCard.subtitle')}</p>

            {loading ? (
              <div className="text-center py-20 text-slate-400">Loading...</div>
            ) : !user ? (
              <div className="text-center py-20 text-red-500">Failed to load user data</div>
            ) : (
              <div className="space-y-6">
                {/* Card Preview */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold text-slate-700 mb-4">Card Preview</h2>
                  <div className="flex justify-center">
                    <div
                      className="rounded-xl overflow-hidden shadow-lg bg-white"
                      style={{
                        width: '100%',
                        maxWidth: `${design.width * 1.5}px`,
                        aspectRatio: `${design.width} / ${design.height}`,
                      }}
                    >
                      {cardImgSrc ? (
                        <img
                          src={cardImgSrc}
                          alt="My ID Card"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          Rendering card...
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Download Buttons */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold text-slate-700 mb-4">Download Options</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      onClick={downloadPNG}
                      disabled={!cardImgSrc || exporting}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium border-2 border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      📥 Download PNG
                    </button>
                    <button
                      onClick={downloadPDF}
                      disabled={!cardImgSrc || exporting}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium border-2 border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      📄 Download PDF
                    </button>
                    <button
                      onClick={downloadQR}
                      disabled={!qrDataUrl || exporting}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium border-2 border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      📱 Download QR
                    </button>
                  </div>
                </div>

                {/* User Info */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold text-slate-700 mb-4">Card Details</h2>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Name</span>
                      <p className="font-medium text-slate-700">{user.name}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Employee ID</span>
                      <p className="font-medium text-slate-700">{empId}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Role / Position</span>
                      <p className="font-medium text-slate-700">{user.role}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Email</span>
                      <p className="font-medium text-slate-700">{user.email}</p>
                    </div>
                    {user.phone && (
                      <div>
                        <span className="text-slate-400">Phone</span>
                        <p className="font-medium text-slate-700">{user.phone}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
