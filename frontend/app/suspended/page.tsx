'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../lib/i18n';
import { LOCK_RECOVERY_ROLES, fetchSchoolAccess, homeForRole, storedRole } from '../../lib/school-lock';

/** How often the screen asks whether the school is open again. */
const CHECK_EVERY_MS = 60_000;

/**
 * Where everyone except administrators lands while the school is locked for an unpaid platform bill.
 *
 * Deliberately outside AuthGuard and free of apiFetch: it has to render for a signed-out scanning
 * kiosk as well as a signed-in parent, and nothing on it may answer 402 and redirect it away. It shows
 * no amount -- students and parents have no business seeing the school's debts -- and it sends each
 * person back to their own home page as soon as the school is open again.
 */
export default function SuspendedPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const check = useCallback(async () => {
    const status = await fetchSchoolAccess();
    if (!status) return; // No answer: keep the notice up and ask again next minute.
    setSchoolName(status.schoolName);
    if (status.access === 'ACTIVE') {
      const current = storedRole();
      router.replace(current ? homeForRole(current) : '/login');
    }
  }, [router]);

  useEffect(() => {
    setRole(storedRole());
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    try {
      localStorage.removeItem('role');
    } catch {
      // Storage can be blocked; signing out on the server is what matters.
    }
    router.replace('/login');
  }

  const isAdmin = !!role && LOCK_RECOVERY_ROLES.includes(role);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-xl text-amber-700" aria-hidden>
          ❚❚
        </div>
        {schoolName && <p className="mt-4 text-sm font-semibold text-slate-500">{schoolName}</p>}
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t('suspended.title')}</h1>
        <p className="mt-3 text-slate-700">{t('suspended.message')}</p>
        <p className="mt-2 text-slate-700">{isAdmin ? t('suspended.adminHint') : t('suspended.contactAdmin')}</p>
        <p className="mt-4 text-xs text-slate-500">{t('suspended.autoReturn')}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {isAdmin && <Link className="btn btn-primary" href="/admin/platform-billing">{t('suspended.openBilling')}</Link>}
          {role && <button type="button" className="btn btn-secondary" onClick={signOut} disabled={signingOut}>{t('common.logout')}</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setLang(lang === 'en' ? 'kh' : 'en')}>
            {lang === 'en' ? 'ភាសាខ្មែរ' : 'English'}
          </button>
        </div>
      </div>
    </main>
  );
}
