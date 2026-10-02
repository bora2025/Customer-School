/**
 * Where people go while the school is locked for an unpaid platform bill.
 *
 * The Platform billing page admits ADMIN and SUPER_ADMIN, and AuthGuard's ADMIN rule lets SCHOOL_ADMIN
 * through as well. Everyone else -- teachers, students, parents, employees, scanning kiosks -- goes to
 * the lock screen: sending them to the billing page bounced them to sign-in, and signing in sent them
 * straight back.
 */
export const LOCK_RECOVERY_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'ADMIN'];

export function lockDestination(role: string | null | undefined): string {
  return role && LOCK_RECOVERY_ROLES.includes(role) ? '/admin/platform-billing' : '/suspended';
}

/** The role AuthGuard and the sign-in page remember. Storage can be blocked, so this never throws. */
export function storedRole(): string | null {
  try {
    return localStorage.getItem('role');
  } catch {
    return null;
  }
}

/** Each role's home page after signing in, and after the lock lifts. */
export function homeForRole(role: string | null | undefined): string {
  const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'SCHOOL_ADMIN', 'DEPARTMENT_ADMIN', 'OFFICE_ADMIN'];
  if (role && adminRoles.includes(role)) return '/admin';
  if (role === 'CLASS_ADMIN') return '/admin/classes';
  if (role === 'TEACHER') return '/teacher';
  if (role === 'STUDENT') return '/student';
  if (role === 'PARENT') return '/parent';
  if (role === 'WATTAMAN') return '/wattaman';
  if (role === 'WATTAMAN_REPORTER') return '/reporter';
  if (role === 'ACCOUNTER') return '/accounter';
  return '/employee';
}

export type SchoolAccessStatus = { access: 'ACTIVE' | 'SUSPENDED'; schoolName: string | null };

/**
 * Whether the school is locked. Plain fetch on purpose, not apiFetch: this is what decides where a
 * 402 should send someone, so it must never itself redirect. Null when the answer is unavailable.
 */
export async function fetchSchoolAccess(): Promise<SchoolAccessStatus | null> {
  try {
    const response = await fetch('/api/school-access', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as SchoolAccessStatus;
  } catch {
    return null;
  }
}
