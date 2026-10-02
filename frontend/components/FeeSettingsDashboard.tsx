'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscountPreset {
  id: string
  name: string
  type: 'percent' | 'fixed'
  value: number
}

interface Promotion {
  id: string
  name: string
  type: 'percent' | 'fixed'
  value: number
  expiresAt: string   // YYYY-MM-DD or ''
  active: boolean
}

interface FeeSettings {
  schoolName: string
  schoolAddress: string
  schoolPhone: string
  schoolEmail: string
  invoiceTitle: string
  invoiceSubtitle: string
  invoiceFooter: string
  discountPresets: DiscountPreset[]
  promotions: Promotion[]
}

const DEFAULT: FeeSettings = {
  schoolName: 'Wattaman School',
  schoolAddress: '',
  schoolPhone: '',
  schoolEmail: '',
  invoiceTitle: 'INVOICE',
  invoiceSubtitle: 'Student Fee Receipt',
  invoiceFooter: 'This is a computer-generated invoice. No signature required.',
  discountPresets: [],
  promotions: [],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }

// ─── Invoice Preview ──────────────────────────────────────────────────────────

function InvoicePreview({ s }: { s: FeeSettings }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-base font-bold text-gray-900">{s.schoolName || '—'}</p>
          {s.schoolAddress && <p className="text-[11px] text-gray-400 mt-0.5">{s.schoolAddress}</p>}
          {(s.schoolPhone || s.schoolEmail) && (
            <p className="text-[11px] text-gray-400">{[s.schoolPhone, s.schoolEmail].filter(Boolean).join(' · ')}</p>
          )}
          <p className="text-[11px] text-gray-500 mt-1">{s.invoiceSubtitle || 'Student Fee Receipt'}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-extrabold text-gray-900 tracking-tight">{s.invoiceTitle || 'INVOICE'}</p>
          <p className="text-[11px] text-gray-400 mt-1">No: #A1B2C3D4</p>
          <p className="text-[11px] text-gray-400">Date: 04 Jul 2026</p>
        </div>
      </div>
      <hr className="border-gray-200 mb-4" />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Bill To</p>
          <p className="font-semibold text-gray-900 text-xs">Sample Student</p>
          <p className="text-[11px] text-gray-500">Class: Grade 8A</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Fee Details</p>
          <p className="text-[11px] text-gray-600">Term: <span className="font-medium text-gray-900">2025-26</span></p>
          <p className="text-[11px] text-gray-600">Due Date: <span className="font-medium text-gray-900">2026-08-01</span></p>
        </div>
      </div>
      <hr className="border-gray-100 mt-4 mb-2" />
      <p className="text-center text-[10px] text-gray-400">{s.invoiceFooter || '—'}</p>
    </div>
  )
}

// ─── Discount Preset Row ──────────────────────────────────────────────────────

