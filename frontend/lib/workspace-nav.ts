/**
 * Staff roles that work through plugins in a core installation. They have no core administration;
 * their menu is Home (+ Search) and the plugin pages their role is granted on Roles & access.
 *   WATTAMAN      takes attendance (scanning)
 *   RECEPTIONIST  front office
 *   TEACHER       the Teacher Portal: their classes, attendance, student permissions, score sheets
 */
export const WORKSPACE_ROLES = ['WATTAMAN', 'RECEPTIONIST', 'TEACHER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(role: string | null | undefined): role is WorkspaceRole {
  return Boolean(role && (WORKSPACE_ROLES as readonly string[]).includes(role));
}

/** The role's home: teachers keep their portal address. */
export function workspaceHome(role: string | null | undefined): string {
  return role === 'TEACHER' ? '/teacher' : '/workspace';
}

export function workspaceTitle(role: string | null | undefined): string {
  return role === 'TEACHER' ? 'Teacher Portal' : 'Workspace';
}

export const ROLE_INFO: Record<string, { label: string; kh: string; description: string }> = {
  SUPER_ADMIN: { label: 'Super admin', kh: 'អ្នកគ្រប់គ្រងកំពូល', description: 'Everything, including plugins, roles and system settings.' },
  ADMIN: { label: 'Admin', kh: 'អ្នកគ្រប់គ្រង', description: 'Runs the school: every feature its plugins grant to administrators.' },
  WATTAMAN: { label: 'Wattaman', kh: 'អ្នកស្កេនវត្តមាន', description: 'Takes attendance: scans students and staff.' },
  RECEPTIONIST: { label: 'Receptionist', kh: 'អ្នកទទួលភ្ញៀវ', description: 'Front office: search, register and update students and staff, print progress books, record books, report cards and ID cards.' },
  TEACHER: { label: 'Teacher', kh: 'គ្រូ', description: 'Your classes: take attendance, record student permissions, enter scores, look after your class.' },
};

export function workspaceNav(role: string | null | undefined) {
  const items: Array<{ label: string; href: string; icon: string; section?: string }> = [
    { label: 'Home', href: workspaceHome(role), icon: 'dashboard', section: 'nav.section.overview' },
  ];
  if (role === 'RECEPTIONIST') items.push({ label: 'Search', href: '/workspace/search', icon: 'search' });
  items.push({ label: 'My Profile', href: '/workspace/profile', icon: 'users' });
  return items;
}
