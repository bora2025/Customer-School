'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRole?: string;
  allowedRoles?: string[];
}

const EMPLOYEE_EXCLUDED_ROLES = ['ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN', 'DEPARTMENT_ADMIN', 'OFFICE_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'WATTAMAN', 'WATTAMAN_REPORTER', 'CLASS_ADMIN', 'ACCOUNTER'];

// ── Module-level auth cache ────────────────────────────────────────────────
// `/api/auth/me` is called once per app session and cached here so subsequent
// page navigations within the same SPA session do NOT block on the network.
// We still revalidate in the background to detect role/session changes.
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
let authCache: { role: string; checkedAt: number } | null = null;
let authInflight: Promise<{ role: string } | null> | null = null;

async function fetchMe(): Promise<{ role: string } | null> {
  if (authInflight) return authInflight;
  authInflight = (async () => {
    try {
      let res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!refreshRes.ok) return null;
        res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) return null;
      }
      const user = await res.json();
      authCache = { role: user.role, checkedAt: Date.now() };
      return user;
    } catch {
      return null;
    } finally {
      authInflight = null;
    }
  })();
  return authInflight;
}

function isRoleAllowed(userRole: string, requiredRole?: string, allowedRoles?: string[]): boolean {
  // SUPER_ADMIN is a superset of ADMIN — can access anything ADMIN can.
  // ADMIN is a superset of CLASS_ADMIN — can access anything CLASS_ADMIN can.
  const effectiveAllows = (target: string) =>
    userRole === target ||
    (target === 'ADMIN' && (userRole === 'SUPER_ADMIN' || userRole === 'SCHOOL_ADMIN')) ||
    (target === 'CLASS_ADMIN' && (userRole === 'SUPER_ADMIN' || userRole === 'SCHOOL_ADMIN' || userRole === 'ADMIN')) ||
    (target === 'ACCOUNTER' && (userRole === 'SUPER_ADMIN' || userRole === 'SCHOOL_ADMIN' || userRole === 'ADMIN'));

  if (allowedRoles && allowedRoles.length > 0) {
    if (allowedRoles.some(r => effectiveAllows(r))) return true;
    // Special meta-role: EMPLOYEE means any role not in excluded list
    if (allowedRoles.includes('EMPLOYEE')) {
      return !EMPLOYEE_EXCLUDED_ROLES.includes(userRole);
    }
    return false;
  }
  if (requiredRole) {
    return effectiveAllows(requiredRole);
  }
  return true; // no restriction
}

export default function AuthGuard({ children, requiredRole, allowedRoles }: AuthGuardProps) {
  // Synchronously seed from the module-level cache so repeat navigations within
  // the same session render the protected content INSTANTLY (no spinner flash).
  const cachedAllowed = authCache ? isRoleAllowed(authCache.role, requiredRole, allowedRoles) : false;
  const [isAuthenticated, setIsAuthenticated] = useState(cachedAllowed);
  const [isLoading, setIsLoading] = useState(!cachedAllowed);
  const router = useRouter();
  const pathname = usePathname();
  const loginUrl = `/login?returnTo=${encodeURIComponent(pathname)}`;

  useEffect(() => {
    const _requiredRole = requiredRole;
    const _allowedRoles = allowedRoles;
    const _loginUrl = loginUrl;
    let cancelled = false;

    // If cache is fresh, skip network entirely on this mount.
    const cacheFresh = authCache && Date.now() - authCache.checkedAt < AUTH_CACHE_TTL_MS;
    if (cacheFresh && cachedAllowed) {
      // Already authenticated above; no-op. Background revalidation runs in the
      // separate effect below on a 10-min interval.
      return;
    }

    (async () => {
      const user = await fetchMe();
      if (cancelled) return;
      if (!user) {
        localStorage.removeItem('role');
        router.push(_loginUrl);
        return;
      }
      if (!isRoleAllowed(user.role, _requiredRole, _allowedRoles)) {
        router.push(_loginUrl);
        return;
      }
      localStorage.setItem('role', user.role);
      setIsAuthenticated(true);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactively refresh the access token every 10 minutes so it never expires mid-session
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        .then(() => fetchMe()) // also revalidate /me so role changes propagate
        .catch(() => {});
    }, 10 * 60 * 1000); // 10 minutes
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-slate-500 mt-3">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect
  }

  return <>{children}</>;
}