function PresetRow({ preset, onChange, onDelete }: {
  preset: DiscountPreset
  onChange: (p: DiscountPreset) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
      <input
        type="text" value={preset.name} placeholder="Name (e.g. Scholarship)"
        onChange={e => onChange({ ...preset, name: e.target.value })}
        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
      />
      <select value={preset.type} onChange={e => onChange({ ...preset, type: e.target.value as 'percent' | 'fixed' })}
        className="px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
        <option value="percent">%</option>
        <option value="fixed">$</option>
      </select>
      <input
        type="number" min="0" step="0.1" value={preset.value} placeholder="0"
        onChange={e => onChange({ ...preset, value: parseFloat(e.target.value) || 0 })}
        className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white text-right"
      />
      <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ─── Promotion Row ────────────────────────────────────────────────────────────

function PromoRow({ promo, onChange, onDelete }: {
  promo: Promotion
  onChange: (p: Promotion) => void
  onDelete: () => void
}) {
  return (
    <div className={`p-3 rounded-xl border ${promo.active ? 'bg-emerald-50/60 border-emerald-100' : 'bg-gray-50 border-gray-100'}`}>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text" value={promo.name} placeholder="Promotion name"
          onChange={e => onChange({ ...promo, name: e.target.value })}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
        />
        <select value={promo.type} onChange={e => onChange({ ...promo, type: e.target.value as 'percent' | 'fixed' })}
          className="px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
          <option value="percent">%</option>
          <option value="fixed">$</option>
        </select>
        <input
          type="number" min="0" step="0.1" value={promo.value} placeholder="0"
          onChange={e => onChange({ ...promo, value: parseFloat(e.target.value) || 0 })}
          className="w-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white text-right"
        />
        <button onClick={onDelete} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={promo.active} onChange={e => onChange({ ...promo, active: e.target.checked })}
            className="rounded" />
          <span className={promo.active ? 'text-emerald-700 font-semibold' : 'text-gray-500'}>Active</span>
        </label>
        <span className="text-gray-400">Expires:</span>
        <input type="date" value={promo.expiresAt}
          onChange={e => onChange({ ...promo, expiresAt: e.target.value })}
          className="px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
        />
        {promo.expiresAt && (
          <button onClick={() => onChange({ ...promo, expiresAt: '' })} className="text-gray-400 hover:text-gray-600 text-xs">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Settings Dashboard ───────────────────────────────────────────────────────

type Tab = 'invoice' | 'discounts' | 'promotions'

export function FeeSettingsDashboard() {
  const [tab, setTab] = useState<Tab>('invoice')
  const [settings, setSettings] = useState<FeeSettings>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/fees/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSettings(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const res = await apiFetch('/api/fees/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
      else setError('Failed to save settings')
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  function setField<K extends keyof FeeSettings>(k: K, v: FeeSettings[K]) {
    setSettings(s => ({ ...s, [k]: v }))
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'invoice', label: 'Invoice' },
    { key: 'discounts', label: 'Discount Presets' },
    { key: 'promotions', label: 'Promotions' },
  ]

  return (
    <main className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fee Settings</h1>
            <p className="text-sm text-gray-500 mt-0.5">Configure invoice, discounts and promotions</p>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition disabled:opacity-60">
            {saving ? (
              <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</>
            ) : saved ? (
              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Saved</>
            ) : 'Save Settings'}
          </button>
        </div>

        {error && <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              {TABS.map(({ key, label }) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Invoice Tab ─────────────────────────────────────────────── */}
            {tab === 'invoice' && (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-1">School Information</h2>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">School Name</label>
                    <input type="text" value={settings.schoolName}
                      onChange={e => setField('schoolName', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                    <input type="text" value={settings.schoolAddress}
                      onChange={e => setField('schoolAddress', e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                      <input type="text" value={settings.schoolPhone}
                        onChange={e => setField('schoolPhone', e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                      <input type="email" value={settings.schoolEmail}
                        onChange={e => setField('schoolEmail', e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                    </div>
                  </div>
                  <hr className="border-gray-100" />
                  <h2 className="text-sm font-semibold text-gray-700">Invoice Header</h2>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Title</label>
                    <input type="text" value={settings.invoiceTitle}
                      onChange={e => setField('invoiceTitle', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Subtitle</label>
                    <input type="text" value={settings.invoiceSubtitle}
                      onChange={e => setField('invoiceSubtitle', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </div>
                  <hr className="border-gray-100" />
                  <h2 className="text-sm font-semibold text-gray-700">Invoice Footer</h2>
                  <div>
                    <textarea value={settings.invoiceFooter} rows={3}
                      onChange={e => setField('invoiceFooter', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Live Preview</p>
                  <InvoicePreview s={settings} />
                </div>
              </div>
            )}

            {/* ── Discounts Tab ───────────────────────────────────────────── */}
            {tab === 'discounts' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-700">Discount Presets</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Saved discounts selectable when creating fee records</p>
                  </div>
                  <button
                    onClick={() => setField('discountPresets', [...settings.discountPresets, { id: uid(), name: '', type: 'percent', value: 0 }])}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    Add Preset
                  </button>
                </div>
                {settings.discountPresets.length === 0 ? (
                  <div className="text-center py-10 text-sm text-gray-400">
                    No presets yet — add a discount template above
                  </div>
                ) : (
                  <div className="space-y-2">
                    {settings.discountPresets.map((p, i) => (
                      <PresetRow key={p.id} preset={p}
                        onChange={updated => setField('discountPresets', settings.discountPresets.map((x, j) => j === i ? updated : x))}
                        onDelete={() => setField('discountPresets', settings.discountPresets.filter((_, j) => j !== i))}
                      />
                    ))}
                  </div>
                )}
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
                  <strong>How it works:</strong> These presets appear as a dropdown when creating or editing a fee record, pre-filling the discount field. The actual discount applied is calculated based on the fee amount.
                </div>
              </div>
            )}

            {/* ── Promotions Tab ──────────────────────────────────────────── */}
            {tab === 'promotions' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-700">Promotions</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Time-limited discounts (e.g. Early-bird, Holiday special)</p>
                  </div>
                  <button
                    onClick={() => setField('promotions', [...settings.promotions, { id: uid(), name: '', type: 'percent', value: 0, expiresAt: '', active: true }])}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    Add Promotion
                  </button>
                </div>
                {settings.promotions.filter(p => p.active).length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700 font-medium">
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                    {settings.promotions.filter(p => p.active).length} active promotion{settings.promotions.filter(p => p.active).length !== 1 ? 's' : ''}
                  </div>
                )}
                {settings.promotions.length === 0 ? (
                  <div className="text-center py-10 text-sm text-gray-400">
                    No promotions yet — add a time-limited discount above
                  </div>
                ) : (
                  <div className="space-y-2">
                    {settings.promotions.map((p, i) => (
                      <PromoRow key={p.id} promo={p}
                        onChange={updated => setField('promotions', settings.promotions.map((x, j) => j === i ? updated : x))}
                        onDelete={() => setField('promotions', settings.promotions.filter((_, j) => j !== i))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
