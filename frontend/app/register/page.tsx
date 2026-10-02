'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '../../lib/api'

// A MULTI_SELECT value is string[] (needs length > 0); everything else is a plain string.
function customFieldHasValue(v: string | string[] | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : !!(v && v.trim())
}

interface PublicClass {
  id: string
  name: string
  subject: string | null
  registrationStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN'
  studyYear: { label: string | null; year: number } | null
}

type FieldMode = 'REQUIRED' | 'OPTIONAL' | 'HIDDEN'

interface FormConfig {
  settings: {
    khmerNameMode: FieldMode
    phoneMode: FieldMode
    emailMode: FieldMode
    photoMode: FieldMode
    passwordMode: FieldMode
    sexMode: FieldMode
    dateOfBirthMode: FieldMode
    addressMode: FieldMode
    generationMode: FieldMode
  }
  fields: { id: string; key: string; label: string; required: boolean; fieldType: 'TEXT' | 'SELECT' | 'MULTI_SELECT'; options: string[] | null }[]
}

const DEFAULT_FORM_CONFIG: FormConfig = {
  settings: {
    khmerNameMode: 'REQUIRED',
    phoneMode: 'REQUIRED',
    emailMode: 'REQUIRED',
    photoMode: 'OPTIONAL',
    passwordMode: 'REQUIRED',
    sexMode: 'HIDDEN',
    dateOfBirthMode: 'HIDDEN',
    addressMode: 'HIDDEN',
    generationMode: 'HIDDEN',
  },
  fields: [],
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PHOTO_BYTES = 3 * 1024 * 1024 // 3MB source file cap
const MIN_PASSWORD_LENGTH = 6

function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-base leading-none">{icon}</span>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{text}</h3>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  )
}

export default function StudentRegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}

