'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '../../lib/i18n';
import { getInstallationStatus } from '../../lib/installation';
import { fetchSchoolAccess, homeForRole, lockDestination } from '../../lib/school-lock';

function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  useEffect(() => {
    const controller = new AbortController();
    getInstallationStatus(controller.signal)
      .then((result) => {
        if (result.state === 'ready') router.replace('/setup');
      })
      .catch(() => {
        // A temporary API failure must not redirect an installed school.
      });
    return () => controller.abort();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}) }),
      });

      if (res.ok) {
        const data = await res.json();
        const role = data.user?.role;
        if (role) localStorage.setItem('role', role);

        // On a school locked for an unpaid platform bill, returnTo would lead straight back to a
        // page that refuses them. Administrators go to the bill; everyone else to the lock screen.
        const lock = await fetchSchoolAccess();
        if (lock?.access === 'SUSPENDED') {
          router.push(lockDestination(role));
          return;
        }

        // Check for returnTo query param (e.g. from AuthGuard redirect)
        const returnTo = searchParams.get('returnTo');
        // Only allow safe relative paths
        if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
          router.push(returnTo);
        } else {
          router.push(homeForRole(role));
        }
      } else {
        setError(t('login.invalidCredentials'));
        setLoading(false);
      }
    } catch {
      setError(t('login.error'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Mobile: Gradient header + white card ── */}
      <div className="lg:hidden min-h-screen flex flex-col relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(155deg, #EEFFF7 0%, #E8F8FF 55%, #F0F4FF 100%)' }} />
        <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(0,201,167,0.25) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 70%)' }} />

        {/* Header */}
        <div className="relative z-10 px-5 pt-12 pb-20 flex flex-col items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #00C9A7, #00A88A)' }}>
          {/* Decorative blobs inside header */}
          <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full opacity-20 pointer-events-none"
            style={{ background: 'radial-gradient(circle, white, transparent)' }} />
          <div className="absolute -bottom-8 -left-8 w-28 h-28 rounded-full opacity-15 pointer-events-none"
            style={{ background: 'radial-gradient(circle, white, transparent)' }} />
          <Link href="/" className="absolute left-4 top-12 text-white/90 text-sm font-semibold flex items-center gap-1 hover:text-white transition-colors">
            ← {t('login.backToHome')}
          </Link>
          <div className="w-16 h-16 rounded-2xl mb-3 flex items-center justify-center shadow-lg"
            style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}>
            <Image src="/logo.png" alt="Wattaman" width={44} height={44} priority className="brightness-0 invert" />
          </div>
          <h1 className="text-[26px] font-extrabold text-white tracking-tight">{t('login.welcome')}</h1>
          <p className="text-white/75 text-sm mt-1">{t('login.subtitle')}</p>
        </div>

        {/* White card overlapping header */}
        <div className="relative z-10 flex-1 bg-white -mt-6" style={{ borderRadius: '28px 28px 0 0', boxShadow: '0 -8px 32px rgba(0,0,0,0.06)' }}>
          <form onSubmit={handleLogin} className="px-8 pt-8 pb-8 space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {error}
              </div>
            )}

            <div>
              <label className="block text-[15px] font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{t('common.emailOrPhone')}</label>
              <input
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[15px] font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{t('common.password')}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[15px] font-semibold mb-2" style={{ color: 'var(--color-text)' }}>MFA or recovery code <span className="font-normal text-slate-400">(if enabled)</span></label>
              <input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={10} />
            </div>

            <div className="pt-5">
              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-bold text-base py-4 disabled:opacity-60 transition-all active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #00C9A7, #00A88A)', borderRadius: '16px', boxShadow: '0 8px 24px rgba(0,168,138,0.32)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t('login.signingIn')}
                  </span>
                ) : (
                  t('common.signIn')
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Desktop: Split-screen layout ── */}
      <div className="hidden lg:flex min-h-screen">

        {/* LEFT: Brand panel */}
        <div className="w-[42%] xl:w-2/5 flex flex-col relative overflow-hidden"
          style={{ background: 'linear-gradient(150deg, #1e1b4b 0%, #312e81 40%, #0F766E 100%)' }}>
          {/* Decorative blobs */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
            <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 65%)' }} />
            <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(0,201,167,0.35) 0%, transparent 65%)' }} />
            <div className="absolute top-1/2 left-1/4 w-48 h-48 rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.18) 0%, transparent 65%)' }} />
          </div>
          {/* Grid overlay */}
          <div className="absolute inset-0 opacity-[0.04]"
            style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

          {/* Content */}
          <div className="relative z-10 flex flex-col h-full px-10 xl:px-14 py-10">
            {/* Logo */}
            <div className="flex items-center gap-3 mb-auto">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <Image src="/logo.png" alt="Wattaman" width={26} height={26} priority className="brightness-0 invert" />
              </div>
              <span className="font-bold text-white text-lg tracking-tight">Wattaman</span>
            </div>

            {/* Main text */}
            <div className="py-10">
              <h2 className="text-3xl xl:text-4xl font-extrabold text-white leading-tight mb-3">
                Smart Attendance<br />for Modern Schools
              </h2>
              <p className="text-white/60 text-sm xl:text-base leading-relaxed max-w-sm mb-10">
                {t('home.heroDesc')}
              </p>

              {/* Feature list */}
              <div className="space-y-3.5">
                {[
                  { icon: '⚡', label: t('home.instantCheckIn') },
                  { icon: '📡', label: t('home.liveTracking') },
                  { icon: '👥', label: 'Multi-role Access Control' },
                  { icon: '📊', label: t('home.csvAnalytics') },
                ].map((feature) => (
                  <div key={feature.label} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
                      style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)' }}>
                      {feature.icon}
                    </div>
                    <span className="text-white/85 text-sm">{feature.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <p className="text-white/30 text-xs">{t('home.footer')}</p>
          </div>
        </div>

        {/* RIGHT: Form panel */}
        <div className="flex-1 flex items-center justify-center px-10 xl:px-16 py-12 bg-white">
          <div className="w-full max-w-[400px]">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md overflow-hidden"
                  style={{ background: 'linear-gradient(135deg, #00C9A7, #0F766E)' }}>
                  <Image src="/logo.png" alt="Wattaman" width={28} height={28} priority className="brightness-0 invert p-0.5" />
                </div>
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900 mb-1">{t('login.welcome')}</h1>
              <p className="text-sm text-slate-500">{t('login.subtitle')}</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {error && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label className="form-label">{t('common.emailOrPhone')}</label>
                <input
                  type="text"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@school.edu or 012 345 678"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="form-label">{t('common.password')}</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="form-label">MFA or recovery code <span className="font-normal text-slate-400">(if enabled)</span></label>
                <input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={10} />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none"
                style={{ background: 'linear-gradient(135deg, #4F46E5, #6366F1)', boxShadow: '0 4px 14px rgba(79,70,229,0.3)' }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t('login.signingIn')}
                  </span>
                ) : t('common.signIn')}
              </button>
            </form>

            <p className="text-center text-sm text-slate-400 mt-6">
              <Link href="/" className="text-indigo-500 hover:text-indigo-700 transition-colors font-medium">
                ← {t('login.backToHome')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginContent />
    </Suspense>
  );
}
