'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getInstallationStatus,
  installWattanam,
  type InstallRequest,
  type InstallationState,
} from '../../lib/installation';

const initialForm: InstallRequest & { confirmPassword: string } = {
  schoolName: '',
  schoolSlug: '',
  locale: 'en-KH',
  timezone: 'Asia/Phnom_Penh',
  currency: 'KHR',
  ownerName: '',
  ownerEmail: '',
  ownerPassword: '',
  confirmPassword: '',
};

const steps = [
  { title: 'School', description: 'Identity and regional settings' },
  { title: 'Owner', description: 'Create the first administrator' },
  { title: 'Review', description: 'Confirm and lock installation' },
];

function makeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function SetupPage() {
  const router = useRouter();
  const [state, setState] = useState<InstallationState | 'checking' | 'unavailable'>('checking');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [installedSchool, setInstalledSchool] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getInstallationStatus(controller.signal)
      .then((result) => setState(result.state))
      .catch(() => setState('unavailable'));
    return () => controller.abort();
  }, []);

  const passwordChecks = useMemo(() => ({
    length: form.ownerPassword.length >= 12,
    letter: /[A-Za-z]/.test(form.ownerPassword),
    number: /\d/.test(form.ownerPassword),
    matches: form.ownerPassword.length > 0 && form.ownerPassword === form.confirmPassword,
  }), [form.ownerPassword, form.confirmPassword]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'schoolName' && !slugEdited) next.schoolSlug = makeSlug(String(value));
      return next;
    });
  }

  function validateCurrentStep() {
    setError('');
    if (step === 0) {
      if (form.schoolName.trim().length < 2) return 'Enter the school name.';
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.schoolSlug)) return 'Enter a valid lowercase school slug.';
      if (!form.locale || !form.timezone || !/^[A-Z]{3}$/.test(form.currency)) return 'Complete all regional settings.';
    }
    if (step === 1) {
      if (!form.ownerName.trim()) return 'Enter the owner name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.ownerEmail)) return 'Enter a valid owner email.';
      if (!passwordChecks.length || !passwordChecks.letter || !passwordChecks.number) {
        return 'Use at least 12 characters with a letter and number.';
      }
      if (!passwordChecks.matches) return 'The password confirmation does not match.';
    }
    return '';
  }

  function nextStep() {
    const message = validateCurrentStep();
    if (message) return setError(message);
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      const latest = await getInstallationStatus();
      if (latest.state !== 'ready') {
        setState(latest.state);
        throw new Error('This installation is no longer available for setup.');
      }
      await installWattanam({
        schoolName: form.schoolName.trim(),
        schoolSlug: form.schoolSlug,
        locale: form.locale,
        timezone: form.timezone,
        currency: form.currency,
        ownerName: form.ownerName.trim(),
        ownerEmail: form.ownerEmail.trim().toLowerCase(),
        ownerPassword: form.ownerPassword,
      });
      setInstalledSchool(form.schoolName.trim());
      setForm((current) => ({ ...current, ownerPassword: '', confirmPassword: '' }));
      setState('installed');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Installation failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'checking') return <SetupState title="Checking installation" detail="Contacting the Wattanam API…" busy />;

  if (state === 'unavailable') {
    return (
      <SetupState
        title="Setup service unavailable"
        detail="The API or database is not ready. Check the Railway deployment and /health/ready before trying again."
        action={<button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>}
      />
    );
  }

  if (state === 'legacy_unadopted') {
    return (
      <SetupState
        title="Legacy installation detected"
        detail="Users already exist, so public setup is locked to protect this school. Complete the documented legacy-adoption procedure instead."
        action={<Link href="/login" className="btn btn-primary">Go to sign in</Link>}
      />
    );
  }

  if (state === 'installed') {
    return (
      <SetupState
        title={installedSchool ? `${installedSchool} is ready` : 'Wattanam is already installed'}
        detail={installedSchool
          ? 'The installation is locked. Sign in with the owner account to finish school configuration.'
          : 'Public setup is locked. Sign in with an authorized account.'}
        action={<button className="btn btn-primary" onClick={() => router.replace('/login')}>Continue to sign in</button>}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
        <div className="grid lg:grid-cols-[280px_1fr]">
          <aside className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-indigo-700 p-7 text-white lg:min-h-[720px]">
            <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10" />
            <div className="relative">
              <div className="mb-10 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-xl font-black">W</div>
                <div><p className="font-bold">Wattanam V2</p><p className="text-xs text-white/65">Secure installation</p></div>
              </div>
              <ol className="space-y-5">
                {steps.map((item, index) => (
                  <li key={item.title} className={`flex gap-3 ${index > step ? 'opacity-45' : ''}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${index < step ? 'border-emerald-300 bg-emerald-300 text-teal-900' : index === step ? 'border-white bg-white text-teal-700' : 'border-white/50'}`}>
                      {index < step ? '✓' : index + 1}
                    </span>
                    <span><span className="block text-sm font-semibold">{item.title}</span><span className="text-xs text-white/65">{item.description}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <section className="p-6 sm:p-10">
            <div className="mb-8">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-teal-600">Step {step + 1} of {steps.length}</p>
              <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">{steps[step].title}</h1>
              <p className="mt-2 text-sm text-slate-500">{steps[step].description}</p>
            </div>

            {error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {step === 0 && (
              <div className="space-y-5">
                <Field label="School name" hint="Shown to staff, students, and parents.">
                  <input value={form.schoolName} onChange={(event) => update('schoolName', event.target.value)} autoFocus maxLength={150} placeholder="Angkor International School" />
                </Field>
                <Field label="School slug" hint="Permanent lowercase installation identifier.">
                  <input value={form.schoolSlug} onChange={(event) => { setSlugEdited(true); update('schoolSlug', event.target.value.toLowerCase()); }} maxLength={80} placeholder="angkor-international-school" />
                </Field>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Locale"><select value={form.locale} onChange={(event) => update('locale', event.target.value)}><option value="en-KH">English (Cambodia)</option><option value="km-KH">Khmer (Cambodia)</option><option value="en">English</option></select></Field>
                  <Field label="Timezone"><select value={form.timezone} onChange={(event) => update('timezone', event.target.value)}><option value="Asia/Phnom_Penh">Asia/Phnom Penh</option><option value="Asia/Bangkok">Asia/Bangkok</option><option value="Asia/Ho_Chi_Minh">Asia/Ho Chi Minh</option><option value="UTC">UTC</option></select></Field>
                  <Field label="Currency"><select value={form.currency} onChange={(event) => update('currency', event.target.value)}><option value="KHR">KHR</option><option value="USD">USD</option><option value="THB">THB</option><option value="VND">VND</option></select></Field>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <Field label="Owner name"><input value={form.ownerName} onChange={(event) => update('ownerName', event.target.value)} autoFocus maxLength={100} autoComplete="name" /></Field>
                <Field label="Owner email" hint="This becomes the first SUPER_ADMIN account."><input type="email" value={form.ownerEmail} onChange={(event) => update('ownerEmail', event.target.value)} maxLength={254} autoComplete="email" placeholder="owner@school.edu" /></Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Password"><input type="password" value={form.ownerPassword} onChange={(event) => update('ownerPassword', event.target.value)} maxLength={128} autoComplete="new-password" /></Field>
                  <Field label="Confirm password"><input type="password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} maxLength={128} autoComplete="new-password" /></Field>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <Check valid={passwordChecks.length}>At least 12 characters</Check>
                  <Check valid={passwordChecks.letter && passwordChecks.number}>Contains a letter and number</Check>
                  <Check valid={passwordChecks.matches}>Passwords match</Check>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <Review label="School" value={form.schoolName} />
                  <Review label="Slug" value={form.schoolSlug} />
                  <Review label="Region" value={`${form.locale} · ${form.timezone} · ${form.currency}`} />
                  <Review label="Owner" value={`${form.ownerName} · ${form.ownerEmail}`} last />
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Installation creates the first owner and permanently locks public setup. Confirm the email and regional settings before continuing.
                </div>
              </div>
            )}

            <div className="mt-10 flex items-center justify-between border-t border-slate-100 pt-6">
              <button type="button" className="btn btn-secondary" disabled={step === 0 || submitting} onClick={() => { setError(''); setStep((current) => current - 1); }}>Back</button>
              {step < steps.length - 1
                ? <button type="button" className="btn btn-primary" onClick={nextStep}>Continue</button>
                : <button type="button" className="btn btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Installing…' : 'Install Wattanam'}</button>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-800">{label}</span>{children}{hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}</label>;
}

function Check({ valid, children }: { valid: boolean; children: React.ReactNode }) {
  return <span className={valid ? 'text-emerald-700' : 'text-slate-400'}>{valid ? '✓' : '○'} {children}</span>;
}

function Review({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <div className={`grid gap-1 py-3 sm:grid-cols-[120px_1fr] ${last ? '' : 'border-b border-slate-200'}`}><dt className="text-sm font-semibold text-slate-500">{label}</dt><dd className="break-words text-sm font-medium text-slate-900">{value}</dd></div>;
}

function SetupState({ title, detail, action, busy = false }: { title: string; detail: string; action?: React.ReactNode; busy?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/60">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-2xl font-black text-teal-700">{busy ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" /> : 'W'}</div>
        <h1 className="text-2xl font-extrabold text-slate-900">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">{detail}</p>
        {action && <div className="mt-7">{action}</div>}
      </section>
    </main>
  );
}