function RegisterForm() {
  const searchParams = useSearchParams()
  const urlClassId = searchParams.get('classId') || ''

  const [classes, setClasses] = useState<PublicClass[]>([])
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [formConfig, setFormConfig] = useState<FormConfig>(DEFAULT_FORM_CONFIG)

  const [classId, setClassId] = useState(urlClassId)
  const [nameKh, setNameKh] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [sex, setSex] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [dobDay, setDobDay] = useState('')
  const [dobMonth, setDobMonth] = useState('')
  const [dobYear, setDobYear] = useState('')
  const [address, setAddress] = useState('')
  const [generation, setGeneration] = useState('')
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string | string[]>>({})

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [classesLoadError, setClassesLoadError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/class-registrations/public/classes')
        if (res.ok) {
          setClasses(await res.json())
        } else {
          setClassesLoadError(`Failed to load classes (${res.status}). Please try again later.`)
        }
      } catch {
        setClassesLoadError('Failed to load classes. Please check your connection and try again.')
      } finally {
        setLoadingClasses(false)
      }
    })()
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/class-registrations/public/form-config')
        if (res.ok) setFormConfig(await res.json())
      } catch {
        // Fall back to the default (all built-in fields required, no custom fields)
      }
    })()
  }, [])

  const { khmerNameMode, phoneMode, emailMode, photoMode, passwordMode, sexMode, dateOfBirthMode, addressMode, generationMode } = formConfig.settings

  const emailTrimmed = email.trim()
  const phoneTrimmed = phone.trim()
  const emailFormatOk = EMAIL_RE.test(emailTrimmed)

  // Email and Phone are each independently Required/Optional/Hidden (admin-configured,
  // never both Hidden at once — enforced server-side too). Whichever one is REQUIRED
  // must be present/valid on its own; if NEITHER is required, at least one of them
  // still has to be filled in, mirroring the backend's baseline safety net.
  const identifierOk =
    (emailMode !== 'REQUIRED' || (emailTrimmed !== '' && emailFormatOk)) &&
    (phoneMode !== 'REQUIRED' || phoneTrimmed !== '') &&
    (emailMode === 'REQUIRED' || phoneMode === 'REQUIRED' || emailFormatOk || phoneTrimmed !== '')

  // Blank is fine when Password isn't Required — the backend auto-generates one and
  // shows it to the admin. If the student types anything at all, it still has to
  // meet the minimum length and be confirmed correctly.
  const passwordValid = password === '' ? passwordMode !== 'REQUIRED' : password.length >= MIN_PASSWORD_LENGTH
  const passwordsMatch = password === '' ? true : password === confirmPassword

  const hasContactSection = phoneMode !== 'HIDDEN' || emailMode !== 'HIDDEN'
  const hasDetailsSection = photoMode !== 'HIDDEN' || sexMode !== 'HIDDEN' || dateOfBirthMode !== 'HIDDEN' || addressMode !== 'HIDDEN' || generationMode !== 'HIDDEN'

  // Day/Month/Year are typed as three separate boxes (some mobile browsers render a bare
  // type="date" input with no visible text at all) and combined into one ISO date here.
  const dobStarted = dobDay !== '' || dobMonth !== '' || dobYear !== ''
  useEffect(() => {
    const d = parseInt(dobDay, 10)
    const m = parseInt(dobMonth, 10)
    const y = parseInt(dobYear, 10)
    const valid = dobDay !== '' && dobMonth !== '' && dobYear.length === 4 &&
      d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= new Date().getFullYear()
    setDateOfBirth(valid ? `${dobYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '')
  }, [dobDay, dobMonth, dobYear])

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setPhotoError(null)
    if (!file) { setPhoto(null); return }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('Photo must be smaller than 3MB')
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => setPhoto(reader.result as string)
    reader.readAsDataURL(file)
  }

  const canSubmit =
    classId &&
    (khmerNameMode !== 'REQUIRED' || nameKh.trim()) &&
    nameEn.trim() &&
    identifierOk &&
    (photoMode !== 'REQUIRED' || photo) &&
    (sexMode !== 'REQUIRED' || sex) &&
    (dateOfBirthMode !== 'REQUIRED' || dateOfBirth) &&
    (addressMode !== 'REQUIRED' || address.trim()) &&
    (generationMode !== 'REQUIRED' || generation.trim()) &&
    passwordValid &&
    passwordsMatch &&
    formConfig.fields.every((f) => !f.required || customFieldHasValue(customFieldValues[f.key]))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch('/api/class-registrations/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          nameKh: khmerNameMode === 'HIDDEN' ? undefined : nameKh.trim(),
          nameEn: nameEn.trim(),
          // Only ever send email if it's actually a valid address — if it isn't
          // (e.g. leftover/duplicate text) and a phone was given, it's just dropped.
          email: emailMode === 'HIDDEN' ? undefined : (emailFormatOk ? emailTrimmed : undefined),
          phone: phoneMode === 'HIDDEN' ? undefined : phoneTrimmed || undefined,
          password: password || undefined,
          photo: photoMode === 'HIDDEN' ? undefined : photo || undefined,
          sex: sexMode === 'HIDDEN' ? undefined : sex || undefined,
          dateOfBirth: dateOfBirthMode === 'HIDDEN' ? undefined : dateOfBirth || undefined,
          address: addressMode === 'HIDDEN' ? undefined : address.trim() || undefined,
          generation: generationMode === 'HIDDEN' ? undefined : generation.trim() || undefined,
          customFieldValues,
        }),
      })
      if (res.ok) {
        setSuccess(true)
      } else {
        const j = await res.json().catch(() => ({}))
        setError(j.message || 'Failed to submit registration')
      }
    } catch {
      setError('Failed to submit registration')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white py-10 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6 text-center">
          <Link href="/" className="text-xs text-indigo-600 hover:underline">← Back to home</Link>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-2xl flex items-center justify-center mx-auto mt-4 shadow-lg shadow-indigo-200">
            🎓
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mt-3">Student Registration</h1>
          <p className="text-sm text-slate-500 mt-1">Register for a class — your request will be reviewed by an admin before your account is activated.</p>
        </div>

        {success ? (
          <div className="card p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 text-3xl flex items-center justify-center mx-auto mb-4">✅</div>
            <h2 className="text-lg font-semibold text-slate-800">Registration submitted</h2>
            <p className="text-sm text-slate-500 mt-2">
              Your registration is pending review.{' '}
              {emailTrimmed
                ? <>We'll email you at <span className="font-medium text-slate-700">{emailTrimmed}</span> once an admin approves or rejects it.</>
                : <>An admin will review your request soon.</>}
              {' '}Once approved, log in with the {emailTrimmed ? 'email' : 'phone number'} and{' '}
              {password ? 'password you just set.' : 'password your admin or teacher gives you.'}
            </p>
            <Link href="/" className="btn-primary inline-flex mt-6">Back to home</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 sm:p-8 space-y-6">
            <div>
              <label className="form-label">Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} required disabled={loadingClasses} className="truncate">
                <option value="">{loadingClasses ? 'Loading classes…' : 'Select a class…'}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.registrationStatus !== 'AVAILABLE'}>
                    {c.name}{c.subject ? ` — ${c.subject}` : ''}{c.registrationStatus !== 'AVAILABLE' ? ' (Closed)' : ''}
                  </option>
                ))}
              </select>
              {!loadingClasses && classesLoadError && (
                <p className="text-xs text-red-600 mt-1">{classesLoadError}</p>
              )}
              {!loadingClasses && !classesLoadError && classes.length === 0 && (
                <p className="text-xs text-slate-400 mt-1">No classes are currently open for registration.</p>
              )}
            </div>

            <div className="space-y-4">
              <SectionLabel icon="🧑" text="Personal Information" />

              {khmerNameMode !== 'HIDDEN' && (
                <div>
                  <label className="form-label">
                    Full Name (Khmer) — ឈ្មោះពេញជាភាសាខ្មែរ
                    {khmerNameMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs"> (optional)</span>}
                  </label>
                  <input type="text" value={nameKh} onChange={(e) => setNameKh(e.target.value)} required={khmerNameMode === 'REQUIRED'} placeholder="សុខ សុភា" />
                </div>
              )}

              <div>
                <label className="form-label">Full Name (English)</label>
                <input type="text" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required placeholder="Sok Sophea" />
              </div>
            </div>

            {hasContactSection && (
              <div className="space-y-4">
                <SectionLabel icon="📞" text="Contact" />

                {phoneMode !== 'HIDDEN' && (
                  <div>
                    <label className="form-label">
                      Phone Number
                      {phoneMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs"> (optional)</span>}
                    </label>
                    <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} required={phoneMode === 'REQUIRED'} placeholder="012 345 678" />
                  </div>
                )}

                {emailMode !== 'HIDDEN' && (
                  <div>
                    <label className="form-label">
                      Email
                      {emailMode === 'OPTIONAL' && (
                        <span className="text-slate-400 font-normal text-xs">
                          {' '}({phoneTrimmed ? 'you can leave this blank — you already entered a phone number above' : 'optional'})
                        </span>
                      )}
                    </label>
                    <input
                      // type="text", not "email" — the browser's own type="email" format
                      // validation would block submission natively even when our own JS
                      // validation intentionally allows non-email text here once a phone
                      // number covers the requirement, regardless of the required attribute.
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required={emailMode === 'REQUIRED'}
                      placeholder={emailMode !== 'REQUIRED' && phoneTrimmed ? 'Leave blank' : 'you@example.com'}
                    />
                    {email.length > 0 && !emailFormatOk && emailMode !== 'REQUIRED' && phoneTrimmed ? (
                      // A phone number already satisfies the requirement, so this is just an
                      // FYI — it won't block submission, and won't be sent since it isn't a
                      // valid email.
                      <p className="text-xs text-slate-400 mt-1">
                        This won't be submitted since it isn't a valid email — you're all set with the phone number entered above.
                      </p>
                    ) : email.length > 0 && !emailFormatOk && /^[\d\s+()-]+$/.test(emailTrimmed) ? (
                      <p className="text-xs text-red-600 mt-1">That looks like a phone number{phoneMode !== 'HIDDEN' ? ' — enter it in the Phone Number field above instead, and leave this blank' : ''}.</p>
                    ) : email.length > 0 && !emailFormatOk && (
                      <p className="text-xs text-red-600 mt-1">Enter a valid email address</p>
                    )}
                    {emailMode !== 'REQUIRED' && !emailTrimmed && !phoneTrimmed && phoneMode !== 'REQUIRED' && (
                      <p className="text-xs text-red-600 mt-1">Enter an email or a phone number above</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {hasDetailsSection && (
              <div className="space-y-4">
                <SectionLabel icon="🪪" text="Additional Details" />

                {photoMode !== 'HIDDEN' && (
                  <div className="flex flex-col items-center gap-2 py-1">
                    <label className="relative cursor-pointer group inline-block">
                      <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center group-hover:border-indigo-400 group-active:border-indigo-400 transition-colors">
                        {photo ? (
                          <img src={photo} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 17a4 4 0 100-8 4 4 0 000 8z" />
                          </svg>
                        )}
                      </div>
                      <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md ring-2 ring-white group-hover:bg-indigo-700 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      </span>
                      <input type="file" accept="image/*" onChange={handlePhotoChange} className="sr-only" />
                    </label>
                    <span className="text-xs font-medium text-slate-500">
                      Photo {photoMode === 'OPTIONAL' && <span className="font-normal text-slate-400">(optional)</span>}
                    </span>
                    {photo && (
                      <button type="button" onClick={() => setPhoto(null)} className="text-xs text-red-500 hover:underline px-2 py-1 -my-1">Remove photo</button>
                    )}
                    {photoError && <p className="text-xs text-red-600">{photoError}</p>}
                  </div>
                )}

                {sexMode !== 'HIDDEN' && (
                  <div>
                    <label className="form-label">
                      Sex {sexMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs">(optional)</span>}
                    </label>
                    <select value={sex} onChange={(e) => setSex(e.target.value)} required={sexMode === 'REQUIRED'}>
                      <option value="">Select…</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                    </select>
                  </div>
                )}

                {dateOfBirthMode !== 'HIDDEN' && (
                  <div>
                    <label className="form-label">
                      Date of Birth {dateOfBirthMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs">(optional)</span>}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text" inputMode="numeric" maxLength={2} placeholder="DD"
                        value={dobDay} onChange={(e) => setDobDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                        className="w-1/4 text-center"
                      />
                      <input
                        type="text" inputMode="numeric" maxLength={2} placeholder="MM"
                        value={dobMonth} onChange={(e) => setDobMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                        className="w-1/4 text-center"
                      />
                      <input
                        type="text" inputMode="numeric" maxLength={4} placeholder="YYYY"
                        value={dobYear} onChange={(e) => setDobYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className="w-1/2 text-center"
                      />
                    </div>
                    {dobStarted && !dateOfBirth && (
                      <p className="text-xs text-red-600 mt-1">Enter a valid day, month, and year</p>
                    )}
                  </div>
                )}

                {addressMode !== 'HIDDEN' && (
                  <div>
                    <label className="form-label">
                      Address {addressMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs">(optional)</span>}
                    </label>
                    <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} required={addressMode === 'REQUIRED'} placeholder="Street, City, Province" />
                  </div>
                )}

                {generationMode !== 'HIDDEN' && (
                  <div>
                    <label className="form-label">
                      Generation (ជំនាន់ទី) {generationMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs">(optional)</span>}
                    </label>
                    <input type="number" min="1" value={generation} onChange={(e) => setGeneration(e.target.value)} required={generationMode === 'REQUIRED'} placeholder="1" />
                  </div>
                )}
              </div>
            )}

            {formConfig.fields.length > 0 && (
              <div className="space-y-4">
                <SectionLabel icon="📋" text="More Information" />
                {formConfig.fields.map((f) => (
                  <div key={f.id}>
                    <label className="form-label">
                      {f.label}
                      {!f.required && <span className="text-slate-400 font-normal text-xs"> (optional)</span>}
                    </label>
                    {f.fieldType === 'MULTI_SELECT' ? (
                      <div className="flex flex-wrap gap-3 pt-1">
                        {(f.options || []).map((opt) => {
                          const selected = Array.isArray(customFieldValues[f.key]) ? (customFieldValues[f.key] as string[]) : []
                          return (
                            <label key={opt} className="flex items-center gap-1.5 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={selected.includes(opt)}
                                onChange={(e) => setCustomFieldValues((prev) => {
                                  const cur = Array.isArray(prev[f.key]) ? (prev[f.key] as string[]) : []
                                  const next = e.target.checked ? [...cur, opt] : cur.filter((o) => o !== opt)
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
                        value={(customFieldValues[f.key] as string) || ''}
                        onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        required={f.required}
                      >
                        <option value="">Select…</option>
                        {(f.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={(customFieldValues[f.key] as string) || ''}
                        onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        required={f.required}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {passwordMode !== 'HIDDEN' && (
              <div className="space-y-4">
                <SectionLabel icon="🔒" text="Account Security" />

                <div>
                  <label className="form-label">
                    Password
                    {passwordMode === 'OPTIONAL' && <span className="text-slate-400 font-normal text-xs"> (optional — leave blank and your admin/teacher will give you one)</span>}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={passwordMode === 'REQUIRED'}
                    minLength={password ? MIN_PASSWORD_LENGTH : undefined}
                    placeholder={passwordMode === 'REQUIRED' ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Leave blank, or set your own'}
                  />
                  {password.length > 0 && !passwordValid && (
                    <p className="text-xs text-red-600 mt-1">Password must be at least {MIN_PASSWORD_LENGTH} characters</p>
                  )}
                </div>

                {password.length > 0 && (
                  <div>
                    <label className="form-label">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Re-enter your password"
                    />
                    {confirmPassword.length > 0 && !passwordsMatch && (
                      <p className="text-xs text-red-600 mt-1">Passwords do not match</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button type="submit" disabled={!canSubmit || submitting} className="btn-primary w-full justify-center disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit Registration'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
